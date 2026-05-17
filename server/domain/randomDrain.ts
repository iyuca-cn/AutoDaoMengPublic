import {
  CREDIT_LIST_URLS,
  SIGN_TYPES,
  parseCreditValueToCent,
  validateCreditType,
  type ExecutionDetail,
  type ExecutionSummary,
  type SupportedCreditType,
} from "./models";
import { summarizeExecutionDetails, verifyExecutionDetails } from "./executionVerifier";

export interface RandomDrainClient {
  getManagedActivities(): Promise<Record<string, unknown>>;
  getSignCard(activityId: string): Promise<string | null>;
  getCreditTypes(activityId: string): Promise<unknown[]>;
  getCreditList(kind: keyof typeof CREDIT_LIST_URLS, activityId: string, creditId: string): Promise<unknown[]>;
  getSignList(activityId: string, type: number): Promise<unknown[]>;
  resign(activityId: string, signUpIds: string[], isAll?: boolean): Promise<boolean>;
  sendCredit(activityId: string, creditId: string, userIds: string[]): Promise<boolean>;
}

export interface RandomDrainSelectionInput {
  activityId: string;
  creditId: string;
}

export interface RandomDrainPreviewInput {
  thresholdPercent: number;
  jitterCount: number;
  selectedItems: RandomDrainSelectionInput[];
}

export interface RandomDrainMember {
  signUpId: string;
  userId: string;
  studentName: string;
  studentId?: string;
}

export type RandomDrainSelectionStatus = "ready" | "threshold_reached" | "no_candidates" | "candidate_shortage" | "no_sign_card" | "missing_credit_item";

export interface RandomDrainSelection {
  activityId: string;
  activityName: string;
  creditId: string;
  scoreId: string;
  creditType?: SupportedCreditType;
  unitcountCent: number;
  totalCapacity: number;
  providedCount: number;
  thresholdPercent: number;
  baseTargetCount: number;
  jitterOffset: number;
  finalTargetCount: number;
  candidateCount: number;
  plannedIssueCount: number;
  status: RandomDrainSelectionStatus;
  note: string;
  selectedMembers: RandomDrainMember[];
}

export interface RandomDrainActivityBatch {
  activityId: string;
  activityName: string;
  selections: RandomDrainSelection[];
  plannedIssueCount: number;
}

export interface RandomDrainBatch {
  id: string;
  createdAt: string;
  thresholdPercent: number;
  jitterCount: number;
  activities: RandomDrainActivityBatch[];
  selectedItems: RandomDrainSelectionInput[];
  summary: {
    activityCount: number;
    creditItemCount: number;
    plannedIssueCount: number;
    skippedCount: number;
  };
}

interface CreditSelectionDraft {
  selection: RandomDrainSelection;
  candidates: RandomDrainMember[];
  targetIssueCount: number;
}

export async function buildRandomDrainPreview(
  client: RandomDrainClient,
  input: RandomDrainPreviewInput,
  random: () => number = Math.random,
): Promise<RandomDrainBatch> {
  validateInput(input);
  const selectedByActivity = groupSelectedItems(input.selectedItems);
  const activities = await client.getManagedActivities();
  const batches: RandomDrainActivityBatch[] = [];

  for (const [activityId, selectedCreditIds] of selectedByActivity) {
    const rawActivity = activities[activityId];
    const activityName = getFirstString(rawActivity, ["name", "activityName"]) || activityId;
    const signCard = await client.getSignCard(activityId);
    if (!signCard) {
      batches.push(activityBatch(activityId, activityName, [...selectedCreditIds].map((creditId) => emptySelection({
        activityId,
        activityName,
        creditId,
        status: "no_sign_card",
        note: "活动没有签到卡，已跳过",
        thresholdPercent: input.thresholdPercent,
      }))));
      continue;
    }

    const creditRows = await client.getCreditTypes(activityId);
    const creditRowById = new Map(creditRows.map((row) => [getFirstString(row, ["creditId"]), row]).filter(([creditId]) => Boolean(creditId)) as Array<[string, unknown]>);
    const drafts: CreditSelectionDraft[] = [];
    const missingSelections: RandomDrainSelection[] = [];
    for (const creditId of selectedCreditIds) {
      const creditRow = creditRowById.get(creditId);
      if (!creditRow) {
        missingSelections.push(emptySelection({
          activityId,
          activityName,
          creditId,
          status: "missing_credit_item",
          note: "未找到该活动学分包，已跳过",
          thresholdPercent: input.thresholdPercent,
        }));
        continue;
      }
      const jitterOffset = randomJitter(input.jitterCount, random);
      const draft = await buildSelectionDraft(client, {
        activityId,
        activityName,
        creditRow,
        thresholdPercent: input.thresholdPercent,
        jitterOffset,
      });
      if (draft) {
        drafts.push(draft);
      }
    }
    const selections = [...assignActivityMembers(drafts, random), ...missingSelections];
    batches.push(activityBatch(activityId, activityName, selections));
  }

  const selections = batches.flatMap((batch) => batch.selections);
  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    thresholdPercent: input.thresholdPercent,
    jitterCount: input.jitterCount,
    activities: batches,
    selectedItems: normalizeSelectedItems(input.selectedItems),
    summary: {
      activityCount: batches.length,
      creditItemCount: selections.length,
      plannedIssueCount: selections.reduce((sum, selection) => sum + selection.plannedIssueCount, 0),
      skippedCount: selections.filter((selection) => selection.plannedIssueCount === 0 || selection.status !== "ready").length,
    },
  };
}

export async function executeRandomDrainBatch(
  client: RandomDrainClient,
  batch: RandomDrainBatch,
  confirmedActivityIds: string[],
  onEvent?: (message: string) => void,
): Promise<ExecutionSummary> {
  const confirmed = new Set(confirmedActivityIds.map((id) => id.trim()).filter(Boolean));
  const details: ExecutionDetail[] = [];
  for (const activity of batch.activities) {
    if (activity.plannedIssueCount === 0) {
      for (const selection of activity.selections.filter((item) => item.status !== "ready")) {
        details.push(selectionDetail(selection, "skipped", 0, selection.note || selection.status));
      }
      continue;
    }
    if (!confirmed.has(activity.activityId)) {
      for (const selection of activity.selections) {
        for (const member of selection.selectedMembers) {
          details.push(detailFromMember(selection, member, "skipped", 0, "活动未确认执行，已跳过"));
        }
      }
      continue;
    }

    onEvent?.(`开始执行随机消耗：${activity.activityName}`);
    const blockedSignUpIds = await resignSelectedMembers(client, activity, onEvent);
    for (const selection of activity.selections) {
      if (selection.selectedMembers.length === 0 || !selection.creditId) {
        continue;
      }
      const pending = selection.selectedMembers.filter((member) => !blockedSignUpIds.has(member.signUpId) && member.userId);
      const blocked = selection.selectedMembers.filter((member) => blockedSignUpIds.has(member.signUpId) || !member.userId);
      for (const member of blocked) {
        details.push(detailFromMember(selection, member, "failed", 0, blockedSignUpIds.has(member.signUpId) ? "补签失败，未发放学分" : "缺少 userId，未发放学分"));
      }
      if (pending.length === 0) {
        continue;
      }
      onEvent?.(`开始为 ${activity.activityName} 发放 ${selection.creditType ?? "学分"} ${pending.length} 人`);
      try {
        const ok = await client.sendCredit(activity.activityId, selection.creditId, uniqueStrings(pending.map((member) => member.userId)));
        if (!ok) {
          throw new Error("代理返回发放失败");
        }
        for (const member of pending) {
          details.push(detailFromMember(selection, member, "success", selection.unitcountCent, `已发放 ${selection.creditType ?? "学分"}`));
        }
        onEvent?.(`已为 ${activity.activityName} 发放 ${selection.creditType ?? "学分"} ${pending.length} 人`);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        for (const member of pending) {
          details.push(detailFromMember(selection, member, "failed", 0, `发放失败：${reason}`));
        }
        onEvent?.(`${activity.activityName} 发放 ${selection.creditType ?? "学分"} 失败：${reason}`);
      }
    }
  }
  const verified = await verifyExecutionDetails(client, details, onEvent);
  return summarizeExecutionDetails(verified);
}

function validateInput(input: RandomDrainPreviewInput): void {
  if (!Number.isInteger(input.thresholdPercent) || input.thresholdPercent < 0 || input.thresholdPercent > 100) {
    throw new Error("阈值必须是 0 到 100 的整数百分比");
  }
  if (!Number.isInteger(input.jitterCount) || input.jitterCount < 0) {
    throw new Error("偏移必须是非负整数");
  }
  if (normalizeSelectedItems(input.selectedItems).length === 0) {
    throw new Error("请选择要随机消耗的活动学分包");
  }
}

function normalizeSelectedItems(items: RandomDrainSelectionInput[]): RandomDrainSelectionInput[] {
  const keys = new Set<string>();
  const result: RandomDrainSelectionInput[] = [];
  for (const item of items ?? []) {
    const activityId = String(item.activityId ?? "").trim();
    const creditId = String(item.creditId ?? "").trim();
    const key = `${activityId}:${creditId}`;
    if (!activityId || !creditId || keys.has(key)) {
      continue;
    }
    keys.add(key);
    result.push({ activityId, creditId });
  }
  return result;
}

function groupSelectedItems(items: RandomDrainSelectionInput[]): Map<string, Set<string>> {
  const groups = new Map<string, Set<string>>();
  for (const item of normalizeSelectedItems(items)) {
    const existing = groups.get(item.activityId) ?? new Set<string>();
    existing.add(item.creditId);
    groups.set(item.activityId, existing);
  }
  return groups;
}

async function buildSelectionDraft(
  client: RandomDrainClient,
  options: {
    activityId: string;
    activityName: string;
    creditRow: unknown;
    thresholdPercent: number;
    jitterOffset: number;
  },
): Promise<CreditSelectionDraft | null> {
  let creditType: SupportedCreditType;
  try {
    creditType = validateCreditType(getFirstString(options.creditRow, ["scorename", "creditType"]));
  } catch {
    return null;
  }
  const creditId = getFirstString(options.creditRow, ["creditId"]);
  const scoreId = getFirstString(options.creditRow, ["scoreId"]);
  const totalCapacity = toInteger(getFirstString(options.creditRow, ["num", "totalCapacity"]));
  const unitcountCent = parseCreditValueToCent(getFirstString(options.creditRow, ["unitcount", "unitcountCent"]));
  const providedFromRow = toInteger(getFirstString(options.creditRow, ["providenum", "issuedCount"]));
  const baseTargetCount = calculateTargetCount(totalCapacity, options.thresholdPercent, 0);
  const finalTargetCount = calculateTargetCount(totalCapacity, options.thresholdPercent, options.jitterOffset);
  const credited = await client.getCreditList("credited", options.activityId, creditId);
  const creditedSignUpIds = new Set(credited.map((row) => getFirstString(row, ["signUpId", "signupId", "id"])).filter(Boolean));
  const providedCount = Math.max(providedFromRow, creditedSignUpIds.size);
  const baseSelection = {
    activityId: options.activityId,
    activityName: options.activityName,
    creditId,
    scoreId,
    creditType,
    unitcountCent,
    totalCapacity,
    providedCount,
    thresholdPercent: options.thresholdPercent,
    baseTargetCount,
    jitterOffset: options.jitterOffset,
    finalTargetCount,
  };

  if (providedCount >= finalTargetCount) {
    return {
      selection: {
        ...baseSelection,
        candidateCount: 0,
        plannedIssueCount: 0,
        status: "threshold_reached",
        note: "已发人数达到目标阈值",
        selectedMembers: [],
      },
      candidates: [],
      targetIssueCount: 0,
    };
  }

  const candidateRows = [
    ...await client.getCreditList("candidates", options.activityId, creditId),
    ...await client.getCreditList("other", options.activityId, creditId),
  ];
  const candidates = uniqueMembers(candidateRows).filter((member) => !creditedSignUpIds.has(member.signUpId));
  const targetIssueCount = finalTargetCount - providedCount;
  if (candidates.length === 0) {
    return {
      selection: {
        ...baseSelection,
        candidateCount: 0,
        plannedIssueCount: 0,
        status: "no_candidates",
        note: "没有未发放候选人",
        selectedMembers: [],
      },
      candidates: [],
      targetIssueCount,
    };
  }

  return {
    selection: {
      ...baseSelection,
      candidateCount: candidates.length,
      plannedIssueCount: 0,
      status: "ready",
      note: "",
      selectedMembers: [],
    },
    candidates,
    targetIssueCount,
  };
}

export function calculateTargetCount(totalCapacity: number, thresholdPercent: number, jitterOffset = 0): number {
  const baseTarget = Math.floor((totalCapacity * thresholdPercent) / 100 + 0.5);
  return Math.max(0, Math.min(totalCapacity, baseTarget + jitterOffset));
}

function assignActivityMembers(drafts: CreditSelectionDraft[], random: () => number): RandomDrainSelection[] {
  const selectedCountBySignUpId = new Map<string, number>();
  return drafts.map((draft) => {
    if (draft.targetIssueCount <= 0 || draft.candidates.length === 0) {
      return draft.selection;
    }
    const ordered = shuffle(draft.candidates, random)
      .sort((left, right) => (selectedCountBySignUpId.get(left.signUpId) ?? 0) - (selectedCountBySignUpId.get(right.signUpId) ?? 0));
    const selectedMembers = ordered.slice(0, draft.targetIssueCount).sort((left, right) => left.signUpId.localeCompare(right.signUpId));
    for (const member of selectedMembers) {
      selectedCountBySignUpId.set(member.signUpId, (selectedCountBySignUpId.get(member.signUpId) ?? 0) + 1);
    }
    const status: RandomDrainSelectionStatus = selectedMembers.length >= draft.targetIssueCount ? "ready" : "candidate_shortage";
    return {
      ...draft.selection,
      selectedMembers,
      plannedIssueCount: selectedMembers.length,
      status,
      note: status === "ready" ? "" : "候选不足，已选择所有可发候选人",
    };
  });
}

async function resignSelectedMembers(
  client: RandomDrainClient,
  activity: RandomDrainActivityBatch,
  onEvent?: (message: string) => void,
): Promise<Set<string>> {
  const memberBySignUpId = new Map<string, RandomDrainMember>();
  for (const selection of activity.selections) {
    for (const member of selection.selectedMembers) {
      memberBySignUpId.set(member.signUpId, member);
    }
  }
  if (memberBySignUpId.size === 0) {
    return new Set();
  }
  try {
    const unsignedRows = await client.getSignList(activity.activityId, SIGN_TYPES.unsigned);
    const unsignedIds = new Set(unsignedRows.map((row) => getFirstString(row, ["signUpId", "signupId", "id"])).filter(Boolean));
    const targets = [...memberBySignUpId.keys()].filter((signUpId) => unsignedIds.has(signUpId)).sort();
    if (targets.length === 0) {
      return new Set();
    }
    onEvent?.(`开始为 ${activity.activityName} 批量补签 ${targets.length} 人`);
    const ok = await client.resign(activity.activityId, targets, false);
    if (!ok) {
      throw new Error("代理返回补签失败");
    }
    onEvent?.(`已为 ${activity.activityName} 批量补签 ${targets.length} 人`);
    return new Set();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    onEvent?.(`${activity.activityName} 批量补签失败：${reason}`);
    return new Set(memberBySignUpId.keys());
  }
}

function activityBatch(activityId: string, activityName: string, selections: RandomDrainSelection[]): RandomDrainActivityBatch {
  return {
    activityId,
    activityName,
    selections,
    plannedIssueCount: selections.reduce((sum, selection) => sum + selection.plannedIssueCount, 0),
  };
}

function emptySelection(options: {
  activityId: string;
  activityName: string;
  creditId: string;
  status: RandomDrainSelectionStatus;
  note: string;
  thresholdPercent: number;
}): RandomDrainSelection {
  return {
    activityId: options.activityId,
    activityName: options.activityName,
    creditId: options.creditId,
    scoreId: "",
    unitcountCent: 0,
    totalCapacity: 0,
    providedCount: 0,
    thresholdPercent: options.thresholdPercent,
    baseTargetCount: 0,
    jitterOffset: 0,
    finalTargetCount: 0,
    candidateCount: 0,
    plannedIssueCount: 0,
    status: options.status,
    note: options.note,
    selectedMembers: [],
  };
}

function selectionDetail(selection: RandomDrainSelection, status: ExecutionDetail["status"], actualValueCent: number, message: string): ExecutionDetail {
  return {
    studentName: "",
    activityId: selection.activityId,
    activityName: selection.activityName,
    creditId: selection.creditId,
    scoreId: selection.scoreId,
    creditType: selection.creditType,
    plannedValueCent: selection.unitcountCent,
    actualValueCent,
    action: "issueCredit",
    status,
    message,
  };
}

function detailFromMember(
  selection: RandomDrainSelection,
  member: RandomDrainMember,
  status: ExecutionDetail["status"],
  actualValueCent: number,
  message: string,
): ExecutionDetail {
  return {
    studentId: member.studentId,
    studentName: member.studentName,
    activityId: selection.activityId,
    activityName: selection.activityName,
    signUpId: member.signUpId,
    userId: member.userId,
    creditId: selection.creditId,
    scoreId: selection.scoreId,
    creditType: selection.creditType,
    plannedValueCent: selection.unitcountCent,
    actualValueCent,
    action: "issueCredit",
    status,
    message,
  };
}

function uniqueMembers(rows: unknown[]): RandomDrainMember[] {
  const bySignUpId = new Map<string, RandomDrainMember>();
  for (const row of rows) {
    const signUpId = getFirstString(row, ["signUpId", "signupId", "id"]);
    const userId = getFirstString(row, ["userId", "uid", "user_id"]);
    if (!signUpId || !userId) {
      continue;
    }
    bySignUpId.set(signUpId, {
      signUpId,
      userId,
      studentId: getFirstString(row, ["studentId", "studentNo", "stuNo", "schoolNo", "code", "no"]) || undefined,
      studentName: getFirstString(row, ["studentName", "stuName", "realName", "realname", "name", "username", "nickname", "userName"]) || "未知姓名",
    });
  }
  return [...bySignUpId.values()].sort((left, right) => left.signUpId.localeCompare(right.signUpId));
}

function randomJitter(jitterCount: number, random: () => number): number {
  if (jitterCount <= 0) {
    return 0;
  }
  return Math.floor(random() * (jitterCount * 2 + 1)) - jitterCount;
}

function shuffle<T>(values: T[], random: () => number): T[] {
  const next = [...values];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

function toInteger(value: string): number {
  const parsed = Number.parseInt(value || "0", 10);
  return Number.isFinite(parsed) ? parsed : 0;
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
