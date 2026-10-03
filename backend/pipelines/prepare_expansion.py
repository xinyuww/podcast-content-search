"""Match curated Xiaoyuzhou episodes to saved public RSS and stage a manifest.

Read-only parsing of downloaded source snapshots; no guessed media URLs.
Prints a curl config for missing audio and publisher subtitle/chapters assets.
"""
import hashlib
import json
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

from backend.paths import ROOT
FEEDS = {
    'ld': ('kejiluandun', 'https://feeds.daopub.com/ld.xml'),
    'dao': ('jinjinledao', 'https://feeds.daopub.com/dao.xml'),
    'bmrs': ('bianmarensheng', 'https://feeds.daopub.com/bmrs.xml'),
    'sjhybf': ('shijiehaiyoubanfa', 'https://proxy.wavpub.com/sjhybf.xml'),
}
ITUNES = '{http://www.itunes.com/dtds/podcast-1.0.dtd}'
PODCAST = '{https://podcastindex.org/namespace/1.0}'


def main():
    manifest = json.loads((ROOT / 'data/collection.json').read_text())
    old_podcast = manifest.pop('podcast', None)
    manifest.setdefault('podcasts', [old_podcast] if old_podcast else [])
    for e in manifest['episodes']:
        e.setdefault('podcast_id', 'kejiluandun')
        e.setdefault('transcript_origin', 'publisher_vtt')
    selection = json.loads((ROOT / 'data/selection-tech-work-10.json').read_text())
    manifest.update(version=2, collection_title='科技与职场：15期中文真实播客素材',
        collection_workflow='小宇宙选题 → RSS匹配 → 本地音频 → 复用字幕或本地ASR → 对齐检查 → SQLite')
    known = {e['guid'] for e in manifest['episodes']}
    for pick in selection['episodes']:
        xyid = pick['xiaoyuzhou_url'].rsplit('/', 1)[-1]
        snapshot = ROOT / f'data/raw/discovery/{xyid}.html'
        match = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', snapshot.read_text())
        xy = json.loads(match[1])['props']['pageProps']['episode']
        if xy.get('isPrivateMedia') or xy.get('payType') != 'FREE':
            raise ValueError(f'Not public/free: {pick["title"]}')
        channel = ET.parse(ROOT / f'data/raw/{pick["feed_key"]}-current.xml').getroot().find('channel')
        matches = [it for it in channel.findall('item') if it.findtext('title') == xy['title']]
        if len(matches) != 1:
            raise ValueError(f'Ambiguous/missing RSS match: {xy["title"]}')
        item = matches[0]
        guid = item.findtext('guid')
        if guid in known:
            continue
        known.add(guid)
        duration_raw = item.findtext(ITUNES + 'duration')
        duration = 0
        for part in duration_raw.split(':'):
            duration = duration * 60 + float(part)
        if abs(duration - xy['duration']) > 2:
            raise ValueError(f'Xiaoyuzhou/RSS duration mismatch: {xy["title"]}')
        transcript = item.find(PODCAST + 'transcript')
        chapters = item.find(PODCAST + 'chapters')
        transcript_url = transcript.get('url') if transcript is not None else ''
        if transcript is not None and transcript.get('type') != 'text/vtt':
            raise ValueError('New transcript format requires an explicit parser')
        eid = (transcript_url.rsplit('/', 1)[-1].removesuffix('.vtt') if transcript_url else
               pick['feed_key'] + '-' + hashlib.sha256(guid.encode()).hexdigest()[:20])
        pid, rss_url = FEEDS[pick['feed_key']]
        if pid not in {p['id'] for p in manifest['podcasts']}:
            manifest['podcasts'].append(dict(id=pid, title=channel.findtext('title'),
                publisher=channel.findtext(ITUNES + 'author') or xy['podcast']['author'],
                language=channel.findtext('language') or 'zh-CN', rss_url=rss_url,
                source_url='https://www.xiaoyuzhoufm.com/podcast/' + xy['podcast']['pid']))
        manifest['episodes'].append(dict(id=eid, podcast_id=pid, title=item.findtext('title'),
            guid=guid, published_at=parsedate_to_datetime(item.findtext('pubDate')).isoformat(),
            duration_seconds=duration, source_url=pick['xiaoyuzhou_url'],
            publisher_episode_url=item.findtext('link'), audio_url=item.find('enclosure').get('url'),
            transcript_url=transcript_url, chapters_url=chapters.get('url') if chapters is not None else '',
            transcript_origin='publisher_vtt' if transcript_url else 'local_asr',
            audio_alignment_status='pending_alignment_check', topic=pick['topic'],
            selection_basis='小宇宙选题；RSS单集标题和时长匹配。',
            discovery=dict(platform='xiaoyuzhou', url=pick['xiaoyuzhou_url'],
                snapshot=str(snapshot.relative_to(ROOT)), checked_at=datetime.now(timezone.utc).isoformat())))
    if len(manifest['episodes']) != 15:
        raise ValueError(f'Expected 15, found {len(manifest["episodes"])}')
    manifest['rights']['notes'] = ('用户要求的15期本地演示素材；保留来源，原音频和字幕不纳入Git。'
        '不同栏目来自同一播客网络；公开再托管不在当前范围。')
    (ROOT / 'data/collection-15.pending.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print('location\nfail\nsilent\nshow-error\nconnect-timeout = 30\nmax-time = 1200\nretry = 2')
    for e in manifest['episodes']:
        audio = ROOT / f'data/raw/audio/{e["id"]}.mp3'
        if not audio.exists():
            print('url = ' + json.dumps(e['audio_url']))
            print('output = ' + json.dumps(str(audio) + '.part'))
        for kind, ext in [('transcript', 'vtt'), ('chapters', 'json')]:
            target = ROOT / f'data/raw/{e["id"]}.{ext}'
            if e[kind + '_url'] and not target.exists():
                print('url = ' + json.dumps(e[kind + '_url']))
                print('output = ' + json.dumps(str(target)))


if __name__ == '__main__':
    main()
