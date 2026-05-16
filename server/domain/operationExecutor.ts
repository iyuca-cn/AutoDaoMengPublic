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
  getCreditList(kind: keyof typeof CREDIT_LIST_URLS, activityId: string, creditId: string): Promise<unknown[]>;
  sendCredit(activityId: string, creditId: string, userIds: string[]): Promise<boolean>;
  abandonCredit(activityId: string, creditId: string, userScoreIds: string[]): Promise<boolean>;
  resign(activityId: string, signUpIds: string[], isAll?: boolean): Promise<boolean>;
}

export async function precheckOperationPlan(client: OperationExecutorClient, plan: OperationPlan): Promise<OperationPrecheckReport> {
  const issues: OperationPrecheckIssue[] = [];
  const normalizedActions = plan.actions.map((action) => normalizeActionActivity(plan, action));
  const enabledActions = normalizedActions.filter((action) => action.enabled);
  const creditedCache = new Map<string, Set<string>>();

  for (const [activityId, actions] of groupByActivity(enabledActions)) {
    const activityName = actions[0]?.activityName || plan.activityName;
    const signCard = await client.getSignCard(activityId);
    if (!signCard) {
      issues.push({
        level: "error",
        code: "NO_SIGN_CARD",
        message: `活动 ${activityName} 没有签到卡，不能执行操作计划`,
        activityId,
      });
    }

    const unsignedRows = (await client.getSignList(activityId, SIGN_TYPES.unsigned)).map((row) => normalizePerson(row));
    const signedRows = (await client.getSignList(activityId, SIGN_TYPES.signed)).map((row) => normalizePerson(row));
    const signoutRows = (await client.getSignList(activityId, SIGN_TYPES.signout)).map((row) => normalizePerson(row));
    const leaveRows = (await client.getSignList(activityId, SIGN_TYPES.leave)).map((row) => normalizePerson(row));
    const rowBySignUpId = new Map(
      [...unsignedRows, ...signedRows, ...signoutRows, ...leaveRows]
        .filter((row) => row.signUpId)
        .map((row) => [row.signUpId as string, row]),
    );
    const unsignedIds = new Set(unsignedRows.map((row) => row.signUpId).filter((id): id is string => Boolean(id)));

    for (const action of actions) {
      if (!action.signUpId) {
        issues.push(actionIssue(action, "error", "MISSING_SIGNUP_ID", `${action.studentName} 缺少 signUpId，不能执行写操作`));
        continue;
      }
      const currentPerson = rowBySignUpId.get(action.signUpId);
      if (!currentPerson) {
        issues.push(actionIssue(action, "warning", "SIGNUP_NOT_IN_SIGN_LIST", `${action.studentName} 不在当前签到名单中，将按计划报名 ID 尝试执行`));
      }
      if (isInvalidUserId(action.userId) && currentPerson?.userId && !isInvalidUserId(currentPerson.userId)) {
        action.userId = currentPerson.userId;
      }
      if ((action.kind === "resign" || action.kind === "resignThenIssueCredit") && !unsignedIds.has(action.signUpId)) {
        issues.push(actionIssue(action, "warning", "NOT_UNSIGNED", `${action.studentName} 当前不是未签到状态，补签会跳过`));
      }
      if (action.kind === "resign") {
        continue;
      }
      if (action.kind === "abandonCredit") {
        for (const item of action.creditItems) {
          const itemActivityId = item.activityId || action.activityId;
          const credited = await client.getCreditList("credited", itemActivityId, item.creditId);
          const creditedRow = findCreditedRow(credited, action);
          if (!creditedRow) {
            issues.push(actionIssue(action, "error", "NOT_CREDITED", `${action.studentName} 未发放 ${item.creditType}，不能撤销`, item.scoreId));
            continue;
          }
          const userScoreId = userScoreIdFromCreditedRow(creditedRow, action.signUpId);
          if (!userScoreId) {
            issues.push(actionIssue(action, "error", "MISSING_USER_SCORE_ID", `${action.studentName} 的 ${item.creditType} 缺少 userScoreId，不能撤销`, item.scoreId));
            continue;
          }
          item.userScoreId = userScoreId;
        }
        continue;
      }
      if (isInvalidUserId(action.userId)) {
        issues.push(actionIssue(action, "error", "MISSING_USER_ID", `${action.studentName} 缺少有效 userId，不能按用户 uid 发放学分`));
      }
      for (const item of action.creditItems) {
        const itemActivityId = item.activityId || action.activityId;
        if (item.remainingCapacity <= 0) {
          issues.push(actionIssue(action, "error", "NO_CREDIT_CAPACITY", `${item.creditType} 剩余容量不足`, item.scoreId));
        }
        const credited = await creditedIdentityKeys(client, creditedCache, itemActivityId, item.creditId);
        if (actionIdentityKeys(action).some((key) => credited.has(key))) {
          issues.push(actionIssue(action, "warning", "ALREADY_CREDITED", `${action.studentName} 已发放 ${item.creditType}，执行时会跳过`, item.scoreId));
        }
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
  let abandonSuccessCount = 0;
  let skippedAlreadyIssuedCount = 0;
  let failedCount = 0;

  for (const action of report.normalizedActions.filter((item) => item.enabled)) {
    const activityId = action.activityId || plan.activityId;
    if (action.kind === "abandonCredit") {
      for (const item of action.creditItems) {
      const itemActivityId = item.activityId || activityId;
      const credited = await client.getCreditList("credited", itemActivityId, item.creditId);
      const creditedRow = findCreditedRow(credited, action);
      const userScoreId = item.userScoreId || userScoreIdFromCreditedRow(creditedRow, action.signUpId);
        if (!userScoreId) {
          failedCount += 1;
          onEvent?.(`${action.studentName} 的 ${item.creditType} 缺少 userScoreId，跳过撤销`);
          continue;
        }
        const ok = await client.abandonCredit(itemActivityId, item.creditId, [userScoreId]);
        if (ok) {
          abandonSuccessCount += 1;
          onEvent?.(`已为 ${action.studentName} 撤销 ${item.creditType}`);
        } else {
          failedCount += 1;
        }
      }
      continue;
    }
    let canIssue = true;
    if (action.kind === "resign" || action.kind === "resignThenIssueCredit") {
      const unsigned = await client.getSignList(activityId, SIGN_TYPES.unsigned);
      const unsignedIds = new Set(unsigned.map((row) => getFirstString(row, ["signUpId", "signupId", "id"])));
      if (unsignedIds.has(action.signUpId)) {
        const ok = await client.resign(activityId, [action.signUpId], false);
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
    if (isInvalidUserId(action.userId)) {
      failedCount += action.creditItems.length;
      onEvent?.(`${action.studentName} 缺少有效 userId，跳过发放`);
      continue;
    }
    const userId = String(action.userId ?? "").trim();
    for (const item of action.creditItems) {
      const itemActivityId = item.activityId || activityId;
      const credited = await client.getCreditList("credited", itemActivityId, item.creditId);
      const creditedKeys = new Set(credited.flatMap(rowIdentityKeys));
      if (actionIdentityKeys(action).some((key) => creditedKeys.has(key))) {
        skippedAlreadyIssuedCount += 1;
        onEvent?.(`${action.studentName} 已发放 ${item.creditType}，跳过`);
        continue;
      }
      const ok = await client.sendCredit(itemActivityId, item.creditId, [userId]);
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
    abandonSuccessCount,
    skippedAlreadyIssuedCount,
    failedCount,
  };
}

function isInvalidUserId(value: unknown): boolean {
  const text = String(value ?? "").trim();
  return !text || /[\u4e00-\u9fff]/u.test(text);
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
  const issueCount = action.kind === "issueCredit" || action.kind === "resignThenIssueCredit" ? action.creditItems.length : 0;
  const abandonCount = action.kind === "abandonCredit" ? action.creditItems.length : 0;
  return resignCount + issueCount + abandonCount;
}

function normalizeActionActivity(plan: OperationPlan, action: OperationAction): OperationAction {
  const activityId = action.activityId || plan.activityId;
  const activityName = action.activityName || plan.activityName;
  return {
    ...action,
    activityId,
    activityName,
    creditItems: action.creditItems.map((item) => ({
      ...item,
      activityId: item.activityId || activityId,
      activityName: item.activityName || activityName,
    })),
  };
}

function groupByActivity(actions: OperationAction[]): Map<string, OperationAction[]> {
  const groups = new Map<string, OperationAction[]>();
  for (const action of actions) {
    const existing = groups.get(action.activityId) ?? [];
    existing.push(action);
    groups.set(action.activityId, existing);
  }
  return groups;
}

async function creditedIdentityKeys(client: OperationExecutorClient, cache: Map<string, Set<string>>, activityId: string, creditId: string): Promise<Set<string>> {
  const key = `${activityId}:${creditId}`;
  if (!cache.has(key)) {
    const rows = await client.getCreditList("credited", activityId, creditId);
    cache.set(key, new Set(rows.flatMap(rowIdentityKeys)));
  }
  return cache.get(key) ?? new Set();
}

function findCreditedRow(rows: unknown[], action: OperationAction): unknown | null {
  const keys = new Set(actionIdentityKeys(action));
  return rows.find((row) => rowIdentityKeys(row).some((key) => keys.has(key))) ?? null;
}

function userScoreIdFromCreditedRow(row: unknown | null | undefined, signUpId: string): string {
  const userScoreId = getFirstString(row, [
    "userScoreId",
    "userScoreID",
    "userScoreIds",
    "user_score_id",
    "user_score_ids",
    "scoreUserId",
    "userCreditId",
  ]);
  if (userScoreId) {
    return userScoreId;
  }
  const rawId = getFirstString(row, ["id"]);
  return rawId && rawId !== signUpId ? rawId : "";
}

function actionIdentityKeys(action: OperationAction): string[] {
  return uniqueStrings([
    action.signUpId ? `signup:${action.signUpId}` : "",
    action.userId ? `user:${action.userId}` : "",
    action.studentId ? `student:${action.studentId}` : "",
    action.studentId || action.studentName ? `student-name:${action.studentId ?? ""}:${action.studentName}` : "",
  ]);
}

function rowIdentityKeys(row: unknown): string[] {
  const signUpId = getFirstString(row, ["signUpId", "signupId", "signup_id", "joinId"]);
  const userId = getFirstString(row, ["userId", "uid", "user_id"]);
  const studentId = getFirstString(row, ["studentId", "studentNo", "stuNo", "schoolNo", "code", "no"]);
  const studentName = getFirstString(row, ["studentName", "stuName", "realName", "realname", "name", "username", "nickname", "userName"]);
  return uniqueStrings([
    signUpId ? `signup:${signUpId}` : "",
    userId ? `user:${userId}` : "",
    studentId ? `student:${studentId}` : "",
    studentId || studentName ? `student-name:${studentId}:${studentName}` : "",
  ]);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
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
    activityId: action.creditItems[0]?.activityId || action.activityId,
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
