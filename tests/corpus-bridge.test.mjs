import { AUDIO_ORIGIN, isHostedAudioUrl } from "../lib/audio-source.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { parsePlaylistResponse } from "../lib/playlist.ts";
test("client rejects malformed or out-of-bounds playlists",()=>{
  for(const v of [null,{}, {status:"ready",message:"ok",playlist:null},{status:"insufficient_coverage",message:"no",playlist:{}}]) assert.throws(()=>parsePlaylistResponse(v));
});

test("client accepts complete chapter playlists and rejects duration or URL corruption",()=>{
  const item={id:"a",episodeId:"a",chapterId:"a",title:"章节",summary:"摘要",show:"节目",episode:"单集",sourceUrl:"https://example.com",start:100,end:300,duration:200,audioOffset:100,episodeDuration:1000,audioUrl:`${AUDIO_ORIGIN}/audio/example.mp3`,episodeAudioUrl:`${AUDIO_ORIGIN}/audio/example.mp3`,cues:[{start:100,end:110,text:"原文"}]};
  const r={status:"ready",message:"ok",playlist:{id:"p",kind:"matched",title:"拼盘",totalDuration:600,items:[item,{...item,id:"b"},{...item,id:"c"}]}};
  assert.equal(parsePlaylistResponse(r).playlist.items.length,3);
  r.playlist.totalDuration=500; assert.throws(()=>parsePlaylistResponse(r));
  r.playlist.totalDuration=600; r.playlist.items[0].audioUrl="file:///private/test"; assert.throws(()=>parsePlaylistResponse(r));
});

// A playlist may only point at the dedicated store, not arbitrary external URLs.
test("audio URL allowlist accepts only this demo store", () => {
  assert(isHostedAudioUrl(`${AUDIO_ORIGIN}/audio/example.mp3`));
  assert(isHostedAudioUrl(`${AUDIO_ORIGIN}/audio/example.m4a`));
  assert.equal(isHostedAudioUrl(`${AUDIO_ORIGIN}/audio/example.wav`), false);
  for (const url of ["https://tk.wavpub.com/example.mp3", `${AUDIO_ORIGIN}.evil.test/audio/example.mp3`, `${AUDIO_ORIGIN}/audio/example.mp3?download=1`, "http://localhost/audio/example.mp3", `${AUDIO_ORIGIN}/other/example.mp3`]) assert.equal(isHostedAudioUrl(url), false);
});
