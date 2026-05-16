import { buildActivityOverview } from "../domain/catalog";
import { jsonOk } from "../http";
import type { RouteContext } from "./context";

export async function handleActivityRoutes(request: Request, context: RouteContext): Promise<Response | null> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/api/activities") {
    await context.localApiProcessManager.ensureRunning();
    const activities = await buildActivityOverview(context.localApiClient);
    return jsonOk(activities);
  }
  return null;
}
