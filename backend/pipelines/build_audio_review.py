"""Generate a local-only listening review page from verified original-audio clips."""
import html
import json

from backend.paths import ROOT


def clock(seconds):
    seconds = int(seconds)
    return f'{seconds//3600:02}:{seconds//60%60:02}:{seconds%60:02}'


def main():
    report = json.loads((ROOT / 'data/local-audio-report.json').read_text())
    sections = []
    labels = {'early': '前段', 'middle': '中段', 'late': '后段'}
    for episode in report['episodes']:
        cards = []
        for sample in episode['auditions']:
            src = '../auditions/' + Path(sample['local_path']).name
            cards.append(f'''<article><h3>{labels[sample['label']]} ·
                {clock(sample['start_seconds'])}–{clock(sample['end_seconds'])}</h3>
                <audio controls preload="none" src="{html.escape(src, quote=True)}"></audio>
                <p class="transcript">{html.escape(sample['text'])}</p>
                <label><input type="checkbox"> 已听完并核对这一段</label></article>''')
        origin = 'OpenAI 机器转录' if episode.get('transcript_origin') == 'openai_asr' else '发布方字幕'
        sections.append(f'''<section data-origin="{episode.get('transcript_origin', 'publisher_vtt')}">
            <h2>{html.escape(episode['title'])}</h2><p class="meta">{origin} · 原音频片段 · 尚未核听</p>
            <div class="grid">{''.join(cards)}</div></section>''')
    count = sum(len(e['auditions']) for e in report['episodes'])
    page = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>播客素材核听</title>
<style>
:root{color-scheme:light;font-family:system-ui,-apple-system,sans-serif;color:#182d32;background:#f4f5f1}
body{max-width:1240px;margin:0 auto;padding:40px 24px}h1{font-size:34px;margin-bottom:12px}
.intro{max-width:850px;line-height:1.8}.meta{color:#56666a;font-size:14px}section{margin:40px 0}
h2{font-size:22px}h3{font-size:15px;margin-top:0}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
article{background:white;border:1px solid #dce2dc;border-radius:14px;padding:20px;min-width:0}
audio{width:100%;margin:10px 0}.transcript{white-space:pre-wrap;line-height:1.75;font-size:15px;max-height:260px;overflow:auto}
label{font-size:13px;color:#52605d}button{padding:10px 16px;margin:8px 10px 0 0;border:1px solid #bac9c1;border-radius:20px;background:white;cursor:pointer}
button[aria-pressed=true]{background:#1d5347;color:white}section[hidden]{display:none}
@media(max-width:850px){.grid{grid-template-columns:1fr}body{padding:24px 16px}}
</style><h1>播客素材核听</h1>
<p class="intro">NUM_EPISODES 期真实播客 · NUM_CLIPS 段原声试听。每期选取前、中、后三处字幕窗口，
点击播放器核对文字和声音。音频均剪自本地原文件。时间范围与文件解码已检查；
文字准确性和听感对齐仍需核听。下方勾选只记录在当前页面，不会修改数据库核验状态。</p>
<nav><button aria-pressed="true" data-filter="all">全部</button>
<button aria-pressed="false" data-filter="openai_asr">4 期机器转录</button>
<button aria-pressed="false" data-filter="publisher_vtt">11 期发布方字幕</button></nav>
SECTIONS
<script>
document.querySelectorAll('button').forEach(button=>button.onclick=()=>{
 document.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
 document.querySelectorAll('section').forEach(s=>s.hidden=button.dataset.filter!=='all'&&s.dataset.origin!==button.dataset.filter);
});
document.addEventListener('play',event=>{
 document.querySelectorAll('audio').forEach(a=>{if(a!==event.target)a.pause()});
},true);
</script></html>'''
    page = page.replace('NUM_EPISODES', str(len(report['episodes']))).replace('NUM_CLIPS', str(count)).replace('SECTIONS', ''.join(sections))
    target = ROOT / 'data/raw/review/index.html'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(page)
    print(target)


if __name__ == '__main__':
    main()
