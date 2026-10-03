import { createHash } from "node:crypto";
import { preferenceFields, taxonomy, vocabulary } from "../lib/needs.ts";
import type { Preferences } from "../lib/needs.ts";
import type { ListeningItem, PlaylistResponse } from "../lib/playlist.ts";
import { DIMENSIONS, EMBEDDING_MODEL, loadSnapshotRecords, normalizeVector } from "./snapshot.ts";
import type { CorpusRecord, Tags } from "./snapshot.ts";

export const MIN_SIMILARITY = .35;
export const WEIGHTS = { help_types: .10, formats: .08, topics: .04 };
type Ranked = { record: CorpusRecord; similarity: number; score: number; matches: Tags };
export class RetrievalError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}
export function validateSearchNeed(body: unknown): { query: string; preferences: Preferences } {
  const fail = () => { throw new RetrievalError("需求格式无效，请先完成需求确认。", 400); };
  if (!body || typeof body !== "object") return fail();
  const b = body as { taxonomy_version?: unknown; need?: { ready_to_recommend?: unknown; search_query?: unknown; preferences?: unknown } };
  const need = b.need;
  if (b.taxonomy_version !== taxonomy.version || need?.ready_to_recommend !== true || typeof need.search_query !== "string" || !need.search_query.trim() || need.search_query.length > 1000) return fail();
  const p = need.preferences;
  if (!p || typeof p !== "object" || Array.isArray(p) || Object.keys(p).length !== preferenceFields.length) return fail();
  const preferences = p as Preferences;
  for (const field of preferenceFields) {
    const labels = preferences[field];
    if (!Array.isArray(labels) || labels.length > 3 || new Set(labels).size !== labels.length || labels.some(x => typeof x !== "string" || !Object.hasOwn(vocabulary(field), x))) return fail();
  }
  for (const field of ["help_types", "formats"] as const) {
    if (preferences[field].some(x => preferences[`avoid_${field}`].includes(x))) return fail();
  }
  return { query: need.search_query.trim(), preferences };
}

const compareId = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const rounded = (n: number) => Math.round(n*100000)/100000;
/** Match Python's cosine recall -> hard excludes -> deterministic label bonuses. */
export function rankRecords(records: CorpusRecord[], vector: number[], preferences: Preferences) {
  const query = normalizeVector(vector);
  const candidates = records.map(record => ({ record, similarity: record.vector.reduce((sum, x, i) => sum + x*query[i], 0) }))
    .filter(r => r.similarity >= MIN_SIMILARITY)
    .sort((a, b) => b.similarity - a.similarity || compareId(a.record.id, b.record.id));
  const ranked: Ranked[] = [];
  for (const candidate of candidates.slice(0, 30)) {
    if ((["formats", "help_types"] as const).some(f => candidate.record.tags[f].some(t => preferences[`avoid_${f}`].includes(t)))) continue;
    const matches: Tags = { topics: [], help_types: [], formats: [] };
    let score = candidate.similarity;
    for (const field of Object.keys(WEIGHTS) as (keyof Tags)[]) {
      matches[field] = preferences[field].filter(t => candidate.record.tags[field].includes(t)).sort();
      score += preferences[field].length ? WEIGHTS[field]*matches[field].length/preferences[field].length : 0;
    }
    ranked.push({ ...candidate, score, matches });
  }
  ranked.sort((a, b) => b.score - a.score || b.similarity - a.similarity || compareId(a.record.id, b.record.id));
  // Python serializes to five decimal places before its assembler.
  return { ranked: ranked.map(r => ({ ...r, score: rounded(r.score), similarity: rounded(r.similarity) })),
    counts: { eligible: records.length, above_threshold: candidates.length, after_rules: ranked.length } };
}

/** Choose complete chapters, with the same scoring and tie order as the offline service. */
export function assemble(ranked: Ranked[]): Ranked[] {
  const ids = new Set<string>();
  const pool = ranked.slice(0, 30).filter(({ record: r }) => {
    const duration = r.end-r.start;
    if (ids.has(r.id) || !Number.isFinite(duration) || duration <= 0 || duration > 1800) return false;
    ids.add(r.id); return true;
  });
  let best: Ranked[] = [], bestScore = -Infinity;
  for (let count = 3; count <= Math.min(5, pool.length); count++) {
    const selected: Ranked[] = [];
    function visit(index: number, total: number, relevance: number) {
      if (selected.length === count) {
        if (total < 600 || total > 1800) return;
        const score = relevance/count + .015*new Set(selected.map(c => c.record.show)).size
          + .005*new Set(selected.map(c => c.record.episodeId)).size - .02*Math.abs(total-1200)/600;
        if (score > bestScore) { bestScore = score; best = [...selected]; }
        return;
      }
      for (let i = index; i <= pool.length-(count-selected.length); i++) {
        const candidate = pool[i], r = candidate.record, nextTotal = total+r.end-r.start;
        if (nextTotal > 1800 || selected.some(({ record: a }) => a.episodeId === r.episodeId && Math.max(a.start, r.start) < Math.min(a.end, r.end))) continue;
        selected.push(candidate); visit(i+1, nextTotal, relevance+candidate.score); selected.pop();
      }
    }
    visit(0, 0, 0);
  }
  return best;
}

export async function embedQuery(query: string, key: string, signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<number[]> {
  if (!key || !/^[!-~]+$/.test(key)) throw new RetrievalError("检索服务尚未配置，请稍后重试。你也可以先试听固定拼盘。", 503);
  let response: Response;
  try {
    response = await fetcher("https://api.openai.com/v1/embeddings", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: [query], dimensions: DIMENSIONS, encoding_format: "float" }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(35000)]) : AbortSignal.timeout(35000),
    });
  } catch { throw new RetrievalError("检索请求超时或网络不可用，需求已保留，请重试。", 504); }
  if (!response.ok) throw new RetrievalError(response.status === 429 ? "检索服务暂时繁忙或额度不足，请稍后重试。" : "暂时无法连接检索服务，请稍后重试。", response.status === 429 ? 429 : 502);
  try {
    const result = await response.json() as { model?: string; data?: { index: number; embedding: number[] }[] };
    if (result.model !== EMBEDDING_MODEL || result.data?.length !== 1 || result.data[0].index !== 0 || !Array.isArray(result.data[0].embedding) || result.data[0].embedding.some((v: unknown) => typeof v !== "number")) throw new Error("Unexpected embedding response");
    return normalizeVector(result.data[0].embedding);
  } catch { throw new RetrievalError("未能获得有效检索结果，请重试。", 502); }
}

export function playlistFromVector(records: CorpusRecord[], vector: number[], query: string, preferences: Preferences): PlaylistResponse {
  const result = rankRecords(records, vector, preferences);
  const chosen = assemble(result.ranked);
  if (!chosen.length) return { status: "insufficient_coverage", playlist: null,
    message: "现有相关章节无法组成 3–5 段、10–30 分钟的完整拼盘。请调整需求；不会用无关内容补足。" };
  const items: ListeningItem[] = chosen.map(({ record: r, similarity, matches }) => ({
    id: r.id, chapterId: r.id, episodeId: r.episodeId, title: r.title, summary: r.summary,
    show: r.show, episode: r.episode, sourceUrl: r.sourceUrl, start: r.start, end: r.end,
    duration: r.end-r.start, episodeDuration: r.episodeDuration, audioOffset: r.start,
    audioUrl: r.audioUrl, episodeAudioUrl: r.audioUrl, cues: r.cues, similarity, matches,
  }));
  const missing = Object.fromEntries((Object.keys(WEIGHTS) as (keyof Tags)[]).map(f => [f, preferences[f].filter(t => !chosen.some(c => c.matches[f].includes(t))).sort()])) as Tags;
  const partial = Object.values(missing).some(labels => labels.length);
  return { status: partial ? "partial_match" : "ready", unmet_preferences: missing,
    message: partial ? "拼盘已生成，但部分期望的帮助或形式尚未覆盖。" : "已根据当前需求选出完整章节。",
    playlist: { id: createHash("sha256").update(JSON.stringify([query, preferences, items.map(i => i.id)])).digest("hex"),
      kind: "matched", title: "按当前需求组合的声音拼盘", totalDuration: items.reduce((s, i) => s+i.duration, 0), items } };
}
export async function createPlaylist(body: unknown, key: string, signal?: AbortSignal, fetcher: typeof fetch = fetch) {
  const { query, preferences } = validateSearchNeed(body);
  const records = loadSnapshotRecords();
  const vector = await embedQuery(query, key, signal, fetcher);
  return playlistFromVector(records, vector, query, preferences);
}
