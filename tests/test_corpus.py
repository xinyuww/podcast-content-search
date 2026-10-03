"""Importer edge cases; run python3 -m unittest discover -s tests -p 'test_*.py'."""
import sqlite3
import json
import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend import corpus


class CorpusTests(unittest.TestCase):
    def test_multi_show_asr_without_chapters_preserves_audio_on_rebuild(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            raw = root / 'data/raw'
            raw.mkdir(parents=True)
            shows = [dict(id=pid, title=pid, publisher='fixture', language='zh-CN',
                          rss_url='https://example.com/feed', source_url='https://example.com')
                     for pid in ['show-a', 'show-b', 'show-c']]
            episodes = []
            for i, show in enumerate(shows):
                eid = f'episode-{i}'
                (raw / f'{eid}.vtt').write_text('WEBVTT\n\n00:01.000 --> 00:03.000\n测试字幕\n')
                episodes.append(dict(id=eid, podcast_id=show['id'], title=eid, guid=eid,
                    published_at='2026-01-01', duration_seconds=10, source_url='https://example.com',
                    audio_url='https://example.com/audio.mp3', transcript_url='', chapters_url='',
                    transcript_origin=['publisher_vtt','local_asr','openai_asr'][i]))
            (raw / 'episode-1.asr.json').write_text(json.dumps({'complete': True}))
            (raw/'audio').mkdir()
            (raw/'audio/episode-2.mp3').write_bytes(b'audio-fixture')
            (raw/'episode-2.asr.json').write_text(json.dumps(dict(complete=True, engine='openai-api',
                model='gpt-4o-transcribe-diarize', transcript_sha256=hashlib.sha256((raw/'episode-2.vtt').read_bytes()).hexdigest(),
                audio_sha256=hashlib.sha256(b'audio-fixture').hexdigest())))
            manifest = root / 'data/collection.json'
            manifest.write_text(json.dumps(dict(podcasts=shows, episodes=episodes,
                rights={'evidence_url': 'https://example.com/rights'})))
            database = root / 'data/test.sqlite3'
            with patch.object(corpus, 'ROOT', root):
                corpus.build(database, manifest)
                with sqlite3.connect(database) as db:
                    db.execute('INSERT INTO source_assets VALUES (?,?,?,?,?,?,?)',
                        ('episode-1','audio','url','path','hash',42,'date'))
                result = corpus.build(database, manifest)
            self.assertEqual(result['podcasts'], 3)
            self.assertEqual(result['transcript_origins'], {'local_asr_imported':1,'publisher_vtt_imported':1,'openai_asr_imported':1})
            self.assertEqual(result['local_audio_files'], 1)
            with sqlite3.connect(database) as db:
                self.assertEqual(db.execute('SELECT id,podcast_id FROM episodes ORDER BY id').fetchall(),
                                 [('episode-0','show-a'),('episode-1','show-b'),('episode-2','show-c')])
                self.assertEqual(db.execute('SELECT count(*) FROM chapters').fetchone()[0],0)
                self.assertEqual(db.execute('SELECT count(*) FROM transcript_cues').fetchone()[0],3)
            (raw/'audio/episode-2.mp3').write_bytes(b'different-audio')
            with patch.object(corpus,'ROOT',root), self.assertRaisesRegex(ValueError,'different source audio'):
                corpus.build(database,manifest)

    def test_cue_identifiers_settings_and_voice_tags(self):
        cues = corpus.parse_vtt("WEBVTT\n\n1\n00:01.250 --> 00:04.000 align:start\n<v 说话人 1>甲 &amp; 乙\n", 10)
        self.assertEqual(cues[0]["start"], 1.25)
        self.assertEqual(cues[0]["speaker"], "说话人 1")
        self.assertEqual(cues[0]["text"], "甲 & 乙")
        self.assertIn("&amp;", cues[0]["raw"])

    def test_bad_or_out_of_range_cues_fail(self):
        for content in ["<html>Not found</html>", "WEBVTT\n\nmalformed cue",
                        "WEBVTT\n\n00:02.000 --> 00:01.000\n逆序",
                        "WEBVTT\n\n00:00.000 --> 01:00.000\n超界"]:
            with self.assertRaises(ValueError):
                corpus.parse_vtt(content, 10)

    def test_grouping_preserves_gaps_and_every_cue(self):
        cues = [{"start": 0, "end": 2}, {"start": 5, "end": 9}, {"start": 10, "end": 15}]
        chapters = [{"startTime": 5, "endTime": 10}, {"startTime": 10, "endTime": 20}]
        groups = corpus.group_cues(cues, chapters)
        self.assertEqual([index for index, _ in groups], [None, 0, 1])
        self.assertEqual([index for _, group in groups for index, _ in group], [0, 1, 2])

    def test_existing_corpus_integrity_and_literal_search(self):
        if not corpus.DATABASE.exists():
            self.skipTest("Download and build corpus for integration validation")
        with sqlite3.connect(f"file:{corpus.DATABASE}?mode=ro", uri=True) as db:
            corpus.check(db)
            self.assertTrue(corpus.search(db, "焦虑"))
            self.assertFalse(corpus.search(db, "' OR 1=1 --"))


if __name__ == "__main__":
    unittest.main()
