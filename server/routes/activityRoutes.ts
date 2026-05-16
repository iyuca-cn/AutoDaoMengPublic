import { buildActivityDetail } from "../domain/activityDetail";
import { buildActivityOverview } from "../domain/catalog";
import { jsonOk, pathParts } from "../http";
import { ensureLocalApiRunning, type RouteContext } from "./context";

export async function handleActivityRoutes(request: Request, context: RouteContext): Promise<Response | null> {
  const url = new URL(request.url);
  const parts = pathParts(url.pathname);
  if (request.method === "GET" && url.pathname === "/api/activities") {
    await ensureLocalApiRunning(context);
    await context.sessionManager.requireAuthenticated();
    const activities = await buildActivityOverview(context.localApiClient);
    return jsonOk(activities);
  }
  if (request.method === "POST" && url.pathname === "/api/activities/refresh") {
    await ensureLocalApiRunning(context);
    await context.sessionManager.requireAuthenticated();
    return jsonOk(await buildActivityOverview(context.localApiClient));
  }
  if (parts[0] === "api" && parts[1] === "activities" && parts[2] && parts.length === 3) {
    if (request.method === "GET" || request.method === "POST") {
      await ensureLocalApiRunning(context);
      await context.sessionManager.requireAuthenticated();
      return jsonOk(await buildActivityDetail(context.localApiClient, parts[2]));
    }
  }
  if (parts[0] === "api" && parts[1] === "activities" && parts[2] && parts[3] === "refresh" && request.method === "POST") {
    await ensureLocalApiRunning(context);
    await context.sessionManager.requireAuthenticated();
    return jsonOk(await buildActivityDetail(context.localApiClient, parts[2]));
  }
  return null;
}
