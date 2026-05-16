import { creditItemToOperationItem } from "./activityDetail";
import {
  type ActivityCreditItem,
  type ActivityPersonRow,
  type OperationAction,
  type OperationCreditItem,
  type OperationKind,
  type OperationPlan,
  type OperationPlanSummary,
  createAuditLog,
} from "./models";

export interface CreateOperationPlanInput {
  name?: string;
  kind: OperationKind;
  activityId?: string;
  activityName?: string;
  members?: ActivityPersonRow[];
  creditItems?: ActivityCreditItem[];
  activitySelections?: OperationActivitySelection[];
}

export interface OperationActivitySelection {
  activityId: string;
  activityName: string;
  members: ActivityPersonRow[];
  creditItems?: ActivityCreditItem[];
}

export interface PatchOperationPlanInput {
  name?: string;
  status?: OperationPlan["status"];
  actions?: OperationAction[];
}

export function createOperationPlan(input: CreateOperationPlanInput): OperationPlan {
  if (!["resign", "issueCredit", "resignThenIssueCredit"].includes(input.kind)) {
    throw new Error("操作类型不支持");
  }
  const selections = normalizeSelections(input);
  const actions = selections.flatMap((selection) => {
    const members = uniqueMembers(selection.members ?? []);
    if (members.length === 0) {
      return [];
    }
    const operationCreditItems = normalizeCreditItems(input.kind, selection.creditItems ?? [], selection.activityId, selection.activityName);
    return members.map((member) => actionFromMember(input.kind, member, operationCreditItems, selection.activityId, selection.activityName));
  });
  if (actions.length === 0) {
    throw new Error("请选择要生成计划的人员");
  }
  const activityIds = uniqueValues(actions.map((action) => action.activityId));
  const activityNames = uniqueValues(actions.map((action) => action.activityName));
  const now = new Date().toISOString();
  const plan: OperationPlan = {
    id: crypto.randomUUID(),
    name: input.name?.trim() || defaultPlanName(input.kind, activityNames),
    kind: input.kind,
    activityId: activityIds[0],
    activityName: activityNames[0],
    activityIds,
    activityNames,
    createdAt: now,
    updatedAt: now,
    status: "draft",
    actions,
    summary: buildOperationPlanSummary(actions),
    auditLogs: [createAuditLog("operation-plan.created", { kind: input.kind, activityIds, actionCount: actions.length }, "user")],
  };
  return plan;
}

export function patchOperationPlan(plan: OperationPlan, input: PatchOperationPlanInput): OperationPlan {
  if (!["draft", "ready"].includes(plan.status)) {
    throw new Error("已执行或执行中的操作计划不能直接修改，请复制为新计划");
  }
  const name = input.name?.trim();
  const actions = input.actions ? input.actions.map((action) => normalizePatchedAction(action, plan)) : plan.actions.map((action) => normalizePatchedAction(action, plan));
  const activityIds = uniqueValues(actions.map((action) => action.activityId));
  const activityNames = uniqueValues(actions.map((action) => action.activityName));
  return {
    ...plan,
    name: name || plan.name,
    activityId: activityIds[0] ?? plan.activityId,
    activityName: activityNames[0] ?? plan.activityName,
    activityIds,
    activityNames,
    status: input.status ?? (plan.status === "draft" ? "ready" : plan.status),
    actions,
    summary: buildOperationPlanSummary(actions),
    updatedAt: new Date().toISOString(),
    auditLogs: [...plan.auditLogs, createAuditLog("operation-plan.updated", { fields: Object.keys(input) }, "user")],
  };
}

export function buildOperationPlanSummary(actions: OperationAction[]): OperationPlanSummary {
  const enabled = actions.filter((action) => action.enabled);
  const targetCreditKeys = new Set(enabled.flatMap((action) => action.creditItems.map((item) => `${item.activityId}:${item.creditId}`)));
  return {
    actionCount: actions.length,
    enabledCount: enabled.length,
    targetMemberCount: new Set(enabled.map((action) => `${action.activityId}:${action.signUpId}`)).size,
    targetCreditItemCount: targetCreditKeys.size,
    expectedResignCount: enabled.filter((action) => action.kind === "resign" || action.kind === "resignThenIssueCredit").length,
    expectedIssueCount: enabled.reduce((sum, action) => sum + (action.kind === "resign" ? 0 : action.creditItems.length), 0),
  };
}

function actionFromMember(
  kind: OperationKind,
  member: ActivityPersonRow,
  creditItems: OperationCreditItem[],
  activityId: string,
  activityName: string,
): OperationAction {
  if (!member.signUpId) {
    throw new Error(`${member.studentName || member.studentId || "所选人员"} 缺少 signUpId，不能生成写操作计划`);
  }
  return {
    id: crypto.randomUUID(),
    kind,
    activityId,
    activityName,
    studentId: member.studentId,
    studentName: member.studentName || "未知姓名",
    signUpId: member.signUpId,
    userId: member.userId,
    creditItems,
    enabled: true,
    status: "planned",
  };
}

function normalizeSelections(input: CreateOperationPlanInput): OperationActivitySelection[] {
  if (input.activitySelections?.length) {
    return input.activitySelections.map((selection) => normalizeSelection(selection));
  }
  return [normalizeSelection({
    activityId: input.activityId ?? "",
    activityName: input.activityName ?? "",
    members: input.members ?? [],
    creditItems: input.creditItems ?? [],
  })];
}

function normalizeSelection(selection: OperationActivitySelection): OperationActivitySelection {
  const activityId = selection.activityId?.trim();
  const activityName = selection.activityName?.trim();
  if (!activityId) {
    throw new Error("活动 ID 不能为空");
  }
  if (!activityName) {
    throw new Error("活动名称不能为空");
  }
  return {
    activityId,
    activityName,
    members: selection.members ?? [],
    creditItems: selection.creditItems ?? [],
  };
}

function normalizeCreditItems(kind: OperationKind, items: ActivityCreditItem[], activityId: string, activityName: string): OperationCreditItem[] {
  if (kind === "resign") {
    return [];
  }
  if (items.length === 0) {
    throw new Error("发放类操作必须选择学分项");
  }
  for (const item of items) {
    if (!item.creditId) {
      throw new Error(`${item.creditType} 缺少 creditId，不能生成发放计划`);
    }
  }
  return uniqueCreditItems(items).map((item) => creditItemToOperationItem(item, activityId, activityName));
}

function uniqueMembers(members: ActivityPersonRow[]): ActivityPersonRow[] {
  const byKey = new Map<string, ActivityPersonRow>();
  for (const member of members) {
    const key = member.signUpId || `${member.studentId ?? ""}:${member.studentName}`;
    const existing = byKey.get(key);
    byKey.set(key, mergeMember(existing, member));
  }
  return [...byKey.values()];
}

function mergeMember(existing: ActivityPersonRow | undefined, incoming: ActivityPersonRow): ActivityPersonRow {
  if (!existing) {
    return incoming;
  }
  return {
    ...existing,
    ...incoming,
    userId: preferredUserId(existing.userId, incoming.userId),
  };
}

function preferredUserId(left?: string, right?: string): string | undefined {
  if (isValidUserId(right)) {
    return right;
  }
  if (isValidUserId(left)) {
    return left;
  }
  return right || left;
}

function isValidUserId(value?: string): boolean {
  const text = String(value ?? "").trim();
  return Boolean(text) && !/[\u4e00-\u9fff]/u.test(text);
}

function uniqueCreditItems(items: ActivityCreditItem[]): ActivityCreditItem[] {
  return [...new Map(items.map((item) => [creditItemKey(item), item])).values()];
}

function creditItemKey(item: ActivityCreditItem): string {
  return [item.scoreId, item.creditId, item.creditType, item.unitcountCent].join(":");
}

function normalizePatchedAction(action: OperationAction, plan: OperationPlan): OperationAction {
  return {
    ...action,
    activityId: action.activityId || plan.activityId,
    activityName: action.activityName || plan.activityName,
    creditItems: action.creditItems.map((item) => ({
      ...item,
      activityId: item.activityId || action.activityId || plan.activityId,
      activityName: item.activityName || action.activityName || plan.activityName,
    })),
    enabled: Boolean(action.enabled),
    status: action.enabled ? action.status : "disabled",
  };
}

function defaultPlanName(kind: OperationKind, activityNames: string[]): string {
  const label = {
    resign: "补签计划",
    issueCredit: "发放计划",
    resignThenIssueCredit: "补签后发放计划",
  } satisfies Record<OperationKind, string>;
  const prefix = activityNames.length === 1 ? activityNames[0] : `${activityNames.length} 个活动`;
  return `${prefix} ${label[kind]}`;
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
