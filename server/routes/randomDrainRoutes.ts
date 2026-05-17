import { buildRandomDrainPreview, executeRandomDrainBatch, type RandomDrainPreviewInput } from "../domain/randomDrain";
import { jsonOk, ndjsonStream, pathParts, readJson, HttpError } from "../http";
import { ensureLocalApiRunning, type RouteContext } from "./context";
import type { ExecutionTask } from "../domain/models";

export async function handleRandomDrainRoutes(request: Request, context: RouteContext): Promise<Response | null> {
  const url = new URL(request.url);
  const parts = pathParts(url.pathname);

  if (request.method === "GET" && url.pathname === "/api/random-drain/batches") {
    return jsonOk(await context.store.list("random-drain-batches"));
  }

  if (request.method === "POST" && url.pathname === "/api/random-drain/preview") {
    await ensureLocalApiRunning(context);
    await context.sessionManager.requireAuthenticated();
    const body = await readJson<RandomDrainPreviewInput>(request);
    const batch = await buildRandomDrainPreview(context.localApiClient, body);
    return jsonOk(await context.store.create("random-drain-batches", batch), { status: 201 });
  }

  if (parts[0] === "api" && parts[1] === "random-drain" && parts[2] === "batches" && parts[3]) {
    const batchId = parts[3];
    const batch = await context.store.read("random-drain-batches", batchId);
    if (!batch) {
      throw new HttpError("随机消耗批次不存在", 404, "RANDOM_DRAIN_BATCH_NOT_FOUND");
    }
    if (request.method === "GET" && parts.length === 4) {
      return jsonOk(batch);
    }
    if (request.method === "POST" && parts[4] === "execute" && parts[5] === "stream" && parts.length === 6) {
      await ensureLocalApiRunning(context);
      await context.sessionManager.requireAuthenticated();
      const body = await readJson<{ confirmedActivityIds?: string[] }>(request);
      const confirmedActivityIds = (body.confirmedActivityIds ?? []).map((id) => String(id).trim()).filter(Boolean);
      return ndjsonStream(async (send) => {
        send({ type: "started", message: "开始执行随机消耗" });
        const task = await runRandomDrainTask(context, batchId, confirmedActivityIds, (snapshot) => {
          send({ type: "task", message: snapshot.events.at(-1)?.message ?? "任务状态更新", data: snapshot });
        });
        send({ type: "completed", message: "随机消耗执行结束", data: task });
      });
    }
    if (request.method === "POST" && parts[4] === "execute" && parts.length === 5) {
      await ensureLocalApiRunning(context);
      await context.sessionManager.requireAuthenticated();
      const body = await readJson<{ confirmedActivityIds?: string[] }>(request);
      return jsonOk(await runRandomDrainTask(context, batchId, body.confirmedActivityIds ?? []), { status: 202 });
    }
  }

  return null;
}

async function runRandomDrainTask(
  context: RouteContext,
  batchId: string,
  confirmedActivityIds: string[],
  onTask?: (task: ExecutionTask) => void,
): Promise<ExecutionTask> {
  const batch = await context.store.read("random-drain-batches", batchId);
  if (!batch) {
    throw new HttpError("随机消耗批次不存在", 404, "RANDOM_DRAIN_BATCH_NOT_FOUND");
  }
  const now = new Date().toISOString();
  const task: ExecutionTask = {
    id: crypto.randomUUID(),
    planId: batch.id,
    targetType: "randomDrain",
    targetId: batch.id,
    status: "running",
    createdAt: now,
    updatedAt: now,
    events: [{ time: now, level: "info", message: "随机消耗任务开始执行" }],
  };
  await context.store.create("tasks", task);
  onTask?.(task);
  const events = taskEventWriter(task, context.store, onTask);
  try {
    const result = await executeRandomDrainBatch(context.localApiClient, batch, confirmedActivityIds, events.push);
    await events.flush();
    const completed = await context.store.update("tasks", task.id, (storedTask) => ({
      ...storedTask,
      status: result.failedCount > 0 ? "failed" : "completed",
      updatedAt: new Date().toISOString(),
      result,
      events: [...storedTask.events, {
        time: new Date().toISOString(),
        level: result.failedCount > 0 ? "warning" : "info",
        message: result.failedCount > 0 ? "随机消耗执行结束，存在未完成项" : "随机消耗执行完成",
      }],
    }));
    onTask?.(completed);
    return completed;
  } catch (error) {
    await events.flush();
    const failed = await context.store.update("tasks", task.id, (storedTask) => ({
      ...storedTask,
      status: "failed",
      updatedAt: new Date().toISOString(),
      events: [...storedTask.events, { time: new Date().toISOString(), level: "error", message: error instanceof Error ? error.message : String(error) }],
    }));
    onTask?.(failed);
    return failed;
  }
}

function taskEventWriter(task: ExecutionTask, store: RouteContext["store"], onTask?: (task: ExecutionTask) => void): { push: (message: string) => void; flush: () => Promise<void> } {
  let pending = Promise.resolve();
  return {
    push(message: string) {
      pending = pending.then(() => store.update("tasks", task.id, (storedTask) => ({
        ...storedTask,
        updatedAt: new Date().toISOString(),
        events: [...storedTask.events, { time: new Date().toISOString(), level: "info", message }],
      }))).then((updatedTask) => {
        onTask?.(updatedTask);
      });
    },
    flush() {
      return pending;
    },
  };
}
