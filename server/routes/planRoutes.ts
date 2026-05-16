import { createAuditLog, type Plan } from "../domain/models";
import { HttpError, jsonOk, pathParts, readJson } from "../http";
import type { RouteContext } from "./context";

interface PatchPlanBody {
  name?: string;
  status?: Plan["status"];
  allocations?: Plan["allocations"];
}

export async function handlePlanRoutes(request: Request, context: RouteContext): Promise<Response | null> {
  const url = new URL(request.url);
  const parts = pathParts(url.pathname);
  if (request.method === "GET" && url.pathname === "/api/plans") {
    return jsonOk(await context.store.list("plans"));
  }
  if (parts[0] === "api" && parts[1] === "plans" && parts[2]) {
    const id = parts[2];
    if (request.method === "GET" && parts.length === 3) {
      const plan = await context.store.read("plans", id);
      if (!plan) {
        throw new HttpError("计划不存在", 404, "PLAN_NOT_FOUND");
      }
      return jsonOk(plan);
    }
    if (request.method === "PATCH" && parts.length === 3) {
      const body = await readJson<PatchPlanBody>(request);
      const updated = await context.store.update("plans", id, (plan) => {
        if (!["draft", "ready"].includes(plan.status)) {
          throw new HttpError("已执行或执行中的计划不能直接修改，请复制为新计划", 409, "PLAN_LOCKED");
        }
        return {
          ...plan,
          name: body.name ?? plan.name,
          status: body.status ?? plan.status,
          allocations: body.allocations ?? plan.allocations,
          auditLogs: [...plan.auditLogs, createAuditLog("plan.updated", { fields: Object.keys(body) }, "user")],
        };
      });
      return jsonOk(updated);
    }
  }
  return null;
}
