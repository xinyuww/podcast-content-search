/** Local-only publishing of the 15 downloaded MP3s. Never imported by the web app. */
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { readFile, writeFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { resolve, relative } from "node:path";
import { spawn } from "node:child_process";
const storeId = process.env.BLOB_STORE_ID;
const cli = process.env.VERCEL_CLI;
if (!storeId || !cli) throw new Error("Set BLOB_STORE_ID and VERCEL_CLI; load .env.local for short-lived OIDC authentication");
const root = process.cwd();
const db = new DatabaseSync("data/podcasts.sqlite3", { readOnly: true });
const rows = db.prepare("SELECT e.id,a.local_path,a.sha256 FROM episodes e JOIN source_assets a ON a.episode_id=e.id AND a.kind='audio' ORDER BY e.id").all();
db.close();
if (rows.length !== 15) throw new Error("Expected exactly 15 audio files");
const manifestPath = "data/hosted-audio.json";
let manifest = { schema_version: 1, store_id: storeId, episodes: {} };
try { manifest = JSON.parse(await readFile(manifestPath, "utf8")); } catch (e) { if (e.code !== "ENOENT") throw e; }
if (manifest.store_id !== storeId) throw new Error("Manifest belongs to a different store");
for (const row of rows) {
  const file = resolve(root, row.local_path);
  if (!relative(root, file).startsWith("data/raw/audio/")) throw new Error("Unexpected local audio path");
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  const sha256 = hash.digest("hex");
  if (sha256 !== row.sha256) throw new Error(`Audio hash changed: ${row.id}`);
  if (manifest.episodes[row.id]?.sha256 === sha256) { console.log(`Already uploaded: ${row.id}`); continue; }
  const pathname = `audio/${row.id}-${sha256.slice(0, 16)}.mp3`;
  console.log(`Uploading: ${row.id}`);
  const output = await new Promise((ok, fail) => {
    const child = spawn(cli, ["blob", "put", file, "--access", "public", "--pathname", pathname, "--content-type", "audio/mpeg", "--scope", "xwei1"], { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let text = "";
    for (const stream of [child.stdout, child.stderr]) stream.on("data", b => { text = (text + b.toString()).slice(-32000); });
    child.on("error", fail);
    child.on("exit", code => code === 0 ? ok(text) : fail(new Error(`Upload failed (${row.id}): ${text.slice(-1200)}`)));
  });
  const urls = String(output).match(/https:\/\/[a-z0-9]+\.public\.blob\.vercel-storage\.com\/[^\s"<>]+\.mp3/g);
  const url = urls?.find(u => new URL(u).pathname === "/" + pathname);
  if (!url) throw new Error("Upload returned no matching MP3 URL: " + row.id);
  manifest.episodes[row.id] = { url, sha256, bytes: (await stat(file)).size };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Uploaded ${Object.keys(manifest.episodes).length}/15: ${row.id}`);
}
const origins = new Set(Object.values(manifest.episodes).map(e => new URL(e.url).origin));
if (origins.size !== 1) throw new Error("Audio URLs must use a single dedicated store");
await writeFile("lib/audio-host.json", JSON.stringify({ origin: [...origins][0] }, null, 2) + "\n");
console.log("All 15 audio files uploaded; run npm run snapshot:export next.");
