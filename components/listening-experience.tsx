"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ListeningPlaylist, PlaylistResponse } from "../lib/playlist";
import { vocabulary } from "../lib/needs";
import NeedsConversation from "./needs-conversation";
import { formatTime, PlaylistPlayer } from "../lib/player";

function VinylArtwork({ label = "声签", caption = "A MIX FOR YOUR MIND", footer = "调到你的频率" }: { label?: string; caption?: string; footer?: string }) {
  return <div className="vinyl-artwork" aria-hidden="true">
    <span className="vinyl-caption">{caption}</span>
    <div className="vinyl-record"><div className="vinyl-label"><span>{label}</span><small>VOL. 01</small><i /></div></div>
    <div className="vinyl-footer"><span>{footer}</span><span>◦ ◦ ◦</span></div>
  </div>;
}

export default function ListeningExperience() {
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [view, setView] = useState<"home" | "result">("home");
  const [selection, setSelection] = useState<ListeningPlaylist | null>(null);
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const previewPending = useRef(false);
  const [previewMessage, setPreviewMessage] = useState("");

  async function preview(query: string) {
    if (previewPending.current) return;
    previewPending.current = true;
    setPreviewMessage("正在准备试听…");
    try {
      const response = await fetch("/api/demo", { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error("示例拼盘暂时不可用，请稍后重试。");
      const playlist: ListeningPlaylist = await response.json();
      setSelection(playlist);
      setNotice("");
      setRevision(value => value + 1);
      setSubmittedQuery(query);
      setView("result");
      setPreviewMessage("");
      window.scrollTo({ top: 0, behavior: "instant" });
    } catch { setPreviewMessage("示例拼盘暂时不可用，请稍后重试。"); }
    finally { previewPending.current = false; }
  }

  function acceptPlaylist(result: PlaylistResponse, summary: string) {
    if (!result.playlist) return;
    setSelection(result.playlist);
    const missing = (["topics", "help_types", "formats"] as const).flatMap(field => (result.unmet_preferences?.[field] ?? []).map(label => vocabulary(field)[label]));
    setNotice(result.message + (missing.length ? ` 尚未覆盖：${missing.join("；")}。` : ""));
    setSubmittedQuery(summary);
    setRevision(value => value + 1);
    setView("result");
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function goHome() { setView("home"); window.scrollTo({ top: 0, behavior: "instant" }); }

  return (
    <main className={view === "result" ? "results-page" : ""}>
      <nav className="nav">
        <button className="brand" onClick={goHome} aria-label="声签首页"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span><span>声签</span><span className="brand-caption">PERSONAL RADIO</span></button>
        <div className="nav-links"><span className="nav-note">15 期真实素材</span>{selection && <button className="text-button" onClick={() => setView(view === "home" ? "result" : "home")}>{view === "home" ? "我的拼盘 ↗" : "调到此刻 ↗"}</button>}</div>
      </nav>

      <section className="hero" hidden={view !== "home"}>
        <div className="hero-art"><VinylArtwork /></div>
        <div className="hero-conversation">
          <div className="eyebrow">调到你的频率</div>
          <h1>世界很吵。<br />听点与你有关的。</h1>
          <p className="lede">告诉我此刻的困惑，<br />把几段值得听的声音，交给接下来的二十分钟。</p>
          <NeedsConversation onPreview={preview} onPlaylist={acceptPlaylist} />
          {previewMessage && <p role="status">{previewMessage}</p>}
          {submittedQuery && <button className="secondary resume-result" onClick={() => setView("result")}>返回上一份拼盘</button>}
        </div>
      </section>
      {selection && <div hidden={view !== "result"}><ListeningResult key={revision} activeView={view === "result"} playlist={selection} notice={notice} submittedQuery={submittedQuery} goHome={goHome} /></div>}
      <footer className="site-footer"><span>你的私人播客拼盘</span><span>3–5 段声音 · 10–30 分钟 · 随时听完整集</span></footer>
    </main>
  );
}

function ListeningResult({ playlist, notice, submittedQuery, goHome, activeView }: { activeView: boolean; playlist: ListeningPlaylist; notice: string; submittedQuery: string; goHome: () => void }) {
  const items = playlist.items;
  const [player] = useState(() => new PlaylistPlayer(items));
  const state = useSyncExternalStore(player.subscribe, player.getSnapshot, player.getServerSnapshot);
  const heading = useRef<HTMLHeadingElement>(null);
  const playerPanel = useRef<HTMLElement>(null);
  const active = items[state.index];
  const isPlaying = state.phase === "playing" || state.phase === "loading";
  const inEpisode = state.mode === "episode";
  const completed = !inEpisode && state.phase === "ended";
  const playlistTime = items.slice(0, state.index).reduce((total, item) => total + item.duration, 0) + state.time;

  useEffect(() => () => player.dispose(), [player]);
  useEffect(() => {
    if (activeView) heading.current?.focus();
    else player.pause();
  }, [activeView, player]);

  function openEpisode(index: number, fromClip = true) {
    player.openEpisode(index, fromClip);
    playerPanel.current?.scrollIntoView({ block: "start" });
  }
  return (
        <div className="listening-room">
          <div className="result-art"><VinylArtwork label="此刻的声音" caption="YOUR LISTENING MIX" footer={`${items.length} TRACKS / ${formatTime(playlist.totalDuration)}`} /></div>
          <section className="result-heading">
            <button className="back" onClick={goHome}>← 返回需求对话</button>
            <div className="result-kicker">{playlist.kind === "matched" ? "按需求生成的拼盘" : "固定示例拼盘"} · {items.length} 段 · {formatTime(playlist.totalDuration)}</div>
            <h1 ref={heading} tabIndex={-1}>为此刻的你。</h1>
            <p className="result-query">你说：“{submittedQuery}”</p>
            <h2>{playlist.title}</h2>
            <p className="curator-note">{playlist.kind === "matched" ? `来自 ${new Set(items.map(i => i.show)).size} 档节目、${new Set(items.map(i => i.episodeId)).size} 期单集的真实章节。${notice} 按顺序收听，或从喜欢的片段继续听完整单集。` : "这是一份预先选定的真实原声示例，尚未根据你的输入匹配。"}</p>
            <div className="summary-actions">
              <button className="primary" onClick={() => player.restart()}>{completed ? "重新听一遍" : "从第一段播放"}</button>
              <span>全部为原播客音频 · 片段间自动连播</span>
            </div>
          </section>

            <section ref={playerPanel} className="listening-player" aria-label={inEpisode ? "完整单集播放器" : "拼盘播放器"}>
              <div className="player-mode"><b>{inEpisode ? "正在收听完整单集" : `拼盘 · 第 ${state.index + 1} / ${items.length} 段`}</b>{inEpisode && <button className="secondary" onClick={() => player.returnToPlaylist()}>返回拼盘</button>}</div>
              <h2>{inEpisode ? active.episode : active.title}</h2>
              <p>{active.show}{inEpisode ? " · 完整单集" : ` · 原单集 ${formatTime(active.start)}–${formatTime(active.end)}`}</p>
              <div className="player-status" role="status" aria-live="polite">
                {state.phase === "loading" ? "正在加载音频…" : completed ? "这份拼盘听完了。可以重听，也可以选一集继续探索。" : state.phase === "ended" ? "完整单集已播放结束。" : state.phase === "playing" ? "正在播放" : "点击播放，继续收听"}
              </div>
              <label className="sr-only" htmlFor="audio-seek">{inEpisode ? "完整单集进度" : "当前片段进度"}</label>
              <input id="audio-seek" className="audio-seek" type="range" min={0} max={state.duration} step={0.1} value={state.time} onChange={(event) => player.seek(Number(event.target.value))} aria-valuetext={`${formatTime(state.time)}，共 ${formatTime(state.duration)}`} />
              <div className="time-labels"><span>{formatTime(state.time)}</span><span>{formatTime(state.duration)}</span></div>
              <div className="transport">
                <button className="secondary" onClick={() => player.previous()} disabled={inEpisode || state.index === 0} aria-label="上一片段">上一段</button>
                <button className="secondary" onClick={() => player.skip(-15)} aria-label="后退15秒">−15 秒</button>
                <button className="primary play-toggle" onClick={() => completed ? player.restart() : player.toggle()} aria-label={isPlaying ? "暂停播放" : completed ? "重新播放拼盘" : "播放音频"}>{isPlaying ? "暂停" : completed ? "重播" : "播放"}</button>
                <button className="secondary" onClick={() => player.skip(15)} aria-label="前进15秒">+15 秒</button>
                <button className="secondary" onClick={() => player.next()} disabled={inEpisode || state.index === items.length - 1} aria-label="下一片段">下一段</button>
              </div>
              <div className="player-options">
                <label>播放速度 <select value={state.rate} onChange={(event) => player.setRate(Number(event.target.value))}>{[0.75, 1, 1.25, 1.5, 2].map((rate) => <option key={rate} value={rate}>{rate}×</option>)}</select></label>
                <a href={active.sourceUrl} target="_blank" rel="noreferrer" onClick={() => player.pause()}>节目原页面 ↗</a>
              </div>
              {!inEpisode ? <div className="overall-progress"><label htmlFor="playlist-progress">拼盘位置 {formatTime(playlistTime)} / {formatTime(playlist.totalDuration)}</label><progress id="playlist-progress" max={playlist.totalDuration} value={playlistTime} /></div> : <p className="demo-note">返回拼盘后会保留离开时的位置。全集播放结束后不会自动切换节目。</p>}
              {state.error && <div className="audio-error" role="alert"><p>{state.error}</p><button className="secondary" onClick={() => player.retry()}>重试播放</button></div>}
            </section>

            <section className="playlist" aria-label="拼盘片段列表">
              {items.map((item, index) => {
                const selected = !inEpisode && state.index === index;
                return (
                  <article className={`segment ${selected ? "active" : ""}`} key={item.id} aria-current={selected ? "true" : undefined}>
                    <div className="timeline"><span>{String(index + 1).padStart(2, "0")}</span>{index < items.length - 1 && <i />}</div>
                    <div className="segment-card">
                      <div className="segment-topline"><span>{item.show}</span><span>{formatTime(item.duration)}</span></div>
                      <h2>{item.title}</h2>
                      <div className="clip-actions">
                        <button className={selected ? "primary" : "secondary"} onClick={() => player.select(index)} aria-label={`${selected && isPlaying ? "暂停" : "播放"}第${index + 1}段`}>{selected && isPlaying ? "暂停片段" : selected && state.time > 0 && !completed ? "继续片段" : "播放片段"}</button>
                        <button className="secondary" onClick={() => openEpisode(index)}>从此处听全集</button>
                      </div>
                      <details className="segment-details"><summary>简介、字幕与来源</summary>
                        <p className="segment-summary">{item.summary}</p>
                        <div className="source"><div className="source-copy"><b>{item.episode}</b><small>原单集 {formatTime(item.start)}–{formatTime(item.end)} · 全集 {formatTime(item.episodeDuration)}</small></div></div>
                        <button className="text-button" onClick={() => openEpisode(index, false)}>全集从头听</button>
                      <details className="transcript"><summary>查看片段字幕</summary><p className="demo-note">字幕来自发布方或模型转录，可能含识别错误，尚未逐段核听。点击时间点可以听对应原声。</p><div className="transcript-scroll">{item.cues.map((cue, cueIndex) => <p key={cueIndex}><button className="cue-time" onClick={() => player.select(index, Math.max(0, cue.start - item.start))} aria-label={`播放第${index + 1}段原单集${formatTime(cue.start)}处`}>{formatTime(cue.start)}</button>{cue.text}</p>)}</div></details>
                      </details>
                    </div>
                  </article>
                );
              })}
            </section>
        </div>
  );
}
