export type SupportedCreditType = "美育实践学分" | "思想成长学分" | "劳动教育学分" | "体育活动学分";
export type SessionSource = "account" | "exportUrl";
export type OperationKind = "resign" | "issueCredit" | "resignThenIssueCredit" | "abandonCredit";
export type OperationPlanStatus = "draft" | "ready" | "running" | "completed" | "failed" | "cancelled";
export type AssignmentStatus = "planned" | "disabled" | "issued" | "skipped" | "failed";

export interface SessionStatus {
  authenticated: boolean;
  source?: SessionSource;
  savedAt?: string;
  lastVerifiedAt?: string;
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

export interface ActivityOverviewItem {
  activityId: string;
  activityName: string;
  hasSignCard: boolean;
  readError?: string;
  signCounts: {
    unsigned: number;
    signed: number;
    signout: number;
    leave: number;
  };
  creditItems: CreditItem[];
  creditedCounts: Record<string, number>;
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

export interface PriorityDemandRecord {
  studentId: string;
  studentName: string;
  creditTypes: SupportedCreditType[];
  requestedValueCent: number;
  enabled: boolean;
}

export interface ImportBatch {
  id: string;
  filename: string;
  createdAt: string;
  rows: ImportedDemandRow[];
  aggregatedDemands: PriorityDemandRecord[];
  errors: ImportError[];
}

export interface Plan {
  id: string;
  name: string;
  sourceImportId: string;
  generatedAt: string;
  status: "draft" | "ready" | "running" | "completed" | "failed" | "cancelled";
  demands: DemandRecord[];
  activities: ActivityBundle[];
  allocations: DemandAllocation[];
  preissued: {
    alreadyPartiallyIssued: unknown[];
    alreadyFullyIssued: unknown[];
  };
  notInAdmitList: DemandRecord[];
  summary: {
    demandCount: number;
    studentCount: number;
    activityCount: number;
    plannedIssueCount: number;
    notInAdmitCount: number;
    underIssuedCount: number;
    overIssuedCount: number;
    alreadyPartiallyIssuedCount: number;
    alreadyFullyIssuedCount: number;
  };
}

export interface DemandRecord {
  studentId: string;
  studentName: string;
  creditType: SupportedCreditType;
  requestedValueCent: number;
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

export interface DemandAllocation {
  demand: DemandRecord;
  assignments: BundleCandidate[];
  plannedValueCent: number;
  deltaCent: number;
  enabled: boolean;
}

export interface ExecutionTask {
  id: string;
  planId: string;
  targetType?: "creditPlan" | "operationPlan" | "randomDrain";
  targetId?: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  createdAt: string;
  updatedAt: string;
  events: Array<{ time: string; level: string; message: string }>;
  result?: {
    resignSuccessCount: number;
    issueSuccessCount: number;
    abandonSuccessCount: number;
    skippedAlreadyIssuedCount: number;
    failedCount: number;
    details?: ExecutionDetail[];
  };
}

export interface ExecutionDetail {
  studentId?: string;
  studentName: string;
  activityId: string;
  activityName: string;
  signUpId?: string;
  userId?: string;
  creditId?: string;
  scoreId?: string;
  creditType?: SupportedCreditType;
  plannedValueCent: number;
  actualValueCent: number;
  action: "resign" | "issueCredit" | "abandonCredit";
  status: "success" | "skipped" | "failed";
  message: string;
}

export interface ApiStreamEvent<T = unknown> {
  type: "started" | "progress" | "data" | "task" | "completed" | "error";
  message?: string;
  data?: T;
  code?: string;
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
  selectedItems: Array<{ activityId: string; creditId: string }>;
  summary: {
    activityCount: number;
    creditItemCount: number;
    plannedIssueCount: number;
    skippedCount: number;
  };
}

export function formatCent(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "-";
  }
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}
