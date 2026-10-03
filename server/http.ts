export const jsonResponse = (value: unknown, status = 200) => Response.json(value, {
  status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
});
/** Next may use an internal hostname in request.url; Host is the browser-facing authority. */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const url = new URL(request.url);
    const host = request.headers.get("host") ?? url.host;
    const protocol = request.headers.get("x-forwarded-proto") ?? url.protocol.slice(0, -1);
    if (protocol !== "http" && protocol !== "https") return false;
    return origin === `${protocol}://${host}`;
  } catch { return false; }
}
/** Best-effort per-instance backpressure. Not a global billing cap across serverless instances. */
let active = 0;
export async function withCapacity(run: () => Promise<Response>) {
  if (active >= 4) return jsonResponse({ error: "正在处理其他请求，请稍后再试。" }, 429);
  active++;
  try { return await run(); } finally { active--; }
}
export async function readPlaylistBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing body");
  const parts: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 16000) { await reader.cancel(); throw new Error("Body too large"); }
    parts.push(value);
  }
  return JSON.parse(Buffer.concat(parts).toString("utf8"));
}
