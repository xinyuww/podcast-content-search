"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { MAX_USER_TURNS, parseNeedTurn, taxonomy } from "../lib/needs";
import type { ConversationMessage, NeedTurn } from "../lib/needs";
import { parsePlaylistResponse } from "../lib/playlist";
import type { PlaylistResponse } from "../lib/playlist";

const suggestions = [
  { label: "想换个节奏", text: "最近工作有点累，想听听别人怎样找到适合自己的生活节奏。" },
  { label: "听听新鲜事", text: "想了解 AI 正在怎样改变普通人的生活，听些新鲜的观点。" },
  { label: "给自己充个电", text: "最近有点提不起劲，想听一些能带来鼓励的真实经历。" },
];

export default function NeedsConversation({ onPlaylist }: { onPlaylist: (result: PlaylistResponse) => void }) {
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [turn, setTurn] = useState<NeedTurn | null>(null);
  const [pending, setPending] = useState("");
  const [phase, setPhase] = useState<"idle" | "thinking" | "building">("idle");
  const [error, setError] = useState("");
  const [noMatch, setNoMatch] = useState(false);
  const request = useRef<AbortController | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const history = useRef<HTMLDivElement>(null);
  const userTurns = messages.filter(m => m.role === "user").length;
  const busy = phase !== "idle";
  const started = messages.length > 0 || !!pending;
  const limitReached = userTurns >= MAX_USER_TURNS;

  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    const panel = history.current;
    if (panel) panel.scrollTop = panel.scrollHeight;
  }, [messages, pending, phase, error, noMatch]);
  useEffect(() => { if (!busy && started) input.current?.focus(); }, [busy, started]);

  function reset() {
    request.current?.abort(); request.current = null;
    setDraft(""); setMessages([]); setTurn(null); setPending(""); setPhase("idle"); setError(""); setNoMatch(false);
    input.current?.focus();
  }
  function cancel() {
    request.current?.abort(); request.current = null;
    setPending(""); setPhase("idle");
  }
  async function buildPlaylist(result: NeedTurn, controller: AbortController) {
    setPhase("building"); setPending("");
    const response = await fetch("/api/playlists", {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
      body: JSON.stringify({ taxonomy_version: taxonomy.version, need: {
        search_query: result.need.search_query, preferences: result.need.preferences, ready_to_recommend: true,
      } }),
    });
    const data = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "暂时没能生成拼盘，请重试。");
    const playlist = parsePlaylistResponse(data);
    if (request.current !== controller) return;
    if (playlist.playlist) onPlaylist(playlist);
    else setNoMatch(true);
  }
  async function retryPlaylist() {
    if (request.current || !turn?.need.ready_to_recommend) return;
    const controller = new AbortController(); request.current = controller;
    setError(""); setNoMatch(false);
    try { await buildPlaylist(turn, controller); }
    catch (error) { if (request.current === controller) setError(error instanceof Error ? error.message : "生成失败，请重试。"); }
    finally { if (request.current === controller) { request.current = null; setPhase("idle"); } }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (request.current || limitReached) return;
    const content = draft.trim();
    if (!content) return;
    const next: ConversationMessage[] = [...messages, { id: `u${userTurns + 1}`, role: "user", content }];
    const controller = new AbortController(); request.current = controller;
    setPending(content); setPhase("thinking"); setError(""); setNoMatch(false);
    try {
      const response = await fetch("/api/needs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: next }), signal: controller.signal });
      const data = await response.json() as Record<string, unknown>;
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "暂时没有收到回复，请重试。");
      if (data.taxonomy_version !== taxonomy.version) throw new Error("请刷新页面后重试。");
      const result = parseNeedTurn({ assistant_message: data.assistant_message, next_question: data.next_question, need: data.need }, next);
      if (request.current !== controller) return;
      // Keep structured understanding internal; only the follow-up belongs in the chat.
      setMessages([...next, { id: `a${userTurns + 1}`, role: "assistant", content: result.next_question || "正在为你挑选声音…" }]);
      setTurn(result); setDraft(""); setPending("");
      if (result.need.ready_to_recommend) await buildPlaylist(result, controller);
    } catch (error) {
      if (request.current === controller) setError(error instanceof Error ? error.message : "连接失败，请重试。");
    } finally {
      if (request.current === controller) { request.current = null; setPending(""); setPhase("idle"); }
    }
  }

  return <div className="needs-conversation">
    <div className={`chat-box ${started ? "has-messages" : ""}`}>
      {/* The bounded history must be keyboard-scrollable. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      {started && <div ref={history} className="conversation-history" role="log" aria-label="需求对话" aria-live="polite" tabIndex={0}>
        {messages.map(m => m.role === "assistant" && m.content === "正在为你挑选声音…" ? null : <div className={`conversation-message ${m.role}`} key={m.id}><span className="sr-only">{m.role === "user" ? "你" : "声签"}：</span><p>{m.content}</p></div>)}
        {pending && <div className="conversation-message user"><p>{pending}</p></div>}
        {busy && <p className="chat-status" role="status">{phase === "building" ? "正在为你挑选声音…" : "正在听…"}</p>}
        {noMatch && <p className="chat-status">暂时没有找到合适的声音，换个话题试试？</p>}
      </div>}
      <form className="search-box" onSubmit={submit} noValidate aria-busy={busy}>
        <label className="sr-only" htmlFor="podcast-query">{started ? "回复声签" : "告诉我此刻的困惑，一个问题，一点心情，都可以。"}</label>
        <textarea ref={input} id="podcast-query" value={busy ? "" : draft} onChange={e => { setDraft(e.target.value); setError(""); }} disabled={busy || limitReached} rows={started ? 2 : 4} maxLength={1000} placeholder={started ? "说说你的想法…" : "告诉我此刻的困惑，一个问题，一点心情，都可以。"} aria-invalid={!!error} aria-describedby={error ? "needs-error" : undefined} />
        {error && <p className="form-error" role="alert" id="needs-error">{error}</p>}
        {limitReached && <p className="chat-status">这次先聊到这里，重新开始聊聊吧。</p>}
        <div className="search-footer">
          {started && <button type="button" className="text-button" onClick={reset}>重新开始</button>}
          {busy ? <button type="button" className="secondary" onClick={cancel}>取消</button> : turn?.need.ready_to_recommend && !draft.trim() ? <button type="button" onClick={retryPlaylist}>重新生成 <b aria-hidden="true">↗</b></button> : <button type="submit" disabled={!draft.trim() || limitReached}>{started ? "发送" : "找到我的声音"} <b aria-hidden="true">↗</b></button>}
        </div>
      </form>
    </div>
    {!started && <div className="suggestions" aria-label="试试这些输入">{suggestions.map(({ label, text }) => <button key={label} onClick={() => { setDraft(text); setError(""); input.current?.focus(); }}>{label} <span aria-hidden="true">↗</span></button>)}</div>}
  </div>;
}
