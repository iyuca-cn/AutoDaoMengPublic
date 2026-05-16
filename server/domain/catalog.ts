import {
  CREDIT_LIST_URLS,
  type ActivityBundle,
  type CreditItem,
  SIGN_TYPES,
  validateCreditType,
  parseCreditValueToCent,
} from "./models";

export interface CatalogClient {
  getManagedActivities(): Promise<Record<string, unknown>>;
  getSignCard(activityId: string): Promise<string | null>;
  getCreditTypes(activityId: string): Promise<unknown[]>;
  getSignList(activityId: string, type: number): Promise<unknown[]>;
  getCreditList(kind: keyof typeof CREDIT_LIST_URLS, activityId: string, scoreId: string): Promise<unknown[]>;
}

export interface ActivityOverviewItem {
  activityId: string;
  activityName: string;
  hasSignCard: boolean;
  signCounts: Record<keyof typeof SIGN_TYPES, number>;
  creditItems: CreditItem[];
  creditedCounts: Record<string, number>;
}

export async function buildActivityBundles(client: CatalogClient, retryAttempts = 3): Promise<ActivityBundle[]> {
  const activities = await retry(() => client.getManagedActivities(), retryAttempts, "读取可管理活动失败");
  const bundles: ActivityBundle[] = [];

  for (const [activityId, rawActivity] of Object.entries(activities)) {
    const normalizedActivityId = getString(rawActivity, "activityId") || activityId;
    const signCard = await retry(() => client.getSignCard(normalizedActivityId), retryAttempts, `活动 ${normalizedActivityId} 未能读取签到卡`);
    if (!signCard) {
      continue;
    }
    const rows = await retry(() => client.getCreditTypes(normalizedActivityId), retryAttempts, `活动 ${normalizedActivityId} 未能读取学分项`);
    for (const row of rows) {
      const item = creditItemFromRow(row);
      if (!item) {
        continue;
      }
      bundles.push({
        activityId: normalizedActivityId,
        activityName: getString(rawActivity, "name") || `活动 ${normalizedActivityId}`,
        creditType: item.creditType,
        bundleValueCent: item.unitcountCent,
        bundleCapacity: item.remainingCapacity,
        creditItems: [item],
      });
    }
  }
  return bundles;
}

export async function buildActivityOverview(client: CatalogClient, retryAttempts = 2): Promise<ActivityOverviewItem[]> {
  const activities = await retry(() => client.getManagedActivities(), retryAttempts, "读取可管理活动失败");
  const overview: ActivityOverviewItem[] = [];
  for (const [activityId, rawActivity] of Object.entries(activities)) {
    const normalizedActivityId = getString(rawActivity, "activityId") || activityId;
    const hasSignCard = Boolean(await retry(() => client.getSignCard(normalizedActivityId), retryAttempts, `活动 ${normalizedActivityId} 未能读取签到卡`));
    const creditItems = (await retry(() => client.getCreditTypes(normalizedActivityId), retryAttempts, `活动 ${normalizedActivityId} 未能读取学分项`))
      .map(creditItemFromRow)
      .filter((item): item is CreditItem => Boolean(item));
    const signCounts = {
      unsigned: await listCount(() => client.getSignList(normalizedActivityId, SIGN_TYPES.unsigned)),
      signed: await listCount(() => client.getSignList(normalizedActivityId, SIGN_TYPES.signed)),
      signout: await listCount(() => client.getSignList(normalizedActivityId, SIGN_TYPES.signout)),
      leave: await listCount(() => client.getSignList(normalizedActivityId, SIGN_TYPES.leave)),
    };
    const creditedCounts: Record<string, number> = {};
    for (const item of creditItems) {
      creditedCounts[item.creditId] = await listCount(() => client.getCreditList("credited", normalizedActivityId, item.scoreId));
    }
    overview.push({
      activityId: normalizedActivityId,
      activityName: getString(rawActivity, "name") || `活动 ${normalizedActivityId}`,
      hasSignCard,
      signCounts,
      creditItems,
      creditedCounts,
    });
  }
  return overview;
}

function creditItemFromRow(row: unknown): CreditItem | null {
  const creditTypeText = getString(row, "scorename");
  try {
    const creditType = validateCreditType(creditTypeText);
    const num = Number(getString(row, "num") || 0);
    const providenum = Number(getString(row, "providenum") || 0);
    return {
      creditId: getString(row, "creditId"),
      scoreId: getString(row, "scoreId"),
      creditType,
      unitcountCent: parseCreditValueToCent(getString(row, "unitcount")),
      remainingCapacity: Math.max(0, num - providenum),
    };
  } catch {
    return null;
  }
}

async function retry<T>(fn: () => Promise<T>, attempts: number, message: string): Promise<T> {
  let lastError: unknown;
  for (let index = 0; index < Math.max(1, attempts); index += 1) {
    try {
      const result = await fn();
      if (result === null || result === undefined) {
        throw new Error(message);
      }
      return result;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(message);
}

async function listCount(fn: () => Promise<unknown[]>): Promise<number> {
  try {
    const value = await fn();
    return Array.isArray(value) ? value.length : 0;
  } catch {
    return 0;
  }
}

function getString(value: unknown, key: string): string {
  if (typeof value !== "object" || value === null) {
    return "";
  }
  const record = value as Record<string, unknown>;
  const raw = record[key];
  return raw === undefined || raw === null ? "" : String(raw);
}
