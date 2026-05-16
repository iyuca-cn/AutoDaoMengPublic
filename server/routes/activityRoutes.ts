import { buildActivityDetail } from "../domain/activityDetail";
import { buildActivityOverview } from "../domain/catalog";
import type { ActivityDetail } from "../domain/models";
import { HttpError, jsonOk, ndjsonStream, pathParts, readJson } from "../http";
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
  if (request.method === "POST" && url.pathname === "/api/activities/details/stream") {
    await ensureLocalApiRunning(context);
    await context.sessionManager.requireAuthenticated();
    const body = await readJson<{ activityIds?: string[] }>(request);
    const activityIds = [...new Set((body.activityIds ?? []).map((id) => String(id).trim()).filter(Boolean))];
    if (activityIds.length === 0) {
      throw new HttpError("请选择要读取详情的活动", 400, "NO_ACTIVITY_SELECTED");
    }
    return ndjsonStream(async (send) => {
      const details: ActivityDetail[] = [];
      const errors: Array<{ activityId: string; message: string }> = [];
      send({ type: "started", message: `开始读取 ${activityIds.length} 个活动详情` });
      for (const activityId of activityIds) {
        send({ type: "progress", message: `正在读取活动 ${activityId}`, data: { activityId } });
        try {
          const detail = await buildActivityDetail(context.localApiClient, activityId);
          details.push(detail);
          send({ type: "data", message: `已读取 ${detail.activityName}`, data: detail });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const item = { activityId, message };
          errors.push(item);
          send({ type: "error", message, code: "ACTIVITY_DETAIL_FAILED", data: item });
        }
      }
      send({ type: "completed", message: "活动详情读取完成", data: { details, errors } });
    });
  }
  if (parts[0] === "api" && parts[1] === "activities" && parts[2] && parts[3] === "stream" && parts.length === 4 && request.method === "GET") {
    await ensureLocalApiRunning(context);
    await context.sessionManager.requireAuthenticated();
    const activityId = parts[2];
    return ndjsonStream(async (send) => {
      send({ type: "started", message: `开始读取活动 ${activityId} 详情`, data: { activityId } });
      const detail = await buildActivityDetail(context.localApiClient, activityId);
      send({ type: "data", message: `已读取 ${detail.activityName}`, data: detail });
      send({ type: "completed", message: "活动详情读取完成", data: detail });
    });
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
