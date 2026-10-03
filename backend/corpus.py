"""Build and inspect a local, source-traceable podcast corpus (Python stdlib only)."""

import argparse
import hashlib
import html
import json
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from backend.paths import ROOT
MANIFEST = ROOT / "data/collection.json"
DATABASE = ROOT / "data/podcasts.sqlite3"
TIMING = re.compile(r"^([\d:.]+)\s+-->\s+([\d:.]+)(?:\s.*)?$")


def seconds(value):
    parts = value.split(":")
    if len(parts) not in (2, 3):
        raise ValueError(f"Invalid timestamp: {value}")
    result = 0.0
    for part in parts:
        result = result * 60 + float(part)
    return result


def parse_vtt(raw, duration):
    raw = raw.lstrip("\ufeff").replace("\r\n", "\n")
    if not raw.startswith("WEBVTT"):
        raise ValueError("Not a WebVTT transcript")
    cues = []
    for block in re.split(r"\n\s*\n", raw):
        lines = block.splitlines()
        if not lines or lines[0].startswith(("WEBVTT", "NOTE", "STYLE", "REGION")):
            continue
        timing_index = next((i for i, line in enumerate(lines) if TIMING.match(line)), None)
        if timing_index is None:
            raise ValueError("Unrecognized VTT block; refusing to silently skip text")
        match = TIMING.match(lines[timing_index])
        start, end = map(seconds, match.groups())
        if not 0 <= start < end <= duration + 1:
            raise ValueError(f"Cue outside episode: {start}, {end}, {duration}")
        payload = "\n".join(lines[timing_index + 1:])
        voice = re.search(r"<v(?:\.[^\s>]+)?\s+([^>]+)>", payload)
        text = html.unescape(re.sub(r"<[^>]+>", "", payload)).strip()
        if not text:
            raise ValueError("Empty cue")
        if cues and start < cues[-1]["start"]:
            raise ValueError("Non-monotonic cues")
        cues.append({"start": start, "end": end, "speaker": voice.group(1) if voice else None,
                     "text": text, "raw": payload})
    if not cues:
        raise ValueError("Transcript contains no cues")
    return cues


def parse_chapters(raw, duration):
    chapters = json.loads(raw)["chapters"]
    for index, chapter in enumerate(chapters):
        start = chapter["startTime"]
        end = chapter.get("endTime")
        if end is None:
            raise ValueError("No explicit chapter end; needs source review")
        if not 0 <= start < end <= duration + 1 or not chapter.get("title"):
            raise ValueError("Invalid chapter")
        if index and start < chapters[index - 1]["endTime"] - 0.01:
            raise ValueError("Overlapping chapters")
    if not chapters:
        raise ValueError("No chapters")
    return chapters


SCHEMA = """
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS podcasts (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, publisher TEXT NOT NULL,
 language TEXT NOT NULL, rss_url TEXT NOT NULL, source_url TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS episodes (
 id TEXT PRIMARY KEY, podcast_id TEXT NOT NULL REFERENCES podcasts(id),
 title TEXT NOT NULL, guid TEXT NOT NULL UNIQUE, published_at TEXT NOT NULL,
 duration_seconds REAL NOT NULL CHECK(duration_seconds>0), source_url TEXT NOT NULL,
 audio_url TEXT NOT NULL, transcript_url TEXT NOT NULL, chapters_url TEXT NOT NULL,
 transcript_status TEXT NOT NULL, audio_alignment_status TEXT NOT NULL,
 rights_evidence_url TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS source_assets (
 episode_id TEXT NOT NULL REFERENCES episodes(id), kind TEXT NOT NULL,
 url TEXT NOT NULL, local_path TEXT NOT NULL, sha256 TEXT NOT NULL, byte_count INTEGER NOT NULL,
 imported_at TEXT NOT NULL, PRIMARY KEY(episode_id, kind));
CREATE TABLE IF NOT EXISTS chapters (
 id TEXT PRIMARY KEY, episode_id TEXT NOT NULL REFERENCES episodes(id), position INTEGER NOT NULL,
 title TEXT NOT NULL, start_seconds REAL NOT NULL, end_seconds REAL NOT NULL,
 CHECK(start_seconds>=0 AND end_seconds>start_seconds), UNIQUE(episode_id,position));
CREATE TABLE IF NOT EXISTS transcript_cues (
 id TEXT PRIMARY KEY, episode_id TEXT NOT NULL REFERENCES episodes(id), position INTEGER NOT NULL,
 start_seconds REAL NOT NULL, end_seconds REAL NOT NULL, speaker_label TEXT,
 text TEXT NOT NULL, raw_payload TEXT NOT NULL,
 CHECK(start_seconds>=0 AND end_seconds>start_seconds), UNIQUE(episode_id,position));
CREATE TABLE IF NOT EXISTS transcript_segments (
 id TEXT PRIMARY KEY, episode_id TEXT NOT NULL REFERENCES episodes(id),
 chapter_id TEXT REFERENCES chapters(id), title TEXT NOT NULL,
 start_seconds REAL NOT NULL, end_seconds REAL NOT NULL, transcript TEXT NOT NULL,
 first_cue_position INTEGER NOT NULL, last_cue_position INTEGER NOT NULL,
 boundary_method TEXT NOT NULL, review_status TEXT NOT NULL,
 CHECK(start_seconds>=0 AND end_seconds>start_seconds));
CREATE INDEX IF NOT EXISTS cues_episode_idx ON transcript_cues(episode_id,position);
CREATE INDEX IF NOT EXISTS segments_episode_idx ON transcript_segments(episode_id,start_seconds);
"""


def group_cues(cues, chapters, target_seconds=180):
    """Use source cue boundaries; do not split sentences or invent timestamps."""
    groups, current, current_chapter = [], [], None
    for position, cue in enumerate(cues):
        chapter_index = next((i for i, chapter in enumerate(chapters)
                              if chapter["startTime"] <= cue["start"] < chapter["endTime"]), None)
        if current and (chapter_index != current_chapter or
                        cue["end"] - current[0][1]["start"] > target_seconds):
            groups.append((current_chapter, current))
            current = []
        current_chapter = chapter_index
        current.append((position, cue))
    if current:
        groups.append((current_chapter, current))
    return groups


def build(database=DATABASE, manifest_path=MANIFEST):
    manifest = json.loads(Path(manifest_path).read_text())
    podcasts = manifest.get("podcasts") or [manifest["podcast"]]
    podcast_ids = {podcast["id"] for podcast in podcasts}
    now = datetime.now(timezone.utc).isoformat()
    # Validate all inputs before touching an existing database.
    prepared = []
    for episode in manifest["episodes"]:
        pid = episode.get("podcast_id", podcasts[0]["id"])
        if pid not in podcast_ids:
            raise ValueError(f"Unknown podcast: {pid}")
        assets = {"transcript": ROOT / "data/raw" / f'{episode["id"]}.vtt'}
        if episode.get("chapters_url"):
            assets["chapters"] = ROOT / "data/raw" / f'{episode["id"]}.json'
        cues = parse_vtt(assets["transcript"].read_text(), episode["duration_seconds"])
        chapters = (parse_chapters(assets["chapters"].read_text(), episode["duration_seconds"])
                    if "chapters" in assets else [])
        if episode.get("transcript_origin") in ("local_asr", "openai_asr"):
            provenance = ROOT / "data/raw" / f'{episode["id"]}.asr.json'
            meta = json.loads(provenance.read_text())
            if not meta.get("complete"):
                raise ValueError(f"ASR incomplete: {episode['id']}")
            if episode.get("transcript_origin") == "openai_asr":
                if meta.get("engine") != "openai-api" or not meta.get("model"):
                    raise ValueError("Missing OpenAI ASR provenance")
                if meta.get("transcript_sha256") != hashlib.sha256(assets["transcript"].read_bytes()).hexdigest():
                    raise ValueError("ASR transcript checksum mismatch")
                audio = ROOT / "data/raw/audio" / f'{episode["id"]}.mp3'
                if meta.get("audio_sha256") != hashlib.sha256(audio.read_bytes()).hexdigest():
                    raise ValueError("ASR belongs to different source audio")
            assets["transcript_provenance"] = provenance
        prepared.append((episode, assets, cues, chapters))
    db = sqlite3.connect(database)
    db.executescript(SCHEMA)
    with db:
        for podcast in podcasts:
            db.execute("INSERT INTO podcasts VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET "
                       "title=excluded.title,publisher=excluded.publisher,language=excluded.language,"
                       "rss_url=excluded.rss_url,source_url=excluded.source_url",
                       tuple(podcast[k] for k in ["id", "title", "publisher", "language", "rss_url", "source_url"]))
        for episode, assets, cues, chapters in prepared:
            eid = episode["id"]
            # Replace only derived rows of the selected episode; preserve unrelated episodes.
            for table in ["transcript_segments", "transcript_cues", "chapters"]:
                db.execute(f"DELETE FROM {table} WHERE episode_id=?", (eid,))
            # Rebuilding subtitles must preserve separately verified local audio.
            db.execute("DELETE FROM source_assets WHERE episode_id=? AND kind IN ('transcript','chapters','transcript_provenance')", (eid,))
            db.execute("INSERT INTO episodes VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) "
                       "ON CONFLICT(id) DO UPDATE SET podcast_id=excluded.podcast_id,title=excluded.title,guid=excluded.guid,"
                       "published_at=excluded.published_at,duration_seconds=excluded.duration_seconds,"
                       "source_url=excluded.source_url,audio_url=excluded.audio_url,"
                       "transcript_url=excluded.transcript_url,chapters_url=excluded.chapters_url,"
                       "transcript_status=excluded.transcript_status,audio_alignment_status=excluded.audio_alignment_status,"
                       "rights_evidence_url=excluded.rights_evidence_url",
                       (eid, episode.get("podcast_id", podcasts[0]["id"]), episode["title"], episode["guid"], episode["published_at"],
                        episode["duration_seconds"], episode["source_url"], episode["audio_url"],
                        episode["transcript_url"], episode["chapters_url"],
                        episode.get("transcript_origin", "publisher_vtt") + "_imported",
                        episode.get("audio_alignment_status", "not_listening_verified"), manifest["rights"]["evidence_url"]))
            for kind, path in assets.items():
                blob = path.read_bytes()
                db.execute("INSERT INTO source_assets VALUES (?,?,?,?,?,?,?)", (eid, kind,
                           episode.get(kind + "_url", ""), str(path.relative_to(ROOT)), hashlib.sha256(blob).hexdigest(), len(blob), now))
            for index, chapter in enumerate(chapters):
                db.execute("INSERT INTO chapters VALUES (?,?,?,?,?,?)", (f"{eid}:chapter:{index}", eid,
                           index, chapter["title"], chapter["startTime"], chapter["endTime"]))
            for index, cue in enumerate(cues):
                db.execute("INSERT INTO transcript_cues VALUES (?,?,?,?,?,?,?,?)", (f"{eid}:cue:{index}",
                           eid, index, cue["start"], cue["end"], cue["speaker"], cue["text"], cue["raw"]))
            for index, (chapter_index, group) in enumerate(group_cues(cues, chapters)):
                chapter_id = f"{eid}:chapter:{chapter_index}" if chapter_index is not None else None
                title = chapters[chapter_index]["title"] if chapter_index is not None else episode["title"]
                transcript = "\n".join(cue["text"] for _, cue in group)
                db.execute("INSERT INTO transcript_segments VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                           (f"{eid}:segment:{index}", eid, chapter_id, title, group[0][1]["start"],
                            max(cue["end"] for _, cue in group), transcript, group[0][0], group[-1][0],
                            ("asr_cues_grouped_180s_target" if episode.get("transcript_origin") in ("local_asr", "openai_asr")
                             else "publisher_cues_grouped_within_chapters_180s_target"), "needs_listening_review"))
    check(db)
    result = report(db)
    (ROOT / "data/import-report.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    db.close()
    return result


def check(db):
    assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    assert not db.execute("PRAGMA foreign_key_check").fetchall()
    assert db.execute("SELECT count(*) FROM episodes").fetchone()[0] > 0
    assert db.execute("SELECT count(*) FROM transcript_segments WHERE transcript='' OR end_seconds<=start_seconds").fetchone()[0] == 0
    # Every source cue must be assigned to exactly one segment (including intros).
    bad = db.execute("""SELECT c.id FROM transcript_cues c LEFT JOIN transcript_segments s
      ON s.episode_id=c.episode_id AND c.position BETWEEN s.first_cue_position AND s.last_cue_position
      GROUP BY c.id HAVING count(s.id) != 1""").fetchall()
    assert not bad, f"Unassigned or duplicated cues: {bad[:3]}"
    for eid, start, end, first, last, text in db.execute(
            "SELECT episode_id,start_seconds,end_seconds,first_cue_position,last_cue_position,transcript FROM transcript_segments"):
        rows = db.execute("SELECT start_seconds,end_seconds,text FROM transcript_cues WHERE episode_id=? "
                          "AND position BETWEEN ? AND ? ORDER BY position", (eid, first, last)).fetchall()
        assert start == rows[0][0] and end == max(row[1] for row in rows)
        assert text == "\n".join(row[2] for row in rows)


def report(db):
    counts = {table: db.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
              for table in ["podcasts", "episodes", "chapters", "transcript_cues", "transcript_segments"]}
    counts["audio_hours"] = round(db.execute("SELECT sum(duration_seconds)/3600 FROM episodes").fetchone()[0], 2)
    counts["verified_by_listening"] = 0
    counts["transcript_origins"] = dict(db.execute("SELECT transcript_status,count(*) FROM episodes GROUP BY transcript_status"))
    counts["local_audio_files"] = db.execute("SELECT count(*) FROM source_assets WHERE kind='audio'").fetchone()[0]
    available = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    for table in ["topic_chapters", "content_units", "content_annotations", "content_embeddings"]:
        if table in available:
            counts[table] = db.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
    counts["embeddings_generated"] = counts.get("content_embeddings", 0) > 0
    counts["episodes_detail"] = [{"id": row[0], "title": row[1], "duration_seconds": row[2], "segments": row[3]}
        for row in db.execute("SELECT e.id,e.title,e.duration_seconds,count(s.id) FROM episodes e "
                              "LEFT JOIN transcript_segments s ON s.episode_id=e.id GROUP BY e.id ORDER BY e.published_at")]
    return counts


def search(db, query, limit=5):
    # Deliberately a substring baseline, not a claim of semantic search.
    escaped = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    pattern = "%" + escaped + "%"
    rows = db.execute("""SELECT s.id,e.title,s.title,s.start_seconds,s.end_seconds,e.source_url
      FROM transcript_segments s JOIN episodes e ON e.id=s.episode_id
      WHERE s.transcript LIKE ? ESCAPE '\\' OR s.title LIKE ? ESCAPE '\\'
      ORDER BY (s.title LIKE ? ESCAPE '\\') DESC,e.published_at DESC,s.start_seconds LIMIT ?""",
      (pattern, pattern, pattern, limit)).fetchall()
    return [dict(zip(["id", "episode", "chapter", "start_seconds", "end_seconds", "source_url"], row)) for row in rows]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["build", "check", "search", "download-config"])
    parser.add_argument("query", nargs="?")
    args = parser.parse_args()
    if args.command == "download-config":
        manifest = json.loads(MANIFEST.read_text())
        (ROOT / "data/raw").mkdir(exist_ok=True)
        print('fail\nlocation\nsilent\nshow-error\nmax-time = 30\nretry = 1')
        for episode in manifest["episodes"]:
            for kind, extension in [("transcript", "vtt"), ("chapters", "json")]:
                if not episode.get(kind + "_url"):
                    continue
                print("url = " + json.dumps(episode[kind + "_url"]))
                print("output = " + json.dumps(str(ROOT / "data/raw" / f'{episode["id"]}.{extension}')))
        raise SystemExit(0)
    elif args.command == "build":
        output = build()
    else:
        with sqlite3.connect(f"file:{DATABASE}?mode=ro", uri=True) as connection:
            if args.command == "check":
                check(connection)
                output = report(connection)
            else:
                if not args.query or not args.query.strip():
                    parser.error("search requires a non-empty keyword")
                output = search(connection, args.query.strip())
    print(json.dumps(output, ensure_ascii=False, indent=2))
