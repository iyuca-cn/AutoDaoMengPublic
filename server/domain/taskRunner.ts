import { executePlan, precheckPlan, type ExecutorClient, type PrecheckReport } from "./executor";
import { createAuditLog, type ExecutionTask, type Plan } from "./models";
import type { JsonStore } from "../storage/jsonStore";

export class TaskRunner {
  constructor(private readonly store: JsonStore, private readonly client: ExecutorClient) {}

  async precheck(plan: Plan): Promise<PrecheckReport> {
    return precheckPlan(this.client, plan);
  }

  async run(plan: Plan): Promise<ExecutionTask> {
    if (!["ready", "draft"].includes(plan.status)) {
      throw new Error("只有草稿或已预检计划可以执行");
    }
    const now = new Date().toISOString();
    const task: ExecutionTask = {
      id: crypto.randomUUID(),
      planId: plan.id,
      targetType: "creditPlan",
      targetId: plan.id,
      status: "running",
      createdAt: now,
      updatedAt: now,
      events: [{ time: now, level: "info", message: "任务开始执行" }],
    };
    await this.store.create("tasks", task);
    await this.store.update("plans", plan.id, (storedPlan) => ({
      ...storedPlan,
      status: "running",
      auditLogs: [...storedPlan.auditLogs, createAuditLog("plan.execution.started", { taskId: task.id }, "user")],
    }));
    const events = taskEventWriter(task, this.store);
    try {
      const result = await executePlan(this.client, plan, events.push);
      await events.flush();
      const completed = await this.store.update("tasks", task.id, (storedTask) => ({
        ...storedTask,
        status: "completed",
        updatedAt: new Date().toISOString(),
        result,
        events: [...storedTask.events, { time: new Date().toISOString(), level: "info", message: "任务执行完成" }],
      }));
      await this.store.update("plans", plan.id, (storedPlan) => ({
        ...storedPlan,
        status: "completed",
        auditLogs: [...storedPlan.auditLogs, createAuditLog("plan.execution.completed", { taskId: task.id }, "system")],
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
      await this.store.update("plans", plan.id, (storedPlan) => ({
        ...storedPlan,
        status: "failed",
        auditLogs: [...storedPlan.auditLogs, createAuditLog("plan.execution.failed", { taskId: task.id }, "system")],
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
