import assert from "node:assert/strict";
import test from "node:test";
import { detectAudioFormat } from "../scripts/audio-format.mjs";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

test("M4A downloaded with an mp3 filename must be published as audio/mp4", () => {
  const header = Buffer.from("0000001c6674797069736f6d00000200", "hex");
  assert.deepEqual(detectAudioFormat(header), { extension: "m4a", contentType: "audio/mp4" });
});

test("MP3 tags and MPEG frame headers are recognized; other content fails closed", () => {
  for (const header of [Buffer.from("ID3\x04\x00\x00"), Buffer.from("fffb9064", "hex")]) {
    assert.deepEqual(detectAudioFormat(header), { extension: "mp3", contentType: "audio/mpeg" });
  }
  for (const header of [Buffer.alloc(0), Buffer.from("<html>error"), Buffer.from("fff15080", "hex")]) {
    assert.throws(() => detectAudioFormat(header), /Unsupported/);
  }
});

test("published snapshot uses the reviewed audio URL and type for every original", () => {
  const manifest = JSON.parse(readFileSync(new URL("../data/hosted-audio.json", import.meta.url)));
  const db = new DatabaseSync(new URL("../server/data/corpus.sqlite3", import.meta.url), { readOnly: true });
  try {
    for (const { payload_json } of db.prepare("SELECT payload_json FROM episodes").all()) {
      const episode = JSON.parse(payload_json);
      const asset = manifest.episodes[episode.id];
      assert.equal(episode.audioUrl, asset.url);
      assert.equal(asset.content_type, asset.url.endsWith(".m4a") ? "audio/mp4" : "audio/mpeg");
    }
    const demo = JSON.parse(db.prepare("SELECT payload_json FROM demo").get().payload_json);
    assert(demo.items[0].audioUrl.endsWith(".m4a"), "The first demo episode is AAC/M4A, not MP3");
    for (const item of demo.items) {
      assert.equal(item.audioUrl, manifest.episodes[item.episodeId].url);
      assert.equal(item.audioOffset, item.start);
    }
  } finally { db.close(); }
});
