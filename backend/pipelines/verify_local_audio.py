"""Verify downloaded corpus audio and extract source-cue audition windows.

Downloads belong in data/raw/audio/<episode-id>.mp3.part (curl must finish
successfully). This command fully decodes each file before promoting it to .mp3.
No transcription or speech synthesis is used; listening alignment is not asserted.
"""

import hashlib
import json
import shutil
import sqlite3
import subprocess
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

from backend.paths import ROOT


def audition_windows(cues, duration):
    """Prefer whole cues, grouping short adjacent utterances without inventing times."""
    windows = []
    for label, fraction in [('early', .1), ('middle', .5), ('late', .9)]:
        index = next((i for i, cue in enumerate(cues) if cue['start_seconds'] >= duration*fraction), len(cues)-1)
        selected = [cues[index]]
        for cue in cues[index+1:]:
            if max(c['end_seconds'] for c in selected) - selected[0]['start_seconds'] >= 15:
                break
            if cue['start_seconds'] - max(c['end_seconds'] for c in selected) > 3:
                break
            if cue['end_seconds'] - selected[0]['start_seconds'] > 45:
                break
            selected.append(cue)
        windows.append(dict(label=label, start_seconds=selected[0]['start_seconds'],
            end_seconds=max(c['end_seconds'] for c in selected),
            text='\n'.join(c['text'] for c in selected)))
    return windows


def run(args):
    result = subprocess.run(args, capture_output=True, text=True, timeout=300)
    if result.returncode:
        raise RuntimeError(f"{args[0]} failed: {result.stderr[-2000:]}")
    return result.stdout


def verify(episode):
    eid = episode['id']
    folder = ROOT / 'data/raw/audio'
    target = folder / f'{eid}.mp3'
    pending = folder / f'{eid}.mp3.part'
    source = pending if pending.exists() else target
    probe = json.loads(run(['ffprobe', '-v', 'error', '-select_streams', 'a:0',
        '-show_entries', 'format=duration,size:stream=codec_name,sample_rate,channels',
        '-of', 'json', str(source)]))
    duration = float(probe['format']['duration'])
    if not probe['streams'] or abs(duration - episode['duration_seconds']) > 1:
        raise ValueError(f"Unexpected format/duration for {eid}: {probe}")
    run(['ffmpeg', '-nostdin', '-v', 'error', '-xerror', '-i', str(source),
         '-map', '0:a:0', '-f', 'null', '-'])
    if source == pending:
        pending.replace(target)
    with sqlite3.connect(ROOT / 'data/podcasts.sqlite3') as db:
        db.row_factory = sqlite3.Row
        cues = [dict(row) for row in db.execute('SELECT start_seconds,end_seconds,text FROM transcript_cues '
            'WHERE episode_id=? ORDER BY start_seconds,position', (eid,))]
    if not cues:
        raise ValueError(f'No audition cues for {eid}')
    auditions = []
    for cue in audition_windows(cues, duration):
        clip = ROOT / 'data/raw/auditions' / f'{eid}-{cue["label"]}.mp3'
        clip.parent.mkdir(exist_ok=True)
        clip_duration = cue['end_seconds'] - cue['start_seconds']
        run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-ss', str(cue['start_seconds']),
            '-i', str(target), '-t', str(clip_duration), '-map', '0:a:0', '-vn',
            '-c:a', 'libmp3lame', '-b:a', '128k', str(clip)])
        clip_probe = json.loads(run(['ffprobe', '-v', 'error', '-show_entries',
            'format=duration', '-of', 'json', str(clip)]))
        if abs(float(clip_probe['format']['duration']) - clip_duration) > .15:
            raise ValueError(f'Clip duration mismatch for {eid}')
        auditions.append(dict(cue, local_path=str(clip.relative_to(ROOT)),
            measured_duration_seconds=float(clip_probe['format']['duration'])))
    digest = hashlib.sha256()
    with target.open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            digest.update(block)
    return dict(id=eid, title=episode['title'], source_audio_url=episode['audio_url'],
        local_path=str(target.relative_to(ROOT)), bytes=target.stat().st_size,
        sha256=digest.hexdigest(), duration_seconds=duration,
        rss_duration_seconds=episode['duration_seconds'], full_decode='passed',
        audio_format=probe['streams'][0], auditions=auditions,
        transcript_origin=episode.get('transcript_origin', 'publisher_vtt'),
        listening_alignment='not_verified')


def main():
    for command in ['ffmpeg', 'ffprobe']:
        if not shutil.which(command):
            raise RuntimeError(f'{command} must be installed')
    manifest = json.loads((ROOT / 'data/collection.json').read_text())
    with ThreadPoolExecutor(max_workers=2) as workers:
        episodes = list(workers.map(verify, manifest['episodes']))
    now = datetime.now(timezone.utc).isoformat()
    with sqlite3.connect(ROOT / 'data/podcasts.sqlite3') as db:
        db.execute('PRAGMA foreign_keys=ON')
        for e in episodes:
            db.execute('INSERT INTO source_assets VALUES (?,?,?,?,?,?,?) '
                'ON CONFLICT(episode_id,kind) DO UPDATE SET url=excluded.url,'
                'local_path=excluded.local_path,sha256=excluded.sha256,'
                'byte_count=excluded.byte_count,imported_at=excluded.imported_at',
                (e['id'], 'audio', e['source_audio_url'], e['local_path'],
                 e['sha256'], e['bytes'], now))
    report = dict(checked_at=now, episodes=episodes,
        total_bytes=sum(e['bytes'] for e in episodes),
        browser_playback='not_verified',
        notes='Full decode and source-timestamp clip extraction passed. '
              'Early/middle/late auditions use original audio, never synthesized speech. '
              'Text/audio alignment and recognition accuracy still require listening.')
    (ROOT / 'data/local-audio-report.json').write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(dict(episodes=len(episodes), total_bytes=report['total_bytes'],
        full_decode='passed', audition_extraction='passed',
        audition_count=sum(len(e['auditions']) for e in episodes)), ensure_ascii=False))


if __name__ == '__main__':
    main()
