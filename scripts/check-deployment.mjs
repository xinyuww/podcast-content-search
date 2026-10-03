/** Fail closed if the corpus is missing or local media would enter the web bundle. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { isHostedAudioUrl } from "../lib/audio-source.ts";
const root = process.cwd();
const path = join(root, "server/data/corpus.sqlite3");
const bytes = await readFile(path);
const manifest = JSON.parse(await readFile(join(root, "server/data/corpus.json"), "utf8"));
assert.equal(createHash("sha256").update(bytes).digest("hex"), manifest.sha256, "Snapshot differs from release manifest; run npm run snapshot:export locally");
const db = new DatabaseSync(path, { readOnly: true });
try {
  assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  for (const [table, expected] of [["episodes", 15], ["chapters", 185], ["embeddings", 165], ["transcript_cues", 4157]]) {
    assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, expected, `Unexpected ${table} count`);
  }
  assert.equal(db.prepare("SELECT count(*) AS n FROM chapters WHERE eligible=1").get().n, 164);
  assert.equal(manifest.audio_policy, "hosted_local_audio");
  for (const row of db.prepare("SELECT payload_json FROM episodes").all()) {
    assert(isHostedAudioUrl(JSON.parse(row.payload_json).audioUrl), "Every episode must use the dedicated audio store");
  }
  assert.equal(db.prepare("SELECT count(*) AS n FROM chapters c LEFT JOIN embeddings v ON c.id=v.unit_id WHERE c.eligible=1 AND v.unit_id IS NULL").get().n, 0);
  assert.throws(() => db.exec("CREATE TABLE should_never_write (id INTEGER)"), /readonly/i);
} finally { db.close(); }
async function checkPublic(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    assert(!entry.isSymbolicLink(), "Public symlinks can expose private data");
    assert(!/\.(mp3|m4a|mp4|wav|sqlite3?|db)$/i.test(entry.name) && entry.name !== "demo-audio", "Local media/database must not be published");
    if (entry.isDirectory()) await checkPublic(join(directory, entry.name));
  }
}
await checkPublic(join(root, "public"));
console.log(`Deployment snapshot verified: 15 episodes, 164 eligible chapters, ${(bytes.length/1024/1024).toFixed(2)} MiB; audio hosted separately in Blob.`);
