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
  getCreditList(kind: keyof typeof CREDIT_LIST_URLS, activityId: string, creditId: string): Promise<unknown[]>;
}

export interface ActivityOverviewItem {
  activityId: string;
  activityName: string;
  hasSignCard: boolean;
  readError?: string;
  signCounts: Record<keyof typeof SIGN_TYPES, number>;
  creditItems: CreditItem[];
  creditedCounts: Record<string, number>;
}

export async function buildActivityBundles(client: CatalogClient, retryAttempts = 3): Promise<ActivityBundle[]> {
  const activities = await retry(() => client.getManagedActivities(), retryAttempts, "读取可管理活动失败");
  const bundles: ActivityBundle[] = [];

  for (const [activityId, rawActivity] of Object.entries(activities)) {
    const normalizedActivityId = getString(rawActivity, "activityId") || activityId;
    const signCard = await retry(() => client.getSignCard(normalizedActivityId), retryAttempts, `活动 ${normalizedActivityId} 未能读取签到卡`, {
      rejectEmpty: false,
    });
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
  return Promise.all(
    Object.entries(activities).map(([activityId, rawActivity]) =>
      buildActivityOverviewItem(client, activityId, rawActivity, retryAttempts),
    ),
  );
}

async function buildActivityOverviewItem(
  client: CatalogClient,
  activityId: string,
  rawActivity: unknown,
  retryAttempts: number,
): Promise<ActivityOverviewItem> {
  const normalizedActivityId = getString(rawActivity, "activityId") || activityId;
  const activityName = getString(rawActivity, "name") || `活动 ${normalizedActivityId}`;
  try {
    const signCard = await retry(() => client.getSignCard(normalizedActivityId), retryAttempts, `活动 ${normalizedActivityId} 未能读取签到卡`, {
      rejectEmpty: false,
    });
    if (!signCard) {
      return emptyOverviewItem(normalizedActivityId, activityName, false);
    }
    const creditItems = (await retry(() => client.getCreditTypes(normalizedActivityId), retryAttempts, `活动 ${normalizedActivityId} 未能读取学分项`))
      .map(creditItemFromRow)
      .filter((item): item is CreditItem => Boolean(item));
    const [unsigned, signed, signout, leave] = await Promise.all([
      listCount(() => client.getSignList(normalizedActivityId, SIGN_TYPES.unsigned)),
      listCount(() => client.getSignList(normalizedActivityId, SIGN_TYPES.signed)),
      listCount(() => client.getSignList(normalizedActivityId, SIGN_TYPES.signout)),
      listCount(() => client.getSignList(normalizedActivityId, SIGN_TYPES.leave)),
    ]);
    const creditedEntries = await Promise.all(
      creditItems.map(async (item) => [
        item.scoreId,
        await listCount(() => client.getCreditList("credited", normalizedActivityId, item.creditId)),
      ] as const),
    );
    return {
      activityId: normalizedActivityId,
      activityName,
      hasSignCard: true,
      signCounts: { unsigned, signed, signout, leave },
      creditItems,
      creditedCounts: Object.fromEntries(creditedEntries),
    };
  } catch (error) {
    return {
      ...emptyOverviewItem(normalizedActivityId, activityName, false),
      readError: `活动 ${normalizedActivityId} 读取失败：${errorMessage(error)}`,
    };
  }
}

function emptyOverviewItem(activityId: string, activityName: string, hasSignCard: boolean): ActivityOverviewItem {
  return {
    activityId,
    activityName,
    hasSignCard,
    signCounts: {
      unsigned: 0,
      signed: 0,
      signout: 0,
      leave: 0,
    },
    creditItems: [],
    creditedCounts: {},
  };
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

async function retry<T>(fn: () => Promise<T>, attempts: number, message: string, options: { rejectEmpty?: boolean } = {}): Promise<T> {
  let lastError: unknown;
  for (let index = 0; index < Math.max(1, attempts); index += 1) {
    try {
      const result = await fn();
      if (options.rejectEmpty !== false && (result === null || result === undefined)) {
        throw new Error(message);
      }
      return result;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
