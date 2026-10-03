"""Validate the completed 15-episode collection and publish it to local SQLite.

No network calls. Keeps a backup of the previous database and active manifest.
"""
import json
import sqlite3
from pathlib import Path

from backend import corpus
from backend.pipelines import verify_local_audio
from backend.pipelines import audit_transcripts
from backend.pipelines import build_audio_review

from backend.common import atomic_json
from backend.paths import ROOT


def main():
    manifest_path = ROOT / 'data/collection-15.pending.json'
    manifest = json.loads(manifest_path.read_text())
    origins = [e.get('transcript_origin') for e in manifest['episodes']]
    if len(origins) != 15 or origins.count('openai_asr') != 4 or origins.count('publisher_vtt') != 11:
        raise ValueError('Expected 15 completed episodes: 11 publisher VTT + 4 OpenAI ASR')
    report = json.loads((ROOT/'data/openai-asr-report.json').read_text())
    if report['status'] != 'transcribed' or not report['complete']:
        raise ValueError('Cloud transcription is not complete')
    backup = ROOT/'data/raw/backups'
    backup.mkdir(parents=True,exist_ok=True)
    active = ROOT/'data/collection.json'
    if not (backup/'collection-before-15.json').exists():
        (backup/'collection-before-15.json').write_bytes(active.read_bytes())
    db_path = ROOT/'data/podcasts.sqlite3'
    stage = ROOT/'data/podcasts.next.sqlite3'
    if db_path.exists():
        with sqlite3.connect(db_path) as source:
            if not (backup/'podcasts-before-15.sqlite3').exists():
                with sqlite3.connect(backup/'podcasts-before-15.sqlite3') as target:
                    source.backup(target)
            with sqlite3.connect(stage) as target:
                source.backup(target)
    summary = corpus.build(stage, manifest_path)
    if summary['episodes'] != 15:
        raise ValueError('Unexpected database size; staged database preserved for review')
    stage.replace(db_path)
    atomic_json(active, manifest)
    verify_local_audio.main()
    audit_transcripts.main()
    build_audio_review.main()
    with sqlite3.connect(db_path) as db:
        corpus.check(db)
        summary=corpus.report(db)
    atomic_json(ROOT/'data/import-report.json',summary)
    print(json.dumps(summary,ensure_ascii=False,indent=2))


if __name__=='__main__':
    main()
