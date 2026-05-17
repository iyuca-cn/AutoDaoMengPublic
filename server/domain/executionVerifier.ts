import { CREDIT_LIST_URLS, SIGN_TYPES, type ExecutionDetail, type ExecutionSummary } from "./models";

export interface ExecutionVerifierClient {
  getSignList(activityId: string, type: number): Promise<unknown[]>;
  getCreditList(kind: keyof typeof CREDIT_LIST_URLS, activityId: string, creditId: string): Promise<unknown[]>;
}

export async function verifyExecutionDetails(
  client: ExecutionVerifierClient,
  details: ExecutionDetail[],
  onEvent?: (message: string) => void,
): Promise<ExecutionDetail[]> {
  const verified = await verifyIssueCreditDetails(client, details, onEvent);
  return verifyResignDetails(client, verified, onEvent);
}

export function summarizeExecutionDetails(details: ExecutionDetail[]): ExecutionSummary {
  return {
    resignSuccessCount: details.filter((detail) => detail.action === "resign" && detail.status === "success").length,
    issueSuccessCount: details.filter((detail) => detail.action === "issueCredit" && detail.status === "success").length,
    abandonSuccessCount: details.filter((detail) => detail.action === "abandonCredit" && detail.status === "success").length,
    skippedAlreadyIssuedCount: details.filter((detail) => detail.action === "issueCredit" && detail.status === "skipped").length,
    failedCount: details.filter((detail) => detail.status === "failed").length,
    details,
  };
}

async function verifyIssueCreditDetails(
  client: ExecutionVerifierClient,
  details: ExecutionDetail[],
  onEvent?: (message: string) => void,
): Promise<ExecutionDetail[]> {
  const next = [...details];
  const issueIndexesByKey = groupDetailIndexes(
    next,
    (detail) => detail.action === "issueCredit" && (detail.status === "success" || detail.status === "skipped"),
    (detail) => detail.creditId ? `${detail.activityId}:${detail.creditId}` : "",
  );
  const abandonIndexesByKey = groupDetailIndexes(
    next,
    (detail) => detail.action === "abandonCredit" && detail.status === "success",
    (detail) => detail.creditId ? `${detail.activityId}:${detail.creditId}` : "",
  );

  for (const [key, indexes] of issueIndexesByKey) {
    const [activityId, creditId] = key.split(":");
    try {
      const creditedRows = await client.getCreditList("credited", activityId, creditId);
      const creditedKeys = new Set(creditedRows.flatMap(rowIdentityKeys));
      for (const index of indexes) {
        const detail = next[index];
        const identityKeys = executionIdentityKeys(detail);
        if (identityKeys.length > 0 && identityKeys.some((identityKey) => creditedKeys.has(identityKey))) {
          continue;
        }
        next[index] = verificationFailed(detail, "执行后校验未在已发名单中找到该学分记录");
      }
      onEvent?.(`已校验活动 ${activityId} 的学分项 ${creditId} 发放结果`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      for (const index of indexes) {
        next[index] = verificationFailed(next[index], `执行后校验读取已发名单失败：${reason}`);
      }
      onEvent?.(`活动 ${activityId} 的学分项 ${creditId} 执行后校验失败：${reason}`);
    }
  }

  for (const [key, indexes] of abandonIndexesByKey) {
    const [activityId, creditId] = key.split(":");
    try {
      const creditedRows = await client.getCreditList("credited", activityId, creditId);
      const creditedKeys = new Set(creditedRows.flatMap(rowIdentityKeys));
      for (const index of indexes) {
        const detail = next[index];
        const identityKeys = executionIdentityKeys(detail);
        if (identityKeys.length > 0 && !identityKeys.some((identityKey) => creditedKeys.has(identityKey))) {
          continue;
        }
        next[index] = verificationFailed(detail, "执行后校验仍在已发名单中找到该学分记录");
      }
      onEvent?.(`已校验活动 ${activityId} 的学分项 ${creditId} 撤销结果`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      for (const index of indexes) {
        next[index] = verificationFailed(next[index], `执行后校验读取已发名单失败：${reason}`);
      }
      onEvent?.(`活动 ${activityId} 的学分项 ${creditId} 执行后校验失败：${reason}`);
    }
  }

  return next;
}

async function verifyResignDetails(
  client: ExecutionVerifierClient,
  details: ExecutionDetail[],
  onEvent?: (message: string) => void,
): Promise<ExecutionDetail[]> {
  const next = [...details];
  const resignIndexesByActivity = groupDetailIndexes(
    next,
    (detail) => detail.action === "resign" && detail.status === "success",
    (detail) => detail.activityId,
  );
  for (const [activityId, indexes] of resignIndexesByActivity) {
    try {
      const rows = (await Promise.all([
        client.getSignList(activityId, SIGN_TYPES.signed),
        client.getSignList(activityId, SIGN_TYPES.signout),
        client.getSignList(activityId, SIGN_TYPES.leave),
      ])).flat();
      const signedKeys = new Set(rows.flatMap(rowIdentityKeys));
      for (const index of indexes) {
        const detail = next[index];
        const identityKeys = executionIdentityKeys(detail);
        if (identityKeys.length > 0 && identityKeys.some((identityKey) => signedKeys.has(identityKey))) {
          continue;
        }
        next[index] = verificationFailed(detail, "执行后校验未在已签到名单中找到该报名记录");
      }
      onEvent?.(`已校验活动 ${activityId} 的补签结果`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      for (const index of indexes) {
        next[index] = verificationFailed(next[index], `执行后校验读取签到名单失败：${reason}`);
      }
      onEvent?.(`活动 ${activityId} 的补签执行后校验失败：${reason}`);
    }
  }
  return next;
}

function groupDetailIndexes(
  details: ExecutionDetail[],
  predicate: (detail: ExecutionDetail) => boolean,
  keyFromDetail: (detail: ExecutionDetail) => string,
): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  details.forEach((detail, index) => {
    if (!predicate(detail)) {
      return;
    }
    const key = keyFromDetail(detail);
    if (!key) {
      groups.set(`missing-key:${index}`, [index]);
      return;
    }
    const existing = groups.get(key) ?? [];
    existing.push(index);
    groups.set(key, existing);
  });
  return groups;
}

function verificationFailed(detail: ExecutionDetail, reason: string): ExecutionDetail {
  const identity = [
    `活动ID ${detail.activityId}`,
    detail.userId ? `用户ID ${detail.userId}` : "",
    detail.signUpId ? `报名ID ${detail.signUpId}` : "",
    detail.creditId ? `活动可发学分ID ${detail.creditId}` : "",
  ].filter(Boolean).join("；");
  return {
    ...detail,
    status: "failed",
    actualValueCent: 0,
    message: `${detail.message}；${reason}${identity ? `；${identity}` : ""}`,
  };
}

function executionIdentityKeys(detail: ExecutionDetail): string[] {
  return uniqueStrings([
    detail.signUpId ? `signup:${detail.signUpId}` : "",
    detail.userId ? `user:${detail.userId}` : "",
    detail.studentId ? `student:${detail.studentId}` : "",
    detail.studentId || detail.studentName ? `student-name:${detail.studentId ?? ""}:${detail.studentName}` : "",
  ]);
}

function rowIdentityKeys(row: unknown): string[] {
  const signUpId = getFirstString(row, ["signUpId", "signupId", "signup_id", "joinId", "id"]);
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

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
