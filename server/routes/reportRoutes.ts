import { writeExecutionWorkbook, writeOperationPlanDetailWorkbook, writePlanDetailWorkbook, writePlanSummaryWorkbook, writeRandomDrainWorkbook } from "../domain/reports";
import { userTimeContextFromRequest } from "../domain/time";
import type { OperationPlan, Plan } from "../domain/models";
import type { RandomDrainBatch } from "../domain/randomDrain";
import { HttpError, pathParts } from "../http";
import type { RouteContext } from "./context";

export async function handleReportRoutes(request: Request, context: RouteContext): Promise<Response | null> {
  const url = new URL(request.url);
  const parts = pathParts(url.pathname);
  const timeContext = userTimeContextFromRequest(request);
  if (request.method === "GET" && parts[0] === "api" && parts[1] === "plans" && parts[2] && parts[3] === "reports" && parts[4] === "summary.xlsx") {
    const plan = await context.store.read("plans", parts[2]);
    if (!plan) {
      throw new HttpError("计划不存在", 404, "PLAN_NOT_FOUND");
    }
    return xlsxResponse(writePlanSummaryWorkbook(plan, timeContext), `${plan.name}-summary.xlsx`);
  }
  if (request.method === "GET" && parts[0] === "api" && parts[1] === "plans" && parts[2] && parts[3] === "reports" && parts[4] === "details.xlsx") {
    const plan = await context.store.read("plans", parts[2]);
    if (!plan) {
      throw new HttpError("计划不存在", 404, "PLAN_NOT_FOUND");
    }
    return xlsxResponse(writePlanDetailWorkbook(plan, timeContext), `${plan.name}-details.xlsx`);
  }
  if (request.method === "GET" && parts[0] === "api" && parts[1] === "operation-plans" && parts[2] && parts[3] === "reports" && parts[4] === "details.xlsx") {
    const plan = await context.store.read("operation-plans", parts[2]);
    if (!plan) {
      throw new HttpError("操作计划不存在", 404, "OPERATION_PLAN_NOT_FOUND");
    }
    return xlsxResponse(writeOperationPlanDetailWorkbook(plan, timeContext), `${plan.name}-details.xlsx`);
  }
  if (request.method === "GET" && parts[0] === "api" && parts[1] === "random-drain" && parts[2] === "batches" && parts[3] && parts[4] === "reports" && parts[5] === "preview.xlsx") {
    const batch = await context.store.read("random-drain-batches", parts[3]);
    if (!batch) {
      throw new HttpError("随机消耗批次不存在", 404, "RANDOM_DRAIN_BATCH_NOT_FOUND");
    }
    return xlsxResponse(writeRandomDrainWorkbook(batch, timeContext), `${batch.id}-random-drain-preview.xlsx`);
  }
  if (request.method === "GET" && parts[0] === "api" && parts[1] === "tasks" && parts[2] && parts[3] === "reports" && parts[4] === "execution.xlsx") {
    const task = await context.store.read("tasks", parts[2]);
    if (!task) {
      throw new HttpError("任务不存在", 404, "TASK_NOT_FOUND");
    }
    const plan = task.targetType === "randomDrain"
      ? await context.store.read("random-drain-batches", task.targetId ?? task.planId)
      : task.targetType === "operationPlan"
      ? await context.store.read("operation-plans", task.targetId ?? task.planId)
      : await context.store.read("plans", task.targetId ?? task.planId);
    return xlsxResponse(writeExecutionWorkbook(task, isExecutionPlan(plan) || isRandomDrainBatch(plan) ? plan : undefined, timeContext), `${task.id}-execution.xlsx`);
  }
  return null;
}

function isExecutionPlan(value: unknown): value is Plan | OperationPlan {
  return typeof value === "object" && value !== null && ("allocations" in value || "actions" in value);
}

function isRandomDrainBatch(value: unknown): value is RandomDrainBatch {
  return typeof value === "object" && value !== null && "activities" in value && "selectedItems" in value;
}

function xlsxResponse(buffer: ArrayBuffer, filename: string): Response {
  return new Response(buffer, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
