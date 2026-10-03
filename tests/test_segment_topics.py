import copy
import json
import sqlite3
import unittest
from pathlib import Path

from backend.pipelines import segment_topics as topics


class TopicSegmentationTests(unittest.TestCase):
    def setUp(self):
        self.episode = dict(id='test', title='测试节目', duration_seconds=700)
        self.cues = [dict(id=f'test:cue:{i}', position=i, start_seconds=float(s), end_seconds=float(e), text=t)
                     for i, (s, e, t) in enumerate([(1, 100, '问题'), (100, 201, '回应'),
                                                  (200, 300, '另一个话题'), (302, 650, '完整讨论')])]
        self.result = {'chapters': [self.chapter('c0001', 'c0002'), self.chapter('c0003', 'c0004')]}

    @staticmethod
    def chapter(start, end):
        return dict(title='主题', summary='内容概述', start_cue_id=start, end_cue_id=end,
                    kind='content', standalone=True, review_note='')

    def artifact(self):
        return dict(episode_id='test', transcript_sha256=topics.digest(self.cues), model='test-model',
                    chapters=topics.normalize(self.episode, self.cues, self.result))

    def test_real_cue_times_and_overlap_are_preserved(self):
        chapters = topics.normalize(self.episode, self.cues, self.result)
        self.assertEqual((chapters[0]['start_seconds'], chapters[0]['end_seconds']), (1, 201))
        self.assertEqual(chapters[1]['first_cue_db_id'], 'test:cue:2')
        self.assertIn('source_cue_overlap_at_start', chapters[1]['flags'])
        self.assertEqual(chapters[1]['review_status'], 'needs_listening_review')

    def test_missing_duplicate_unknown_reversed_and_trailing_cues_rejected(self):
        for start, end in [('c0002', 'c0004'), ('c0004', 'c0004'), ('c9999', 'c0004'),
                           ('c0003', 'c0002'), ('c0003', 'c0003')]:
            with self.subTest(start=start, end=end), self.assertRaises(ValueError):
                topics.normalize(self.episode, self.cues,
                                 {'chapters': [self.chapter('c0001', 'c0002'), self.chapter(start, end)]})

    def test_stale_transcript_and_tampered_timestamp_rejected(self):
        artifact = self.artifact()
        changed = copy.deepcopy(self.cues)
        changed[0]['text'] = '修订后的问题'
        with self.assertRaises(ValueError):
            topics.validate_artifact(artifact, self.episode, changed)
        artifact['chapters'][0]['end_seconds'] = 190
        with self.assertRaises(ValueError):
            topics.validate_artifact(artifact, self.episode, self.cues)

    def test_incomplete_refusal_and_missing_output_rejected(self):
        for response in [dict(status='incomplete'), dict(status='completed', output=[]),
                         dict(status='completed', output=[dict(content=[dict(type='refusal')])])]:
            with self.assertRaises(ValueError):
                topics.response_result(response)

    def test_reviewed_artifact_restores_without_api_cache(self):
        artifact = self.artifact()
        review = dict(chapters=self.result['chapters'], notes=['Checked boundaries'],
                      model_result_sha256='original-result-hash')
        artifact['text_review'] = dict(review_sha256=topics.digest(review))
        # No request_sha256/cache file is available: an already-verified result suffices.
        self.assertEqual(topics.apply_text_review(artifact, review, self.episode, self.cues), artifact)

    def test_saved_real_artifacts_and_database_match(self):
        if not topics.DATABASE.exists():
            self.skipTest('Local corpus not present')
        paths = [p for p in topics.OUTPUT.glob('*.json')
                 if not p.name.endswith(('.review.json', '.corrections.json'))]
        if not paths:
            self.skipTest('Topic segmentation has not been run')
        with sqlite3.connect(f'file:{topics.DATABASE}?mode=ro', uri=True) as db:
            if not db.execute("SELECT 1 FROM sqlite_master WHERE name='topic_chapters'").fetchone():
                self.skipTest('Import saved topic chapters first')
            for path in paths:
                artifact = json.loads(path.read_text())
                episode, cues = topics.read_episode(db, artifact['episode_id'])
                chapters = topics.validate_artifact(artifact, episode, cues)
                rows = db.execute('SELECT * FROM topic_chapters WHERE episode_id=? ORDER BY position',
                                  (episode['id'],)).fetchall()
                self.assertEqual(len(rows), len(chapters))
                for row, chapter in zip(rows, chapters):
                    self.assertEqual(row['start_seconds'], chapter['start_seconds'])
                    self.assertEqual(row['end_seconds'], chapter['end_seconds'])
                    self.assertEqual(row['transcript'], '\n'.join(c['text'] for c in
                        cues[chapter['first_cue_position']:chapter['last_cue_position']+1]))

    def test_import_is_idempotent_atomic_and_rebuild_safe(self):
        db = sqlite3.connect(':memory:')
        db.execute('PRAGMA foreign_keys=ON')
        db.execute('CREATE TABLE episodes (id TEXT PRIMARY KEY,title TEXT,duration_seconds REAL)')
        db.execute('CREATE TABLE transcript_cues (id TEXT PRIMARY KEY,episode_id TEXT,position INTEGER,'
                   'start_seconds REAL,end_seconds REAL,text TEXT)')
        db.execute('INSERT INTO episodes VALUES (?,?,?)', ('test', '测试节目', 700))
        db.executemany('INSERT INTO transcript_cues VALUES (?,?,?,?,?,?)',
                       [(c['id'], 'test', c['position'], c['start_seconds'], c['end_seconds'], c['text']) for c in self.cues])
        db.commit()
        artifact = self.artifact()
        topics.import_results(db, [artifact])
        topics.import_results(db, [artifact])
        self.assertEqual(db.execute('SELECT count(*) FROM topic_chapters').fetchone()[0], 2)
        self.assertEqual(db.execute('SELECT transcript FROM topic_chapters ORDER BY position').fetchone()[0], '问题\n回应')
        bad = copy.deepcopy(artifact)
        bad['transcript_sha256'] = 'stale'
        with self.assertRaises(ValueError):
            topics.import_results(db, [artifact, bad])
        self.assertEqual(db.execute('SELECT count(*) FROM topic_chapters').fetchone()[0], 2)
        db.execute('DELETE FROM transcript_cues')
        self.assertEqual(db.execute('SELECT count(*) FROM topic_chapters').fetchone()[0], 0)
        db.close()


if __name__ == '__main__':
    unittest.main()
