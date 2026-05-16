import { parseImportWorkbook } from "../domain/excel";
import { aggregatePriorityDemands } from "../domain/excel";
import type { ImportBatch, PriorityDemandRecord } from "../domain/models";
import { createAuditLog } from "../domain/models";
import { generatePlanFromImport } from "../domain/planWorkflow";
import { HttpError, jsonOk, pathParts, readJson } from "../http";
import type { RouteContext } from "./context";

interface UpdateImportBody {
  aggregatedDemands?: PriorityDemandRecord[];
}

interface GeneratePlanBody {
  name?: string;
  editedDemands?: PriorityDemandRecord[];
}

export async function handleImportRoutes(request: Request, context: RouteContext): Promise<Response | null> {
  const url = new URL(request.url);
  const parts = pathParts(url.pathname);
  if (request.method === "POST" && url.pathname === "/api/imports") {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new HttpError("需要上传字段名为 file 的 xlsx 文件");
    }
    const draft = parseImportWorkbook(await file.arrayBuffer());
    const batch: ImportBatch = {
      id: crypto.randomUUID(),
      filename: file.name,
      createdAt: new Date().toISOString(),
      rows: draft.rows,
      aggregatedDemands: draft.aggregatedDemands,
      errors: draft.errors,
      auditLogs: [createAuditLog("import.created", { filename: file.name, rowCount: draft.rows.length }, "user")],
    };
    await context.store.create("imports", batch);
    return jsonOk(batch, { status: 201 });
  }

  if (request.method === "GET" && url.pathname === "/api/imports") {
    return jsonOk(await context.store.list("imports"));
  }

  if (parts[0] === "api" && parts[1] === "imports" && parts[2]) {
    const id = parts[2];
    if (request.method === "GET" && parts.length === 3) {
      const batch = await context.store.read("imports", id);
      if (!batch) {
        throw new HttpError("导入批次不存在", 404, "IMPORT_NOT_FOUND");
      }
      return jsonOk(batch);
    }

    if (request.method === "PATCH" && parts.length === 3) {
      const body = await readJson<UpdateImportBody>(request);
      const updated = await context.store.update("imports", id, (batch) => ({
        ...batch,
        aggregatedDemands: body.aggregatedDemands ?? aggregatePriorityDemands(batch.rows),
        auditLogs: [...batch.auditLogs, createAuditLog("import.updated", { demandCount: body.aggregatedDemands?.length }, "user")],
      }));
      return jsonOk(updated);
    }

    if (request.method === "POST" && parts[3] === "generate-plan") {
      await context.localApiProcessManager.ensureRunning();
      const body = await maybeJson<GeneratePlanBody>(request);
      const plan = await generatePlanFromImport(context.store, context.localApiClient, id, body);
      return jsonOk(plan, { status: 201 });
    }
  }

  return null;
}

async function maybeJson<T>(request: Request): Promise<T> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return {} as T;
  }
  return (await request.json()) as T;
}
