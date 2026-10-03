import { isHostedAudioUrl } from "../lib/audio-source.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PlaylistPlayer } from "../lib/player.ts";
import { loadDemoPlaylist } from "../server/snapshot.ts";

const manifest = JSON.parse(readFileSync(new URL("../data/demo-playlist.json", import.meta.url)));

class FakeAudio extends EventTarget {
  src = "";
  currentTime = 0;
  duration = 8000;
  readyState = 0;
  playbackRate = 1;
  ended = false;
  paused = true;
  failure = null;
  playPromise = null;
  load() {}
  removeAttribute() { this.src = ""; }
  emit(name) { this.dispatchEvent(new Event(name)); }
  metadata() { this.readyState = 1; this.emit("loadedmetadata"); }
  play() {
    if (this.failure) return Promise.reject(this.failure);
    if (this.playPromise) return this.playPromise;
    this.paused = false;
    this.emit("playing");
    return Promise.resolve();
  }
  pause() { this.paused = true; this.emit("pause"); }
  tick(time) { this.currentTime = time; this.emit("timeupdate"); }
  finish() { this.ended = true; this.emit("ended"); }
}

function setup() {
  const audios = [];
  const player = new PlaylistPlayer(manifest.items, () => {
    const audio = new FakeAudio(); audios.push(audio); return audio;
  });
  return { player, audios };
}

test("a stalled audio request becomes a recoverable error instead of loading forever", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { player, audios } = setup();
  player.restart();
  audios[0].emit("waiting");
  t.mock.timers.tick(20000);
  assert.equal(player.getSnapshot().phase, "error");
  assert.match(player.getSnapshot().error, /加载超时/);
  player.retry();
  assert.equal(audios.length, 2);
  audios[1].metadata();
  t.mock.timers.tick(20000);
  assert.equal(player.getSnapshot().phase, "playing");
  player.dispose();
});

test("demo has 3–5 real episodes, 10–30 minutes, with hosted audio and valid timestamps", () => {
  const manifest = loadDemoPlaylist();
  assert.ok(manifest.items.length >= 3 && manifest.items.length <= 5);
  assert.equal(new Set(manifest.items.map((item) => item.episodeId)).size, manifest.items.length);
  const sum = manifest.items.reduce((total, item) => total + item.duration, 0);
  assert.ok(sum >= 600 && sum <= 1800);
  assert.equal(sum, manifest.totalDuration);
  for (const item of manifest.items) {
    assert.ok(item.start >= 0 && item.end <= item.episodeDuration);
    assert.equal(item.duration, item.end - item.start);
    assert.ok(item.cues.length > 0);
    assert.ok(item.cues.every((cue) => cue.start >= item.start && cue.start < item.end));
    for (const url of [item.audioUrl, item.episodeAudioUrl]) {
      assert(isHostedAudioUrl(url));
    }
    assert.equal(item.audioOffset, item.start);
  }
});

test("pause/resume retains the clip position without reloading", async () => {
  const { player, audios } = setup();
  player.select(0); audios[0].metadata(); audios[0].tick(42);
  player.toggle();
  assert.equal(player.getSnapshot().phase, "paused");
  await player.play();
  assert.equal(audios.length, 1);
  assert.equal(audios[0].currentTime, 42);
  assert.equal(player.getSnapshot().phase, "playing");
});

test("clip end automatically advances and the final clip completes without looping", () => {
  const { player, audios } = setup();
  player.restart();
  for (let index = 0; index < manifest.items.length; index++) {
    assert.equal(player.getSnapshot().index, index);
    audios[index].finish();
  }
  assert.equal(audios.length, manifest.items.length);
  assert.equal(player.getSnapshot().phase, "ended");
  assert.equal(player.getSnapshot().time, manifest.items.at(-1).duration);
});

test("switching clips stops the previous audio and ignores stale events", () => {
  const { player, audios } = setup();
  player.select(0); player.select(2);
  assert.ok(audios[0].paused);
  audios[0].finish(); audios[0].emit("error"); audios[0].tick(99);
  assert.equal(player.getSnapshot().index, 2);
  assert.equal(player.getSnapshot().time, 0);
  assert.equal(player.getSnapshot().error, null);
});

test("episode uses original timestamp and return restores the playlist bookmark paused", () => {
  const { player, audios } = setup();
  player.select(1); audios[0].metadata(); audios[0].tick(80);
  player.openEpisode(3); audios[1].metadata();
  assert.equal(audios[1].src, manifest.items[3].episodeAudioUrl);
  assert.equal(audios[1].currentTime, manifest.items[3].start);
  player.openEpisode(0, false); audios[2].metadata();
  assert.equal(audios[2].currentTime, 0);
  player.returnToPlaylist(); audios[3].metadata();
  assert.equal(player.getSnapshot().mode, "playlist");
  assert.equal(player.getSnapshot().index, 1);
  assert.equal(audios[3].currentTime, 80);
  assert.equal(player.getSnapshot().phase, "paused");
});

test("complete episode does not advance the playlist", () => {
  const { player, audios } = setup();
  player.openEpisode(0); audios[0].finish();
  assert.equal(player.getSnapshot().phase, "ended");
  assert.equal(player.getSnapshot().mode, "episode");
  assert.equal(audios.length, 1);
});

test("seek before metadata is preserved and skip is clamped to the clip bounds", () => {
  const { player, audios } = setup();
  player.select(0, 17); player.seek(35); audios[0].metadata();
  assert.equal(audios[0].currentTime, 35);
  player.skip(-100); assert.equal(audios[0].currentTime, 0);
  player.skip(10000); assert.equal(audios[0].currentTime, manifest.items[0].duration);
  player.seek(NaN); assert.ok(Number.isFinite(player.getSnapshot().time));
});

test("playback speed persists across clips and full episodes", () => {
  const { player, audios } = setup();
  player.setRate(1.5); player.restart(); player.next(); player.openEpisode(2);
  assert.ok(audios.every((audio) => audio.playbackRate === 1.5));
  player.setRate(99); assert.equal(player.getSnapshot().rate, 1.5);
});

test("audio failures are recoverable at the same position", () => {
  const { player, audios } = setup();
  player.select(1); audios[0].metadata(); audios[0].tick(60); audios[0].emit("error");
  assert.equal(player.getSnapshot().phase, "error");
  player.retry(); audios[1].metadata();
  assert.equal(player.getSnapshot().index, 1);
  assert.equal(audios[1].currentTime, 60);
  assert.equal(player.getSnapshot().error, null);
});

test("autoplay rejection offers recovery instead of claiming playback", async () => {
  const { player, audios } = setup();
  player.select(0); player.pause();
  audios[0].failure = new DOMException("blocked", "NotAllowedError");
  await player.play();
  assert.equal(player.getSnapshot().phase, "error");
  assert.match(player.getSnapshot().error, /点击播放继续/);
  player.retry();
  assert.equal(player.getSnapshot().phase, "playing");
});

test("a rejected play promise from an old clip cannot corrupt the new clip", async () => {
  const { player, audios } = setup();
  player.select(0); player.pause();
  let reject;
  audios[0].playPromise = new Promise((_, fail) => { reject = fail; });
  const pending = player.play(); player.select(1);
  reject(new Error("old source interrupted")); await pending;
  assert.equal(player.getSnapshot().index, 1);
  assert.equal(player.getSnapshot().phase, "playing");
  assert.equal(player.getSnapshot().error, null);
});

test("reset stops audio, clears episode bookmarks and restores initial state", () => {
  const { player, audios } = setup();
  player.select(2); player.openEpisode(3); player.reset();
  assert.ok(audios.every((audio) => audio.paused));
  assert.deepEqual(player.getSnapshot(), player.getServerSnapshot());
  player.select(0); player.dispose();
  assert.ok(audios.at(-1).paused);
});

test("previous/next respect boundaries and are inactive in episode mode", () => {
  const { player, audios } = setup();
  player.previous(); assert.equal(audios.length, 0);
  player.select(3); player.next(); assert.equal(audios.length, 1);
  player.previous(); assert.equal(player.getSnapshot().index, 2);
  player.openEpisode(1); player.next(); player.previous();
  assert.equal(player.getSnapshot().index, 1);
  assert.equal(player.getSnapshot().mode, "episode");
});

test("whole-source chapters seek in absolute audio time but expose relative progress", () => {
  const audios = [];
  const items = manifest.items.map(i => ({ ...i, audioOffset: i.start, audioUrl: i.episodeAudioUrl }));
  const player = new PlaylistPlayer(items, () => { const a = new FakeAudio(); audios.push(a); return a; });
  try {
    player.select(0); audios[0].metadata();
    assert.equal(audios[0].currentTime, items[0].start);
    audios[0].tick(items[0].start + 30);
    assert.equal(player.getSnapshot().time, 30);
    player.seek(60);
    assert.equal(audios[0].currentTime, items[0].start + 60);
    player.openEpisode(0);
    audios[1].metadata();
    assert.equal(audios[1].currentTime, items[0].start);
    player.returnToPlaylist(); audios[2].metadata();
    assert.equal(audios[2].currentTime, items[0].start + 60);
    assert.equal(player.getSnapshot().phase, "paused");
  } finally { player.dispose(); }
});

test("chapter end pauses original source and advances exactly once before full episode ends", () => {
  const audios = [];
  const items = manifest.items.map(i => ({ ...i, audioOffset: i.start, audioUrl: i.episodeAudioUrl }));
  const player = new PlaylistPlayer(items, () => { const a = new FakeAudio(); audios.push(a); return a; });
  try {
    player.select(0); audios[0].metadata();
    audios[0].tick(items[0].start + items[0].duration);
    assert.equal(audios[0].paused, true);
    assert.equal(player.getSnapshot().index, 1);
    audios[0].finish();
    assert.equal(audios.length, 2);
    player.select(items.length - 1); audios.at(-1).metadata();
    audios.at(-1).tick(items.at(-1).start + items.at(-1).duration);
    assert.equal(player.getSnapshot().phase, "ended");
    assert.equal(audios.at(-1).paused, true);
  } finally { player.dispose(); }
});

test("seek before metadata and paused resume use the correct chapter offset", async () => {
  const audios = [];
  const items = manifest.items.map(i => ({ ...i, audioOffset: i.start, audioUrl: i.episodeAudioUrl }));
  const player = new PlaylistPlayer(items, () => { const a = new FakeAudio(); audios.push(a); return a; });
  try {
    player.select(0); player.seek(40); audios[0].metadata();
    assert.equal(audios[0].currentTime, items[0].start + 40);
    player.pause(); player.seek(55); await player.play();
    assert.equal(audios[0].currentTime, items[0].start + 55);
    assert.equal(audios.length, 1);
  } finally { player.dispose(); }
});
