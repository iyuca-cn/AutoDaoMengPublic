export const SUPPORTED_CREDIT_TYPES = [
  "美育实践学分",
  "思想成长学分",
  "劳动教育学分",
  "体育活动学分",
] as const;

export type SupportedCreditType = (typeof SUPPORTED_CREDIT_TYPES)[number];

export const SIGN_TYPES = {
  unsigned: 1,
  signed: 2,
  signout: 3,
  leave: 4,
} as const;

export const EXPORT_TYPES = {
  register: 1,
  admit: 2,
  leave: 3,
} as const;

export const CREDIT_LIST_URLS = {
  candidates: "https://appdmkj.5idream.net/v2/activity/manager/credit/candidates",
  other: "https://appdmkj.5idream.net/v2/activity/manager/credit/other/mem",
  credited: "https://appdmkj.5idream.net/v2/activity/manager/credit/men",
} as const;

export type PlanStatus = "draft" | "ready" | "running" | "completed" | "failed" | "cancelled";
export type OperationPlanStatus = PlanStatus;
export type AssignmentStatus = "planned" | "disabled" | "issued" | "skipped" | "failed";
export type TaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled";
export type SessionSource = "account" | "exportUrl";
export type OperationKind = "resign" | "issueCredit" | "resignThenIssueCredit" | "abandonCredit";
export type TaskTargetType = "creditPlan" | "operationPlan";

export interface StoredSession {
  uid: string;
  token: string;
  source: SessionSource;
  savedAt: string;
  lastVerifiedAt?: string;
}

export interface SessionStatus {
  authenticated: boolean;
  source?: SessionSource;
  savedAt?: string;
  lastVerifiedAt?: string;
}

export interface DemandRecord {
  studentId: string;
  studentName: string;
  creditType: SupportedCreditType;
  requestedValueCent: number;
}

export interface PriorityDemandRecord {
  studentId: string;
  studentName: string;
  creditTypes: SupportedCreditType[];
  requestedValueCent: number;
  enabled: boolean;
}

export interface ImportedDemandRow {
  rowNumber: number;
  studentId: string;
  studentName: string;
  creditTypes: string[];
  requestedValueCent: number | null;
  enabled: boolean;
}

export interface ImportError {
  rowNumber: number;
  field: string;
  message: string;
}

export interface ImportBatch {
  id: string;
  filename: string;
  createdAt: string;
  rows: ImportedDemandRow[];
  aggregatedDemands: PriorityDemandRecord[];
  errors: ImportError[];
  auditLogs: AuditLogEntry[];
}

export interface ImportBatchDraft {
  rows: ImportedDemandRow[];
  aggregatedDemands: PriorityDemandRecord[];
  errors: ImportError[];
}

export interface CreditItem {
  creditId: string;
  scoreId: string;
  creditType: SupportedCreditType;
  unitcountCent: number;
  remainingCapacity: number;
}

export interface ActivityCreditItem extends CreditItem {
  totalCapacity: number;
  issuedCount: number;
}

export type SignListKey = "unsigned" | "signed" | "signout" | "leave";
export type MemberListKey = "register" | "admit" | "leave";
export type SignStatus = SignListKey | "unknown";
export type AdmitStatus = MemberListKey | "unknown";

export interface ActivityPersonRow {
  studentId?: string;
  studentName: string;
  signUpId?: string;
  userId?: string;
  userScoreId?: string;
  signStatus?: SignStatus;
  admitStatus?: AdmitStatus;
  source?: string;
  raw?: Record<string, unknown>;
}

export interface ActivityCreditLists {
  candidates: ActivityPersonRow[];
  other: ActivityPersonRow[];
  credited: ActivityPersonRow[];
  notSent: ActivityPersonRow[];
}

export interface ActivityDetail {
  activityId: string;
  activityName: string;
  hasSignCard: boolean;
  signLists: Record<SignListKey, ActivityPersonRow[]>;
  memberLists: Record<MemberListKey, ActivityPersonRow[]>;
  creditItems: ActivityCreditItem[];
  creditListsByScoreId: Record<string, ActivityCreditLists>;
}

export interface ActivityBundle {
  activityId: string;
  activityName: string;
  creditType: SupportedCreditType;
  bundleValueCent: number;
  bundleCapacity: number;
  creditItems: CreditItem[];
}

export interface BundleCandidate {
  bundle: ActivityBundle;
  signUpId: string;
  userId: string;
}

export interface PlannableDemand {
  demand: DemandRecord;
  candidates: BundleCandidate[];
}

export interface DemandAllocation {
  demand: DemandRecord;
  assignments: BundleCandidate[];
  plannedValueCent: number;
  deltaCent: number;
  enabled: boolean;
}

export interface PlanningResult {
  allocations: DemandAllocation[];
  bundleAssignmentCounts: Record<string, number>;
}

export interface EligibilityMatch {
  studentId: string;
  studentName: string;
  creditType: SupportedCreditType;
  activityId: string;
  signUpId: string;
  userId: string;
}

export interface EligibilityResult {
  matchesByDemand: Record<string, EligibilityMatch[]>;
  notInAdmitList: DemandRecord[];
}

export interface PreissuedRecord {
  activityId: string;
  activityName: string;
  creditType: SupportedCreditType;
  studentId: string;
  studentName: string;
  signUpId?: string;
  note: string;
}

export interface PlanSummary {
  demandCount: number;
  studentCount: number;
  activityCount: number;
  plannedIssueCount: number;
  notInAdmitCount: number;
  underIssuedCount: number;
  overIssuedCount: number;
  alreadyPartiallyIssuedCount: number;
  alreadyFullyIssuedCount: number;
}

export interface Plan {
  id: string;
  name: string;
  sourceImportId: string;
  generatedAt: string;
  status: PlanStatus;
  demands: DemandRecord[];
  activities: ActivityBundle[];
  allocations: DemandAllocation[];
  preissued: {
    alreadyPartiallyIssued: PreissuedRecord[];
    alreadyFullyIssued: PreissuedRecord[];
  };
  notInAdmitList: DemandRecord[];
  summary: PlanSummary;
  auditLogs: AuditLogEntry[];
}

export interface ExecutionEvent {
  time: string;
  level: "info" | "warning" | "error";
  message: string;
  details?: Record<string, unknown>;
}

export interface ExecutionTask {
  id: string;
  planId: string;
  targetType?: TaskTargetType;
  targetId?: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  events: ExecutionEvent[];
  result?: ExecutionSummary;
}

export interface ExecutionSummary {
  resignSuccessCount: number;
  issueSuccessCount: number;
  abandonSuccessCount: number;
  skippedAlreadyIssuedCount: number;
  failedCount: number;
}

export interface AuditLogEntry {
  id: string;
  time: string;
  action: string;
  actor: "system" | "user";
  details?: Record<string, unknown>;
}

export interface OperationCreditItem extends ActivityCreditItem {
  activityId: string;
  activityName: string;
  userScoreId?: string;
}

export interface OperationAction {
  id: string;
  kind: OperationKind;
  activityId: string;
  activityName: string;
  studentId?: string;
  studentName: string;
  signUpId: string;
  userId?: string;
  creditItems: OperationCreditItem[];
  enabled: boolean;
  status: AssignmentStatus;
  note?: string;
}

export interface OperationPlanSummary {
  actionCount: number;
  enabledCount: number;
  targetMemberCount: number;
  targetCreditItemCount: number;
  expectedResignCount: number;
  expectedIssueCount: number;
  expectedAbandonCount: number;
}

export interface OperationPrecheckIssue {
  level: "error" | "warning";
  code: string;
  message: string;
  actionId?: string;
  activityId?: string;
  studentId?: string;
  signUpId?: string;
  scoreId?: string;
}

export interface OperationPrecheckReport {
  planId: string;
  executable: boolean;
  issues: OperationPrecheckIssue[];
  actionCount: number;
  normalizedActions: OperationAction[];
}

export interface OperationPlan {
  id: string;
  name: string;
  kind: OperationKind;
  activityId: string;
  activityName: string;
  activityIds?: string[];
  activityNames?: string[];
  createdAt: string;
  updatedAt: string;
  status: OperationPlanStatus;
  actions: OperationAction[];
  precheck?: OperationPrecheckReport;
  summary: OperationPlanSummary;
  auditLogs: AuditLogEntry[];
}

export function normalizeText(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
}

export function validateCreditType(value: string): SupportedCreditType {
  if ((SUPPORTED_CREDIT_TYPES as readonly string[]).includes(value)) {
    return value as SupportedCreditType;
  }
  throw new Error(`不支持的学分类型：${value}`);
}

export function splitCreditTypes(value: string): string[] {
  return value
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseCreditValueToCent(value: unknown): number {
  const text = normalizeText(value);
  if (!text) {
    throw new Error("学分数值不能为空");
  }
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) {
    throw new Error(`学分数值无效：${text}`);
  }
  const [integerPart, fractionPart = ""] = text.split(".");
  if (fractionPart.length > 2) {
    throw new Error("学分数值必须以 0.01 为最小单位");
  }
  const sign = integerPart.startsWith("-") ? -1 : 1;
  const absInteger = integerPart.replace(/^-/, "");
  const cents = Number.parseInt(absInteger || "0", 10) * 100 + Number.parseInt(fractionPart.padEnd(2, "0") || "0", 10);
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new Error(`学分数值无效：${text}`);
  }
  return sign * cents;
}

export function formatCreditCent(valueCent: number): string {
  const sign = valueCent < 0 ? "-" : "";
  const absolute = Math.abs(valueCent);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

export function createAuditLog(action: string, details?: Record<string, unknown>, actor: "system" | "user" = "system"): AuditLogEntry {
  return {
    id: crypto.randomUUID(),
    time: new Date().toISOString(),
    action,
    actor,
    details,
  };
}
