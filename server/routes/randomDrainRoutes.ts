import { previewRandomDrain } from "../domain/randomDrain";
import { jsonOk, readJson } from "../http";
import type { RouteContext } from "./context";

export async function handleRandomDrainRoutes(request: Request, _context: RouteContext): Promise<Response | null> {
  const url = new URL(request.url);
  if (request.method === "POST" && url.pathname === "/api/random-drain/preview") {
    const body = await readJson<{ threshold: number; jitter: number; seed?: string }>(request);
    return jsonOk(previewRandomDrain(body));
  }
  return null;
}
