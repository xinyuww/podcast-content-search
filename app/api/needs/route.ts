import { handleNeedsRequest } from "../../../server/needs";
import { withCapacity } from "../../../server/http";

export const runtime = "nodejs";
export const maxDuration = 60;
export function POST(request: Request) {
  return withCapacity(() => handleNeedsRequest(request, process.env.OPENAI_API_KEY ?? ""));
}
