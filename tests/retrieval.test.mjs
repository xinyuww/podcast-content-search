import { isHostedAudioUrl } from "../lib/audio-source.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { openSnapshot, loadSnapshotRecords, loadDemoPlaylist, EMBEDDING_MODEL } from "../server/snapshot.ts";
import { rankRecords, assemble, playlistFromVector, embedQuery, validateSearchNeed } from "../server/retrieval.ts";
import { parsePlaylistResponse } from "../lib/playlist.ts";
import { readPlaylistBody } from "../server/http.ts";
const fixtures = JSON.parse(readFileSync(new URL("fixtures/retrieval-parity.json", import.meta.url)));
const records = loadSnapshotRecords();
test("snapshot is read-only and complete, with reusable vectors", () => {
  const db = openSnapshot();
  try {
    assert.equal(db.prepare("SELECT count(*) AS n FROM episodes").get().n, 15);
    assert.equal(records.length, 164);
    assert.throws(() => db.exec("CREATE TABLE mutation (id INTEGER)"), /readonly/);
  } finally { db.close(); }
  const demo = loadDemoPlaylist();
  assert.equal(demo.items.length, 4);
  for (const item of demo.items) { assert.equal(item.audioOffset, item.start); assert(isHostedAudioUrl(item.audioUrl)); }
});
for (const fixture of fixtures) test(`Python/Node parity: ${fixture.id}`, () => {
  const { ranked } = rankRecords(records, fixture.vector, fixture.profile);
  assert.deepEqual(ranked.map(r => r.record.id), fixture.ranked_ids);
  assert.deepEqual(assemble(ranked).map(r => r.record.id), fixture.selected_ids);
  const result = playlistFromVector(records, fixture.vector, fixture.query, fixture.profile);
  assert.equal(result.status, fixture.status);
  parsePlaylistResponse(result);
  assert(!JSON.stringify(result).includes('"vector"'));
  assert(!JSON.stringify(result).includes("data/raw"));
});
test("need validation rejects unknown labels, conflicts, and unconfirmed needs", () => {
  const b = {taxonomy_version:"needs-content-v1",need:{ready_to_recommend:true,search_query:"工作",preferences:{topics:[],help_types:[],formats:[],avoid_formats:[],avoid_help_types:[]}}};
  assert.equal(validateSearchNeed(b).query, "工作");
  b.need.preferences.topics = ["unknown"]; assert.throws(() => validateSearchNeed(b));
  b.need.preferences.topics = []; b.need.preferences.help_types = ["perspective"]; b.need.preferences.avoid_help_types = ["perspective"]; assert.throws(() => validateSearchNeed(b));
  b.need.ready_to_recommend = false; assert.throws(() => validateSearchNeed(b));
});
test("embeddings send only the new query and validate upstream responses", async () => {
  const result = await embedQuery("查询", "test-key", undefined, async (url, init) => {
    assert.equal(url, "https://api.openai.com/v1/embeddings");
    assert.deepEqual(JSON.parse(init.body).input, ["查询"]);
    return Response.json({model:EMBEDDING_MODEL,data:[{index:0,embedding:fixtures[0].vector}]});
  });
  assert.equal(result.length, 1536);
  await assert.rejects(embedQuery("查询", "test-key", undefined, async () => Response.json({model:EMBEDDING_MODEL,data:[{index:0,embedding:[1]}]})), /有效/);
  await assert.rejects(embedQuery("查询", "test-key", undefined, async () => new Response("secret", {status:429})), /额度/);
});
test("request body cap works without Content-Length", async () => {
  await assert.rejects(readPlaylistBody(new Request("http://localhost/api/playlists", {method:"POST",body:"x".repeat(16001)})), /large/);
});
