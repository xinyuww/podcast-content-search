import host from "./audio-host.json" with { type: "json" };

export const AUDIO_ORIGIN = host.origin;
/** Only this demo's dedicated audio store is allowed; never a user-controlled URL. */
export function isHostedAudioUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.origin === AUDIO_ORIGIN && url.protocol === "https:" &&
      !url.username && !url.password && !url.search && !url.hash &&
      /^\/audio\/[a-z0-9-]+\.(mp3|m4a)$/.test(url.pathname);
  } catch { return false; }
}
