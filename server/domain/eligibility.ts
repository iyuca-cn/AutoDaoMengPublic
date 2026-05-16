import * as XLSX from "xlsx";
import { EXPORT_TYPES, type ActivityBundle, type DemandRecord, type EligibilityMatch, type EligibilityResult, normalizeText } from "./models";

export interface EligibilityClient {
  exportMembers(activityId: string, type: number): Promise<ArrayBuffer>;
}

interface AdmitMember {
  signUpId: string;
  studentName: string;
  studentId: string;
  userId: string;
}

export async function buildEligibilityMap(client: EligibilityClient, bundles: ActivityBundle[], demands: DemandRecord[], retryAttempts = 3): Promise<EligibilityResult> {
  const membersByActivity = new Map<string, Map<string, AdmitMember>>();
  for (const activityId of [...new Set(bundles.map((bundle) => bundle.activityId))].sort()) {
    const content = await retry(() => client.exportMembers(activityId, EXPORT_TYPES.admit), retryAttempts, `导出活动 ${activityId} 录取名单失败`);
    const members = parseAdmitMembers(content);
    membersByActivity.set(activityId, new Map(members.map((member) => [memberKey(member.studentId, member.studentName), member])));
  }

  const matchesByDemand: Record<string, EligibilityMatch[]> = {};
  const notInAdmitList: DemandRecord[] = [];
  for (const demand of demands) {
    const key = demandKey(demand);
    const matches: EligibilityMatch[] = [];
    for (const bundle of bundles) {
      if (bundle.creditType !== demand.creditType) {
        continue;
      }
      const member = membersByActivity.get(bundle.activityId)?.get(memberKey(demand.studentId, demand.studentName));
      if (!member) {
        continue;
      }
      matches.push({
        studentId: demand.studentId,
        studentName: demand.studentName,
        creditType: demand.creditType,
        activityId: bundle.activityId,
        signUpId: member.signUpId,
        userId: member.userId,
      });
    }
    if (matches.length === 0) {
      notInAdmitList.push(demand);
    } else {
      matchesByDemand[key] = uniqueMatches(matches);
    }
  }
  return { matchesByDemand, notInAdmitList };
}

export function parseAdmitMembers(content: ArrayBuffer | Uint8Array | Buffer): AdmitMember[] {
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
  const [signUpIdIndex, studentNameIndex, studentIdIndex, userIdIndex] = resolveAdmitColumnIndexes(rows[0]);
  const members: AdmitMember[] = [];
  for (const row of rows.slice(1)) {
    const signUpId = normalizeText(row[signUpIdIndex]);
    const studentName = normalizeText(row[studentNameIndex]);
    const studentId = normalizeText(row[studentIdIndex]);
    const userId = normalizeText(row[userIdIndex]);
    if (!signUpId && !studentName && !studentId && !userId) {
      continue;
    }
    if (!signUpId || !studentName || !studentId) {
      throw new Error("录取名单存在缺少报名ID、姓名或学号的行");
    }
    members.push({ signUpId, studentName, studentId, userId });
  }
  return members;
}

export function demandKey(demand: DemandRecord): string {
  return JSON.stringify([demand.studentId, demand.studentName, demand.creditType]);
}

function memberKey(studentId: string, studentName: string): string {
  return JSON.stringify([studentId, studentName]);
}

function resolveAdmitColumnIndexes(headerRow: unknown[]): [number, number, number, number] {
  const normalized = headerRow.map(normalizeHeader);
  const findExact = (candidates: string[]): number | null => {
    for (const candidate of candidates.map(normalizeHeader)) {
      const index = normalized.indexOf(candidate);
      if (index !== -1) {
        return index;
      }
    }
    return null;
  };
  let userIdIndex = findExact(["userId", "uid", "用户ID", "用户UID", "用户编号", "userId(uid)"]);
  if (userIdIndex === null) {
    userIdIndex = normalized.findIndex((header) => (header.includes("userid") || header.includes("uid") || header.includes("用户id") || header.includes("用户uid")) && !header.includes("signup") && !header.includes("报名"));
    if (userIdIndex === -1) {
      userIdIndex = 5;
    }
  }
  return [
    findExact(["报名ID", "报名编号", "signUpId", "signupId"]) ?? 0,
    findExact(["姓名", "学生姓名", "name", "studentName"]) ?? 3,
    findExact(["学号", "学生学号", "studentId", "studentNo"]) ?? 4,
    userIdIndex,
  ];
}

function normalizeHeader(value: unknown): string {
  return normalizeText(value).toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function uniqueMatches(matches: EligibilityMatch[]): EligibilityMatch[] {
  return [...new Map(matches.map((match) => [JSON.stringify(match), match])).values()];
}

async function retry<T>(fn: () => Promise<T>, attempts: number, message: string): Promise<T> {
  let lastError: unknown;
  for (let index = 0; index < Math.max(1, attempts); index += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(message);
}
