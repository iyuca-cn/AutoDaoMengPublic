import { CREDIT_LIST_URLS, SIGN_TYPES, type BundleCandidate, type DemandAllocation, type ExecutionDetail, type ExecutionSummary, type Plan } from "./models";
import { summarizeExecutionDetails, verifyExecutionDetails } from "./executionVerifier";

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
  const blockedIssueKeys = new Set<string>();
  const assignmentsByActivity = groupBy(assignments, ({ assignment }) => assignment.bundle.activityId);
  for (const [activityId, entries] of assignmentsByActivity) {
    let unsigned: unknown[];
    try {
      unsigned = await client.getSignList(activityId, SIGN_TYPES.unsigned);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      for (const { allocation, assignment } of entries) {
        blockedIssueKeys.add(assignmentKey(allocation, assignment));
        failedCount += assignment.bundle.creditItems.length;
        for (const creditItem of assignment.bundle.creditItems) {
          details.push(detailFromAssignment(allocation, assignment, "issueCredit", "failed", creditItem.unitcountCent, 0, `${allocation.demand.studentName} 读取未签到名单失败：${reason}`, creditItem));
        }
      }
      onEvent?.(`${entries[0].assignment.bundle.activityName} 读取未签到名单失败：${reason}`);
      continue;
    }
    const unsignedSignUpIds = new Set(unsigned.map((row) => getString(row, "signUpId")));
    const resignEntries = entries.filter(({ assignment }) => unsignedSignUpIds.has(assignment.signUpId));
    if (resignEntries.length === 0) {
      continue;
    }
    const signUpIds = uniqueValues(resignEntries.map(({ assignment }) => assignment.signUpId));
    onEvent?.(`开始为 ${entries[0].assignment.bundle.activityName} 批量补签 ${signUpIds.length} 人`);
    try {
      const ok = await client.resign(activityId, signUpIds, false);
      if (!ok) {
        throw new Error("代理返回补签失败");
      }
      resignSuccessCount += resignEntries.length;
      for (const { allocation, assignment } of resignEntries) {
        const message = `已为 ${allocation.demand.studentName} 补签`;
        details.push(detailFromAssignment(allocation, assignment, "resign", "success", 0, 0, message));
      }
      onEvent?.(`已为 ${entries[0].assignment.bundle.activityName} 批量补签 ${signUpIds.length} 人`);
    } catch (error) {
      failedCount += resignEntries.length;
      const reason = error instanceof Error ? error.message : String(error);
      for (const { allocation, assignment } of resignEntries) {
        blockedIssueKeys.add(assignmentKey(allocation, assignment));
        details.push(detailFromAssignment(allocation, assignment, "resign", "failed", 0, 0, `${allocation.demand.studentName} 补签失败：${reason}`));
      }
      onEvent?.(`${entries[0].assignment.bundle.activityName} 批量补签失败：${reason}`);
    }
  }

  const userIdCache = new Map<string, Map<string, string>>();
  for (const { allocation, assignment } of assignments) {
    if (blockedIssueKeys.has(assignmentKey(allocation, assignment))) {
      continue;
    }
    if (isInvalidUserId(assignment.userId)) {
      let resolvedUserId = "";
      try {
        resolvedUserId = (await userIdsBySignUpId(client, assignment.bundle.activityId, userIdCache)).get(assignment.signUpId) ?? "";
      } catch (error) {
        failedCount += assignment.bundle.creditItems.length;
        const reason = error instanceof Error ? error.message : String(error);
        const message = `${allocation.demand.studentName} 解析 userId 失败：${reason}`;
        for (const creditItem of assignment.bundle.creditItems) {
          details.push(detailFromAssignment(allocation, assignment, "issueCredit", "failed", creditItem.unitcountCent, 0, message, creditItem));
        }
        onEvent?.(message);
        continue;
      }
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
  }

  const issueEntries = assignments
    .filter(({ allocation, assignment }) => !blockedIssueKeys.has(assignmentKey(allocation, assignment)) && !isInvalidUserId(assignment.userId))
    .flatMap(({ allocation, assignment }) => assignment.bundle.creditItems.map((creditItem) => ({ allocation, assignment, creditItem })));
  const issueBatches = groupBy(issueEntries, ({ assignment, creditItem }) => `${assignment.bundle.activityId}:${creditItem.creditId}`);
  for (const [, batch] of issueBatches) {
    const first = batch[0];
    const activityId = first.assignment.bundle.activityId;
    const creditId = first.creditItem.creditId;
    let credited: unknown[];
    try {
      credited = await client.getCreditList("credited", activityId, creditId);
    } catch (error) {
      failedCount += batch.length;
      const reason = error instanceof Error ? error.message : String(error);
      for (const { allocation, assignment, creditItem } of batch) {
        details.push(detailFromAssignment(allocation, assignment, "issueCredit", "failed", creditItem.unitcountCent, 0, `${allocation.demand.studentName} 读取已发名单失败：${reason}`, creditItem));
      }
      onEvent?.(`${first.assignment.bundle.activityName} 读取 ${first.creditItem.creditType} 已发名单失败：${reason}`);
      continue;
    }
    const creditedSignUpIds = new Set(credited.map((row) => getString(row, "signUpId")));
    const pending = batch.filter(({ assignment }) => !creditedSignUpIds.has(assignment.signUpId));
    const skipped = batch.filter(({ assignment }) => creditedSignUpIds.has(assignment.signUpId));
    skippedAlreadyIssuedCount += skipped.length;
    for (const { allocation, assignment, creditItem } of skipped) {
      details.push(detailFromAssignment(allocation, assignment, "issueCredit", "skipped", creditItem.unitcountCent, 0, `${allocation.demand.studentName} 已发放 ${creditItem.creditType}，跳过`, creditItem));
    }
    if (pending.length === 0) {
      continue;
    }
    const userIds = uniqueValues(pending.map(({ assignment }) => assignment.userId));
    onEvent?.(`开始为 ${first.assignment.bundle.activityName} 发放 ${first.creditItem.creditType} ${pending.length} 人`);
    try {
      const ok = await client.sendCredit(activityId, creditId, userIds);
      if (!ok) {
        throw new Error("代理返回发放失败");
      }
      issueSuccessCount += pending.length;
      for (const { allocation, assignment, creditItem } of pending) {
        const message = `已为 ${allocation.demand.studentName} 发放 ${creditItem.creditType}`;
        details.push(detailFromAssignment(allocation, assignment, "issueCredit", "success", creditItem.unitcountCent, creditItem.unitcountCent, message, creditItem));
      }
      onEvent?.(`已为 ${first.assignment.bundle.activityName} 发放 ${first.creditItem.creditType} ${pending.length} 人`);
    } catch (error) {
      failedCount += pending.length;
      const reason = error instanceof Error ? error.message : String(error);
      for (const { allocation, assignment, creditItem } of pending) {
        details.push(detailFromAssignment(allocation, assignment, "issueCredit", "failed", creditItem.unitcountCent, 0, `${allocation.demand.studentName} 发放 ${creditItem.creditType} 失败：${reason}`, creditItem));
      }
      onEvent?.(`${first.assignment.bundle.activityName} 发放 ${first.creditItem.creditType} 失败：${reason}`);
    }
  }

  onEvent?.("开始执行后校验");
  const verifiedDetails = await verifyExecutionDetails(client, details, onEvent);
  return summarizeExecutionDetails(verifiedDetails);
}

function assignmentKey(allocation: DemandAllocation, assignment: BundleCandidate): string {
  return [
    allocation.demand.studentId,
    allocation.demand.studentName,
    assignment.bundle.activityId,
    assignment.signUpId,
  ].join(":");
}

function groupBy<T>(values: T[], keyFromValue: (value: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const key = keyFromValue(value);
    const existing = groups.get(key) ?? [];
    existing.push(value);
    groups.set(key, existing);
  }
  return groups;
}

function uniqueValues(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
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
