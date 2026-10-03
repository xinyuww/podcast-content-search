import itertools
import json
import math
import unittest
from pathlib import Path
from unittest.mock import patch
from backend import playlist_service as service


def candidate(n, duration=250, episode=None, start=0, score=.6):
    return dict(unit_id=str(n), episode_id=episode or str(n), show=str(n), start_seconds=start, end_seconds=start+duration, score=score)


def payload(case):
    return dict(taxonomy_version='needs-content-v1',need=dict(ready_to_recommend=True, search_query=case['query'], preferences={f:case['profile'].get(f,[]) for f in service.FIELDS}))


class PlaylistServiceTests(unittest.TestCase):
    def test_complete_chapters_count_duration_and_no_overlap(self):
        pool=[candidate(1,350,'same'),candidate(2,350,'same',200),candidate(3),candidate(4),candidate(5)]
        result=service.assemble(pool)
        self.assertTrue(3<=len(result)<=5)
        self.assertTrue(600<=sum(r['end_seconds']-r['start_seconds'] for r in result)<=1800)
        self.assertFalse({'1','2'}<={r['unit_id'] for r in result})
        self.assertTrue(all(r in pool for r in result))

    def test_never_fills_with_too_few_too_short_or_too_long(self):
        for pool in [[candidate(1),candidate(2)], [candidate(i,100) for i in range(5)], [candidate(i,700) for i in range(3)], [candidate(i,math.nan) for i in range(3)]]:
            self.assertEqual(service.assemble(pool),[])

    def test_selection_considers_beyond_first_five(self):
        pool=[candidate(i,700,score=.9) for i in range(5)]+[candidate(i,210) for i in range(5,8)]
        result=service.assemble(pool)
        self.assertTrue(result)
        self.assertTrue(any(int(r['unit_id'])>=5 for r in result))
        self.assertEqual(result,service.assemble(pool))

    def test_duplicate_units_do_not_pad_count(self):
        a=candidate(1,600)
        self.assertEqual(service.assemble([a,a,a]),[])

    def test_http_byte_ranges(self):
        for header, expected in [(None,(0,99,False)),('bytes=10-19',(10,19,True)),('bytes=90-',(90,99,True)),('bytes=-15',(85,99,True)),('bytes=90-500',(90,99,True))]:
            self.assertEqual(service.byte_range(header,100),expected)
        for header in ['bytes=100-','bytes=10-1','bytes=-0','bytes=','bytes=1-2,4-5','items=1-2']:
            with self.assertRaises(ValueError): service.byte_range(header,100)

    def test_need_validation(self):
        case=dict(query='工作沟通',profile={'help_types':['practical_guidance']})
        body=payload(case)
        self.assertEqual(service.validate_need(body)[0],'工作沟通')
        for change in [lambda b:b.update(taxonomy_version='old'),lambda b:b['need'].update(ready_to_recommend=False),lambda b:b['need']['preferences'].update(topics=['unknown']),lambda b:b['need']['preferences'].update(avoid_help_types=['practical_guidance'])]:
            altered=json.loads(json.dumps(body)); change(altered)
            with self.assertRaises(ValueError): service.validate_need(altered)

    def test_real_cached_retrieval_to_playlist_without_network(self):
        cases=json.loads((service.ROOT/'data/retrieval-cases.json').read_text())['cases']
        with patch('urllib.request.urlopen',side_effect=AssertionError('No network allowed')):
            for name in ['ai_practice','no_baking']:
                case=next(c for c in cases if c['id']==name)
                result=service.create_playlist(payload(case),offline=True)
                if name=='no_baking':
                    self.assertEqual(result['status'],'insufficient_coverage'); self.assertIsNone(result['playlist'])
                else:
                    p=result['playlist']
                    self.assertTrue(3<=len(p['items'])<=5)
                    self.assertTrue(600<=p['totalDuration']<=1800)
                    for item in p['items']:
                        self.assertEqual(item['audioOffset'],item['start'])
                        self.assertEqual(item['audioUrl'],'/media/episodes/'+item['episodeId'])
                        self.assertEqual(item['audioUrl'],item['episodeAudioUrl'])
                        self.assertTrue(item['cues'])

    def test_no_new_queries_or_responses_written_by_live_service(self):
        from backend.content_index import api_cached
        with patch('backend.content_index.api_key',return_value='test'),patch('backend.content_index.atomic_json') as write,patch('urllib.request.urlopen',side_effect=OSError('offline')):
            with self.assertRaises(OSError):
                api_cached('embeddings',{'test':'nonexistent-query'},cache_writes=False,retries=0)
            write.assert_not_called()


if __name__=='__main__': unittest.main()
