import copy
import json
import math
import sqlite3
import struct
import unittest
from pathlib import Path
from unittest.mock import patch

from backend import content_index as index
from backend import search_content as search


def source(uid='unit'):
    return dict(id=uid,episode_id='episode',source_table='chapters',source_hash='source-v1',
        title='标题',transcript='完整原文',audio_path=__file__,known_kind=None,known_standalone=None,
        source_flags=[],review_status='needs_listening_review',cues=[dict(position=0,text='真实经历')])


def annotation(uid='unit',help_type='information',form='explanation'):
    return dict(unit_id=uid,summary='基于原文的摘要',context='具体处境',kind='content',standalone=True,
        standalone_reason='',summary_cue_ids=['c0001'],topics=[],
        help_types=[dict(label=help_type,cue_ids=['c0001'])],formats=[dict(label=form,cue_ids=['c0001'])])


class ContentIndexTests(unittest.TestCase):
    def test_evidence_must_reference_own_unit(self):
        a=annotation()
        index.validate_annotations([source()],{'annotations':[a]})
        a['help_types'][0]['cue_ids']=['c0002']
        with self.assertRaises(ValueError):
            index.validate_annotations([source()],{'annotations':[a]})

    def test_missing_duplicate_and_unknown_labels_rejected(self):
        for rows in [[],[annotation(),annotation()],[annotation('other')]]:
            with self.assertRaises(ValueError):
                index.validate_annotations([source()],{'annotations':rows})
        a=annotation(help_type='made_up')
        with self.assertRaises(ValueError):
            index.validate_annotations([source()],{'annotations':[a]})

    def test_known_context_and_non_content_cannot_be_overridden(self):
        u,a=source(),annotation()
        self.assertTrue(index.eligible(u,a))
        u['known_standalone']=0
        self.assertFalse(index.eligible(u,a))
        self.assertTrue(index.eligible(u,a,require_standalone=False))
        u['known_kind']='outro'
        self.assertFalse(index.eligible(u,a,require_standalone=False))

    def test_verified_only_excludes_unlistened_audio(self):
        self.assertFalse(index.eligible(source(),annotation(),verified_only=True))

    def test_embedding_text_keeps_entire_transcript(self):
        u=source()
        u['transcript']='开始\n'+'完整文本'*2000+'\n结尾'
        self.assertTrue(index.embedding_text(u,annotation()).endswith(u['transcript']))

    def test_vector_normalization_and_bad_values(self):
        self.assertEqual(index.unit_vector([3,4],2),[0.6,0.8])
        for vector in [[0,0],[1],[float('nan'),1],[float('inf'),1]]:
            with self.assertRaises(ValueError):
                index.unit_vector(vector,2)

    def test_source_changes_invalidate_annotations_and_vectors(self):
        with sqlite3.connect(':memory:') as db:
            db.row_factory=sqlite3.Row
            db.executescript("CREATE TABLE episodes(id TEXT PRIMARY KEY); CREATE TABLE chapters(id TEXT PRIMARY KEY);"
                             "CREATE TABLE topic_chapters(id TEXT PRIMARY KEY);"
                             "INSERT INTO episodes VALUES('episode'); INSERT INTO chapters VALUES('unit');")
            u=source()
            index.sync_units(db,[u])
            db.execute('INSERT INTO content_annotations VALUES (?,?,?,?,?,?,?)',('unit','source-v1','ah','model','v1','{}','{}'))
            db.execute('INSERT INTO content_embeddings VALUES (?,?,?,?,?,?,?)',('unit','ah','model',2,'th',3,struct.pack('<2f',1,0)))
            db.commit()
            index.sync_units(db,[u])
            self.assertEqual(db.execute('SELECT count(*) FROM content_embeddings').fetchone()[0],1)
            u['source_hash']='source-v2'
            index.sync_units(db,[u])
            self.assertEqual(db.execute('SELECT count(*) FROM content_embeddings').fetchone()[0],0)
            self.assertEqual(db.execute('SELECT count(*) FROM content_annotations').fetchone()[0],0)

    def test_live_index_has_exact_source_text_and_valid_evidence(self):
        if not index.DB.exists():
            self.skipTest('No local corpus')
        with index.connect() as db:
            if not db.execute("SELECT 1 FROM sqlite_master WHERE name='content_units'").fetchone():
                self.skipTest('Prepare index first')
            index.assert_sources_current(db)
            index.annotations_current(db)
            for u,a,h in index.annotated_units(db):
                index.validate_annotations([u],{'annotations':[a]})
                self.assertEqual(u['transcript'],'\n'.join(c['text'] for c in u['cues']))
                self.assertGreater(u['end_seconds'],u['start_seconds'])


class RankingTests(unittest.TestCase):
    def records(self):
        return [dict(unit=source('methods'),annotation=annotation('methods','practical_guidance','practical_advice'),vector=[0.8,0.6]),
                dict(unit=source('story'),annotation=annotation('story','shared_experience','personal_story'),vector=[0.75,math.sqrt(1-0.75**2)])]

    def test_same_query_different_preferences_change_order(self):
        records=self.records()
        base=search.rank_records(records,[1,0],{})
        empathetic=search.rank_records(records,[1,0],dict(help_types=['shared_experience'],formats=['personal_story']))
        self.assertEqual(base['results'][0]['unit']['id'],'methods')
        self.assertEqual(empathetic['results'][0]['unit']['id'],'story')
        self.assertEqual(empathetic['baseline'][0]['unit']['id'],'methods')

    def test_explicit_avoid_is_hard_filter(self):
        result=search.rank_records(self.records(),[1,0],dict(avoid_formats=['practical_advice']))
        self.assertEqual([r['unit']['id'] for r in result['results']],['story'])
        self.assertEqual(result['excluded'][0]['labels'],['practical_advice'])

    def test_labels_cannot_rescue_unrelated_semantics(self):
        result=search.rank_records(self.records(),[-1,0],dict(help_types=['shared_experience']))
        self.assertEqual(result['status'],'insufficient_coverage')
        self.assertEqual(result['results'],[])

    def test_missing_emotional_support_is_visible(self):
        result=search.rank_records(self.records(),[1,0],dict(help_types=['emotional_support']))
        self.assertEqual(result['status'],'partial_match')
        self.assertEqual(result['unmet_preferences']['help_types'],['emotional_support'])

    def test_unknown_profile_and_dimension_mismatch_fail(self):
        with self.assertRaises(ValueError):
            search.rank_records(self.records(),[1,0],dict(formats=['imaginary']))
        with self.assertRaises(ValueError):
            search.rank_records(self.records(),[1,0,0],{})


if __name__=='__main__':
    unittest.main()
