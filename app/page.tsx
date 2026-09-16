"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { formatTime, segments, totalDuration } from "./mock-data";

const suggestions = [
  "最近工作很迷茫，想听一些关于职业选择的讨论",
  "总是很焦虑，怎么重新找回生活的节奏？",
  "创业早期，应该先找用户还是先打磨产品？",
];

type View = "home" | "loading" | "result";

export default function Home() {
  const [query, setQuery] = useState(suggestions[0]);
  const [submittedQuery, setSubmittedQuery] = useState(suggestions[0]);
  const [view, setView] = useState<View>("home");
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
  }, []);

  function search(event?: FormEvent) {
    event?.preventDefault();
    if (!query.trim()) return;
    setSubmittedQuery(query.trim());
    setView("loading");
    window.setTimeout(() => setView("result"), 900);
  }

  function play(id: string) {
    if (timerRef.current) clearInterval(timerRef.current);
    window.speechSynthesis?.cancel();
    if (playingId === id) {
      setPlayingId(null);
      return;
    }
    const item = segments.find((segment) => segment.id === id);
    if (!item) return;
    setPlayingId(id);
    const utterance = new SpeechSynthesisUtterance(item.excerpt);
    utterance.lang = "zh-CN";
    utterance.rate = 0.92;
    utterance.onend = () => setPlayingId(null);
    window.speechSynthesis?.speak(utterance);
    timerRef.current = setInterval(() => {
      setProgress((current) => {
        const next = Math.min((current[id] || 0) + 1, item.duration);
        if (next === item.duration && timerRef.current) clearInterval(timerRef.current);
        return { ...current, [id]: next };
      });
    }, 1000);
  }

  if (view === "result") {
    const playing = segments.find((item) => item.id === playingId);
    return (
      <main className="results-page">
        <Header compact onHome={() => { setView("home"); setPlayingId(null); window.speechSynthesis?.cancel(); }} />
        <section className="result-heading">
          <button className="back" onClick={() => setView("home")}>← 换一个问题</button>
          <div className="result-kicker">为你找到 · {segments.length} 个片段 · {formatTime(totalDuration)}</div>
          <h1>关于「职业选择」的<br /><em>一次声音漫游</em></h1>
          <p className="result-query">“{submittedQuery}”</p>
          <p className="curator-note">我们从“看清迷茫”开始，经过真实的转型故事，最后落到一个可以今天开始的小练习。不同节目，不同视角，组合成一条连贯的思考路径。</p>
          <div className="summary-actions">
            <button className="primary" onClick={() => play(segments[0].id)}>▶ 从头播放</button>
            <span>AI 策展 · 内容为产品演示样本</span>
          </div>
        </section>

        <section className="playlist-layout">
          <div className="playlist">
            {segments.map((item, index) => {
              const current = progress[item.id] || 0;
              const percent = Math.min((current / item.duration) * 100, 100);
              const active = playingId === item.id;
              return (
                <article className={`segment ${active ? "active" : ""}`} key={item.id}>
                  <div className="timeline">
                    <span style={{ background: item.accent }}>{item.order.toString().padStart(2, "0")}</span>
                    {index < segments.length - 1 && <i />}
                  </div>
                  <div className="segment-card">
                    <div className="segment-topline"><span>{item.role}</span><span>{formatTime(item.duration)}</span></div>
                    <h2>{item.title}</h2>
                    <blockquote>“{item.excerpt}”</blockquote>
                    <p className="why"><b>为什么选它</b>{item.reason}</p>
                    <div className="source">
                      <div className="cover" style={{ background: item.accent }}><span>{item.show.slice(0, 2)}</span></div>
                      <div className="source-copy"><b>{item.show}</b><span>{item.episode}</span><small>{item.speaker} · {item.sourceTime}</small></div>
                      <button className="full-episode" onClick={() => window.alert("演示版：正式接入 RSS 后将在这里打开完整单集。")}>完整单集 ↗</button>
                    </div>
                    <div className="mini-player">
                      <button onClick={() => play(item.id)} aria-label={active ? "暂停" : "播放"}>{active ? "Ⅱ" : "▶"}</button>
                      <span>{formatTime(current)}</span>
                      <div className="track"><i style={{ width: `${percent}%` }} /></div>
                      <span>-{formatTime(Math.max(item.duration - current, 0))}</span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          <aside className="result-aside">
            <p>这份拼盘里</p>
            <dl><div><dt>5</dt><dd>个内容片段</dd></div><div><dt>5</dt><dd>档不同节目</dd></div><div><dt>{formatTime(totalDuration)}</dt><dd>总收听时长</dd></div></dl>
            <div className="aside-rule" />
            <p>内容路径</p>
            <ol>{segments.map((item) => <li key={item.id}><span style={{ background:item.accent }} />{item.role}</li>)}</ol>
          </aside>
        </section>

        {playing && (
          <div className="dock">
            <button onClick={() => play(playing.id)}>Ⅱ</button>
            <div className="dock-cover" style={{ background:playing.accent }}>{playing.show.slice(0, 2)}</div>
            <div><b>{playing.title}</b><span>{playing.show} · {playing.speaker}</span></div>
            <div className="dock-wave" aria-hidden="true">▂▅▃▆▄▇▂▅▃▆▄▇▃▅▂▆</div>
            <small>{formatTime(progress[playing.id] || 0)} / {formatTime(playing.duration)}</small>
          </div>
        )}
      </main>
    );
  }

  return (
    <main>
      <Header />
      <section className="hero" id="top">
        <div className="eyebrow"><span /> BETA · 播客内容搜索</div>
        <h1>你现在，<br /><em>想听点什么？</em></h1>
        <p className="lede">不必知道节目名，也不必翻遍单集列表。告诉我们你正在思考的事，我们从不同播客中找到值得听的片段。</p>
        <form className="search-box" onSubmit={search}>
          <label htmlFor="podcast-query">描述一个问题、话题，或此刻的心情</label>
          <textarea id="podcast-query" value={query} onChange={(event) => setQuery(event.target.value)} rows={3} />
          <div className="search-footer"><span>预计生成 15–25 分钟内容拼盘</span><button type="submit">开始寻找 <b>↗</b></button></div>
        </form>
        <div className="suggestions" aria-label="试试这些问题"><span>试试看</span>{suggestions.slice(1).map((item) => <button key={item} onClick={() => setQuery(item)}>{item}</button>)}</div>
        {view === "loading" && <div className="loading-card" role="status"><span className="pulse" /><div><b>正在穿过节目，寻找值得听的片段</b><small>已从 286 期节目中找到 24 个候选片段，正在组成收听路径…</small></div></div>}
      </section>
      <section className="how">
        <p className="section-label">不是搜节目，是搜内容</p>
        <div className="steps"><article><span>01</span><h2>说出你想听的</h2><p>一个具体问题，一种情绪，或最近反复思考的事。</p></article><article><span>02</span><h2>穿过整集，找到片段</h2><p>在转录内容中匹配真正相关的观点与故事。</p></article><article><span>03</span><h2>收获一份声音拼盘</h2><p>多个节目、不同视角，组合成一次连贯的收听。</p></article></div>
      </section>
    </main>
  );
}

function Header({ compact = false, onHome }: { compact?: boolean; onHome?: () => void }) {
  return <nav className={`nav ${compact ? "compact" : ""}`}><button className="brand" onClick={onHome} aria-label="声签首页"><span className="brand-mark">声</span><span>声签</span></button><span className="nav-note">从好内容里，找到此刻需要的声音</span><span className="library-count">286 期节目 · 4,832 个片段</span></nav>;
}
