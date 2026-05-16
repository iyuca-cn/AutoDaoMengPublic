import * as XLSX from "xlsx";
import {
  CREDIT_LIST_URLS,
  EXPORT_TYPES,
  SIGN_TYPES,
  type ActivityCreditItem,
  type ActivityCreditLists,
  type ActivityDetail,
  type ActivityPersonRow,
  type CreditItem,
  type MemberListKey,
  type SignListKey,
  normalizeText,
  parseCreditValueToCent,
  validateCreditType,
} from "./models";

export interface ActivityDetailClient {
  getManagedActivities(): Promise<Record<string, unknown>>;
  getSignCard(activityId: string): Promise<string | null>;
  getSignList(activityId: string, type: number): Promise<unknown[]>;
  getCreditTypes(activityId: string): Promise<unknown[]>;
  getCreditList(kind: keyof typeof CREDIT_LIST_URLS, activityId: string, scoreId: string): Promise<unknown[]>;
  exportMembers(activityId: string, type: number): Promise<ArrayBuffer>;
}

const SIGN_LISTS: Array<[SignListKey, number]> = [
  ["unsigned", SIGN_TYPES.unsigned],
  ["signed", SIGN_TYPES.signed],
  ["signout", SIGN_TYPES.signout],
  ["leave", SIGN_TYPES.leave],
];

const MEMBER_LISTS: Array<[MemberListKey, number]> = [
  ["register", EXPORT_TYPES.register],
  ["admit", EXPORT_TYPES.admit],
  ["leave", EXPORT_TYPES.leave],
];

export async function buildActivityDetail(client: ActivityDetailClient, activityId: string): Promise<ActivityDetail> {
  const activities = await client.getManagedActivities();
  const activity = findActivity(activities, activityId);
  if (!activity) {
    throw new Error(`活动不存在：${activityId}`);
  }
  const normalizedActivityId = getFirstString(activity.raw, ["activityId", "id"]) || activity.id;
  const activityName = getFirstString(activity.raw, ["name", "activityName", "title"]) || `活动 ${normalizedActivityId}`;
  const signCard = await client.getSignCard(normalizedActivityId);
  const signLists = await buildSignLists(client, normalizedActivityId);
  const memberLists = await buildMemberLists(client, normalizedActivityId);
  const creditItems = (await client.getCreditTypes(normalizedActivityId))
    .map((row) => activityCreditItemFromRow(row))
    .filter((item): item is ActivityCreditItem => Boolean(item));
  const creditListsByScoreId: Record<string, ActivityCreditLists> = {};
  for (const item of creditItems) {
    const candidates = (await client.getCreditList("candidates", normalizedActivityId, item.scoreId)).map((row) => normalizePerson(row, { source: "credit.candidates" }));
    const other = (await client.getCreditList("other", normalizedActivityId, item.scoreId)).map((row) => normalizePerson(row, { source: "credit.other" }));
    const credited = (await client.getCreditList("credited", normalizedActivityId, item.scoreId)).map((row) => normalizePerson(row, { source: "credit.credited" }));
    const creditedKeys = new Set(credited.map(personIdentityKey).filter(Boolean));
    const notSent = uniquePeople([...candidates, ...other].filter((person) => !creditedKeys.has(personIdentityKey(person))));
    creditListsByScoreId[item.scoreId] = {
      candidates: uniquePeople(candidates),
      other: uniquePeople(other),
      credited: uniquePeople(credited),
      notSent,
    };
  }
  return {
    activityId: normalizedActivityId,
    activityName,
    hasSignCard: Boolean(signCard),
    signLists,
    memberLists,
    creditItems,
    creditListsByScoreId,
  };
}

export function activityCreditItemFromRow(row: unknown): ActivityCreditItem | null {
  const creditTypeText = getFirstString(row, ["scorename", "scoreName", "creditType", "name"]);
  try {
    const creditType = validateCreditType(creditTypeText);
    const totalCapacity = Number(getFirstString(row, ["num", "total", "totalNum", "capacity"]) || 0);
    const issuedCount = Number(getFirstString(row, ["providenum", "provideNum", "issued", "sentNum"]) || 0);
    return {
      creditId: getFirstString(row, ["creditId", "credit_id", "id"]),
      scoreId: getFirstString(row, ["scoreId", "score_id"]),
      creditType,
      unitcountCent: parseCreditValueToCent(getFirstString(row, ["unitcount", "unitCount", "score", "value"])),
      totalCapacity,
      issuedCount,
      remainingCapacity: Math.max(0, totalCapacity - issuedCount),
    };
  } catch {
    return null;
  }
}

export function normalizePerson(value: unknown, options: Partial<ActivityPersonRow> = {}): ActivityPersonRow {
  const record = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  const studentName = getFirstString(record, ["studentName", "stuName", "realName", "realname", "name", "username", "nickname", "userName"]) || "未知姓名";
  const person: ActivityPersonRow = {
    studentId: getFirstString(record, ["studentId", "studentNo", "stuNo", "schoolNo", "code", "no"]) || undefined,
    studentName,
    signUpId: getFirstString(record, ["signUpId", "signupId", "signup_id", "joinId", "id"]) || undefined,
    userId: getFirstString(record, ["userId", "uid", "user_id"]) || undefined,
    signStatus: options.signStatus,
    admitStatus: options.admitStatus,
    source: options.source,
    raw: sanitizeRaw(record),
  };
  return person;
}

export function parseMemberWorkbook(content: ArrayBuffer | Uint8Array | Buffer, admitStatus: MemberListKey): ActivityPersonRow[] {
  const workbook = XLSX.read(content, { type: "array", cellDates: false });
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!worksheet) {
    return [];
  }
  const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    raw: false,
    blankrows: false,
  });
  if (rows.length === 0) {
    return [];
  }
  const header = rows[0];
  const indexes = resolveMemberColumnIndexes(header);
  return rows.slice(1)
    .map((row) => rowToPerson(row, indexes, admitStatus))
    .filter((row) => Boolean(row.studentName || row.studentId || row.signUpId || row.userId));
}

export function getFirstString(value: unknown, keys: string[]): string {
  if (typeof value !== "object" || value === null) {
    return "";
  }
  const record = value as Record<string, unknown>;
  const normalizedEntries = new Map(Object.entries(record).map(([key, raw]) => [normalizeKey(key), raw]));
  for (const key of keys) {
    const direct = record[key];
    const normalized = normalizedEntries.get(normalizeKey(key));
    const text = normalizeText(direct ?? normalized);
    if (text) {
      return text;
    }
  }
  return "";
}

export function creditItemToOperationItem(item: CreditItem | ActivityCreditItem, activityId: string, activityName: string): ActivityCreditItem & { activityId: string; activityName: string } {
  const detail = "totalCapacity" in item && "issuedCount" in item
    ? item
    : { ...item, totalCapacity: item.remainingCapacity, issuedCount: 0 };
  return {
    ...detail,
    activityId,
    activityName,
  };
}

function findActivity(activities: Record<string, unknown>, activityId: string): { id: string; raw: Record<string, unknown> } | null {
  for (const [id, raw] of Object.entries(activities)) {
    if (typeof raw !== "object" || raw === null) {
      continue;
    }
    const record = raw as Record<string, unknown>;
    const normalizedId = getFirstString(record, ["activityId", "id"]) || id;
    if (normalizedId === activityId || id === activityId) {
      return { id, raw: record };
    }
  }
  return null;
}

async function buildSignLists(client: ActivityDetailClient, activityId: string): Promise<Record<SignListKey, ActivityPersonRow[]>> {
  const result = emptySignLists();
  for (const [key, type] of SIGN_LISTS) {
    result[key] = (await client.getSignList(activityId, type)).map((row) => normalizePerson(row, { signStatus: key, source: `sign.${key}` }));
  }
  return result;
}

async function buildMemberLists(client: ActivityDetailClient, activityId: string): Promise<Record<MemberListKey, ActivityPersonRow[]>> {
  const result = emptyMemberLists();
  for (const [key, type] of MEMBER_LISTS) {
    const content = await client.exportMembers(activityId, type);
    result[key] = parseMemberWorkbook(content, key);
  }
  return result;
}

function emptySignLists(): Record<SignListKey, ActivityPersonRow[]> {
  return {
    unsigned: [],
    signed: [],
    signout: [],
    leave: [],
  };
}

function emptyMemberLists(): Record<MemberListKey, ActivityPersonRow[]> {
  return {
    register: [],
    admit: [],
    leave: [],
  };
}

function resolveMemberColumnIndexes(headerRow: unknown[]): { signUpId: number; studentName: number; studentId: number; userId: number } {
  const normalized = headerRow.map(normalizeHeader);
  const find = (candidates: string[]): number => {
    for (const candidate of candidates.map(normalizeHeader)) {
      const exact = normalized.indexOf(candidate);
      if (exact !== -1) {
        return exact;
      }
    }
    for (const candidate of candidates.map(normalizeHeader)) {
      const fuzzy = normalized.findIndex((header) => header.includes(candidate));
      if (fuzzy !== -1) {
        return fuzzy;
      }
    }
    return -1;
  };
  return {
    signUpId: valueOrFallback(find(["报名ID", "报名编号", "signUpId", "signupId"]), 0),
    studentName: valueOrFallback(find(["姓名", "学生姓名", "studentName", "name"]), 3),
    studentId: valueOrFallback(find(["学号", "学生学号", "studentId", "studentNo"]), 4),
    userId: valueOrFallback(find(["userId", "uid", "用户ID", "用户UID", "用户编号"]), 5),
  };
}

function rowToPerson(row: unknown[], indexes: { signUpId: number; studentName: number; studentId: number; userId: number }, admitStatus: MemberListKey): ActivityPersonRow {
  return {
    signUpId: normalizeText(row[indexes.signUpId]) || undefined,
    studentName: normalizeText(row[indexes.studentName]) || "未知姓名",
    studentId: normalizeText(row[indexes.studentId]) || undefined,
    userId: normalizeText(row[indexes.userId]) || undefined,
    admitStatus,
    source: `member.${admitStatus}`,
  };
}

function valueOrFallback(value: number, fallback: number): number {
  return value === -1 ? fallback : value;
}

function personIdentityKey(person: ActivityPersonRow): string {
  if (person.signUpId) {
    return `signup:${person.signUpId}`;
  }
  if (person.studentId || person.studentName) {
    return `student:${person.studentId ?? ""}:${person.studentName}`;
  }
  return "";
}

function uniquePeople(people: ActivityPersonRow[]): ActivityPersonRow[] {
  const byKey = new Map<string, ActivityPersonRow>();
  for (const person of people) {
    const key = personIdentityKey(person) || crypto.randomUUID();
    if (!byKey.has(key)) {
      byKey.set(key, person);
    }
  }
  return [...byKey.values()];
}

function sanitizeRaw(record: Record<string, unknown>): Record<string, unknown> {
  const sensitive = new Set(["uid", "token", "api_token", "pwd", "account"]);
  return Object.fromEntries(Object.entries(record).filter(([key]) => !sensitive.has(key)));
}

function normalizeKey(value: string): string {
  return normalizeText(value).toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function normalizeHeader(value: unknown): string {
  return normalizeKey(String(value ?? ""));
}
