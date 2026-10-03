import { loadDemoPlaylist } from "../../../server/snapshot";
import { jsonResponse } from "../../../server/http";

export const runtime = "nodejs";
export function GET() {
  try { return jsonResponse(loadDemoPlaylist()); }
  catch { return jsonResponse({ error: "示例拼盘暂时不可用，请稍后重试。" }, 503); }
}
