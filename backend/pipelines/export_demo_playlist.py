"""Export the fixed demo from the existing SQLite corpus. No network or API calls."""
import hashlib
import json
import os
import shutil
import sqlite3
import subprocess

from backend.common import probe
from backend.paths import ROOT


def main():
    database = ROOT / "data/podcasts.sqlite3"
    if not database.exists():
        raise SystemExit("Missing local corpus: data/podcasts.sqlite3. See docs/real-corpus.md.")
    selection = json.loads((ROOT / "data/demo-playlist-selection.json").read_text())
    output = ROOT / "data/raw/legacy-demo-audio"
    output.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(f"file:{database}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    items = []
    for selected in selection["items"]:
        row = connection.execute("""
            SELECT e.id, e.title AS episode, e.source_url, p.title AS show,
                   a.local_path, a.sha256, c.id AS chapter_id, c.title,
                   c.start_seconds, c.end_seconds
            FROM episodes e JOIN podcasts p ON p.id=e.podcast_id
            JOIN source_assets a ON a.episode_id=e.id AND a.kind='audio'
            JOIN chapters c ON c.episode_id=e.id
            WHERE e.id=? AND c.title=?
        """, (selected["episodeId"], selected["chapter"])).fetchone()
        if row is None:
            raise ValueError(f"Chapter missing: {selected}")
        source = ROOT / row["local_path"]
        if not source.is_file():
            raise FileNotFoundError(source)
        source_info = probe(source)
        duration = row["end_seconds"] - row["start_seconds"]
        assert 0 <= row["start_seconds"] < row["end_seconds"] <= float(source_info["duration"])
        fingerprint = hashlib.sha256(
            f'{row["sha256"]}:{row["start_seconds"]}:{row["end_seconds"]}:mp3-96k-v1'.encode()
        ).hexdigest()[:16]
        clip_name = f"clip-{fingerprint}.mp3"
        clip = output / clip_name
        if not clip.exists():
            temporary = clip.with_suffix(".tmp.mp3")
            subprocess.run([
                "ffmpeg", "-nostdin", "-v", "error", "-y", "-ss", str(row["start_seconds"]),
                "-i", str(source), "-t", str(duration), "-map", "0:a:0", "-vn",
                "-map_metadata", "-1", "-c:a", "libmp3lame", "-b:a", "96k", str(temporary),
            ], check=True)
            temporary.replace(clip)
        assert abs(float(probe(clip)["duration"]) - duration) < 0.2
        # Some source files have an .mp3 suffix but actually contain MP4/AAC.
        # Give browsers the correct container; faststart permits immediate seeking.
        extension = ".mp3" if source_info["format_name"] == "mp3" else ".m4a"
        full = output / f'episode-{row["id"]}-{row["sha256"][:12]}{extension}'
        if not full.exists():
            if extension == ".mp3":
                try:
                    os.link(source, full)
                except OSError:
                    shutil.copyfile(source, full)
            else:
                temporary = full.with_suffix(".tmp.m4a")
                subprocess.run([
                    "ffmpeg", "-nostdin", "-v", "error", "-y", "-i", str(source),
                    "-map", "0:a:0", "-c:a", "copy", "-movflags", "+faststart", str(temporary),
                ], check=True)
                temporary.replace(full)
        cues = [dict(cue) for cue in connection.execute("""
            SELECT start_seconds AS start, end_seconds AS end, text
            FROM transcript_cues WHERE episode_id=? AND start_seconds>=? AND start_seconds<?
            ORDER BY position
        """, (row["id"], row["start_seconds"], row["end_seconds"]))]
        items.append({
            "id": fingerprint, "episodeId": row["id"], "chapterId": row["chapter_id"],
            "title": row["title"], "summary": selected["summary"], "show": row["show"],
            "episode": row["episode"], "sourceUrl": row["source_url"],
            "start": row["start_seconds"], "end": row["end_seconds"], "duration": duration,
            "episodeDuration": float(probe(full)["duration"]),
            "audioUrl": f"/demo-audio/{clip.name}", "episodeAudioUrl": f"/demo-audio/{full.name}",
            "cues": cues,
        })
    total = sum(item["duration"] for item in items)
    assert 3 <= len(items) <= 5 and 600 <= total <= 1800
    manifest = {"id": selection["id"], "title": selection["title"], "totalDuration": total, "items": items}
    (ROOT / "data/demo-playlist.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    connection.close()
    print(f"Prepared {len(items)} real clips, {total / 60:.2f} minutes, and local full episodes.")


if __name__ == "__main__":
    main()
