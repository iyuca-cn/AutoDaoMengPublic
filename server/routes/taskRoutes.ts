import { TaskRunner } from "../domain/taskRunner";
import { HttpError, jsonOk, pathParts } from "../http";
import { ensureLocalApiRunning, type RouteContext } from "./context";

export async function handleTaskRoutes(request: Request, context: RouteContext): Promise<Response | null> {
  const url = new URL(request.url);
  const parts = pathParts(url.pathname);
  if (request.method === "GET" && url.pathname === "/api/tasks") {
    return jsonOk(await context.store.list("tasks"));
  }
  if (parts[0] === "api" && parts[1] === "plans" && parts[2] && parts[3] === "precheck" && request.method === "POST") {
    await ensureLocalApiRunning(context);
    await context.sessionManager.requireAuthenticated();
    const plan = await context.store.read("plans", parts[2]);
    if (!plan) {
      throw new HttpError("计划不存在", 404, "PLAN_NOT_FOUND");
    }
    const runner = new TaskRunner(context.store, context.localApiClient);
    return jsonOk(await runner.precheck(plan));
  }
  if (parts[0] === "api" && parts[1] === "plans" && parts[2] && parts[3] === "execute" && request.method === "POST") {
    await ensureLocalApiRunning(context);
    await context.sessionManager.requireAuthenticated();
    const plan = await context.store.read("plans", parts[2]);
    if (!plan) {
      throw new HttpError("计划不存在", 404, "PLAN_NOT_FOUND");
    }
    const runner = new TaskRunner(context.store, context.localApiClient);
    return jsonOk(await runner.run(plan), { status: 202 });
  }
  if (parts[0] === "api" && parts[1] === "tasks" && parts[2] && request.method === "GET") {
    const task = await context.store.read("tasks", parts[2]);
    if (!task) {
      throw new HttpError("任务不存在", 404, "TASK_NOT_FOUND");
    }
    return jsonOk(task);
  }
  return null;
}
