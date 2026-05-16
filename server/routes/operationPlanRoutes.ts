import { createOperationPlan, patchOperationPlan, type CreateOperationPlanInput, type PatchOperationPlanInput } from "../domain/operationPlans";
import { OperationTaskRunner } from "../domain/operationTaskRunner";
import { HttpError, jsonOk, pathParts, readJson } from "../http";
import { ensureLocalApiRunning, type RouteContext } from "./context";

export async function handleOperationPlanRoutes(request: Request, context: RouteContext): Promise<Response | null> {
  const url = new URL(request.url);
  const parts = pathParts(url.pathname);
  if (request.method === "GET" && url.pathname === "/api/operation-plans") {
    const plans = await context.store.list("operation-plans");
    return jsonOk(plans.sort((left, right) => right.createdAt.localeCompare(left.createdAt)));
  }
  if (request.method === "POST" && url.pathname === "/api/operation-plans") {
    await context.sessionManager.requireAuthenticated();
    const body = await readJson<CreateOperationPlanInput>(request);
    const plan = createOperationPlan(body);
    return jsonOk(await context.store.create("operation-plans", plan), { status: 201 });
  }
  if (parts[0] === "api" && parts[1] === "operation-plans" && parts[2]) {
    const id = parts[2];
    const plan = await context.store.read("operation-plans", id);
    if (!plan) {
      throw new HttpError("操作计划不存在", 404, "OPERATION_PLAN_NOT_FOUND");
    }
    if (request.method === "GET" && parts.length === 3) {
      return jsonOk(plan);
    }
    if (request.method === "PATCH" && parts.length === 3) {
      const body = await readJson<PatchOperationPlanInput>(request);
      return jsonOk(await context.store.update("operation-plans", id, (storedPlan) => patchOperationPlan(storedPlan, body)));
    }
    if (request.method === "DELETE" && parts.length === 3) {
      if (!["draft", "ready", "failed", "cancelled"].includes(plan.status)) {
        throw new HttpError("执行中或已完成的操作计划不能删除", 409, "OPERATION_PLAN_LOCKED");
      }
      await context.store.delete("operation-plans", id);
      return jsonOk({ deleted: true });
    }
    if (request.method === "POST" && parts[3] === "precheck" && parts.length === 4) {
      await ensureLocalApiRunning(context);
      await context.sessionManager.requireAuthenticated();
      const runner = new OperationTaskRunner(context.store, context.localApiClient);
      return jsonOk(await runner.precheck(plan));
    }
    if (request.method === "POST" && parts[3] === "execute" && parts.length === 4) {
      await ensureLocalApiRunning(context);
      await context.sessionManager.requireAuthenticated();
      const runner = new OperationTaskRunner(context.store, context.localApiClient);
      return jsonOk(await runner.run(plan), { status: 202 });
    }
  }
  return null;
}
