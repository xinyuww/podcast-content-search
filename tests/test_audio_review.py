import unittest
from pathlib import Path

from backend.pipelines.verify_local_audio import audition_windows
from backend.pipelines.audit_transcripts import audit


class AudioReviewTests(unittest.TestCase):
    def test_auditions_use_whole_cues_and_preserve_overlapping_ends(self):
        cues = [dict(start_seconds=10,end_seconds=28,text='甲'),
                dict(start_seconds=11,end_seconds=13,text='乙'),
                dict(start_seconds=50,end_seconds=52,text='丙'),
                dict(start_seconds=53,end_seconds=67,text='丁'),
                dict(start_seconds=90,end_seconds=94,text='戊')]
        windows = audition_windows(cues,100)
        self.assertEqual(windows[0]['end_seconds'],28)
        self.assertEqual(windows[1]['start_seconds'],50)
        self.assertEqual(windows[1]['end_seconds'],67)
        self.assertEqual(windows[1]['text'],'丙\n丁')

    def test_coverage_counts_overlaps_once_and_flags_gaps(self):
        result=audit([dict(start=0,end=20,text='第一段'),dict(start=10,end=30,text='插话'),
                      dict(start=70,end=80,text='后面的内容')],100)
        self.assertEqual(result['speech_timestamp_coverage'],.4)
        self.assertEqual(result['gaps_over_30_seconds'],[dict(start=30,end=70)])
        self.assertEqual(result['listening_alignment'],'not_verified')


if __name__=='__main__':
    unittest.main()
