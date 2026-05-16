import { CREDIT_LIST_URLS, SIGN_TYPES, type ExecutionSummary, type Plan } from "./models";

export interface ExecutorClient {
  getSignCard(activityId: string): Promise<string | null>;
  getSignList(activityId: string, type: number): Promise<unknown[]>;
  resign(activityId: string, signUpIds: string[], isAll?: boolean): Promise<boolean>;
  getCreditList(kind: keyof typeof CREDIT_LIST_URLS, activityId: string, scoreId: string): Promise<unknown[]>;
  sendCredit(activityId: string, scoreId: string, userIds: string[]): Promise<boolean>;
}

export interface PrecheckIssue {
  level: "error" | "warning";
  code: string;
  message: string;
  activityId?: string;
  studentId?: string;
}

export interface PrecheckReport {
  planId: string;
  executable: boolean;
  issues: PrecheckIssue[];
  actionCount: number;
}

export async function precheckPlan(client: ExecutorClient, plan: Plan): Promise<PrecheckReport> {
  const issues: PrecheckIssue[] = [];
  const activityIds = [...new Set(plan.allocations.flatMap((allocation) => allocation.assignments.map((assignment) => assignment.bundle.activityId)))];
  for (const activityId of activityIds) {
    const signCard = await client.getSignCard(activityId);
    if (!signCard) {
      issues.push({
        level: "error",
        code: "NO_SIGN_CARD",
        message: `活动 ${activityId} 没有签到卡，不能执行发放`,
        activityId,
      });
    }
  }
  for (const allocation of plan.allocations) {
    if (allocation.assignments.length === 0) {
      issues.push({
        level: "warning",
        code: "NO_ASSIGNMENT",
        message: `${allocation.demand.studentName} 没有可执行的计划分配`,
        studentId: allocation.demand.studentId,
      });
    }
  }
  return {
    planId: plan.id,
    executable: !issues.some((issue) => issue.level === "error"),
    issues,
    actionCount: plan.allocations.reduce((sum, allocation) => sum + allocation.assignments.length, 0),
  };
}

export async function executePlan(client: ExecutorClient, plan: Plan, onEvent?: (message: string) => void): Promise<ExecutionSummary> {
  const report = await precheckPlan(client, plan);
  if (!report.executable) {
    throw new Error("执行前预检未通过");
  }
  let resignSuccessCount = 0;
  let issueSuccessCount = 0;
  let skippedAlreadyIssuedCount = 0;
  let failedCount = 0;

  const assignments = plan.allocations.flatMap((allocation) => allocation.assignments.map((assignment) => ({ allocation, assignment })));
  for (const { allocation, assignment } of assignments) {
    const unsigned = await client.getSignList(assignment.bundle.activityId, SIGN_TYPES.unsigned);
    const unsignedSignUpIds = new Set(unsigned.map((row) => getString(row, "signUpId")));
    if (unsignedSignUpIds.has(assignment.signUpId)) {
      const ok = await client.resign(assignment.bundle.activityId, [assignment.signUpId], false);
      if (ok) {
        resignSuccessCount += 1;
        onEvent?.(`已为 ${allocation.demand.studentName} 补签`);
      }
    }
    for (const creditItem of assignment.bundle.creditItems) {
      const credited = await client.getCreditList("credited", assignment.bundle.activityId, creditItem.scoreId);
      const creditedSignUpIds = new Set(credited.map((row) => getString(row, "signUpId")));
      if (creditedSignUpIds.has(assignment.signUpId)) {
        skippedAlreadyIssuedCount += 1;
        continue;
      }
      const ok = await client.sendCredit(assignment.bundle.activityId, creditItem.scoreId, [assignment.userId]);
      if (ok) {
        issueSuccessCount += 1;
        onEvent?.(`已为 ${allocation.demand.studentName} 发放 ${creditItem.creditType}`);
      } else {
        failedCount += 1;
      }
    }
  }

  return {
    resignSuccessCount,
    issueSuccessCount,
    skippedAlreadyIssuedCount,
    failedCount,
  };
}

function getString(value: unknown, key: string): string {
  if (typeof value !== "object" || value === null) {
    return "";
  }
  const raw = (value as Record<string, unknown>)[key];
  return raw === undefined || raw === null ? "" : String(raw);
}
