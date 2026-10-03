"""Resumable OpenAI diarized transcription of the four missing podcast transcripts.

--prepare performs local processing only. --run uploads prepared audio to OpenAI.
Credentials come from OPENAI_API_KEY or the ignored project .env.local file.
Uses Python stdlib and ffmpeg; API results and audio stay out of Git.
"""
import argparse
import hashlib
import html
import json
import math
import os
import re
import subprocess
import time
import urllib.error
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path


from backend.common import api_key, atomic_json, stamp
from backend.paths import ROOT
MODEL = "gpt-4o-transcribe-diarize"
PARAMS = {"model": MODEL, "response_format": "diarized_json", "chunking_strategy": "auto", "language": "zh"}


def sha(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest() if hasattr(hashlib, "file_digest") else hashlib.sha256(source.read()).hexdigest()


def choose_boundaries(duration, silences, target=600, radius=30):
    """Prefer silence near each target, covering the source exactly once."""
    boundaries = [0.0]
    while duration - boundaries[-1] > target + radius:
        aim = boundaries[-1] + target
        candidates = [s for s in silences if abs(s - aim) <= radius]
        boundaries.append(round(min(candidates, key=lambda s: abs(s - aim)) if candidates else aim, 3))
    return boundaries + [duration]


def prepare(episode):
    eid = episode["id"]
    source = ROOT / "data/raw/audio" / f"{eid}.mp3"
    digest = sha(source)
    folder = ROOT / "data/raw/openai-asr" / eid
    folder.mkdir(parents=True, exist_ok=True)
    plan_path = folder / "plan.json"
    if plan_path.exists():
        plan = json.loads(plan_path.read_text())
        if plan["audio_sha256"] != digest or plan["parameters"] != PARAMS:
            raise ValueError("Existing plan has different audio/model parameters; preserve it and use a new cache.")
    else:
        duration = float(episode["duration_seconds"])
        detected = subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-i", str(source),
            "-af", "silencedetect=noise=-35dB:d=0.35", "-f", "null", "-"], capture_output=True, check=True)
        silences = [float(end) - float(length)/2 for end, length in re.findall(
            r"silence_end: ([\d.]+) \| silence_duration: ([\d.]+)", detected.stderr.decode())]
        boundaries = choose_boundaries(duration, silences)
        plan = dict(episode_id=eid, title=episode["title"], source_audio=str(source.relative_to(ROOT)),
            audio_sha256=digest, duration_seconds=duration, parameters=PARAMS,
            boundary_method="silence_near_600_seconds_else_fixed_boundary",
            chunks=[dict(index=i, start=a, end=b, file=f"{i:03}.mp3")
                    for i, (a, b) in enumerate(zip(boundaries, boundaries[1:]))])
        atomic_json(plan_path, plan)
    for chunk in plan["chunks"]:
        path = folder / chunk["file"]
        if path.exists() and chunk.get("sha256"):
            if sha(path) != chunk["sha256"]:
                raise ValueError("Prepared audio checksum mismatch")
            continue
        pending = path.with_suffix(".tmp.mp3")
        subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-ss", str(chunk["start"]),
            "-i", str(source), "-t", str(chunk["end"]-chunk["start"]), "-map", "0:a:0", "-vn",
            "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "64k", str(pending)], check=True)
        pending.replace(path)
        chunk["sha256"] = sha(path)
        chunk["byte_count"] = path.stat().st_size
        if chunk["byte_count"] >= 25_000_000:
            raise ValueError("Audio chunk exceeds API upload size")
        atomic_json(plan_path, plan)
    return folder, plan


def request_transcript(path, key):
    boundary = uuid.uuid4().hex
    body = bytearray()
    for name, value in dict(PARAMS, stream="true").items():
        body.extend(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
    body.extend(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.mp3"\r\nContent-Type: audio/mpeg\r\n\r\n'.encode())
    body.extend(path.read_bytes())
    body.extend(f"\r\n--{boundary}--\r\n".encode())
    request = urllib.request.Request("https://api.openai.com/v1/audio/transcriptions", data=bytes(body),
        headers={"Authorization": "Bearer " + key, "Content-Type": "multipart/form-data; boundary=" + boundary})
    try:
        with urllib.request.urlopen(request, timeout=600) as response:
            if "text/event-stream" not in response.headers.get("Content-Type", ""):
                return json.load(response), response.headers.get("x-request-id")
            event_path = path.with_name(path.stem + ".events." + uuid.uuid4().hex[:8] + ".jsonl")
            with event_path.open("w") as event_log:
                result = read_transcript_stream(response, event_log, path.with_suffix(".progress.json"))
            return result, response.headers.get("x-request-id")
    except urllib.error.HTTPError as error:
        # Only expose the machine-readable error code, never bodies/headers or keys.
        try:
            code = json.loads(error.read()).get("error", {}).get("code") or "unspecified"
            code = re.sub(r"[^a-zA-Z0-9_-]", "", str(code))[:80]
        except (ValueError, AttributeError):
            code = "unspecified"
        raise RuntimeError(f"OpenAI HTTP {error.code} ({code}); completed chunks are saved. No automatic retry.") from None


def read_transcript_stream(response, event_log, progress_path=None):
    segments = []
    data = []
    for raw in response:
        line = raw.decode("utf-8").rstrip("\r\n")
        if line.startswith("data:"):
            data.append(line[5:].lstrip())
        elif line == "" and data:
            payload = "\n".join(data)
            data = []
            if payload == "[DONE]":
                continue
            event = json.loads(payload)
            event_log.write(json.dumps(event, ensure_ascii=False) + "\n")
            event_log.flush()
            if event.get("type") == "transcript.text.segment":
                segments.append(event)
                if progress_path:
                    atomic_json(progress_path, dict(segments_received=len(segments),
                        audio_seconds_received=event["end"], updated_at=datetime.now(timezone.utc).isoformat()))
            elif event.get("type") == "transcript.text.done":
                if not segments:
                    raise ValueError("Completed stream has no timestamped segments")
                return dict(text=event.get("text", ""), segments=segments, usage=event.get("usage"),
                    transport="stream", complete=True)
            elif event.get("type") == "error":
                raise RuntimeError("OpenAI stream returned an error; partial events saved")
    raise RuntimeError("OpenAI stream ended before transcript.text.done; partial events saved")


def redundant_zero_cues(response):
    """Record unplayable zero-length duplicates/backchannels without inventing time.

    All excluded items remain in raw responses and provenance for listening review.
    Substantive untimed text still fails validation.
    """
    segments = response.get("segments", [])
    redundant = []
    for index, cue in enumerate(segments):
        if cue.get("start") != cue.get("end"):
            continue
        text = str(cue.get("text", "")).strip()
        for other_index, other in enumerate(segments):
            if index != other_index and text and cue.get("speaker") == other.get("speaker") \
                    and other["start"] < other["end"] and other["start"] <= cue["start"] <= other["end"] \
                    and other["end"] - cue["start"] <= .5 and other.get("text", "").strip().endswith(text):
                redundant.append(dict(position=index, contained_in_position=other_index,
                    original_segment=cue, reason="zero_duration_text_already_in_same_speaker_overlapping_cue"))
                break
        else:
            if re.sub(r"[^\w]", "", text) in {"嗯", "嗯嗯", "啊", "哦", "噢", "对", "对吧", "是吧", "好", "是", "对对"}:
                redundant.append(dict(position=index, original_segment=cue,
                    reason="zero_duration_backchannel_retained_for_review_not_playable"))
    return redundant


def normalize_segments(response, chunk):
    output = []
    length = chunk["end"] - chunk["start"]
    source, notes = normalized_source_cues(response)
    redundant = {entry["position"] for entry in notes}
    for position, item in enumerate(source):
        if position in redundant:
            continue
        start, end = float(item["start"]), float(item["end"])
        text = str(item["text"]).strip()
        if not all(math.isfinite(v) for v in [start, end]) or not 0 <= start < min(end, length) or end > length + 0.25 or not text:
            raise ValueError("Malformed/out-of-range diarized segment; raw response retained for inspection")
        if not isinstance(item.get("speaker"), str) or not item["speaker"].strip():
            raise ValueError("Missing speaker label in diarized response")
        output.append(dict(start=round(chunk["start"]+start, 3),
            end=round(min(chunk["end"], chunk["start"]+end), 3), text=text,
            # Speaker identity is not assumed to persist across separate requests.
            speaker=f'chunk{chunk["index"]:03}:{item["speaker"]}', chunk_index=chunk["index"]))
    if not output:
        raise ValueError("No timestamped segments returned; refusing to invent timestamps")
    return sorted(output, key=lambda s: (s["start"], s["end"]))


def normalized_source_cues(response):
    source = [dict(s) for s in response.get("segments", [])]
    notes = redundant_zero_cues(response)
    excluded = {n["position"] for n in notes}
    for i, item in enumerate(source):
        if i in excluded or item["start"] != item["end"] or i == 0:
            continue
        prev = source[i-1]
        if i-1 not in excluded and prev["speaker"] == item["speaker"] and prev["start"] < prev["end"] \
                and 0 <= item["start"]-prev["end"] <= .25:
            prev["text"] += item["text"]
            prev["end"] = item["end"]  # existing source timestamp, no estimated duration
            excluded.add(i)
            notes.append(dict(position=i, merged_into_position=i-1, original_segment=item,
                reason="point_cue_merged_with_adjacent_same_speaker_using_source_boundary"))
    for i, item in enumerate(source):
        if i not in excluded and item['start'] == item['end'] and len(item.get('text','').strip()) <= 12:
            excluded.add(i)
            notes.append(dict(position=i, original_segment=item,
                reason="zero_duration_short_fragment_retained_for_review_not_indexed"))
    return source, notes


def run_chunk(folder, plan, chunk, key):
    target = folder / f'{chunk["index"]:03}.response.json'
    fingerprint = dict(audio_sha256=plan["audio_sha256"], upload_sha256=chunk["sha256"],
                           start=chunk["start"], end=chunk["end"], parameters=PARAMS)
    if target.exists():
        saved = json.loads(target.read_text())
        if saved["fingerprint"] != fingerprint:
            raise ValueError("Checkpoint mismatch; refusing to reuse a different request")
    else:
        print(f'UPLOADING {plan["episode_id"]} chunk {chunk["index"]+1}/{len(plan["chunks"])}', flush=True)
        started = time.monotonic()
        response, request_id = request_transcript(folder / chunk["file"], key)
        saved = dict(fingerprint=fingerprint, request_id=request_id,
            elapsed_seconds=round(time.monotonic()-started, 3),
            created_at=datetime.now(timezone.utc).isoformat(), response=response)
        atomic_json(target, saved)
    return normalize_segments(saved["response"], chunk), saved.get("elapsed_seconds")


def run_episode(episode, folder, plan, key):
    segments = []
    normalization_notes = []
    for chunk in plan["chunks"]:
        output, _ = run_chunk(folder, plan, chunk, key)
        segments.extend(output)
        saved = json.loads((folder / f'{chunk["index"]:03}.response.json').read_text())
        normalization_notes.extend(dict(chunk_index=chunk["index"], **note)
            for note in normalized_source_cues(saved["response"])[1])
        print(f'SAVED {episode["id"]} through {chunk["end"]:.1f}s', flush=True)
    segments.sort(key=lambda s: (s["start"], s["end"]))
    blocks = ["WEBVTT", "NOTE OpenAI diarized ASR. Speaker labels are chunk-local. Listening review pending."]
    for segment in segments:
        blocks.append(f'{stamp(segment["start"])} --> {stamp(segment["end"])}\n'
                      f'<v {html.escape(segment["speaker"], quote=True)}>{html.escape(segment["text"])}')
    target = ROOT / "data/raw" / f'{episode["id"]}.vtt'
    pending = target.with_suffix(".vtt.tmp")
    pending.write_text("\n\n".join(blocks) + "\n")
    pending.replace(target)
    meta = dict(complete=True, engine="openai-api", model=MODEL, audio_sha256=plan["audio_sha256"],
        transcript_sha256=sha(target), source_audio=plan["source_audio"], parameters=PARAMS,
        generated_at=datetime.now(timezone.utc).isoformat(), segments=segments,
        word_timestamps=False, speaker_scope="within_each_chunk_only", listening_review="pending",
        normalization_notes=normalization_notes,
        automated_checks=["finite_in_range_segment_timestamps", "nonempty_text_and_speaker", "all_chunks_received"])
    atomic_json(target.with_suffix(".asr.json"), meta)
    return meta


def run_parallel(episodes, manifest, manifest_path, key, workers):
    prepared = [(e, *prepare(e)) for e in episodes]
    report = dict(model=MODEL, status="running", complete=False, workers=workers,
        started_at=datetime.now(timezone.utc).isoformat(),
        total_audio_minutes=round(sum(e["duration_seconds"] for e in episodes)/60, 2),
        chunks_total=sum(len(p["chunks"]) for _, _, p in prepared), chunks_completed=0,
        completed_audio_seconds=0, episodes=[], errors=[])
    path = ROOT / "data/openai-asr-report.json"
    atomic_json(path, report)
    completed = {e["id"]: 0 for e in episodes}
    started = time.monotonic()
    with ThreadPoolExecutor(max_workers=workers) as pool:
        # Interleave episodes to keep four requests active without exceeding the cap.
        futures = {}
        for index in range(max(len(p["chunks"]) for _, _, p in prepared)):
            for episode, folder, plan in prepared:
                if index < len(plan["chunks"]):
                    chunk = plan["chunks"][index]
                    future = pool.submit(run_chunk, folder, plan, chunk, key)
                    futures[future] = (episode, folder, plan, chunk)
        for future in as_completed(futures):
            if future.cancelled():
                continue
            episode, folder, plan, chunk = futures[future]
            try:
                segments, elapsed = future.result()
                completed[episode["id"]] += 1
                report["chunks_completed"] += 1
                report["completed_audio_seconds"] += chunk["end"] - chunk["start"]
                print(json.dumps(dict(completed=report["chunks_completed"], total=report["chunks_total"],
                    episode=episode["title"], chunk=chunk["index"], elapsed_seconds=elapsed,
                    segments=len(segments)), ensure_ascii=False), flush=True)
                if completed[episode["id"]] == len(plan["chunks"]):
                    meta = run_episode(episode, folder, plan, key)  # all responses are cached
                    episode["transcript_origin"] = "openai_asr"
                    episode["audio_alignment_status"] = "timestamps_structurally_checked_listening_pending"
                    atomic_json(manifest_path, manifest)
                    report["episodes"].append(dict(id=episode["id"], title=episode["title"],
                        segments=len(meta["segments"]), status="transcribed_listening_pending"))
            except Exception as error:
                report["errors"].append(dict(episode_id=episode["id"], chunk=chunk["index"],
                    error_type=type(error).__name__, message=str(error)[:300]))
                # Keep successful in-flight responses, but stop queued paid work on failure.
                if not isinstance(error, ValueError):
                    for pending in futures:
                        pending.cancel()
                report["status"] = "failed"
            report["elapsed_seconds"] = round(time.monotonic()-started, 2)
            atomic_json(path, report)
    report["complete"] = len(report["episodes"]) == len(episodes) and not report["errors"]
    report["status"] = "transcribed" if report["complete"] else "failed"
    atomic_json(path, report)
    if not report["complete"]:
        raise RuntimeError("Transcription incomplete; see data/openai-asr-report.json. Saved chunks will be reused.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=ROOT / "data/collection-15.pending.json")
    parser.add_argument("--workers", type=int, choices=range(1, 5), default=4)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--prepare", action="store_true")
    mode.add_argument("--run", action="store_true")
    mode.add_argument("--benchmark", action="store_true", help="Transcribe and save the first prepared chunk only")
    args = parser.parse_args()
    key = api_key() if args.run or args.benchmark else None
    manifest = json.loads(args.manifest.read_text())
    episodes = [e for e in manifest["episodes"] if e.get("transcript_origin") in ("local_asr", "openai_asr")]
    if args.benchmark:
        folder, plan = prepare(episodes[0])
        chunk = plan["chunks"][0]
        segments, elapsed = run_chunk(folder, plan, chunk, key)
        result = dict(model=MODEL, audio_seconds=chunk["end"]-chunk["start"],
            elapsed_seconds=elapsed, segment_count=len(segments), episode_id=episodes[0]["id"],
            status="one_chunk_transcribed", listening_review="pending")
        atomic_json(ROOT / "data/openai-asr-benchmark.json", result)
        print(json.dumps(result, ensure_ascii=False), flush=True)
        return
    if args.run:
        import fcntl
        lock_path = ROOT / "data/raw/openai-asr/run.lock"
        lock_path.parent.mkdir(parents=True, exist_ok=True)
        with lock_path.open("w") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            run_parallel(episodes, manifest, args.manifest, key, args.workers)
        return
    report = dict(model=MODEL, status="prepared" if args.prepare else "transcribed",
                  total_audio_minutes=round(sum(e["duration_seconds"] for e in episodes)/60, 2), episodes=[])
    for episode in episodes:
        folder, plan = prepare(episode)
        print(f'PREPARED {episode["title"]}: {len(plan["chunks"])} chunks', flush=True)
        entry = dict(id=episode["id"], title=episode["title"], chunks=len(plan["chunks"]),
            duration_seconds=episode["duration_seconds"], plan=str((folder / "plan.json").relative_to(ROOT)))
        if args.run:
            meta = run_episode(episode, folder, plan, key)
            entry["segments"] = len(meta["segments"])
            episode["transcript_origin"] = "openai_asr"
            episode["audio_alignment_status"] = "timestamps_structurally_checked_listening_pending"
            atomic_json(args.manifest, manifest)
        report["episodes"].append(entry)
        atomic_json(ROOT / "data/openai-asr-report.json", dict(report, complete=len(report["episodes"]) == len(episodes)))


if __name__ == "__main__":
    main()
