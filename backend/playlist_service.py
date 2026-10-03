"""Loopback-only retrieval/playlist service and allowlisted original-audio streaming.

.venv/bin/python -m backend.playlist_service [--offline] [--port 8766]
No corpus writes or clip re-encoding. New query embeddings are not persisted.
"""
import argparse
import itertools
import json
import math
import re
import sqlite3
import threading
from functools import lru_cache
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

from backend.common import probe
from backend.content_index import ROOT, DB, TAXONOMY, digest
from backend.search_content import load_records, search, validate_profile

FIELDS = ('topics', 'help_types', 'formats', 'avoid_help_types', 'avoid_formats')


def readonly_db():
    db = sqlite3.connect('file:'+str(DB)+'?mode=ro', uri=True)
    db.row_factory = sqlite3.Row
    return db


def validate_need(body):
    if not isinstance(body, dict) or body.get('taxonomy_version') != TAXONOMY['version']:
        raise ValueError('标签版本不匹配，请刷新页面重新整理需求。')
    need = body.get('need')
    if not isinstance(need, dict) or need.get('ready_to_recommend') is not True:
        raise ValueError('请先完成需求确认，再生成拼盘。')
    query, profile = need.get('search_query'), need.get('preferences')
    if not isinstance(query, str) or not 1 <= len(query.strip()) <= 1000:
        raise ValueError('检索文字需为 1–1000 字。')
    if not isinstance(profile, dict) or set(profile) != set(FIELDS):
        raise ValueError('需求偏好格式不完整。')
    validate_profile(profile)
    for labels in profile.values():
        if len(labels) > 3 or len(set(labels)) != len(labels):
            raise ValueError('每类偏好最多三个不重复标签。')
    for field in ('help_types', 'formats'):
        if set(profile[field]) & set(profile['avoid_'+field]):
            raise ValueError('期望和排除标签有冲突，请先修正需求。')
    return query.strip(), profile


def assemble(candidates):
    """Exhaustively choose 3–5 whole, nonoverlapping chapters from <=30 recalled units.

    Relevance dominates; modest diversity and 20-minute proximity break ties.
    Never lower the semantic threshold, ignore avoids, or trim a chapter to fill time.
    """
    pool = []
    seen = set()
    for c in candidates[:30]:
        duration = c['end_seconds']-c['start_seconds']
        if c['unit_id'] not in seen and math.isfinite(duration) and 0 < duration <= 1800:
            seen.add(c['unit_id'])
            pool.append(c)
    best, best_score = None, -math.inf
    for count in range(3, min(5, len(pool))+1):
        for combo in itertools.combinations(pool, count):
            total = sum(c['end_seconds']-c['start_seconds'] for c in combo)
            if not 600 <= total <= 1800:
                continue
            if any(a['episode_id'] == b['episode_id'] and max(a['start_seconds'], b['start_seconds']) < min(a['end_seconds'], b['end_seconds'])
                   for a, b in itertools.combinations(combo, 2)):
                continue
            score = (sum(c['score'] for c in combo)/count
                     + .015*len({c['show'] for c in combo})
                     + .005*len({c['episode_id'] for c in combo})
                     - .02*abs(total-1200)/600)
            if score > best_score:
                best, best_score = combo, score
    return list(best) if best else []


def asset(db, episode_id):
    row = db.execute("SELECT local_path,sha256 FROM source_assets WHERE episode_id=? AND kind='audio'", (episode_id,)).fetchone()
    if not row:
        raise FileNotFoundError('Unknown episode')
    path = (ROOT/row['local_path']).resolve()
    if not path.is_relative_to((ROOT/'data/raw/audio').resolve()) or not path.is_file():
        raise FileNotFoundError('Audio unavailable')
    return path, row['sha256']


@lru_cache(maxsize=32)
def media_info(path, size, mtime):
    info = probe(path)
    return float(info['duration']), ('audio/mpeg' if info['format_name'] == 'mp3' else 'audio/mp4')


def create_playlist(body, offline=False):
    query, profile = validate_need(body)
    with readonly_db() as db:
        records = load_records(db)
        result = search(records, query, profile, limit=30, embedding_options=dict(offline=offline, timeout=35, retries=0, cache_writes=False))
        chosen = assemble(result['results'])
        counts = dict(eligible=result['eligible_pool'], above_threshold=result['above_threshold'], after_rules=len(result['results']))
        if not chosen:
            return dict(status='insufficient_coverage', playlist=None, counts=counts,
                        message='现有相关章节无法组成 3–5 段、10–30 分钟的完整拼盘。请调整需求，或补充素材；不会用无关内容补足。')
        units = {r['unit']['id']: r['unit'] for r in records}
        items = []
        for c in chosen:
            u = units[c['unit_id']]
            path, sha = asset(db, c['episode_id'])
            stat = path.stat()
            duration, mime = media_info(str(path), stat.st_size, stat.st_mtime_ns)
            if c['end_seconds'] > duration + .1:
                raise RuntimeError('Chapter exceeds original audio duration')
            url = '/media/episodes/'+c['episode_id']
            items.append(dict(id=c['unit_id'], episodeId=c['episode_id'], chapterId=c['unit_id'],
                title=c['title'], summary=c['summary'], show=c['show'], episode=c['episode'], sourceUrl=c['source_url'],
                start=c['start_seconds'], end=c['end_seconds'], duration=c['end_seconds']-c['start_seconds'],
                audioOffset=c['start_seconds'], episodeDuration=duration, audioUrl=url, episodeAudioUrl=url,
                cues=u['cues'], reviewStatus=c['review_status'], matches=c['matches'], similarity=c['similarity'],
                score=c['score'], ruleContributions=c['rule_contributions'], tags=c['tags'], sourceHash=sha))
        missing = {f: sorted(set(profile[f])-{label for c in chosen for label in c['matches'][f]}) for f in ('topics','help_types','formats')}
        partial = any(missing.values())
        return dict(status='partial_match' if partial else 'ready', counts=counts, unmet_preferences=missing,
                    message='拼盘已生成，但部分期望的帮助或形式尚未覆盖。' if partial else '已根据当前需求选出完整章节。',
                    playlist=dict(id=digest([query,profile,[i['id'] for i in items]]), kind='matched', title='按当前需求组合的声音拼盘',
                                  totalDuration=sum(i['duration'] for i in items), items=items))


def byte_range(value, size):
    if not value:
        return 0, size-1, False
    match = re.fullmatch(r'bytes=(\d*)-(\d*)', value)
    if not match or not any(match.groups()):
        raise ValueError('Invalid range')
    left, right = match.groups()
    if not left:
        length = int(right)
        if length <= 0:
            raise ValueError('Invalid suffix')
        start, end = max(0, size-length), size-1
    else:
        start, end = int(left), min(int(right), size-1) if right else size-1
    if not 0 <= start <= end < size:
        raise ValueError('Unsatisfiable range')
    return start, end, True


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    server_version = 'PodcastLocal/1'

    def log_message(self, *args):
        pass  # Do not log query text or conversation payloads.

    def json(self, body, status=200):
        data = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        if self.command != 'HEAD':
            try: self.wfile.write(data)
            except (BrokenPipeError, ConnectionResetError): pass

    def do_POST(self):
        if self.path != '/api/playlists':
            return self.json(dict(error='Not found'),404)
        origin = self.headers.get('Origin')
        if origin and urlparse(origin).hostname not in ('localhost','127.0.0.1','::1'):
            return self.json(dict(error='Cross-origin request denied'),403)
        if self.headers.get_content_type() != 'application/json':
            return self.json(dict(error='JSON required'),415)
        try:
            size = int(self.headers.get('Content-Length','0'))
            if not 0 < size <= 16000:
                return self.json(dict(error='Invalid body size'),413)
            body = json.loads(self.rfile.read(size))
            validate_need(body)
        except (ValueError, TypeError):
            return self.json(dict(error='需求格式无效；请先完成需求理解，并使用当前标签体系。'),400)
        if not self.server.jobs.acquire(blocking=False):
            return self.json(dict(error='正在处理其他拼盘，请稍后重试。'),429)
        try:
            result = create_playlist(body, self.server.offline)
        except Exception:
            # Upstream exceptions may contain local paths or API details; never forward them.
            return self.json(dict(error='暂时无法检索。请确认本地索引完整、API 网络可用；离线模式只支持已有查询缓存。'),503)
        finally:
            self.server.jobs.release()
        self.json(result)

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        if self.path == '/health':
            return self.json(dict(service='podcast-playlists', offline=self.server.offline))
        match = re.fullmatch(r'/media/episodes/([a-zA-Z0-9-]{1,100})', self.path)
        if not match:
            return self.json(dict(error='Not found'),404)
        try:
            with readonly_db() as db:
                path, sha = asset(db, match[1])
            stat = path.stat()
            duration, mime = media_info(str(path), stat.st_size, stat.st_mtime_ns)
        except Exception:
            return self.json(dict(error='Audio unavailable'),404)
        etag = '"'+sha+'"'
        range_header = self.headers.get('Range')
        if self.headers.get('If-Range') not in (None, etag):
            range_header = None
        try:
            start, end, partial = byte_range(range_header, stat.st_size)
        except ValueError:
            self.send_response(416)
            self.send_header('Content-Range', f'bytes */{stat.st_size}')
            self.send_header('Content-Length','0')
            self.end_headers()
            return
        self.send_response(206 if partial else 200)
        self.send_header('Content-Type', mime)
        self.send_header('Accept-Ranges','bytes')
        self.send_header('ETag',etag)
        self.send_header('Cache-Control','private, max-age=3600')
        self.send_header('Content-Length',str(end-start+1))
        if partial:
            self.send_header('Content-Range',f'bytes {start}-{end}/{stat.st_size}')
        self.end_headers()
        if self.command == 'HEAD':
            return
        try:
            with path.open('rb') as stream:
                stream.seek(start)
                remaining = end-start+1
                while remaining:
                    chunk = stream.read(min(65536,remaining))
                    if not chunk: break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass


def make_server(port=8766, offline=False):
    server = ThreadingHTTPServer(('127.0.0.1',port),Handler)
    server.offline = offline
    server.jobs = threading.BoundedSemaphore(2)
    return server


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port',type=int,default=8766)
    parser.add_argument('--offline',action='store_true')
    args=parser.parse_args()
    server=make_server(args.port,args.offline)
    print(f'Podcast retrieval/media service: http://127.0.0.1:{args.port} (offline={args.offline})',flush=True)
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.server_close()
