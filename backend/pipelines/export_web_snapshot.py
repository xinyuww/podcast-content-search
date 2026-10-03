"""Export a server-only, read-only web corpus. No network, transcription, or embedding calls.

Run locally after the corpus/index changes: python -m backend.pipelines.export_web_snapshot
The offline source database and audio cache are never modified.
"""
import hashlib
import json
import sqlite3
from pathlib import Path
from urllib.parse import urlparse

from backend.common import probe
from backend.content_index import DB, ROOT, TAXONOMY, DIMENSIONS, EMBEDDING_MODEL, annotated_units
from backend.search_content import load_records

OUTPUT = ROOT / 'server/data/corpus.sqlite3'


def hosted_audio(row, assets, origin):
    asset = assets.get(row['id'])
    if not asset or asset['sha256'] != row['sha256']:
        raise ValueError('Missing or stale uploaded audio: ' + row['id'])
    parsed = urlparse(asset['url'])
    if parsed.scheme != 'https' or parsed.netloc != urlparse(origin).netloc or not parsed.path.startswith('/audio/') or not parsed.path.endswith('.mp3') or parsed.query or parsed.fragment:
        raise ValueError('Unreviewed hosted audio URL: ' + row['id'])
    return asset['url']


def export_snapshot(output=OUTPUT):
    assets = json.loads((ROOT / 'data/hosted-audio.json').read_text())['episodes']
    origin = json.loads((ROOT / 'lib/audio-host.json').read_text())['origin']
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix('.building.sqlite3')
    if temporary.exists():
        temporary.unlink()
    with sqlite3.connect('file:'+str(DB)+'?mode=ro', uri=True) as source:
        source.row_factory = sqlite3.Row
        # Fail on stale source, annotation or embedding data before publishing anything.
        eligible_ids = {r['unit']['id'] for r in load_records(source)}
        units = annotated_units(source)
        episodes = {}
        for row in source.execute('''SELECT e.*,p.title AS show_title,a.local_path,a.sha256
            FROM episodes e JOIN podcasts p ON p.id=e.podcast_id
            JOIN source_assets a ON a.episode_id=e.id AND a.kind='audio' ORDER BY e.id'''):
            episodes[row['id']] = dict(id=row['id'], title=row['title'], show=row['show_title'],
                sourceUrl=row['source_url'], audioUrl=hosted_audio(row, assets, origin),
                duration=float(probe(ROOT / row['local_path'])['duration']), sourceHash=row['sha256'],
                transcriptStatus=row['transcript_status'], rightsEvidenceUrl=row['rights_evidence_url'])
        if len(episodes) != 15:
            raise ValueError('This demo release expects exactly 15 episodes')
        with sqlite3.connect(temporary) as target:
            target.executescript('''
                CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE episodes (id TEXT PRIMARY KEY, payload_json TEXT NOT NULL);
                CREATE TABLE chapters (id TEXT PRIMARY KEY, episode_id TEXT NOT NULL,
                    eligible INTEGER NOT NULL, payload_json TEXT NOT NULL, annotation_json TEXT NOT NULL);
                CREATE TABLE embeddings (unit_id TEXT PRIMARY KEY, model TEXT NOT NULL,
                    dimensions INTEGER NOT NULL, vector BLOB NOT NULL);
                CREATE TABLE transcript_cues (id TEXT PRIMARY KEY, episode_id TEXT NOT NULL,
                    position INTEGER NOT NULL, start REAL NOT NULL, end REAL NOT NULL, text TEXT NOT NULL);
                CREATE TABLE demo (id TEXT PRIMARY KEY, payload_json TEXT NOT NULL);
            ''')
            for episode in episodes.values():
                target.execute('INSERT INTO episodes VALUES (?,?)', (episode['id'], json.dumps(episode, ensure_ascii=False)))
            for u, a, _ in units:
                # Only publish runtime content; no local paths or API processing provenance.
                payload = {k: u[k] for k in ('id','episode_id','title','start_seconds','end_seconds','cues','review_status')}
                if u['end_seconds'] > episodes[u['episode_id']]['duration'] + .1:
                    raise ValueError('Chapter exceeds original audio: '+u['id'])
                target.execute('INSERT INTO chapters VALUES (?,?,?,?,?)',
                    (u['id'], u['episode_id'], int(u['id'] in eligible_ids), json.dumps(payload, ensure_ascii=False), json.dumps(a, ensure_ascii=False)))
            target.executemany('INSERT INTO embeddings VALUES (?,?,?,?)',
                [tuple(r) for r in source.execute('SELECT unit_id,model,dimensions,vector FROM content_embeddings ORDER BY unit_id')])
            target.executemany('INSERT INTO transcript_cues VALUES (?,?,?,?,?,?)',
                [tuple(r) for r in source.execute('SELECT id,episode_id,position,start_seconds,end_seconds,text FROM transcript_cues ORDER BY episode_id,position')])
            demo = json.loads((ROOT / 'data/demo-playlist.json').read_text())
            for item in demo['items']:
                episode = episodes[item['episodeId']]
                item.update(audioUrl=episode['audioUrl'], episodeAudioUrl=episode['audioUrl'],
                            audioOffset=item['start'], episodeDuration=episode['duration'])
            target.execute('INSERT INTO demo VALUES (?,?)', (demo['id'], json.dumps(demo, ensure_ascii=False)))
            counts = dict(episodes=len(episodes), chapters=len(units), eligible=len(eligible_ids),
                embeddings=source.execute('SELECT count(*) FROM content_embeddings').fetchone()[0],
                cues=source.execute('SELECT count(*) FROM transcript_cues').fetchone()[0])
            meta = dict(schema_version='1', taxonomy_version=TAXONOMY['version'], embedding_model=EMBEDDING_MODEL,
                        dimensions=str(DIMENSIONS), counts=json.dumps(counts),
                        source_sha256=hashlib.sha256(DB.read_bytes()).hexdigest())
            target.executemany('INSERT INTO metadata VALUES (?,?)', meta.items())
            if target.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise ValueError('Snapshot integrity check failed')
        temporary.replace(output)
    report = dict(**counts, bytes=output.stat().st_size, sha256=hashlib.sha256(output.read_bytes()).hexdigest(),
                  source_sha256=meta['source_sha256'], audio_policy='hosted_local_mp3', audio_origin=origin)
    output.with_suffix('.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
    return report


if __name__ == '__main__':
    print(json.dumps(export_snapshot(), ensure_ascii=False, indent=2))
