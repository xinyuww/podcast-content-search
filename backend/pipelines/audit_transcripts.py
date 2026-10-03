"""Report timestamp integrity and review candidates; never claim listening accuracy."""
import argparse
import json
import re
from pathlib import Path

from backend.corpus import parse_vtt

from backend.paths import ROOT


def audit(cues, duration):
    end = 0
    covered = 0
    gaps = []
    repeats = []
    previous = ''
    for i, cue in enumerate(cues):
        if cue['start'] - end > 30:
            gaps.append(dict(start=round(end,3), end=cue['start']))
        covered += max(0, cue['end'] - max(end, cue['start']))
        end = max(end, cue['end'])
        text = re.sub(r'\W+', '', cue['text'])
        if len(text) >= 12 and text == previous:
            repeats.append(i)
        previous = text
    if duration - end > 30:
        gaps.append(dict(start=end, end=duration))
    return dict(cues=len(cues), timestamp_range_check='passed',
        speech_timestamp_coverage=round(covered/duration,4),
        gaps_over_30_seconds=gaps, repeated_adjacent_cue_positions=repeats,
        cues_over_60_seconds=sum(c['end']-c['start']>60 for c in cues),
        listening_alignment='not_verified', transcription_accuracy='not_verified')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest',type=Path,default=ROOT/'data/collection.json')
    args=parser.parse_args()
    manifest=json.loads(args.manifest.read_text())
    episodes=[]
    for e in manifest['episodes']:
        cues=parse_vtt((ROOT/f'data/raw/{e["id"]}.vtt').read_text(),e['duration_seconds'])
        entry=dict(id=e['id'],title=e['title'],origin=e.get('transcript_origin','publisher_vtt'),
            **audit(cues,e['duration_seconds']))
        if e.get('transcript_origin')=='openai_asr':
            folder=ROOT/'data/raw/openai-asr'/e['id']
            plan=json.loads((folder/'plan.json').read_text())
            meta=json.loads((ROOT/f'data/raw/{e["id"]}.asr.json').read_text())
            entry['normalization_records']=len(meta.get('normalization_notes',[]))
            entry['unindexed_short_fragments']=[dict(
                audio_time_seconds=round(plan['chunks'][note['chunk_index']]['start']+note['original_segment']['start'],3),
                text=note['original_segment']['text'],reason=note['reason'])
                for note in meta.get('normalization_notes',[]) if 'not_indexed' in note['reason']]
            entry['chunk_edge_gaps']=[]
            for chunk in plan['chunks']:
                data=json.loads((folder/f'{chunk["index"]:03}.response.json').read_text())['response']['segments']
                first=min(s['start'] for s in data)
                last=max(s['end'] for s in data)
                leading=first
                trailing=chunk['end']-chunk['start']-last
                if leading>10 or trailing>10:
                    entry['chunk_edge_gaps'].append(dict(chunk=chunk['index'],
                        leading_seconds=round(leading,3), trailing_seconds=round(trailing,3)))
        episodes.append(entry)
    result=dict(episodes=episodes, notes='Gaps may be music or silence; flags require review, not automatic rejection. '
        'Timestamp coverage is not recognition accuracy. No human listening verification has been performed.')
    (ROOT/'data/transcript-audit.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(dict(episodes=len(episodes),cues=sum(e['cues'] for e in episodes),
        flagged_episodes=sum(bool(e['gaps_over_30_seconds'] or e.get('chunk_edge_gaps') or e.get('unindexed_short_fragments') or e['repeated_adjacent_cue_positions']) for e in episodes)),ensure_ascii=False))


if __name__=='__main__':
    main()
