import {
  CREDIT_LIST_URLS,
  SIGN_TYPES,
  type ExecutionDetail,
  type ActivityPersonRow,
  type ExecutionSummary,
  type OperationAction,
  type OperationPlan,
  type OperationPrecheckIssue,
  type OperationPrecheckReport,
} from "./models";
import { summarizeExecutionDetails, verifyExecutionDetails } from "./executionVerifier";
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
  const details: ExecutionDetail[] = [];
  const enabledActions = report.normalizedActions.filter((item) => item.enabled);
  const blockedIssueActionIds = new Set<string>();

  for (const action of enabledActions.filter((item) => item.kind === "abandonCredit")) {
    const activityId = action.activityId || plan.activityId;
    if (action.kind === "abandonCredit") {
      for (const item of action.creditItems) {
      const itemActivityId = item.activityId || activityId;
      const credited = await client.getCreditList("credited", itemActivityId, item.creditId);
      const creditedRow = findCreditedRow(credited, action);
        const userScoreId = item.userScoreId || userScoreIdFromCreditedRow(creditedRow, action.signUpId);
        if (!userScoreId) {
          failedCount += 1;
          const message = `${action.studentName} 的 ${item.creditType} 缺少 userScoreId，跳过撤销`;
          details.push(detailFromAction(action, "abandonCredit", "failed", item.unitcountCent, 0, message, item));
          onEvent?.(message);
          continue;
        }
        const ok = await client.abandonCredit(itemActivityId, item.creditId, [userScoreId]);
        if (ok) {
          abandonSuccessCount += 1;
          const message = `已为 ${action.studentName} 撤销 ${item.creditType}`;
          details.push(detailFromAction(action, "abandonCredit", "success", item.unitcountCent, item.unitcountCent, message, item));
          onEvent?.(message);
        } else {
          failedCount += 1;
          details.push(detailFromAction(action, "abandonCredit", "failed", item.unitcountCent, 0, `${action.studentName} 撤销 ${item.creditType} 失败`, item));
        }
      }
      continue;
    }
  }

  const resignActions = enabledActions.filter((action) => action.kind === "resign" || action.kind === "resignThenIssueCredit");
  for (const [activityId, actions] of groupByActivity(resignActions)) {
    let unsigned: unknown[];
    try {
      unsigned = await client.getSignList(activityId, SIGN_TYPES.unsigned);
    } catch (error) {
      failedCount += actions.reduce((sum, action) => sum + (action.kind === "resign" ? 1 : 1 + action.creditItems.length), 0);
      const reason = error instanceof Error ? error.message : String(error);
      for (const action of actions) {
        blockedIssueActionIds.add(action.id);
        details.push(detailFromAction(action, "resign", "failed", 0, 0, `${action.studentName} 读取未签到名单失败：${reason}`));
        if (action.kind === "resignThenIssueCredit") {
          for (const item of action.creditItems) {
            details.push(detailFromAction(action, "issueCredit", "failed", item.unitcountCent, 0, `${action.studentName} 补签状态未确认，跳过发放：${reason}`, item));
          }
        }
      }
      onEvent?.(`${actions[0]?.activityName || plan.activityName} 读取未签到名单失败：${reason}`);
      continue;
    }
    const unsignedIds = new Set(unsigned.map((row) => getFirstString(row, ["signUpId", "signupId", "id"])));
    const targets = actions.filter((action) => unsignedIds.has(action.signUpId));
    if (targets.length === 0) {
      continue;
    }
    const signUpIds = uniqueStrings(targets.map((action) => action.signUpId));
    const activityName = targets[0]?.activityName || plan.activityName;
    onEvent?.(`开始为 ${activityName} 批量补签 ${targets.length} 人`);
    try {
      const ok = await client.resign(activityId, signUpIds, false);
      if (!ok) {
        throw new Error("代理返回补签失败");
      }
      resignSuccessCount += targets.length;
      for (const action of targets) {
        const message = `已为 ${action.studentName} 补签`;
        details.push(detailFromAction(action, "resign", "success", 0, 0, message));
      }
      onEvent?.(`已为 ${activityName} 批量补签 ${targets.length} 人`);
    } catch (error) {
      failedCount += targets.length;
      const reason = error instanceof Error ? error.message : String(error);
      for (const action of targets) {
        blockedIssueActionIds.add(action.id);
        details.push(detailFromAction(action, "resign", "failed", 0, 0, `${action.studentName} 补签失败：${reason}`));
      }
      onEvent?.(`${activityName} 批量补签失败：${reason}`);
    }
  }

  const issueActions = enabledActions.filter((action) => (
    action.kind === "issueCredit" || action.kind === "resignThenIssueCredit"
  ) && !blockedIssueActionIds.has(action.id));
  for (const action of issueActions) {
    const activityId = action.activityId || plan.activityId;
    if (isInvalidUserId(action.userId)) {
      failedCount += action.creditItems.length;
      const message = `${action.studentName} 缺少有效 userId，跳过发放`;
      for (const item of action.creditItems) {
        details.push(detailFromAction(action, "issueCredit", "failed", item.unitcountCent, 0, message, item));
      }
      onEvent?.(message);
      continue;
    }
  }

  const issueEntries = issueActions
    .filter((action) => !isInvalidUserId(action.userId))
    .flatMap((action) => action.creditItems.map((item) => ({
      action,
      item,
      activityId: item.activityId || action.activityId || plan.activityId,
      userId: String(action.userId ?? "").trim(),
    })));
  const issueBatches = groupBy(issueEntries, (entry) => `${entry.activityId}:${entry.item.creditId}`);
  for (const [, batch] of issueBatches) {
    const first = batch[0];
    let credited: unknown[];
    try {
      credited = await client.getCreditList("credited", first.activityId, first.item.creditId);
    } catch (error) {
      failedCount += batch.length;
      const reason = error instanceof Error ? error.message : String(error);
      for (const { action, item } of batch) {
        details.push(detailFromAction(action, "issueCredit", "failed", item.unitcountCent, 0, `${action.studentName} 读取已发名单失败：${reason}`, item));
      }
      onEvent?.(`${first.item.activityName || first.action.activityName} 读取 ${first.item.creditType} 已发名单失败：${reason}`);
      continue;
    }
    const creditedKeys = new Set(credited.flatMap(rowIdentityKeys));
    const pending = batch.filter(({ action }) => !actionIdentityKeys(action).some((key) => creditedKeys.has(key)));
    const skipped = batch.filter(({ action }) => actionIdentityKeys(action).some((key) => creditedKeys.has(key)));
    skippedAlreadyIssuedCount += skipped.length;
    for (const { action, item } of skipped) {
      const message = `${action.studentName} 已发放 ${item.creditType}，跳过`;
      details.push(detailFromAction(action, "issueCredit", "skipped", item.unitcountCent, 0, message, item));
    }
    if (pending.length === 0) {
      continue;
    }
    const userIds = uniqueStrings(pending.map((entry) => entry.userId));
    const activityName = first.item.activityName || first.action.activityName;
    onEvent?.(`开始为 ${activityName} 发放 ${first.item.creditType} ${pending.length} 人`);
    try {
      const ok = await client.sendCredit(first.activityId, first.item.creditId, userIds);
      if (!ok) {
        throw new Error("代理返回发放失败");
      }
      issueSuccessCount += pending.length;
      for (const { action, item } of pending) {
        const message = `已为 ${action.studentName} 发放 ${item.creditType}`;
        details.push(detailFromAction(action, "issueCredit", "success", item.unitcountCent, item.unitcountCent, message, item));
      }
      onEvent?.(`已为 ${activityName} 发放 ${first.item.creditType} ${pending.length} 人`);
    } catch (error) {
      failedCount += pending.length;
      const reason = error instanceof Error ? error.message : String(error);
      for (const { action, item } of pending) {
        details.push(detailFromAction(action, "issueCredit", "failed", item.unitcountCent, 0, `${action.studentName} 发放 ${item.creditType} 失败：${reason}`, item));
      }
      onEvent?.(`${activityName} 发放 ${first.item.creditType} 失败：${reason}`);
    }
  }

  onEvent?.("开始执行后校验");
  const verifiedDetails = await verifyExecutionDetails(client, details, onEvent);
  return summarizeExecutionDetails(verifiedDetails);
}

function detailFromAction(
  action: OperationAction,
  detailAction: ExecutionDetail["action"],
  status: ExecutionDetail["status"],
  plannedValueCent: number,
  actualValueCent: number,
  message: string,
  creditItem?: OperationAction["creditItems"][number],
): ExecutionDetail {
  return {
    studentId: action.studentId,
    studentName: action.studentName,
    activityId: creditItem?.activityId || action.activityId,
    activityName: creditItem?.activityName || action.activityName,
    signUpId: action.signUpId,
    userId: action.userId,
    creditId: creditItem?.creditId,
    scoreId: creditItem?.scoreId,
    creditType: creditItem?.creditType,
    plannedValueCent,
    actualValueCent,
    action: detailAction,
    status,
    message,
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
