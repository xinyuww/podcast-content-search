"""Search complete podcast chapters: cosine recall, then deterministic label rules.

Examples (use .venv/bin/python):
  python -m backend.search_content search 'AI发展太快，担心工作被替代' --help-type perspective
  python -m backend.search_content evaluate
Uncached query embeddings call OpenAI. No generative model reranking is used.
"""
import argparse
import json
import struct
from pathlib import Path

from backend.common import atomic_json, stamp
from backend.content_index import (ROOT, DB, TAXONOMY, DIMENSIONS, EMBEDDING_MODEL, connect, digest,
    assert_sources_current, annotations_current, annotated_units, eligible, embedding_text,
    embed_texts, unit_vector)

MIN_SIMILARITY = 0.35  # Tuned on the small smoke set; not a calibrated confidence.
WEIGHTS = dict(help_types=0.10,formats=0.08,topics=0.04)


def labels(annotation,field):
    return {item['label'] for item in annotation[field]}


def validate_profile(profile):
    for field in ('help_types','formats','topics','avoid_formats','avoid_help_types'):
        vocabulary=TAXONOMY[field.replace('avoid_','')]
        if not isinstance(profile.get(field,[]),list) or any(x not in vocabulary for x in profile.get(field,[])):
            raise ValueError('Unknown profile labels: '+field)


def rank_records(records, query_vector, profile, limit=5, recall=30, min_similarity=MIN_SIMILARITY):
    validate_profile(profile)
    query_vector=unit_vector(query_vector,len(query_vector))
    candidates=[]
    for record in records:
        vector=record['vector']
        if len(vector)!=len(query_vector):
            raise ValueError('Query/document vector dimensions differ')
        cosine=sum(a*b for a,b in zip(query_vector,vector))
        if cosine>=min_similarity:
            candidates.append(dict(record,cosine=cosine))
    candidates.sort(key=lambda x:(-x['cosine'],x['unit']['id']))
    baseline=candidates[:limit]
    recalled=candidates[:recall]
    ranked=[]
    excluded=[]
    for record in recalled:
        annotation=record['annotation']
        blocked=[]
        for field in ('formats','help_types'):
            blocked += sorted(labels(annotation,field)&set(profile.get('avoid_'+field,[])))
        if blocked:
            excluded.append(dict(unit_id=record['unit']['id'],reason='explicit_avoid',labels=blocked))
            continue
        score=record['cosine']
        matches={}
        contributions={}
        for field,weight in WEIGHTS.items():
            wanted=set(profile.get(field,[]))
            matches[field]=sorted(wanted&labels(annotation,field))
            contributions[field]=weight*len(matches[field])/len(wanted) if wanted else 0
            score+=contributions[field]
        ranked.append(dict(record,score=score,matches=matches,contributions=contributions))
    ranked.sort(key=lambda x:(-x['score'],-x['cosine'],x['unit']['id']))
    chosen=ranked[:limit]
    missing={f:sorted(set(profile.get(f,[]))-{v for r in chosen for v in r['matches'][f]})
             for f in WEIGHTS}
    status='insufficient_coverage' if not chosen else ('partial_match' if any(missing.values()) else 'candidates_found')
    return dict(results=chosen,baseline=baseline,excluded=excluded,unmet_preferences=missing,status=status,
                eligible_pool=len(records),above_threshold=len(candidates),recalled=len(recalled))


def load_records(db,verified_only=False):
    assert_sources_current(db)
    annotations_current(db)
    rows=annotated_units(db)
    if len(rows)!=db.execute('SELECT count(*) FROM content_units').fetchone()[0]:
        raise ValueError('Incomplete annotation index')
    records=[]
    for u,a,ah in rows:
        if not eligible(u,a,verified_only=verified_only):
            continue
        row=db.execute('SELECT * FROM content_embeddings WHERE unit_id=?',(u['id'],)).fetchone()
        if not row or row['annotation_hash']!=ah or row['text_hash']!=digest(embedding_text(u,a)):
            raise ValueError('Missing/stale vector for '+u['id']+'; rerun embed')
        if row['model']!=EMBEDDING_MODEL or row['dimensions']!=DIMENSIONS:
            raise ValueError('Embedding model/dimension mismatch')
        vector=list(struct.unpack('<'+str(DIMENSIONS)+'f',row['vector']))
        records.append(dict(unit=u,annotation=a,vector=unit_vector(vector)))
    return records


def serialize_record(record):
    u,a=record['unit'],record['annotation']
    return dict(unit_id=u['id'],title=u['title'],episode_id=u['episode_id'],episode=u['episode_title'],
        show=u['show_title'],summary=a['summary'],start_seconds=u['start_seconds'],end_seconds=u['end_seconds'],
        audio_path=u['audio_path'],source_url=u['source_url'],review_status=u['review_status'],
        similarity=round(record['cosine'],5),score=round(record.get('score',record['cosine']),5),
        matches=record.get('matches',{}),rule_contributions=record.get('contributions',{}),
        tags={f:sorted(labels(a,f)) for f in WEIGHTS},evidence={f:a[f] for f in WEIGHTS})


def search(records,query,profile,embedding_options=None,**kwargs):
    vectors,_=embed_texts([query],**(embedding_options or {}))
    result=rank_records(records,vectors[0],profile,**kwargs)
    result['results']=[serialize_record(r) for r in result['results']]
    result['baseline']=[serialize_record(r) for r in result['baseline']]
    return dict(query=query,profile=profile,**result)


def evaluate(records):
    fixture=json.loads((ROOT/'data/retrieval-cases.json').read_text())
    results=[]
    for case in fixture['cases']:
        result=search(records,case['query'],case['profile'])
        expected=set(case.get('expected_any_units',[]))
        baseline_hit=bool(expected&{x['unit_id'] for x in result['baseline']}) if expected else None
        rules_hit=bool(expected&{x['unit_id'] for x in result['results']}) if expected else None
        results.append(dict(case_id=case['id'],expectation=case['expectation'],expected_any_units=sorted(expected),
            expected_in_baseline_top5=baseline_hit,expected_in_rules_top5=rules_hit,
            negative_case=case.get('negative_case',False),**result))
        print(case['id']+': '+result['status']+'; '+(result['results'][0]['title'] if result['results'] else 'no match'),flush=True)
    judged=[r for r in results if r['expected_any_units']]
    summary=dict(cases=len(results),positive_cases_with_seed_labels=len(judged),
        seed_hit_at_5_baseline=sum(r['expected_in_baseline_top5'] for r in judged),
        seed_hit_at_5_rules=sum(r['expected_in_rules_top5'] for r in judged),
        negative_cases=len([r for r in results if r['negative_case']]),
        negatives_with_no_match=sum(r['negative_case'] and not r['results'] for r in results),
        note='Small developer-authored smoke set with partial relevance seeds, not blind user evaluation or measured recommendation accuracy.')
    artifact=dict(summary=summary,configuration=dict(min_similarity=MIN_SIMILARITY,recall=30,weights=WEIGHTS),results=results)
    atomic_json(ROOT/'data/retrieval-evaluation.json',artifact)
    lines=['# 本地语义检索与标签规则：小规模验证','','开发者编写的场景与部分相关性种子，不是盲测或推荐准确率。标签为模型初稿，所有音频仍待核听。','',
           f'场景 {len(results)} 个；正例种子 Top 5 命中：向量 {summary["seed_hit_at_5_baseline"]}/{len(judged)}，'
           f'标签规则 {summary["seed_hit_at_5_rules"]}/{len(judged)}；负例无结果 {summary["negatives_with_no_match"]}/{summary["negative_cases"]}。','',
           '相似度下限是初始启发式参数，不是置信度；有结果也不代表需求已得到满足。']
    for r in results:
        lines += ['',f'## {r["case_id"]}', '',r['query'],'',f'预期：{r["expectation"]}',
            f'状态：`{r["status"]}`；未覆盖偏好：`{json.dumps(r["unmet_preferences"],ensure_ascii=False)}`。','',
            '向量前 3：'+'；'.join(x['title'] for x in r['baseline'][:3]),'',
            '| 排名 | 规则排序后的章节 | 相似度 | 匹配标签 | 时间 |',
            '| --- | --- | ---: | --- | --- |']
        for i,x in enumerate(r['results'][:5],1):
            tags=' / '.join(','.join(v) for v in x['matches'].values() if v)
            lines.append(f'| {i} | {x["title"].replace("|","／")} | {x["similarity"]:.3f} | {tags} | '
                         f'{stamp(x["start_seconds"])}–{stamp(x["end_seconds"])} |')
        if not r['results']:
            lines += ['| — | 当前素材没有足够匹配的候选 | — | — | — |']
    (ROOT/'data/retrieval-evaluation.md').write_text('\n'.join(lines)+'\n')
    return summary


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command',choices=['search','evaluate'])
    parser.add_argument('query',nargs='?')
    parser.add_argument('--help-type',action='append',default=[],choices=list(TAXONOMY['help_types']))
    parser.add_argument('--format',action='append',default=[],choices=list(TAXONOMY['formats']))
    parser.add_argument('--avoid-format',action='append',default=[],choices=list(TAXONOMY['formats']))
    parser.add_argument('--topic',action='append',default=[],choices=list(TAXONOMY['topics']))
    parser.add_argument('--verified-only',action='store_true')
    args=parser.parse_args()
    with connect() as db:
        records=load_records(db,verified_only=args.verified_only)
    if args.command=='evaluate':
        output=evaluate(records)
    else:
        if not args.query:
            parser.error('search requires a query')
        output=search(records,args.query,dict(help_types=args.help_type,formats=args.format,
                                             avoid_formats=args.avoid_format,topics=args.topic))
    print(json.dumps(output,ensure_ascii=False,indent=2))


if __name__=='__main__':
    main()
