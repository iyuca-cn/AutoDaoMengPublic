import {
  CREDIT_LIST_URLS,
  SIGN_TYPES,
  type ActivityPersonRow,
  type ExecutionSummary,
  type OperationAction,
  type OperationPlan,
  type OperationPrecheckIssue,
  type OperationPrecheckReport,
} from "./models";
import { buildOperationPlanSummary } from "./operationPlans";

export interface OperationExecutorClient {
  getSignCard(activityId: string): Promise<string | null>;
  getSignList(activityId: string, type: number): Promise<unknown[]>;
  getCreditList(kind: keyof typeof CREDIT_LIST_URLS, activityId: string, scoreId: string): Promise<unknown[]>;
  sendCredit(activityId: string, scoreId: string, userIds: string[]): Promise<boolean>;
  resign(activityId: string, signUpIds: string[], isAll?: boolean): Promise<boolean>;
}

export async function precheckOperationPlan(client: OperationExecutorClient, plan: OperationPlan): Promise<OperationPrecheckReport> {
  const issues: OperationPrecheckIssue[] = [];
  const normalizedActions = plan.actions.map((action) => ({ ...action }));
  const enabledActions = normalizedActions.filter((action) => action.enabled);
  const signCard = await client.getSignCard(plan.activityId);
  if (!signCard) {
    issues.push({
      level: "error",
      code: "NO_SIGN_CARD",
      message: `活动 ${plan.activityName} 没有签到卡，不能执行操作计划`,
      activityId: plan.activityId,
    });
  }

  const unsignedRows = (await client.getSignList(plan.activityId, SIGN_TYPES.unsigned)).map((row) => normalizePerson(row));
  const signedRows = (await client.getSignList(plan.activityId, SIGN_TYPES.signed)).map((row) => normalizePerson(row));
  const rowBySignUpId = new Map([...unsignedRows, ...signedRows].filter((row) => row.signUpId).map((row) => [row.signUpId as string, row]));
  const unsignedIds = new Set(unsignedRows.map((row) => row.signUpId).filter((id): id is string => Boolean(id)));
  const creditedCache = new Map<string, Set<string>>();

  for (const action of enabledActions) {
    if (!action.signUpId) {
      issues.push(actionIssue(action, "error", "MISSING_SIGNUP_ID", `${action.studentName} 缺少 signUpId，不能执行写操作`));
      continue;
    }
    const currentPerson = rowBySignUpId.get(action.signUpId);
    if (!currentPerson) {
      issues.push(actionIssue(action, "warning", "SIGNUP_NOT_IN_SIGN_LIST", `${action.studentName} 不在当前签到名单中，将按计划报名 ID 尝试执行`));
    }
    if (!action.userId && currentPerson?.userId) {
      action.userId = currentPerson.userId;
    }
    if ((action.kind === "resign" || action.kind === "resignThenIssueCredit") && !unsignedIds.has(action.signUpId)) {
      issues.push(actionIssue(action, "warning", "NOT_UNSIGNED", `${action.studentName} 当前不是未签到状态，补签会跳过`));
    }
    if (action.kind === "resign") {
      continue;
    }
    if (!action.userId) {
      issues.push(actionIssue(action, "error", "MISSING_USER_ID", `${action.studentName} 缺少 userId，不能按 userId 发放学分`));
    }
    for (const item of action.creditItems) {
      if (item.remainingCapacity <= 0) {
        issues.push(actionIssue(action, "error", "NO_CREDIT_CAPACITY", `${item.creditType} 剩余容量不足`, item.scoreId));
      }
      const credited = await creditedSignUpIds(client, creditedCache, plan.activityId, item.scoreId);
      if (credited.has(action.signUpId)) {
        issues.push(actionIssue(action, "warning", "ALREADY_CREDITED", `${action.studentName} 已发放 ${item.creditType}，执行时会跳过`, item.scoreId));
      }
    }
  }

  return {
    planId: plan.id,
    executable: !issues.some((issue) => issue.level === "error"),
    issues,
    actionCount: enabledActions.reduce((sum, action) => sum + actionCount(action), 0),
    normalizedActions,
  };
}

export async function executeOperationPlan(client: OperationExecutorClient, plan: OperationPlan, onEvent?: (message: string) => void): Promise<ExecutionSummary> {
  const report = await precheckOperationPlan(client, plan);
  if (!report.executable) {
    throw new Error("操作计划预检未通过");
  }
  let resignSuccessCount = 0;
  let issueSuccessCount = 0;
  let skippedAlreadyIssuedCount = 0;
  let failedCount = 0;

  for (const action of report.normalizedActions.filter((item) => item.enabled)) {
    let canIssue = true;
    if (action.kind === "resign" || action.kind === "resignThenIssueCredit") {
      const unsigned = await client.getSignList(plan.activityId, SIGN_TYPES.unsigned);
      const unsignedIds = new Set(unsigned.map((row) => getFirstString(row, ["signUpId", "signupId", "id"])));
      if (unsignedIds.has(action.signUpId)) {
        const ok = await client.resign(plan.activityId, [action.signUpId], false);
        if (ok) {
          resignSuccessCount += 1;
          onEvent?.(`已为 ${action.studentName} 补签`);
        } else {
          failedCount += 1;
          canIssue = false;
        }
      }
    }
    if (action.kind === "resign" || !canIssue) {
      continue;
    }
    if (!action.userId) {
      failedCount += action.creditItems.length;
      onEvent?.(`${action.studentName} 缺少 userId，跳过发放`);
      continue;
    }
    for (const item of action.creditItems) {
      const credited = await client.getCreditList("credited", plan.activityId, item.scoreId);
      const creditedSignUpIds = new Set(credited.map((row) => getFirstString(row, ["signUpId", "signupId", "id"])));
      if (creditedSignUpIds.has(action.signUpId)) {
        skippedAlreadyIssuedCount += 1;
        onEvent?.(`${action.studentName} 已发放 ${item.creditType}，跳过`);
        continue;
      }
      const ok = await client.sendCredit(plan.activityId, item.scoreId, [action.userId]);
      if (ok) {
        issueSuccessCount += 1;
        onEvent?.(`已为 ${action.studentName} 发放 ${item.creditType}`);
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

export function applyPrecheck(plan: OperationPlan, report: OperationPrecheckReport): OperationPlan {
  const status = report.executable ? "ready" : plan.status;
  return {
    ...plan,
    precheck: report,
    actions: report.normalizedActions,
    summary: buildOperationPlanSummary(report.normalizedActions),
    status,
    updatedAt: new Date().toISOString(),
  };
}

function actionCount(action: OperationAction): number {
  const resignCount = action.kind === "resign" || action.kind === "resignThenIssueCredit" ? 1 : 0;
  const issueCount = action.kind === "resign" ? 0 : action.creditItems.length;
  return resignCount + issueCount;
}

async function creditedSignUpIds(client: OperationExecutorClient, cache: Map<string, Set<string>>, activityId: string, scoreId: string): Promise<Set<string>> {
  const key = `${activityId}:${scoreId}`;
  if (!cache.has(key)) {
    const rows = await client.getCreditList("credited", activityId, scoreId);
    cache.set(key, new Set(rows.map((row) => getFirstString(row, ["signUpId", "signupId", "id"])).filter(Boolean)));
  }
  return cache.get(key) ?? new Set();
}

function normalizePerson(value: unknown): ActivityPersonRow {
  return {
    signUpId: getFirstString(value, ["signUpId", "signupId", "id"]) || undefined,
    userId: getFirstString(value, ["userId", "uid"]) || undefined,
    studentId: getFirstString(value, ["studentId", "studentNo", "stuNo"]) || undefined,
    studentName: getFirstString(value, ["studentName", "realName", "name", "username"]) || "未知姓名",
  };
}

function actionIssue(action: OperationAction, level: "error" | "warning", code: string, message: string, scoreId?: string): OperationPrecheckIssue {
  return {
    level,
    code,
    message,
    actionId: action.id,
    activityId: action.creditItems[0]?.activityId,
    studentId: action.studentId,
    signUpId: action.signUpId,
    scoreId,
  };
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
