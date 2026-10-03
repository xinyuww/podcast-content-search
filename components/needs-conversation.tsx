"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { fieldNames, MAX_USER_TURNS, parseNeedTurn, preferenceFields, restoreNeed, taxonomy, vocabulary } from "../lib/needs";
import type { ConversationMessage, NeedTurn } from "../lib/needs";
import { parsePlaylistResponse } from "../lib/playlist";
import type { PlaylistResponse } from "../lib/playlist";

const suggestions = [
  { label: "工作与变化", text: "AI 发展太快了，我有点担心自己的工作。" },
  { label: "一个难做的选择", text: "工作遇到瓶颈，不知道要不要换个方向。" },
  { label: "有点迷茫", text: "今天有点迷茫，想边走边听一些讨论。" },
];

export default function NeedsConversation({ onPreview, onPlaylist }: { onPreview: (query: string) => void; onPlaylist: (result: PlaylistResponse, summary: string) => void }) {
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [turn, setTurn] = useState<NeedTurn | null>(null);
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const [building, setBuilding] = useState(false);
  const [retrieval, setRetrieval] = useState<PlaylistResponse | null>(null);
  const [savedNeed, setSavedNeed] = useState("");
  const [restoreError, setRestoreError] = useState("");
  const request = useRef<AbortController | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const latest = useRef<HTMLDivElement>(null);
  const userTurns = messages.filter(m => m.role === "user").length;
  const busy = !!pending || building;
  const limitReached = userTurns >= MAX_USER_TURNS;

  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => { if (turn) latest.current?.focus(); }, [turn]);

  function reset() {
    request.current?.abort();
    request.current = null;
    setDraft(""); setMessages([]); setTurn(null); setPending(""); setBuilding(false); setRetrieval(null); setError("");
    setSavedNeed(""); setRestoreError("");
    input.current?.focus();
  }
  function cancel() {
    request.current?.abort(); request.current = null;
    setPending(""); setBuilding(false); setError("已取消，输入与当前需求已保留。");
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (request.current || limitReached) return;
    const content = draft.trim();
    if (!content) { setError("先写下一个问题、话题或心情吧。"); input.current?.focus(); return; }
    const next: ConversationMessage[] = [...messages, { id: `u${userTurns + 1}`, role: "user", content }];
    const controller = new AbortController();
    request.current = controller;
    setPending(content); setError(""); setRetrieval(null);
    try {
      const response = await fetch("/api/needs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: next }), signal: controller.signal });
      const data = await response.json() as Record<string, unknown>;
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "需求整理暂时不可用，请重试。");
      if (data.taxonomy_version !== taxonomy.version) throw new Error("标签版本已更新，请刷新页面后重试。");
      const result = parseNeedTurn({ assistant_message: data.assistant_message, next_question: data.next_question, need: data.need }, next);
      if (request.current !== controller) return;
      const reply = [result.assistant_message, result.next_question].filter(Boolean).join("\n\n");
      setMessages([...next, { id: `a${userTurns + 1}`, role: "assistant", content: reply }]);
      setTurn(result); setDraft("");
    } catch (e) {
      if (request.current === controller) setError(e instanceof Error ? e.message : "网络连接失败，输入已保留，请重试。");
    } finally {
      if (request.current === controller) { request.current = null; setPending(""); }
    }
  }
  async function buildPlaylist() {
    if (request.current || !turn?.need.ready_to_recommend || draft.trim()) return;
    const controller = new AbortController(); request.current = controller;
    setBuilding(true); setError(""); setRetrieval(null);
    try {
      const response = await fetch("/api/playlists", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ taxonomy_version: taxonomy.version, need: {
          search_query: turn.need.search_query, preferences: turn.need.preferences, ready_to_recommend: true,
        } }),
      });
      const data = await response.json() as Record<string, unknown>;
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "生成拼盘失败，请重试。");
      const result = parsePlaylistResponse(data);
      if (request.current !== controller) return;
      setRetrieval(result);
      if (result.playlist) onPlaylist(result, turn.need.need_summary);
    } catch (error) {
      if (request.current === controller) setError(error instanceof Error ? error.message : "生成失败，需求已保留，请重试。");
    } finally {
      if (request.current === controller) { request.current = null; setBuilding(false); }
    }
  }
  function download() {
    if (!turn || busy || draft.trim()) return;
    const exportData = { schema_version: "listening-need-v1", taxonomy_version: taxonomy.version, need: turn.need, messages };
    const url = URL.createObjectURL(new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "listening-need.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function restore() {
    if (request.current) return;
    try {
      const restored = restoreNeed(JSON.parse(savedNeed));
      setMessages(restored.messages); setTurn(restored.turn); setDraft(""); setRetrieval(null);
      setSavedNeed(""); setRestoreError(""); setError("");
    } catch (error) { setRestoreError(error instanceof Error ? error.message : "无法读取需求 JSON。"); }
  }

  return <div className="needs-conversation">
    <div className="conversation-heading"><span>{messages.length ? "接着说，我在听。" : "从这里开始。"}</span><span className="conversation-index">{messages.length ? "对话中" : "01 / 说说近况"}</span></div>
    {messages.length > 0 && <div className="conversation-history" role="log" aria-label="需求对话" aria-live="polite">
      {messages.map(m => <div className={`conversation-message ${m.role}`} key={m.id}><b>{m.role === "user" ? "你" : "声签"}</b><p>{m.content}</p></div>)}
    </div>}
    {busy && <div className="conversation-message user">{pending && <><b>你</b><p>{pending}</p></>}<p role="status">{building ? "正在检索相关章节，组合 3–5 段、10–30 分钟的拼盘…" : "正在整理你的需求…"}</p><button className="secondary" onClick={cancel}>取消等待</button></div>}
    {turn && <div ref={latest} tabIndex={-1} className="need-summary" aria-label="当前需求">
      <div className="need-summary-heading"><h2>我目前的理解</h2><span>{busy ? "正在更新" : draft.trim() ? "有补充待发送" : turn.need.ready_to_recommend ? "可以开始找声音了" : "还需要确认"}</span></div>
      <p>{turn.need.need_summary}</p>
      {turn.need.situation && <p className="demo-note">你的处境：{turn.need.situation}</p>}
      <dl className="need-preferences">{preferenceFields.map(field => turn.need.preferences[field].length > 0 && <div key={field}><dt>{fieldNames[field]}</dt><dd>{turn.need.preferences[field].map(label => <span key={label}>{vocabulary(field)[label].split("；")[0]}</span>)}</dd></div>)}</dl>
      {!!turn.need.unresolved.length && <div><b>待确认</b><ul>{turn.need.unresolved.map(item => <li key={item}>{item}</li>)}</ul></div>}
      <p className="demo-note">你可以在下方补充或纠正。这份理解不会自动变成最终结论。</p>
      <div className="need-actions"><button className="secondary" disabled={busy || !!draft.trim()} onClick={download}>保存这次需求</button><button className="text-button" onClick={() => input.current?.focus()} disabled={busy || limitReached}>补充或纠正</button></div>
      {turn.need.ready_to_recommend && <div className="need-actions"><button className="primary" disabled={busy || !!draft.trim()} onClick={buildPlaylist}>{building ? "正在生成拼盘…" : "按这个需求生成拼盘"}</button></div>}
      {retrieval && <div role="status"><p>{retrieval.message}</p>{retrieval.unmet_preferences && <ul>{(["topics", "help_types", "formats"] as const).flatMap(f => (retrieval.unmet_preferences?.[f] ?? []).map(label => <li key={`${f}-${label}`}>尚未覆盖：{vocabulary(f)[label]}</li>))}</ul>}</div>}
      <details className="need-details"><summary>查看结构化需求与原话依据</summary><pre>{JSON.stringify(turn.need, null, 2)}</pre></details>
    </div>}
    <form className="search-box" onSubmit={submit} noValidate aria-busy={busy}>
      <label htmlFor="podcast-query">{messages.length ? "回答刚才的问题，或补充、纠正你的需求" : "一个问题，一点心情，都可以。"}</label>
      <textarea ref={input} id="podcast-query" value={draft} onChange={e => { setDraft(e.target.value); setError(""); }} disabled={busy || limitReached} rows={4} maxLength={1000} placeholder={messages.length ? "例如：我现在更想听相似经历，暂时不需要建议。" : "最近有什么事，\n一直留在你心里？"} aria-invalid={!!error} aria-describedby="needs-note needs-error" />
      <p className="form-error" role="alert" id="needs-error">{error}</p>
      <div className="search-footer"><span>{draft.length ? `${draft.length} / 1000 字` : "想到哪里，就说到哪里。"}</span><button type="submit" disabled={busy || limitReached}>{busy ? "正在理解…" : messages.length ? "更新我的需求" : "找到我的声音"} <b aria-hidden="true">↗</b></button></div>
    </form>
    {limitReached && <p role="status">本次对话已达到 {MAX_USER_TURNS} 轮。可以导出当前需求，或重新开始。</p>}
    {!messages.length && <div className="suggestions" aria-label="试试这些输入">{suggestions.map(({ label, text }) => <button disabled={busy} key={label} onClick={() => { setDraft(text); setError(""); input.current?.focus(); }}>{label} <span aria-hidden="true">↗</span></button>)}</div>}
    <p className="demo-note privacy-note" id="needs-note">对话会发送给 OpenAI；本应用仅在当前页面保留，刷新后清空。</p>
    <div className="preview-entry"><div><span className="preview-label">先听，再说。</span><p>还没想好？从一份固定示例开始。</p></div><button className="text-button" disabled={busy} onClick={() => onPreview(turn?.need.need_summary || draft.trim() || "试听固定示例拼盘")}>试听固定示例拼盘 ↗</button></div>
    {(messages.length > 0 || busy) && <div className="need-actions"><button className="secondary" onClick={reset}>重新开始对话</button></div>}
    <details className="need-details"><summary>恢复已保存的需求</summary><label htmlFor="saved-need">粘贴之前导出的需求 JSON</label><textarea id="saved-need" className="saved-need" value={savedNeed} onChange={event => setSavedNeed(event.target.value)} rows={4} maxLength={64000} disabled={busy} /><button className="secondary" disabled={busy || !savedNeed.trim()} onClick={restore}>恢复需求</button>{restoreError && <p role="alert" className="form-error">{restoreError}</p>}</details>
  </div>;
}
