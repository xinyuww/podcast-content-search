import { isHostedAudioUrl } from "../lib/audio-source.ts";
import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parsePlaylistResponse } from "../lib/playlist.ts";
let child, origin, output = "";
before(async () => {
  const reservation = createServer();
  await new Promise((resolve, reject) => {
    reservation.once("error", reject);
    reservation.listen(0, "127.0.0.1", resolve);
  });
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  origin = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ["--import", fileURLToPath(new URL("./fixtures/mock-openai.mjs", import.meta.url)), "node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)], {
    env: {...process.env,OPENAI_API_KEY:"test-key",PODCAST_TEST_PROVIDER:"1",NODE_ENV:"production"}, stdio:["ignore","pipe","pipe"],
  });
  child.stdout.on("data", x => output += x); child.stderr.on("data", x => output += x);
  for (let i=0; i<100; i++) {
    if (child.exitCode !== null) throw new Error(output);
    try { if ((await fetch(origin, { signal: AbortSignal.timeout(1000) })).ok) return; } catch { /* server starting */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Production server not ready: "+output);
});
after(() => child?.kill("SIGTERM"));

test("production HTML retains the night-radio interface", async () => {
  const r = await fetch(origin); assert.equal(r.status, 200);
  const html = await r.text();
  for (const text of ["声签","调到你的频率","世界很吵，","听点与你有关的。","找到我的声音","告诉我此刻的困惑，一个问题，一点心情，都可以。","YOUR PERSONAL RADIO","/demo"]) assert(html.includes(text), text);
  assert(!html.includes("test-key"));
  for (const text of ["15 期真实素材", "从这里开始。", "恢复已保存的需求", "返回上一份拼盘", "我目前的理解"]) assert(!html.includes(text), text);
});
test("demo has its own playable page", async () => {
  const response = await fetch(origin+"/demo");
  assert.equal(response.status, 200);
  const html = await response.text();
  for (const text of ["Demo 拼盘", "audio-seek", "播放音频", "拼盘片段列表"]) assert(html.includes(text), text);
  for (const text of ["为此刻的你。", "从第一段播放", "全部为原播客音频"]) assert(!html.includes(text), text);
});
test("production API returns a validated need from the test provider", async () => {
  const r = await fetch(origin+"/api/needs", {method:"POST",headers:{"Content-Type":"application/json",Origin:origin},body:JSON.stringify({messages:[{id:"u1",role:"user",content:"想了解编程"}]})});
  assert.equal(r.status, 200);
  assert.equal((await r.json()).need.ready_to_recommend, true);
});
test("production retrieves from the SQLite snapshot using a stub query vector", async () => {
  const fixture = JSON.parse(readFileSync(new URL("fixtures/retrieval-parity.json", import.meta.url)))[0];
  const r = await fetch(origin+"/api/playlists", {method:"POST",headers:{"Content-Type":"application/json",Origin:origin},body:JSON.stringify({taxonomy_version:"needs-content-v1",need:{ready_to_recommend:true,search_query:fixture.query,preferences:fixture.profile}})});
  assert.equal(r.status, 200);
  const result = parsePlaylistResponse(await r.json());
  assert.deepEqual(result.playlist.items.map(i=>i.id), fixture.selected_ids);
});
test("fixed demo requires no audio server; database and local media are inaccessible", async () => {
  const r = await fetch(origin+"/api/demo"); assert.equal(r.status, 200);
  const p = await r.json(); assert.equal(p.items.length, 4);
  for (const item of p.items) { assert(isHostedAudioUrl(item.audioUrl)); assert.equal(item.audioOffset,item.start); }
  for (const path of ["/server/data/corpus.sqlite3","/data/podcasts.sqlite3","/media/episodes/test","/demo-audio/test.mp3"]) assert.equal((await fetch(origin+path)).status,404);
});
test("production APIs reject cross-origin and malformed requests", async () => {
  for (const path of ["/api/needs","/api/playlists"]) {
    const r = await fetch(origin+path,{method:"POST",headers:{Origin:"https://other.test","Content-Type":"application/json"},body:"{}"});
    assert.equal(r.status,403);
    assert.equal((await fetch(origin+path)).status,405);
  }
});
