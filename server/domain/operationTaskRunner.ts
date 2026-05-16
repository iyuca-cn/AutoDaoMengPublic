import { executeOperationPlan, applyPrecheck, precheckOperationPlan } from "./operationExecutor";
import { createAuditLog, type ExecutionTask, type OperationPlan, type OperationPrecheckReport } from "./models";
import type { DmLocalApiClient } from "../local-api/client";
import type { JsonStore } from "../storage/jsonStore";

export class OperationTaskRunner {
  constructor(private readonly store: JsonStore, private readonly client: DmLocalApiClient) {}

  async precheck(plan: OperationPlan): Promise<OperationPrecheckReport> {
    const report = await precheckOperationPlan(this.client, plan);
    await this.store.update("operation-plans", plan.id, (storedPlan) => ({
      ...applyPrecheck(storedPlan, report),
      auditLogs: [...storedPlan.auditLogs, createAuditLog("operation-plan.prechecked", { executable: report.executable }, "system")],
    }));
    return report;
  }

  async run(plan: OperationPlan): Promise<ExecutionTask> {
    if (!["draft", "ready"].includes(plan.status)) {
      throw new Error("只有草稿或已预检操作计划可以执行");
    }
    const now = new Date().toISOString();
    const task: ExecutionTask = {
      id: crypto.randomUUID(),
      planId: plan.id,
      targetType: "operationPlan",
      targetId: plan.id,
      status: "running",
      createdAt: now,
      updatedAt: now,
      events: [{ time: now, level: "info", message: "操作计划任务开始执行" }],
    };
    await this.store.create("tasks", task);
    await this.store.update("operation-plans", plan.id, (storedPlan) => ({
      ...storedPlan,
      status: "running",
      updatedAt: new Date().toISOString(),
      auditLogs: [...storedPlan.auditLogs, createAuditLog("operation-plan.execution.started", { taskId: task.id }, "user")],
    }));
    const events = taskEventWriter(task, this.store);
    try {
      const result = await executeOperationPlan(this.client, plan, events.push);
      await events.flush();
      const completed = await this.store.update("tasks", task.id, (storedTask) => ({
        ...storedTask,
        status: "completed",
        updatedAt: new Date().toISOString(),
        result,
        events: [...storedTask.events, { time: new Date().toISOString(), level: "info", message: "操作计划任务执行完成" }],
      }));
      await this.store.update("operation-plans", plan.id, (storedPlan) => ({
        ...storedPlan,
        status: result.failedCount > 0 ? "failed" : "completed",
        updatedAt: new Date().toISOString(),
        auditLogs: [...storedPlan.auditLogs, createAuditLog("operation-plan.execution.completed", { taskId: task.id, failedCount: result.failedCount }, "system")],
      }));
      return completed;
    } catch (error) {
      await events.flush();
      const failed = await this.store.update("tasks", task.id, (storedTask) => ({
        ...storedTask,
        status: "failed",
        updatedAt: new Date().toISOString(),
        events: [...storedTask.events, { time: new Date().toISOString(), level: "error", message: error instanceof Error ? error.message : String(error) }],
      }));
      await this.store.update("operation-plans", plan.id, (storedPlan) => ({
        ...storedPlan,
        status: "failed",
        updatedAt: new Date().toISOString(),
        auditLogs: [...storedPlan.auditLogs, createAuditLog("operation-plan.execution.failed", { taskId: task.id }, "system")],
      }));
      return failed;
    }
  }
}

function taskEventWriter(task: ExecutionTask, store: JsonStore): { push: (message: string) => void; flush: () => Promise<void> } {
  let pending = Promise.resolve();
  return {
    push(message: string) {
      pending = pending.then(() => store.update("tasks", task.id, (storedTask) => ({
        ...storedTask,
        updatedAt: new Date().toISOString(),
        events: [...storedTask.events, { time: new Date().toISOString(), level: "info", message }],
      }))).then(() => undefined);
    },
    flush() {
      return pending;
    },
  };
}
