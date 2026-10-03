import { isHostedAudioUrl } from "../lib/audio-source.ts";
/** Anonymous production smoke test. Sends one synthetic need and one query embedding request. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { parsePlaylistResponse } from "../lib/playlist.ts";
const origin = new URL(process.argv[2]).origin;
assert(origin.startsWith("https://"), "Use the public HTTPS deployment URL");
const checks = [];
async function get(path, expected) {
  const r = await fetch(origin + path, { redirect: "manual", signal: AbortSignal.timeout(30000) });
  assert.equal(r.status, expected, path);
  checks.push({ path, status: r.status });
  return r;
}
async function post(path, body, requestOrigin = origin) {
  return fetch(origin + path, { method: "POST", redirect: "manual",
    headers: { Origin: requestOrigin, "Content-Type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(55000) });
}
const html = await (await get("/", 200)).text();
assert(html.includes("调到你的频率"));
const demo = await (await get("/api/demo", 200)).json();
assert(demo.items.length >= 3 && demo.items.length <= 5);
for (const path of ["/server/data/corpus.sqlite3", "/data/podcasts.sqlite3", "/.env.local", "/demo-audio/test.mp3"]) await get(path, 404);
for (const path of ["/api/needs", "/api/playlists"]) {
  assert.equal((await post(path, {}, "https://other.example")).status, 403);
}
const started = Date.now();
const nr = await post("/api/needs", { messages: [{ id: "u1", role: "user", content: "我是程序员，想了解 AI 编程工具在团队里的实际用法，想听具体的实践经验。" }] });
assert.equal(nr.status, 200, "Live needs API");
const need = await nr.json();
assert.equal(need.need.ready_to_recommend, true);
const pr = await post("/api/playlists", { taxonomy_version: need.taxonomy_version, need: need.need });
assert.equal(pr.status, 200, "Live retrieval API");
const result = parsePlaylistResponse(await pr.json());
assert(result.playlist, "Synthetic programming query should have enough coverage");
assert(result.playlist.items.length >= 3 && result.playlist.items.length <= 5);
assert(result.playlist.totalDuration >= 600 && result.playlist.totalDuration <= 1800);
for (const item of [...demo.items, ...result.playlist.items]) {
  assert.equal(item.audioOffset, item.start);
  assert(isHostedAudioUrl(item.audioUrl));
}
const summary = { origin, checked_at: new Date().toISOString(), checks,
  live: { status: result.status, clips: result.playlist.items.length, duration: result.playlist.totalDuration, elapsed_ms: Date.now() - started },
  note: "Anonymous HTTP checks; this does not replace real browser audio and mobile checks." };
await mkdir("outputs", { recursive: true });
await writeFile("outputs/public-verification.json", JSON.stringify({ ...summary, need, result }, null, 2));
console.log(JSON.stringify(summary, null, 2));
