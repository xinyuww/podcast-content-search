/** Live model acceptance checks using synthetic conversations. Each uncached run costs API usage.
 * npm run needs:evaluate -- --url http://127.0.0.1:3000
 * Without --url, calls the same service function directly with .env.local.
 */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { inferNeed, NEEDS_MODEL } from "../server/needs.ts";
import { parseNeedTurn, taxonomy } from "../lib/needs.ts";
const root = new URL("../", import.meta.url);
const fixture = JSON.parse(await readFile(new URL("data/needs-cases.json", root), "utf8"));
const urlIndex = process.argv.indexOf("--url");
const baseUrl = urlIndex < 0 ? null : process.argv[urlIndex + 1];
if (urlIndex >= 0 && !baseUrl) throw new Error("--url requires a local server URL");
if (!baseUrl && !process.env.OPENAI_API_KEY) process.loadEnvFile(new URL(".env.local", root));
const results = [];
let consecutiveErrors = 0;
for (const scenario of fixture.cases) {
  const messages = [];
  const turns = [];
  for (const [i, expected] of scenario.turns.entries()) {
    messages.push({ id: `u${i + 1}`, role: "user", content: expected.text });
    const start = Date.now();
    try {
      let result;
      if (baseUrl) {
        const response = await fetch(new URL("/api/needs", baseUrl), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages }), signal: AbortSignal.timeout(55000) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        result = parseNeedTurn({ assistant_message: data.assistant_message, next_question: data.next_question, need: data.need }, messages);
      } else result = await inferNeed(messages, process.env.OPENAI_API_KEY ?? "");
      const failures = [];
      if (result.need.ready_to_recommend !== expected.ready) failures.push(`ready expected ${expected.ready}`);
      for (const [field, labels] of Object.entries(expected.includes ?? {})) for (const label of labels) if (!result.need.preferences[field].includes(label)) failures.push(`missing ${field}.${label}`);
      for (const [field, labels] of Object.entries(expected.absent ?? {})) for (const label of labels) if (result.need.preferences[field].includes(label)) failures.push(`unexpected ${field}.${label}`);
      if (expected.no_avoid && (result.need.preferences.avoid_formats.length || result.need.preferences.avoid_help_types.length)) failures.push("Preference incorrectly became exclusion");
      turns.push({ input: expected.text, elapsed_ms: Date.now() - start, passed: failures.length === 0, failures, result });
      consecutiveErrors = 0;
      messages.push({ id: `a${i + 1}`, role: "assistant", content: [result.assistant_message, result.next_question].filter(Boolean).join("\n\n") });
      console.log(`${scenario.id} turn ${i + 1}: ${failures.length ? failures.join("; ") : "PASS"}`);
    } catch (error) {
      consecutiveErrors++;
      turns.push({ input: expected.text, passed: false, error: error.message, elapsed_ms: Date.now() - start });
      console.log(`${scenario.id} turn ${i + 1}: ERROR ${error.message}`);
      break;
    }
  }
  results.push({ id: scenario.id, turns });
  await mkdir(new URL("outputs/", root), { recursive: true });
  await writeFile(new URL("outputs/needs-evaluation.json", root), JSON.stringify({ model: NEEDS_MODEL, taxonomy: taxonomy.version, note: fixture.note, transport: baseUrl ? "local_http" : "direct_service", results }, null, 2));
  if (consecutiveErrors >= 2) { console.log("Stopping after two service errors; remaining scenarios were not run."); break; }
}
const turns = results.flatMap(r => r.turns);
const expectedCount = fixture.cases.reduce((n, c) => n + c.turns.length, 0);
const lines = ["# 需求对话：真实模型验收", "", fixture.note, "", `模型：${NEEDS_MODEL}；标签版本：${taxonomy.version}；计划 ${expectedCount} 轮，实际尝试 ${turns.length} 轮，有效模型结果 ${turns.filter(t => t.result).length} 轮，通过 ${turns.filter(t => t.passed).length} 轮。服务或网络错误不代表语义判断失败。`, "", "| 场景 | 轮次 | 检查 | 用时 |", "| --- | ---: | --- | ---: |"];
for (const r of results) for (const [i, t] of r.turns.entries()) lines.push(`| ${r.id} | ${i + 1} | ${t.passed ? "通过" : (t.error || t.failures.join("；"))} | ${(t.elapsed_ms / 1000).toFixed(1)} 秒 |`);
lines.push("", "完整合成对话与模型结果保存在本地 outputs/needs-evaluation.json（不进入 Git）。原话引用与标签枚举经结构校验；这不证明模型对所有真实用户的理解都正确。", "");
await writeFile(new URL("data/needs-evaluation.md", root), lines.join("\n"));
if (turns.some(t => !t.passed) || turns.length !== expectedCount) process.exitCode = 1;
