/** Verify public MP3 delivery and seeking against bytes from the local originals. */
import assert from "node:assert/strict";
import { readFile, open, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { isHostedAudioUrl } from "../lib/audio-source.ts";
const manifest = JSON.parse(await readFile("data/hosted-audio.json", "utf8"));
const db = new DatabaseSync("data/podcasts.sqlite3", { readOnly: true });
const rows = db.prepare("SELECT episode_id,local_path FROM source_assets WHERE kind='audio' ORDER BY episode_id").all();
db.close();
const partial = process.argv.includes("--partial");
if (!partial) assert.equal(Object.keys(manifest.episodes).length, 15);
const results = [];
for (const row of rows) {
  const asset = manifest.episodes[row.episode_id];
  if (!asset && partial) continue;
  assert(isHostedAudioUrl(asset.url));
  const file = await open(row.local_path);
  try {
    for (const start of [0, Math.floor(asset.bytes / 2)]) {
      const end = start + 1023;
      const r = await fetch(asset.url, { headers: { Range: `bytes=${start}-${end}`, Referer: "https://podcast-content-search.vercel.app/" }, signal: AbortSignal.timeout(30000) });
      if (r.status !== 206) { await r.body?.cancel(); throw new Error(`Range request failed: ${row.episode_id} HTTP ${r.status}`); }
      assert.equal(r.headers.get("content-range"), `bytes ${start}-${end}/${asset.bytes}`);
      assert.match(r.headers.get("content-type"), /^audio\/mpeg/);
      const expected = Buffer.alloc(1024);
      await file.read(expected, 0, 1024, start);
      assert.deepEqual(Buffer.from(await r.arrayBuffer()), expected);
    }
    results.push({ episode_id: row.episode_id, range_status: 206, head_and_middle_bytes_match: true });
    console.log(`Verified audio byte ranges: ${row.episode_id}`);
  } finally { await file.close(); }
}
await writeFile("outputs/hosted-audio-verification.json", JSON.stringify({ checked_at: new Date().toISOString(), partial, results }, null, 2));
