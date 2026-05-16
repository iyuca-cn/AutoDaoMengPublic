import { writeExecutionWorkbook, writePlanSummaryWorkbook } from "../domain/reports";
import { HttpError, pathParts } from "../http";
import type { RouteContext } from "./context";

export async function handleReportRoutes(request: Request, context: RouteContext): Promise<Response | null> {
  const url = new URL(request.url);
  const parts = pathParts(url.pathname);
  if (request.method === "GET" && parts[0] === "api" && parts[1] === "plans" && parts[2] && parts[3] === "reports" && parts[4] === "summary.xlsx") {
    const plan = await context.store.read("plans", parts[2]);
    if (!plan) {
      throw new HttpError("计划不存在", 404, "PLAN_NOT_FOUND");
    }
    return xlsxResponse(writePlanSummaryWorkbook(plan), `${plan.name}-summary.xlsx`);
  }
  if (request.method === "GET" && parts[0] === "api" && parts[1] === "tasks" && parts[2] && parts[3] === "reports" && parts[4] === "execution.xlsx") {
    const task = await context.store.read("tasks", parts[2]);
    if (!task) {
      throw new HttpError("任务不存在", 404, "TASK_NOT_FOUND");
    }
    return xlsxResponse(writeExecutionWorkbook(task), `${task.id}-execution.xlsx`);
  }
  return null;
}

function xlsxResponse(buffer: ArrayBuffer, filename: string): Response {
  return new Response(buffer, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
