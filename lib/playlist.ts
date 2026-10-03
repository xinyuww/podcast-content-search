import type { PlaylistItem } from "./player";
import type { Preferences } from "./needs";
import { isHostedAudioUrl } from "./audio-source.ts";
export type ListeningItem = PlaylistItem & {
  episodeId: string; chapterId: string; title: string; summary: string; show: string;
  episode: string; sourceUrl: string; end: number;
  cues: { start: number; end: number; text: string }[];
  matches?: Partial<Preferences>;
  similarity?: number;
};
export type ListeningPlaylist = { id: string; kind?: "matched"; title: string; totalDuration: number; items: ListeningItem[] };
export type PlaylistResponse = {
  status: "ready" | "partial_match" | "insufficient_coverage";
  message: string;
  playlist: ListeningPlaylist | null;
  unmet_preferences?: Partial<Preferences>;
};

export function parsePlaylistResponse(value: unknown): PlaylistResponse {
  const invalid = () => { throw new Error("拼盘数据格式不完整，请重试。"); };
  if (!value || typeof value !== "object") return invalid();
  const r = value as PlaylistResponse;
  if (!["ready", "partial_match", "insufficient_coverage"].includes(r.status) || typeof r.message !== "string") return invalid();
  if (r.status === "insufficient_coverage") {
    if (r.playlist !== null) return invalid();
    return r;
  }
  const p = r.playlist;
  if (!p || p.kind !== "matched" || typeof p.id !== "string" || typeof p.title !== "string" || !Array.isArray(p.items) || p.items.length < 3 || p.items.length > 5) return invalid();
  for (const i of p.items) {
    if (!i || ![i.start, i.end, i.duration, i.episodeDuration, i.audioOffset].every(Number.isFinite) || i.start < 0 || i.end <= i.start || i.end > i.episodeDuration + .1 || i.audioOffset !== i.start || Math.abs(i.duration - (i.end - i.start)) > .01) return invalid();
    if (![i.id, i.title, i.summary, i.show, i.episode, i.sourceUrl].every(x => typeof x === "string") || !isHostedAudioUrl(i.audioUrl) || i.episodeAudioUrl !== i.audioUrl) return invalid();
    if (!Array.isArray(i.cues) || i.cues.some(c => !c || typeof c.text !== "string" || !Number.isFinite(c.start) || !Number.isFinite(c.end))) return invalid();
  }
  if (new Set(p.items.map(i => i.id)).size !== p.items.length) return invalid();
  const total = p.items.reduce((n, i) => n + i.duration, 0);
  if (!Number.isFinite(p.totalDuration) || total < 600 || total > 1800 || Math.abs(total - p.totalDuration) > .01) return invalid();
  return r;
}
