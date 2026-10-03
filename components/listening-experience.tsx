"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ListeningPlaylist, PlaylistResponse } from "../lib/playlist";
import NeedsConversation from "./needs-conversation";
import { formatTime, PlaylistPlayer } from "../lib/player";

function VinylArtwork({ label = "声签", caption = "A MIX FOR YOUR MIND", footer = "调到你的频率", playing = false }: { label?: string; caption?: string; footer?: string; playing?: boolean }) {
  return <div className="vinyl-artwork" aria-hidden="true">
    <span className="vinyl-caption">{caption}</span>
    <div className={`vinyl-record ${playing ? "is-playing" : ""}`}><div className="vinyl-label"><span>{label}</span><small>VOL. 01</small><i /></div></div>
    <div className="vinyl-footer"><span>{footer}</span><span>◦ ◦ ◦</span></div>
  </div>;
}

export default function ListeningExperience({ initialPlaylist = null }: { initialPlaylist?: ListeningPlaylist | null }) {
  const [selection, setSelection] = useState<ListeningPlaylist | null>(initialPlaylist);
  const [notice, setNotice] = useState("");
  function acceptPlaylist(result: PlaylistResponse) {
    if (!result.playlist) return;
    setSelection(result.playlist);
    setNotice(result.status === "partial_match" ? "先听听这些，部分偏好暂时没有合适的声音。" : "");
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function goHome() {
    if (initialPlaylist) { window.location.assign("/"); return; }
    setSelection(null); setNotice("");
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  return <main className={selection ? "results-page" : ""}>
    <nav className="nav">
      <button className="brand" onClick={goHome} aria-label="声签首页"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span><span>声签</span><span className="brand-caption">你的私人播客拼盘 ｜ YOUR PERSONAL RADIO</span></button>
      <div className="nav-links">{selection ? <button className="text-button" onClick={goHome}>聊点别的 ↗</button> : <a className="text-button" href="/demo">Demo ↗</a>}</div>
    </nav>
    {selection ? <ListeningResult playlist={selection} notice={notice} /> : <section className="hero">
      <div className="hero-art"><VinylArtwork /></div>
      <div className="hero-conversation">
        <div className="eyebrow">调到你的频率</div>
        <h1>世界很吵，<br />听点与你有关的。</h1>
        <NeedsConversation onPlaylist={acceptPlaylist} />
      </div>
    </section>}
    <footer className="site-footer"><span>你的私人播客拼盘</span></footer>
  </main>;
}

function ListeningResult({ playlist, notice }: { playlist: ListeningPlaylist; notice: string }) {
  const items = playlist.items;
  const [player] = useState(() => new PlaylistPlayer(items));
  const state = useSyncExternalStore(player.subscribe, player.getSnapshot, player.getServerSnapshot);
  const heading = useRef<HTMLElement>(null);
  const playerPanel = useRef<HTMLElement>(null);
  const active = items[state.index];
  const isPlaying = state.phase === "playing" || state.phase === "loading";
  const inEpisode = state.mode === "episode";
  const completed = !inEpisode && state.phase === "ended";
  const playlistTime = items.slice(0, state.index).reduce((total, item) => total + item.duration, 0) + state.time;

  useEffect(() => () => player.dispose(), [player]);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);

  function openEpisode(index: number, fromClip = true) {
    player.openEpisode(index, fromClip);
    playerPanel.current?.scrollIntoView({ block: "start" });
  }
  return (
        <div className="listening-room">
          <div className="listening-deck">
            <div className="result-art"><VinylArtwork label="此刻的声音" caption="YOUR LISTENING MIX" footer={`${items.length} TRACKS / ${formatTime(playlist.totalDuration)}`} playing={state.phase === "playing"} /></div>
            <section ref={playerPanel} className="listening-player" aria-label={inEpisode ? "完整单集播放器" : "拼盘播放器"}>
              <div className="player-mode"><b>{inEpisode ? "正在收听完整单集" : `拼盘 · 第 ${state.index + 1} / ${items.length} 段`}</b>{inEpisode && <button className="secondary" onClick={() => player.returnToPlaylist()}>返回拼盘</button>}</div>
              <h2>{inEpisode ? active.episode : active.title}</h2>
              <p>{active.show}{inEpisode ? " · 完整单集" : ` · 原单集 ${formatTime(active.start)}–${formatTime(active.end)}`}</p>
              <div className="player-status" hidden={state.phase !== "loading" && state.phase !== "ended"} role="status" aria-live="polite">
                {state.phase === "loading" ? "正在加载…" : state.phase === "ended" ? "已播放完毕" : ""}
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
              {!inEpisode ? <div className="overall-progress"><label htmlFor="playlist-progress">拼盘位置 {formatTime(playlistTime)} / {formatTime(playlist.totalDuration)}</label><progress id="playlist-progress" max={playlist.totalDuration} value={playlistTime} /></div> : null}
              {state.error && <div className="audio-error" role="alert"><p>{state.error}</p><button className="secondary" onClick={() => player.retry()}>重试播放</button></div>}
            </section>

          </div>
            <section ref={heading} tabIndex={-1} className="playlist" aria-label="拼盘片段列表">
              <div className="playlist-heading"><h1>{playlist.kind === "matched" ? "你的拼盘" : "Demo 拼盘"}</h1><span>{items.length} 段 · {formatTime(playlist.totalDuration)}</span></div>
              {notice && <p className="demo-note">{notice}</p>}
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
