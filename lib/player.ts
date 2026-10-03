export type PlaylistItem = {
  id: string;
  duration: number;
  episodeDuration: number;
  audioUrl: string;
  episodeAudioUrl: string;
  start: number;
  /** Offset within audioUrl: 0 for pre-cut files, original chapter start for full-source playback. */
  audioOffset?: number;
};

export type PlayerState = {
  index: number;
  mode: "playlist" | "episode";
  phase: "idle" | "loading" | "playing" | "paused" | "ended" | "error";
  time: number;
  duration: number;
  rate: number;
  error: string | null;
};

const clamp = (value: number, max: number) => Math.max(0, Math.min(value, max));

/** One active audio source, with a saved playlist position while hearing an episode. */
export class PlaylistPlayer {
  private audio: HTMLAudioElement | null = null;
  private listeners = new Set<() => void>();
  private bookmark: { index: number; time: number } | null = null;
  private wantsPlay = false;
  private state: PlayerState;
  private readonly initial: PlayerState;
  private readonly items: PlaylistItem[];
  private readonly createAudio: () => HTMLAudioElement;
  private boundaryTimer: ReturnType<typeof setTimeout> | null = null;
  private loadingTimer: ReturnType<typeof setTimeout> | null = null;
  private loadingDeadline: ReturnType<typeof setTimeout> | null = null;

  constructor(items: PlaylistItem[], createAudio = () => new Audio()) {
    if (!items.length) throw new Error("A playlist must contain audio.");
    this.items = items;
    this.createAudio = createAudio;
    this.initial = {
      index: 0, mode: "playlist", phase: "idle", time: 0,
      duration: items[0].duration, rate: 1, error: null,
    };
    this.state = this.initial;
  }

  getSnapshot = () => this.state;
  getServerSnapshot = () => this.initial;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private clearLoadingTimers() {
    if (this.loadingTimer) clearTimeout(this.loadingTimer);
    if (this.loadingDeadline) clearTimeout(this.loadingDeadline);
    this.loadingTimer = null;
    this.loadingDeadline = null;
  }

  private watchLoading(progress = false) {
    if (this.state.phase !== "loading") { this.clearLoadingTimers(); return; }
    if (progress && this.loadingTimer) {
      clearTimeout(this.loadingTimer);
      this.loadingTimer = null;
    }
    if (!this.loadingTimer) {
      this.loadingTimer = setTimeout(() => {
        this.loadingTimer = null;
        if (this.state.phase === "loading") this.fail("音频加载超时，请检查网络后重试播放。");
      }, 20000);
    }
    // Progress may extend the stall timeout, but never allow an endless download.
    if (!this.loadingDeadline) this.loadingDeadline = setTimeout(() => {
      this.loadingDeadline = null;
      if (this.state.phase === "loading") this.fail("音频加载耗时过长，请切换网络后重试播放。");
    }, 120000);
  }

  private update(change: Partial<PlayerState>) {
    this.state = { ...this.state, ...change };
    this.watchLoading();
    this.listeners.forEach((listener) => listener());
  }

  private release() {
    this.clearLoadingTimers();
    if (this.boundaryTimer) clearTimeout(this.boundaryTimer);
    this.boundaryTimer = null;
    const previous = this.audio;
    this.audio = null; // Invalidate events and play promises from the previous source first.
    if (previous) {
      previous.pause();
      previous.removeAttribute("src");
      previous.load();
    }
  }

  private load(index: number, mode: PlayerState["mode"], offset = 0, autoplay = true) {
    this.release();
    const item = this.items[index];
    const duration = mode === "playlist" ? item.duration : item.episodeDuration;
    const sourceOffset = mode === "playlist" ? (item.audioOffset ?? 0) : 0;
    this.wantsPlay = autoplay;
    this.update({ index, mode, time: clamp(offset, duration), duration, phase: autoplay ? "loading" : "paused", error: null });
    const audio = this.createAudio();
    this.audio = audio;
    audio.preload = "metadata";
    audio.playbackRate = this.state.rate;
    const current = () => this.audio === audio;
    let finished = false;
    const finish = () => {
      if (!current() || finished) return;
      finished = true;
      if (this.boundaryTimer) clearTimeout(this.boundaryTimer);
      this.boundaryTimer = null;
      audio.pause();
      if (mode === "playlist" && index < this.items.length - 1) {
        this.load(index + 1, "playlist");
      } else {
        this.wantsPlay = false;
        this.update({ phase: "ended", time: duration });
      }
    };
    const checkBoundary = () => {
      if (!current()) return;
      if (this.boundaryTimer) clearTimeout(this.boundaryTimer);
      this.boundaryTimer = null;
      if (!current() || finished || audio.readyState < 1 || !this.wantsPlay || audio.paused) return;
      if (mode === "playlist" && item.audioOffset !== undefined) {
        const remaining = sourceOffset + duration - audio.currentTime;
        if (remaining <= 0.025) { finish(); return; }
        this.boundaryTimer = setTimeout(checkBoundary, Math.max(15, Math.min(250, remaining * 1000 / this.state.rate)));
      }
    };
    audio.addEventListener("loadedmetadata", () => {
      if (!current()) return;
      this.watchLoading(true);
      audio.currentTime = sourceOffset + clamp(this.state.time, Math.min(duration, Math.max(0, (audio.duration || sourceOffset + duration) - sourceOffset)));
      checkBoundary();
    });
    audio.addEventListener("timeupdate", () => {
      if (current() && audio.readyState >= 1) {
        this.update({ time: clamp(audio.currentTime - sourceOffset, duration) });
        checkBoundary();
      }
    });
    audio.addEventListener("playing", () => {
      if (!current()) return;
      if (!this.wantsPlay) { audio.pause(); return; }
      this.update({ phase: "playing", error: null }); checkBoundary();
    });
    audio.addEventListener("progress", () => {
      if (current() && this.wantsPlay) this.watchLoading(true);
    });
    audio.addEventListener("pause", () => {
      if (current() && !audio.ended && this.state.phase !== "error") this.update({ phase: "paused" });
    });
    audio.addEventListener("waiting", () => {
      if (current() && this.wantsPlay) this.update({ phase: "loading" });
    });
    audio.addEventListener("error", () => {
      if (current()) this.fail("音频暂时无法加载。请重试，或打开节目原页面收听。");
    });
    audio.addEventListener("ended", finish);
    audio.addEventListener("seeked", () => { finished = false; checkBoundary(); });
    audio.src = mode === "playlist" ? item.audioUrl : item.episodeAudioUrl;
    audio.load();
    if (autoplay) void this.play();
  }

  private fail(message: string) {
    this.wantsPlay = false;
    this.audio?.pause();
    this.update({ phase: "error", error: message });
  }

  async play() {
    if (!this.audio) {
      this.load(this.state.index, this.state.mode, this.state.time);
      return;
    }
    if (this.state.phase === "error") { this.retry(); return; }
    if (this.state.phase === "ended") {
      this.load(this.state.index, this.state.mode);
      return;
    }
    const audio = this.audio;
    this.wantsPlay = true;
    this.update({ phase: "loading", error: null });
    try {
      await audio.play();
    } catch (error) {
      if (this.audio !== audio || !this.wantsPlay) return;
      const blocked = error instanceof Error && error.name === "NotAllowedError";
      this.fail(blocked ? "浏览器暂停了自动播放，请点击播放继续。" : "播放未能开始，请重试或打开节目原页面。");
    }
  }

  pause() {
    this.wantsPlay = false;
    this.audio?.pause();
    if (this.state.phase !== "ended" && this.state.phase !== "error") this.update({ phase: "paused" });
  }

  toggle() {
    if (this.state.phase === "playing" || this.state.phase === "loading") this.pause();
    else void this.play();
  }

  select(index: number, offset?: number) {
    if (!Number.isInteger(index) || index < 0 || index >= this.items.length) return;
    this.bookmark = null;
    if (this.state.mode === "playlist" && index === this.state.index && offset === undefined) {
      this.toggle();
    } else this.load(index, "playlist", offset ?? 0);
  }

  seek(time: number) {
    if (!Number.isFinite(time)) return;
    const position = clamp(time, this.state.duration);
    this.update({ time: position, ...(this.state.phase === "ended" ? { phase: "paused" as const } : {}) });
    const sourceOffset = this.state.mode === "playlist" ? (this.items[this.state.index].audioOffset ?? 0) : 0;
    if (this.audio && this.audio.readyState >= 1) this.audio.currentTime = sourceOffset + position;
  }

  skip(seconds: number) { this.seek(this.state.time + seconds); }
  previous() { if (this.state.mode === "playlist" && this.state.index > 0) this.load(this.state.index - 1, "playlist"); }
  next() { if (this.state.mode === "playlist" && this.state.index < this.items.length - 1) this.load(this.state.index + 1, "playlist"); }
  restart() { this.bookmark = null; this.load(0, "playlist"); }

  openEpisode(index: number, fromClip = true) {
    if (!Number.isInteger(index) || index < 0 || index >= this.items.length) return;
    if (this.state.mode === "playlist") this.bookmark = { index: this.state.index, time: this.state.time };
    this.load(index, "episode", fromClip ? this.items[index].start : 0);
  }

  returnToPlaylist() {
    const saved = this.bookmark ?? { index: this.state.index, time: 0 };
    this.bookmark = null;
    this.load(saved.index, "playlist", saved.time, false);
  }

  setRate(rate: number) {
    if (![0.75, 1, 1.25, 1.5, 2].includes(rate)) return;
    if (this.audio) this.audio.playbackRate = rate;
    this.update({ rate });
  }

  retry() { this.load(this.state.index, this.state.mode, this.state.time); }
  reset() { this.wantsPlay = false; this.bookmark = null; this.release(); this.update(this.initial); }
  dispose() { this.wantsPlay = false; this.release(); }
}

export function formatTime(seconds: number) {
  const rounded = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const rest = String(rounded % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}
