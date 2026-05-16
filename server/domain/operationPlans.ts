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
  if (!input.activityId) {
    throw new Error("活动 ID 不能为空");
  }
  if (!input.activityName) {
    throw new Error("活动名称不能为空");
  }
  if (!["resign", "issueCredit", "resignThenIssueCredit"].includes(input.kind)) {
    throw new Error("操作类型不支持");
  }
  const members = uniqueMembers(input.members ?? []);
  if (members.length === 0) {
    throw new Error("请选择要生成计划的人员");
  }
  const operationCreditItems = normalizeCreditItems(input.kind, input.creditItems ?? [], input.activityId, input.activityName);
  const actions = members.map((member) => actionFromMember(input.kind, member, operationCreditItems));
  const now = new Date().toISOString();
  const plan: OperationPlan = {
    id: crypto.randomUUID(),
    name: input.name?.trim() || defaultPlanName(input.kind, input.activityName),
    kind: input.kind,
    activityId: input.activityId,
    activityName: input.activityName,
    createdAt: now,
    updatedAt: now,
    status: "draft",
    actions,
    summary: buildOperationPlanSummary(actions),
    auditLogs: [createAuditLog("operation-plan.created", { kind: input.kind, activityId: input.activityId, actionCount: actions.length }, "user")],
  };
  return plan;
}

export function patchOperationPlan(plan: OperationPlan, input: PatchOperationPlanInput): OperationPlan {
  if (!["draft", "ready"].includes(plan.status)) {
    throw new Error("已执行或执行中的操作计划不能直接修改，请复制为新计划");
  }
  const actions = input.actions ? input.actions.map(normalizePatchedAction) : plan.actions;
  return {
    ...plan,
    name: input.name ?? plan.name,
    status: input.status ?? plan.status,
    actions,
    summary: buildOperationPlanSummary(actions),
    updatedAt: new Date().toISOString(),
    auditLogs: [...plan.auditLogs, createAuditLog("operation-plan.updated", { fields: Object.keys(input) }, "user")],
  };
}

export function buildOperationPlanSummary(actions: OperationAction[]): OperationPlanSummary {
  const enabled = actions.filter((action) => action.enabled);
  const targetCreditKeys = new Set(enabled.flatMap((action) => action.creditItems.map((item) => `${item.activityId}:${item.scoreId}`)));
  return {
    actionCount: actions.length,
    enabledCount: enabled.length,
    targetMemberCount: new Set(enabled.map((action) => action.signUpId)).size,
    targetCreditItemCount: targetCreditKeys.size,
    expectedResignCount: enabled.filter((action) => action.kind === "resign" || action.kind === "resignThenIssueCredit").length,
    expectedIssueCount: enabled.reduce((sum, action) => sum + (action.kind === "resign" ? 0 : action.creditItems.length), 0),
  };
}

function actionFromMember(kind: OperationKind, member: ActivityPersonRow, creditItems: OperationCreditItem[]): OperationAction {
  if (!member.signUpId) {
    throw new Error(`${member.studentName || member.studentId || "所选人员"} 缺少 signUpId，不能生成写操作计划`);
  }
  return {
    id: crypto.randomUUID(),
    kind,
    studentId: member.studentId,
    studentName: member.studentName || "未知姓名",
    signUpId: member.signUpId,
    userId: member.userId,
    creditItems,
    enabled: true,
    status: "planned",
  };
}

function normalizeCreditItems(kind: OperationKind, items: ActivityCreditItem[], activityId: string, activityName: string): OperationCreditItem[] {
  if (kind === "resign") {
    return [];
  }
  if (items.length === 0) {
    throw new Error("发放类操作必须选择学分项");
  }
  return uniqueCreditItems(items).map((item) => creditItemToOperationItem(item, activityId, activityName));
}

function uniqueMembers(members: ActivityPersonRow[]): ActivityPersonRow[] {
  const byKey = new Map<string, ActivityPersonRow>();
  for (const member of members) {
    const key = member.signUpId || `${member.studentId ?? ""}:${member.studentName}`;
    if (!byKey.has(key)) {
      byKey.set(key, member);
    }
  }
  return [...byKey.values()];
}

function uniqueCreditItems(items: ActivityCreditItem[]): ActivityCreditItem[] {
  return [...new Map(items.map((item) => [item.scoreId || item.creditId, item])).values()];
}

function normalizePatchedAction(action: OperationAction): OperationAction {
  return {
    ...action,
    enabled: Boolean(action.enabled),
    status: action.enabled ? action.status : "disabled",
  };
}

function defaultPlanName(kind: OperationKind, activityName: string): string {
  const label = {
    resign: "补签计划",
    issueCredit: "发放计划",
    resignThenIssueCredit: "补签后发放计划",
  } satisfies Record<OperationKind, string>;
  return `${activityName} ${label[kind]}`;
}
