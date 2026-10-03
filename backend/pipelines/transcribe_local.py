"""Offline, resumable Chinese ASR using an already-cached Whisper model.

Run with .venv/bin/python. No audio upload or implicit model download.
Generated timestamps/text retain ASR provenance and require listening review.
"""
import argparse
import hashlib
import html
import json
import math
import os
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

from backend.common import atomic_json, stamp
from backend.paths import ROOT
CHUNK_SECONDS = 300
DECODE_OPTIONS = dict(language='zh', task='transcribe', fp16=False,
    verbose=None, temperature=0, beam_size=3, word_timestamps=True,
    condition_on_previous_text=False,
    initial_prompt='中文科技与职场播客。程序员、人工智能、AI、产品、研发、开源、职业成长。')


def read_audio(path, start, duration):
    import numpy as np
    r = subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-ss', str(start),
        '-i', str(path), '-t', str(duration), '-vn', '-ar', '16000', '-ac', '1',
        '-f', 'f32le', '-'], capture_output=True, check=True)
    return np.frombuffer(r.stdout, dtype=np.float32).copy()


def transcribe(model, samples):
    return model.transcribe(samples, **DECODE_OPTIONS)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', type=Path, default=Path.home() / '.cache/whisper/base.pt')
    parser.add_argument('--manifest', type=Path, default=ROOT / 'data/collection-15.pending.json')
    parser.add_argument('--benchmark', action='store_true')
    args = parser.parse_args()
    if not args.model.is_file():
        raise ValueError('Model must already exist locally; this script never downloads models.')
    # Numba's OpenMP pool conflicts with PyTorch's Intel OpenMP on this Intel Mac.
    # Use Numba's supported workqueue backend instead of suppressing runtime errors.
    os.environ.setdefault('NUMBA_THREADING_LAYER', 'workqueue')
    import torch
    import whisper
    torch.set_num_threads(4)
    model = whisper.load_model(str(args.model), device='cpu')
    model_name = args.model.stem
    model_sha = hashlib.sha256(args.model.read_bytes()).hexdigest()
    manifest = json.loads(args.manifest.read_text())
    episodes = [e for e in manifest['episodes'] if e.get('transcript_origin') == 'local_asr']
    if args.benchmark:
        audio = ROOT / f'data/raw/audio/{episodes[0]["id"]}.mp3'
        started = time.monotonic()
        output = transcribe(model, read_audio(audio, 300, 45))
        result = dict(seconds=time.monotonic()-started, audio_seconds=45,
            episode_id=episodes[0]['id'], source_start_seconds=300,
            model_sha256=model_sha, text=output['text'], segments=output['segments'])
        atomic_json(ROOT / 'data/raw/asr-benchmark.json', result)
        print(json.dumps({k:v for k,v in result.items() if k!='segments'},ensure_ascii=False),flush=True)
        return
    report = dict(model=model_name, engine='openai-whisper', status='running',
        total_audio_seconds=sum(e['duration_seconds'] for e in episodes), episodes=[])
    report_path = ROOT / 'data/local-asr-report.json'
    atomic_json(report_path, report)
    for e in episodes:
        eid = e['id']
        source = ROOT / f'data/raw/audio/{eid}.mp3'
        audio_sha = hashlib.sha256(source.read_bytes()).hexdigest()
        duration = float(e['duration_seconds'])
        cache = ROOT / 'data/raw/asr-checkpoints' / eid
        cache.mkdir(parents=True, exist_ok=True)
        all_segments = []
        for n in range(math.ceil(duration / CHUNK_SECONDS)):
            start = n * CHUNK_SECONDS
            end = min(start + CHUNK_SECONDS, duration)
            # Include a little context at chunk boundaries, keeping each word once.
            read_start = max(0, start - 2)
            read_end = min(duration, end + 2)
            target = cache / f'{n:03}.json'
            if target.exists():
                checkpoint = json.loads(target.read_text())
                if checkpoint['audio_sha256'] != audio_sha or checkpoint['model_sha256'] != model_sha:
                    raise ValueError('Checkpoint belongs to a different audio/model')
                if checkpoint.get('decode_options') != DECODE_OPTIONS:
                    raise ValueError('Checkpoint uses different decode options')
            else:
                started = time.monotonic()
                result = transcribe(model, read_audio(source, read_start, read_end-read_start))
                checkpoint = dict(audio_sha256=audio_sha, model_sha256=model_sha,
                    decode_options=DECODE_OPTIONS,
                    start=start, end=end, read_start=read_start,
                    elapsed_seconds=time.monotonic()-started, segments=result['segments'])
                atomic_json(target, checkpoint)
            for segment in checkpoint['segments']:
                words = [w for w in segment.get('words', [])
                    if start <= read_start + (w['start'] + w['end'])/2 < end]
                if not words:
                    continue
                s = max(start, read_start + words[0]['start'])
                t = min(end, read_start + words[-1]['end'])
                text = ''.join(w['word'] for w in words).strip()
                if t <= s or not text:
                    continue
                all_segments.append(dict(start=round(s,3), end=round(t,3), text=text,
                    avg_logprob=segment.get('avg_logprob'), no_speech_prob=segment.get('no_speech_prob')))
            print(json.dumps(dict(episode=e['title'], completed_seconds=end,
                total_seconds=duration, chunk_elapsed=round(checkpoint['elapsed_seconds'],1)),
                ensure_ascii=False),flush=True)
            report['current_episode'] = dict(id=eid, title=e['title'], completed_seconds=end,
                total_seconds=duration, chunks_completed=n+1, chunks_total=math.ceil(duration/CHUNK_SECONDS))
            atomic_json(report_path, report)
        if not all_segments:
            raise ValueError(f'No transcript for {eid}')
        blocks = ['WEBVTT', 'NOTE Local Whisper ASR; not publisher text; listening review pending.']
        for s in all_segments:
            blocks.append(f'{stamp(s["start"])} --> {stamp(s["end"])}\n{html.escape(s["text"])}')
        vtt = ROOT / f'data/raw/{eid}.vtt'
        vtt.with_suffix('.vtt.tmp').write_text('\n\n'.join(blocks)+'\n')
        vtt.with_suffix('.vtt.tmp').replace(vtt)
        atomic_json(ROOT / f'data/raw/{eid}.asr.json', dict(complete=True,
            engine='openai-whisper', version=whisper.__version__, model=model_name,
            model_sha256=model_sha, audio_sha256=audio_sha, language='zh',
            generated_at=datetime.now(timezone.utc).isoformat(), source_audio=str(source.relative_to(ROOT)),
            chunk_seconds=CHUNK_SECONDS, word_timestamps=True, segments=all_segments,
            decode_options=DECODE_OPTIONS, transcript_sha256=hashlib.sha256(vtt.read_bytes()).hexdigest(),
            listening_review='pending'))
        report['episodes'].append(dict(id=eid, title=e['title'], duration_seconds=duration,
            cues=len(all_segments), status='transcribed_listening_pending'))
        atomic_json(report_path, report)
        print('COMPLETE '+eid,flush=True)
    report['status'] = 'transcribed'
    report.pop('current_episode', None)
    atomic_json(report_path, report)


if __name__ == '__main__':
    main()
