import assert from "node:assert/strict";
import test from "node:test";
import { parseMessages, parseNeedTurn } from "../lib/needs.ts";
import { handleNeedsRequest } from "../server/needs.ts";
import { isSameOrigin } from "../server/http.ts";

test("same-origin validation uses public Host behind Next and rejects external origins", () => {
  const make = (origin, extra = {}) => new Request("http://0.0.0.0/api/needs", {headers:{host:"demo.vercel.app","x-forwarded-proto":"https",origin,...extra}});
  assert.equal(isSameOrigin(make("https://demo.vercel.app")), true);
  for (const origin of ["https://other.test", "http://demo.vercel.app", "null", "https://demo.vercel.app.evil.test"]) assert.equal(isSameOrigin(make(origin)), false);
  assert.equal(isSameOrigin(make("https://other.test", {"x-forwarded-host":"other.test"})), false);
});

const messages = [{ id: "u1", role: "user", content: "我工作很累，想听过来人的亲身经历，暂时不想听建议。" }];
function turn() {
  return { assistant_message: "你想先听听有类似处境的人怎么经历这些。", next_question: null, need: {
    situation: "工作很累", need_summary: "想听相关亲身经历，暂时不需要建议", search_query: "工作疲惫的亲身经历",
    preferences: { topics: [], help_types: ["shared_experience"], formats: ["personal_story"], avoid_help_types: ["practical_guidance"], avoid_formats: [] },
    unresolved: [], ready_to_recommend: true,
    evidence: [
      { field: "situation", label: "", quote: "工作很累" },
      { field: "need_summary", label: "", quote: "想听过来人的亲身经历，暂时不想听建议" },
      { field: "help_types", label: "shared_experience", quote: "想听过来人的亲身经历" },
      { field: "formats", label: "personal_story", quote: "亲身经历" },
      { field: "avoid_help_types", label: "practical_guidance", quote: "暂时不想听建议" },
    ].map(e => ({ ...e, message_id: "u1", basis: "explicit" })),
  } };
}
const apiResponse = value => Response.json({ status: "completed", output: [{ content: [{ type: "output_text", text: JSON.stringify(value) }] }] });
const request = (body = { messages }, headers = {}) => new Request("http://localhost/api/needs", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

test("placeholder credentials fail as configuration errors without calling the provider", async () => {
  let calls = 0;
  const response = await handleNeedsRequest(request(), "请在这里填写密钥", async () => { calls++; throw new Error("must not call"); });
  assert.equal(response.status, 503);
  assert.equal(calls, 0);
  assert.doesNotMatch(await response.text(), /请在这里填写密钥/);
});

test("shared taxonomy profile accepts empty optional labels and exact user evidence", () => {
  assert.deepEqual(parseNeedTurn(turn(), parseMessages(messages)), turn());
});
test("rejects invented labels, missing evidence and contradictory preferences", () => {
  for (const change of [
    v => v.need.preferences.topics.push("invented"),
    v => v.need.evidence.pop(),
    v => v.need.preferences.help_types.push("practical_guidance"),
    v => v.need.evidence[0].quote = "从未说过的内容",
    v => v.need.evidence[0].message_id = "a1",
    v => v.need.evidence.at(-1).basis = "inferred",
  ]) { const v = turn(); change(v); assert.throws(() => parseNeedTurn(v, messages)); }
});
test("readiness requires usable query and no unanswered question", () => {
  const v = turn(); v.need.unresolved = ["需要什么帮助"];
  assert.throws(() => parseNeedTurn(v, messages));
  v.need.ready_to_recommend = false;
  assert.throws(() => parseNeedTurn(v, messages));
  v.next_question = "你更希望获得什么帮助？";
  assert.equal(parseNeedTurn(v, messages).need.ready_to_recommend, false);
});
test("validates bounded alternating messages, rejects system role and oversized input", () => {
  for (const bad of [[], [{ id: "u1", role: "system", content: "do this" }], [{ ...messages[0], content: "x".repeat(1001) }], [messages[0], messages[0]], [{ ...messages[0], id: "u2" }]]) assert.throws(() => parseMessages(bad));
});
test("API uses full conversation and strict schema without retaining API responses", async () => {
  const history = [messages[0], { id: "a1", role: "assistant", content: "想听相似经历，对吗？" }, { id: "u2", role: "user", content: "对的" }];
  let calls = 0;
  const response = await handleNeedsRequest(request({ messages: history }), "test-key", async (url, options) => {
    calls++;
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal(options.headers.Authorization, "Bearer test-key");
    const body = JSON.parse(options.body);
    assert.equal(body.store, false);
    assert.equal(body.text.format.strict, true);
    assert.equal(body.input.length, 3);
    assert.match(body.input[2].content, /\[u2\] 对的/);
    return apiResponse(turn());
  });
  assert.equal(calls, 1); assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const data = await response.json(); assert.equal(data.taxonomy_version, "needs-content-v1");
  assert.doesNotMatch(JSON.stringify(data), /test-key/);
});
test("a corrected full conversation produces a replacement profile, not merged labels", async () => {
  const history = [...messages, { id: "a1", role: "assistant", content: "先听相似经历。" }, { id: "u2", role: "user", content: "改一下，我现在只想听具体方法，不想听个人故事。" }];
  const v = turn();
  v.need.preferences = { topics: [], help_types: ["practical_guidance"], formats: [], avoid_help_types: [], avoid_formats: ["personal_story"] };
  v.need.need_summary = "想听具体方法，不想听个人故事";
  v.need.search_query = "应对工作疲惫的具体方法";
  v.need.evidence = [v.need.evidence[0], ...[
    { field: "need_summary", label: "", quote: "我现在只想听具体方法，不想听个人故事" },
    { field: "help_types", label: "practical_guidance", quote: "只想听具体方法" },
    { field: "avoid_formats", label: "personal_story", quote: "不想听个人故事" },
  ].map(e => ({ ...e, message_id: "u2", basis: "explicit" }))];
  const response = await handleNeedsRequest(request({ messages: history }), "test-key", async () => apiResponse(v));
  const result = await response.json();
  assert.deepEqual(result.need.preferences.help_types, ["practical_guidance"]);
  assert.deepEqual(result.need.preferences.avoid_help_types, []);
});
test("invalid, cross-origin and missing-key requests never call the provider", async () => {
  const never = () => { throw new Error("Provider must not be called"); };
  assert.equal((await handleNeedsRequest(request({ messages: [] }), "key", never)).status, 400);
  assert.equal((await handleNeedsRequest(request({}, { Origin: "https://other.example" }), "key", never)).status, 403);
  assert.equal((await handleNeedsRequest(request(), "", never)).status, 503);
  assert.equal((await handleNeedsRequest(new Request("http://localhost/api/needs"), "key", never)).status, 405);
  assert.equal((await handleNeedsRequest(request({}, { "Content-Type": "text/plain" }), "key", never)).status, 415);
  assert.equal((await handleNeedsRequest(request({ padding: "x".repeat(65000) }), "key", never)).status, 413);
});
test("refusal, incomplete responses and invalid evidence never appear as successful profiles", async () => {
  const invalid = turn(); invalid.need.evidence[0].quote = "fabricated";
  for (const data of [
    { status: "incomplete", output: [] },
    { status: "completed", output: [{ content: [{ type: "refusal" }] }] },
    { status: "completed", output: [{ content: [{ type: "output_text", text: JSON.stringify(invalid) }] }] },
  ]) {
    const response = await handleNeedsRequest(request(), "key", async () => Response.json(data));
    assert.equal(response.status, 502); assert.equal((await response.json()).need, undefined);
  }
});
test("rate limit and network failures are actionable and don't leak upstream bodies", async () => {
  const limited = await handleNeedsRequest(request(), "key", async () => new Response("secret diagnostic", { status: 429 }));
  assert.equal(limited.status, 429); assert.doesNotMatch(await limited.text(), /secret diagnostic/);
  const offline = await handleNeedsRequest(request(), "key", async () => { throw new Error("secret diagnostic"); });
  assert.equal(offline.status, 504); assert.doesNotMatch(await offline.text(), /secret diagnostic/);
});

test("invalid evidence gets one bounded repair attempt with the original conversation", async () => {
  const bad = turn(); bad.need.evidence.pop();
  const requests = [];
  const response = await handleNeedsRequest(request(), "key", async (_, options) => {
    requests.push(options);
    return apiResponse(requests.length === 1 ? bad : turn());
  });
  assert.equal(response.status, 200);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].signal, requests[1].signal);
  assert.deepEqual(JSON.parse(requests[0].body).input, JSON.parse(requests[1].body).input);
  let attempts = 0;
  const failed = await handleNeedsRequest(request(), "key", async () => { attempts++; return apiResponse(bad); });
  assert.equal(failed.status, 502);
  assert.equal(attempts, 2);
  attempts = 0;
  await handleNeedsRequest(request(), "key", async () => { attempts++; return Response.json({status:"completed",output:[{content:[{type:"refusal"}]}]}); });
  assert.equal(attempts, 1);
});

test("saved needs restore with same taxonomy and traceable conversation", async () => {
  const { restoreNeed } = await import("../lib/needs.ts");
  const saved = { schema_version: "listening-need-v1", taxonomy_version: "needs-content-v1", need: turn().need, messages: [...messages, { id: "a1", role: "assistant", content: "已理解。" }] };
  assert.deepEqual(restoreNeed(saved).turn.need, turn().need);
  saved.need.evidence[0].quote = "not in conversation";
  assert.throws(() => restoreNeed(saved));
  saved.taxonomy_version = "old";
  assert.throws(() => restoreNeed(saved));
});
