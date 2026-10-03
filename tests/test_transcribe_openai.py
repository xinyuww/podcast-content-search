"""Timing and provenance checks without API calls or charges."""
import json
import io
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.pipelines import transcribe_openai as asr


class OpenAITranscriptionTests(unittest.TestCase):
    def test_stream_requires_completion_event_and_keeps_segment_metadata(self):
        events=[dict(type='transcript.text.segment',id='seg_0',speaker='A',start=1,end=3,text='测试'),
                dict(type='transcript.text.done',text='测试')]
        data=''.join('data: '+json.dumps(e)+'\n\n' for e in events).encode()
        result=asr.read_transcript_stream(io.BytesIO(data),io.StringIO())
        self.assertEqual(result['segments'][0]['speaker'],'A')
        self.assertTrue(result['complete'])
        with self.assertRaisesRegex(RuntimeError,'before transcript.text.done'):
            asr.read_transcript_stream(io.BytesIO(('data: '+json.dumps(events[0])+'\n\n').encode()),io.StringIO())

    def test_adjacent_point_cue_is_merged_using_source_boundaries(self):
        response={'segments':[dict(start=1,end=3,text='政策性的',speaker='A'),
            dict(start=3.05,end=3.05,text='补贴',speaker='A')]}
        result=asr.normalize_segments(response,dict(start=600,end=610,index=1))
        self.assertEqual(result[0]['text'],'政策性的补贴')
        self.assertEqual(result[0]['end'],603.05)
        self.assertEqual(response['segments'][0]['text'],'政策性的')
        self.assertEqual(asr.normalized_source_cues(response)[1][0]['merged_into_position'],0)

    def test_zero_duration_duplicate_is_documented_without_inventing_time(self):
        response = {'segments': [dict(start=1,end=4,text='我们可以这样做对吧',speaker='A'),
            dict(start=3.9,end=3.9,text='对吧',speaker='A')]}
        chunk=dict(start=600,end=610,index=1)
        self.assertEqual(len(asr.normalize_segments(response,chunk)),1)
        self.assertEqual(asr.redundant_zero_cues(response)[0]['position'],1)
        response['segments'][1]['text']='未包含的其他内容'
        self.assertEqual(len(asr.normalize_segments(response,chunk)),1)
        self.assertEqual(asr.normalized_source_cues(response)[1][0]['original_segment']['text'],'未包含的其他内容')
        response['segments'][1]['text']='一大段没有任何有效时间戳且无法可靠对齐的实质内容必须报错'
        with self.assertRaises(ValueError):
            asr.normalize_segments(response,chunk)

    def test_cached_response_never_reuploads(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            chunk = dict(index=0, start=0, end=10, sha256='upload')
            plan = dict(audio_sha256='source')
            saved = dict(fingerprint=dict(audio_sha256='source',upload_sha256='upload',
                start=0,end=10,parameters=asr.PARAMS), elapsed_seconds=1,
                response={'segments':[dict(start=1,end=3,text='测试',speaker='A')]})
            (folder/'000.response.json').write_text(json.dumps(saved))
            with patch.object(asr, 'request_transcript') as request:
                segments, elapsed = asr.run_chunk(folder, plan, chunk, 'unused')
                request.assert_not_called()
                self.assertEqual(segments[0]['end'], 3)
                self.assertEqual(elapsed, 1)
                with self.assertRaises(ValueError):
                    asr.run_chunk(folder, plan, dict(chunk, sha256='changed'), 'unused')
                request.assert_not_called()

    def test_parallel_requests_are_capped_and_reported(self):
        state = {'active': 0, 'peak': 0}
        guard = threading.Lock()
        def fake_chunk(*args):
            with guard:
                state['active'] += 1
                state['peak'] = max(state['peak'], state['active'])
            time.sleep(.03)
            with guard:
                state['active'] -= 1
            return ([{}], .03)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root/'data').mkdir()
            episodes = [dict(id=str(i),title=str(i),duration_seconds=20) for i in range(4)]
            def fake_prepare(e):
                return root, {'chunks':[dict(index=i,start=i*10,end=(i+1)*10) for i in range(2)]}
            with patch.object(asr,'ROOT',root), patch.object(asr,'prepare',side_effect=fake_prepare), \
                 patch.object(asr,'run_chunk',side_effect=fake_chunk), \
                 patch.object(asr,'run_episode',return_value={'segments':[{}]}), patch('builtins.print'):
                asr.run_parallel(episodes, {'episodes':episodes},root/'manifest.json','unused',4)
            report=json.loads((root/'data/openai-asr-report.json').read_text())
            self.assertEqual(state['peak'],4)
            self.assertEqual(report['chunks_completed'],8)
            self.assertEqual(report['completed_audio_seconds'],80)
            self.assertTrue(report['complete'])
            self.assertTrue(all(e['transcript_origin']=='openai_asr' for e in episodes))

    def test_boundaries_cover_audio_without_gaps(self):
        boundaries = asr.choose_boundaries(1430, [591.2, 1198.1])
        self.assertEqual(boundaries, [0, 591.2, 1198.1, 1430])
        self.assertEqual(sum(b-a for a, b in zip(boundaries, boundaries[1:])), 1430)
        self.assertEqual(asr.choose_boundaries(1300, []), [0, 600, 1200, 1300])

    def test_offsets_and_speakers_are_chunk_local(self):
        response = {"segments": [
            {"start": 2, "end": 5, "text": "第二位", "speaker": "B"},
            {"start": 1, "end": 3, "text": "第一位", "speaker": "A"}]}
        segments = asr.normalize_segments(response, {"start": 600, "end": 1200, "index": 1})
        self.assertEqual([s["start"] for s in segments], [601, 602])
        self.assertEqual(segments[0]["speaker"], "chunk001:A")
        self.assertEqual(segments[0]["end"], 603)

    def test_missing_or_invented_timing_is_rejected(self):
        chunk = {"start": 0, "end": 10, "index": 0}
        for start, end in [(0, 12), (-1, 3), (2, 2), (float("nan"), 2)]:
            with self.assertRaises(ValueError):
                asr.normalize_segments({"segments": [{"start": start, "end": end,
                    "text": "测试", "speaker": "A"}]}, chunk)
        with self.assertRaises(ValueError):
            asr.normalize_segments({"text": "没有时间戳"}, chunk)


if __name__ == "__main__":
    unittest.main()
