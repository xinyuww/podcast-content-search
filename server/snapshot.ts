// Imported only by server route handlers. Never import this module into a client component.
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { taxonomy } from "../lib/needs.ts";
import { isHostedAudioUrl } from "../lib/audio-source.ts";
import type { ListeningPlaylist } from "../lib/playlist.ts";

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const DIMENSIONS = 1536;
export type Tags = Record<"topics" | "help_types" | "formats", string[]>;
export type CorpusRecord = {
  id: string; episodeId: string; title: string; summary: string; show: string; episode: string;
  sourceUrl: string; audioUrl: string; start: number; end: number; episodeDuration: number;
  cues: { start: number; end: number; text: string }[]; reviewStatus: string; tags: Tags; vector: number[];
};
export function normalizeVector(vector: number[]): number[] {
  if (vector.length !== DIMENSIONS || vector.some(x => !Number.isFinite(x))) throw new Error("Invalid embedding");
  const norm = Math.sqrt(vector.reduce((s, x) => s + x*x, 0));
  if (!norm) throw new Error("Zero embedding");
  return vector.map(x => x / norm);
}
export function openSnapshot(path = join(process.cwd(), "server/data/corpus.sqlite3")) {
  const db = new DatabaseSync(path, { readOnly: true, allowExtension: false });
  try {
    const meta = Object.fromEntries(db.prepare("SELECT key,value FROM metadata").all().map(r => [String(r.key), String(r.value)]));
    if (meta.schema_version !== "1" || meta.taxonomy_version !== taxonomy.version || meta.embedding_model !== EMBEDDING_MODEL || Number(meta.dimensions) !== DIMENSIONS) throw new Error("Incompatible corpus snapshot");
    return db;
  } catch (error) { db.close(); throw error; }
}
let cachedRecords: CorpusRecord[] | undefined;
export function loadSnapshotRecords(): CorpusRecord[] {
  if (cachedRecords) return cachedRecords;
  const db = openSnapshot();
  try {
    const rows = db.prepare(`SELECT c.payload_json AS unit,c.annotation_json AS annotation,e.payload_json AS episode,
      v.vector,v.model,v.dimensions FROM chapters c JOIN episodes e ON e.id=c.episode_id
      LEFT JOIN embeddings v ON v.unit_id=c.id WHERE c.eligible=1 ORDER BY c.episode_id,c.id`).all();
    const records = rows.map(row => {
      const u = JSON.parse(String(row.unit));
      const a = JSON.parse(String(row.annotation));
      const e = JSON.parse(String(row.episode));
      if (!(row.vector instanceof Uint8Array) || row.model !== EMBEDDING_MODEL || row.dimensions !== DIMENSIONS || row.vector.byteLength !== DIMENSIONS*4 || !isHostedAudioUrl(e.audioUrl)) throw new Error("Invalid corpus record");
      const bytes = new DataView(row.vector.buffer, row.vector.byteOffset, row.vector.byteLength);
      const vector = normalizeVector(Array.from({ length: DIMENSIONS }, (_, i) => bytes.getFloat32(i*4, true)));
      const tags = Object.fromEntries((["topics", "help_types", "formats"] as const).map(f => [f, a[f].map((t: { label: string }) => t.label).sort()])) as Tags;
      return { id: u.id, episodeId: u.episode_id, title: u.title, summary: a.summary, show: e.show, episode: e.title,
        sourceUrl: e.sourceUrl, audioUrl: e.audioUrl, start: u.start_seconds, end: u.end_seconds,
        episodeDuration: e.duration, cues: u.cues, reviewStatus: u.review_status, tags, vector };
    });
    cachedRecords = records;
    return records;
  } finally { db.close(); }
}
export function loadDemoPlaylist(): ListeningPlaylist {
  const db = openSnapshot();
  try {
    const row = db.prepare("SELECT payload_json FROM demo LIMIT 1").get();
    if (!row) throw new Error("Missing demo");
    const demo = JSON.parse(String(row.payload_json)) as ListeningPlaylist;
    if (demo.items.some(i => !isHostedAudioUrl(i.audioUrl) || i.audioUrl !== i.episodeAudioUrl || i.audioOffset !== i.start)) throw new Error("Invalid demo audio");
    return demo;
  } finally { db.close(); }
}
