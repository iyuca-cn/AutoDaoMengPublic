export type SupportedCreditType = "美育实践学分" | "思想成长学分" | "劳动教育学分" | "体育活动学分";

export interface CreditItem {
  creditId: string;
  scoreId: string;
  creditType: SupportedCreditType;
  unitcountCent: number;
  remainingCapacity: number;
}

export interface ActivityOverviewItem {
  activityId: string;
  activityName: string;
  hasSignCard: boolean;
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
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  createdAt: string;
  updatedAt: string;
  events: Array<{ time: string; level: string; message: string }>;
  result?: {
    resignSuccessCount: number;
    issueSuccessCount: number;
    skippedAlreadyIssuedCount: number;
    failedCount: number;
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
