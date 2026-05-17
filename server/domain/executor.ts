import { CREDIT_LIST_URLS, SIGN_TYPES, type BundleCandidate, type DemandAllocation, type ExecutionDetail, type ExecutionSummary, type Plan } from "./models";

export interface ExecutorClient {
  getSignCard(activityId: string): Promise<string | null>;
  getSignList(activityId: string, type: number): Promise<unknown[]>;
  resign(activityId: string, signUpIds: string[], isAll?: boolean): Promise<boolean>;
  getCreditList(kind: keyof typeof CREDIT_LIST_URLS, activityId: string, creditId: string): Promise<unknown[]>;
  sendCredit(activityId: string, creditId: string, userIds: string[]): Promise<boolean>;
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
  const details: ExecutionDetail[] = [];

  const assignments = plan.allocations.flatMap((allocation) => allocation.assignments.map((assignment) => ({ allocation, assignment })));
  const userIdCache = new Map<string, Map<string, string>>();
  for (const { allocation, assignment } of assignments) {
    const unsigned = await client.getSignList(assignment.bundle.activityId, SIGN_TYPES.unsigned);
    const unsignedSignUpIds = new Set(unsigned.map((row) => getString(row, "signUpId")));
    if (unsignedSignUpIds.has(assignment.signUpId)) {
      const ok = await client.resign(assignment.bundle.activityId, [assignment.signUpId], false);
      if (ok) {
        resignSuccessCount += 1;
        const message = `已为 ${allocation.demand.studentName} 补签`;
        details.push(detailFromAssignment(allocation, assignment, "resign", "success", 0, 0, message));
        onEvent?.(message);
      } else {
        failedCount += 1;
        const message = `${allocation.demand.studentName} 补签失败`;
        details.push(detailFromAssignment(allocation, assignment, "resign", "failed", 0, 0, message));
      }
    }
    if (isInvalidUserId(assignment.userId)) {
      const resolvedUserId = (await userIdsBySignUpId(client, assignment.bundle.activityId, userIdCache)).get(assignment.signUpId);
      if (resolvedUserId) {
        assignment.userId = resolvedUserId;
      }
    }
    if (isInvalidUserId(assignment.userId)) {
      failedCount += assignment.bundle.creditItems.length;
      const message = `${allocation.demand.studentName} 缺少有效 userId，跳过发放`;
      for (const creditItem of assignment.bundle.creditItems) {
        details.push(detailFromAssignment(allocation, assignment, "issueCredit", "failed", creditItem.unitcountCent, 0, message, creditItem));
      }
      onEvent?.(message);
      continue;
    }
    for (const creditItem of assignment.bundle.creditItems) {
      const credited = await client.getCreditList("credited", assignment.bundle.activityId, creditItem.creditId);
      const creditedSignUpIds = new Set(credited.map((row) => getString(row, "signUpId")));
      if (creditedSignUpIds.has(assignment.signUpId)) {
        skippedAlreadyIssuedCount += 1;
        details.push(detailFromAssignment(allocation, assignment, "issueCredit", "skipped", creditItem.unitcountCent, 0, `${allocation.demand.studentName} 已发放 ${creditItem.creditType}，跳过`, creditItem));
        continue;
      }
      const ok = await client.sendCredit(assignment.bundle.activityId, creditItem.creditId, [assignment.userId]);
      if (ok) {
        issueSuccessCount += 1;
        const message = `已为 ${allocation.demand.studentName} 发放 ${creditItem.creditType}`;
        details.push(detailFromAssignment(allocation, assignment, "issueCredit", "success", creditItem.unitcountCent, creditItem.unitcountCent, message, creditItem));
        onEvent?.(message);
      } else {
        failedCount += 1;
        details.push(detailFromAssignment(allocation, assignment, "issueCredit", "failed", creditItem.unitcountCent, 0, `${allocation.demand.studentName} 发放 ${creditItem.creditType} 失败`, creditItem));
      }
    }
  }

  return {
    resignSuccessCount,
    issueSuccessCount,
    abandonSuccessCount: 0,
    skippedAlreadyIssuedCount,
    failedCount,
    details,
  };
}

function detailFromAssignment(
  allocation: DemandAllocation,
  assignment: BundleCandidate,
  action: ExecutionDetail["action"],
  status: ExecutionDetail["status"],
  plannedValueCent: number,
  actualValueCent: number,
  message: string,
  creditItem?: BundleCandidate["bundle"]["creditItems"][number],
): ExecutionDetail {
  return {
    studentId: allocation.demand.studentId,
    studentName: allocation.demand.studentName,
    activityId: assignment.bundle.activityId,
    activityName: assignment.bundle.activityName,
    signUpId: assignment.signUpId,
    userId: assignment.userId,
    creditId: creditItem?.creditId,
    scoreId: creditItem?.scoreId,
    creditType: creditItem?.creditType,
    plannedValueCent,
    actualValueCent,
    action,
    status,
    message,
  };
}

async function userIdsBySignUpId(client: ExecutorClient, activityId: string, cache: Map<string, Map<string, string>>): Promise<Map<string, string>> {
  if (!cache.has(activityId)) {
    const rows = (await Promise.all([
      client.getSignList(activityId, SIGN_TYPES.unsigned),
      client.getSignList(activityId, SIGN_TYPES.signed),
      client.getSignList(activityId, SIGN_TYPES.signout),
      client.getSignList(activityId, SIGN_TYPES.leave),
    ])).flat();
    const mapping = new Map<string, string>();
    for (const row of rows) {
      const signUpId = getFirstString(row, ["signUpId", "signupId", "id"]);
      const userId = getFirstString(row, ["userId", "uid", "user_id"]);
      if (signUpId && !isInvalidUserId(userId)) {
        mapping.set(signUpId, userId);
      }
    }
    cache.set(activityId, mapping);
  }
  return cache.get(activityId) ?? new Map();
}

function isInvalidUserId(value: unknown): boolean {
  const text = String(value ?? "").trim();
  return !text || /[\u4e00-\u9fff]/u.test(text);
}

function getString(value: unknown, key: string): string {
  if (typeof value !== "object" || value === null) {
    return "";
  }
  const raw = (value as Record<string, unknown>)[key];
  return raw === undefined || raw === null ? "" : String(raw);
}

function getFirstString(value: unknown, keys: string[]): string {
  if (typeof value !== "object" || value === null) {
    return "";
  }
  const record = value as Record<string, unknown>;
  const normalizedEntries = new Map(Object.entries(record).map(([key, raw]) => [normalizeKey(key), raw]));
  for (const key of keys) {
    const text = String(record[key] ?? normalizedEntries.get(normalizeKey(key)) ?? "").trim();
    if (text) {
      return text;
    }
  }
  return "";
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}
