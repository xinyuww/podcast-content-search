import { createPlaylist, RetrievalError } from "../../../server/retrieval";
import { isSameOrigin, jsonResponse, readPlaylistBody, withCapacity } from "../../../server/http";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return jsonResponse({ error: "请从当前页面生成拼盘。" }, 403);
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return jsonResponse({ error: "需要 JSON 请求。" }, 415);
  let body: unknown;
  try { body = await readPlaylistBody(request); }
  catch { return jsonResponse({ error: "需求格式无效或内容过长。" }, 400); }
  return withCapacity(async () => {
    try { return jsonResponse(await createPlaylist(body, process.env.OPENAI_API_KEY ?? "", request.signal)); }
    catch (error) { return jsonResponse({ error: error instanceof RetrievalError ? error.message : "素材检索暂时不可用，请稍后重试。" }, error instanceof RetrievalError ? error.status : 503); }
  });
}
