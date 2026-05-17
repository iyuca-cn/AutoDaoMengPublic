import { TaskRunner } from "../domain/taskRunner";
import { HttpError, jsonOk, ndjsonStream, pathParts } from "../http";
import { ensureLocalApiRunning, type RouteContext } from "./context";

export async function handleTaskRoutes(request: Request, context: RouteContext): Promise<Response | null> {
  const url = new URL(request.url);
  const parts = pathParts(url.pathname);
  if (request.method === "GET" && url.pathname === "/api/tasks") {
    return jsonOk(await context.store.list("tasks"));
  }
  if (parts[0] === "api" && parts[1] === "plans" && parts[2] && parts[3] === "precheck" && parts.length === 4 && request.method === "POST") {
    await ensureLocalApiRunning(context);
    await context.sessionManager.requireAuthenticated();
    const plan = await context.store.read("plans", parts[2]);
    if (!plan) {
      throw new HttpError("计划不存在", 404, "PLAN_NOT_FOUND");
    }
    const runner = new TaskRunner(context.store, context.localApiClient);
    return jsonOk(await runner.precheck(plan));
  }
  if (parts[0] === "api" && parts[1] === "plans" && parts[2] && parts[3] === "precheck" && parts[4] === "stream" && parts.length === 5 && request.method === "POST") {
    await ensureLocalApiRunning(context);
    await context.sessionManager.requireAuthenticated();
    const plan = await context.store.read("plans", parts[2]);
    if (!plan) {
      throw new HttpError("计划不存在", 404, "PLAN_NOT_FOUND");
    }
    return ndjsonStream(async (send) => {
      send({ type: "started", message: "开始运行预检" });
      const runner = new TaskRunner(context.store, context.localApiClient);
      const report = await runner.precheck(plan);
      send({ type: "data", message: "预检完成", data: report });
      send({ type: "completed", message: "预检完成", data: report });
    });
  }
  if (parts[0] === "api" && parts[1] === "plans" && parts[2] && parts[3] === "execute" && parts.length === 4 && request.method === "POST") {
    await ensureLocalApiRunning(context);
    await context.sessionManager.requireAuthenticated();
    const plan = await context.store.read("plans", parts[2]);
    if (!plan) {
      throw new HttpError("计划不存在", 404, "PLAN_NOT_FOUND");
    }
    const runner = new TaskRunner(context.store, context.localApiClient);
    return jsonOk(await runner.run(plan), { status: 202 });
  }
  if (parts[0] === "api" && parts[1] === "plans" && parts[2] && parts[3] === "execute" && parts[4] === "stream" && parts.length === 5 && request.method === "POST") {
    await ensureLocalApiRunning(context);
    await context.sessionManager.requireAuthenticated();
    const plan = await context.store.read("plans", parts[2]);
    if (!plan) {
      throw new HttpError("计划不存在", 404, "PLAN_NOT_FOUND");
    }
    return ndjsonStream(async (send) => {
      send({ type: "started", message: plan.status === "failed" ? "开始重新执行计划" : "开始执行计划" });
      const runner = new TaskRunner(context.store, context.localApiClient);
      const task = await runner.run(plan, (snapshot) => {
        send({ type: "task", message: snapshot.events.at(-1)?.message ?? "任务状态更新", data: snapshot });
      });
      send({ type: "completed", message: "计划执行结束", data: task });
    });
  }
  if (parts[0] === "api" && parts[1] === "tasks" && parts[2] && parts.length === 3 && request.method === "GET") {
    const task = await context.store.read("tasks", parts[2]);
    if (!task) {
      throw new HttpError("任务不存在", 404, "TASK_NOT_FOUND");
    }
    return jsonOk(task);
  }
  return null;
}
