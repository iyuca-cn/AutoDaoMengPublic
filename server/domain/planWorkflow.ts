import { buildActivityBundles, type CatalogClient } from "./catalog";
import { buildEligibilityMap, demandKey, type EligibilityClient } from "./eligibility";
import {
  type ActivityBundle,
  type BundleCandidate,
  type DemandAllocation,
  type DemandRecord,
  type ImportBatch,
  type Plan,
  type PlanSummary,
  type PreissuedRecord,
  type PriorityDemandRecord,
  createAuditLog,
} from "./models";
import { bundleKey, Planner } from "./planner";
import type { JsonStore } from "../storage/jsonStore";

export interface PlanWorkflowClient extends CatalogClient, EligibilityClient {}

export interface GeneratePlanOptions {
  name?: string;
  editedDemands?: PriorityDemandRecord[];
}

export async function generatePlanFromImport(store: JsonStore, client: PlanWorkflowClient, importBatchId: string, options: GeneratePlanOptions = {}): Promise<Plan> {
  const importBatch = await store.read("imports", importBatchId);
  if (!importBatch) {
    throw new Error(`导入批次不存在：${importBatchId}`);
  }
  const priorityDemands = (options.editedDemands ?? importBatch.aggregatedDemands).filter((demand) => demand.enabled);
  if (priorityDemands.length === 0) {
    throw new Error("没有可生成计划的导入需求");
  }

  const bundles = await buildActivityBundles(client);
  if (bundles.length === 0) {
    throw new Error("没有可规划的活动学分项，请确认活动存在签到卡且学分类型受支持");
  }

  const eligibilityDemands = priorityTypeDemands(priorityDemands);
  const eligibility = await buildEligibilityMap(client, bundles, eligibilityDemands);
  const { demands, allocations, bundleAssignmentCounts, notInAdmitList } = planPriorityDemands(priorityDemands, bundles, eligibility);
  const preissued = await collectPreissuedPreview(client, allocations);
  const plan: Plan = {
    id: crypto.randomUUID(),
    name: options.name || `${importBatch.filename} 计划`,
    sourceImportId: importBatch.id,
    generatedAt: new Date().toISOString(),
    status: "draft",
    demands,
    activities: bundles,
    allocations,
    preissued,
    notInAdmitList,
    summary: buildPlanSummary(demands, bundles, allocations, notInAdmitList, preissued),
    auditLogs: [createAuditLog("plan.created", { sourceImportId: importBatch.id })],
  };
  await store.create("plans", plan);
  await store.appendAudit("imports", importBatch.id, createAuditLog("plan.generated", { planId: plan.id }, "user"));
  return plan;
}

function priorityTypeDemands(priorityDemands: PriorityDemandRecord[]): DemandRecord[] {
  const byKey = new Map<string, DemandRecord>();
  for (const priorityDemand of priorityDemands) {
    for (const creditType of priorityDemand.creditTypes) {
      const demand: DemandRecord = {
        studentId: priorityDemand.studentId,
        studentName: priorityDemand.studentName,
        creditType,
        requestedValueCent: priorityDemand.requestedValueCent,
      };
      byKey.set(demandKey(demand), demand);
    }
  }
  return [...byKey.values()];
}

function aggregateDemands(demands: DemandRecord[]): DemandRecord[] {
  const byKey = new Map<string, DemandRecord>();
  for (const demand of demands) {
    const key = demandKey(demand);
    const existing = byKey.get(key);
    byKey.set(key, existing ? { ...existing, requestedValueCent: existing.requestedValueCent + demand.requestedValueCent } : { ...demand });
  }
  return [...byKey.values()];
}

function planPriorityDemands(priorityDemands: PriorityDemandRecord[], bundles: ActivityBundle[], eligibility: Awaited<ReturnType<typeof buildEligibilityMap>>): {
  demands: DemandRecord[];
  allocations: DemandAllocation[];
  bundleAssignmentCounts: Record<string, number>;
  notInAdmitList: DemandRecord[];
} {
  const remainingByIndex = new Map(priorityDemands.map((demand, index) => [index, demand.requestedValueCent]));
  const allocations: DemandAllocation[] = [];
  const notInAdmitList: DemandRecord[] = [];
  let assignmentCounts: Record<string, number> = {};
  const maxPriorityCount = Math.max(...priorityDemands.map((demand) => demand.creditTypes.length));

  for (let priorityIndex = 0; priorityIndex < maxPriorityCount; priorityIndex += 1) {
    const layerEntries: Array<{ demandIndex: number; hasLaterType: boolean; demand: DemandRecord; candidates: BundleCandidate[] }> = [];
    priorityDemands.forEach((priorityDemand, demandIndex) => {
      const remainingValueCent = remainingByIndex.get(demandIndex) ?? 0;
      if (remainingValueCent <= 0 || priorityIndex >= priorityDemand.creditTypes.length) {
        return;
      }
      const hasLaterType = priorityIndex + 1 < priorityDemand.creditTypes.length;
      const demand: DemandRecord = {
        studentId: priorityDemand.studentId,
        studentName: priorityDemand.studentName,
        creditType: priorityDemand.creditTypes[priorityIndex],
        requestedValueCent: remainingValueCent,
      };
      const candidates = buildCandidates(demand, bundles, eligibility);
      if (candidates.length === 0) {
        if (!hasLaterType) {
          allocations.push(zeroAllocation(demand));
          notInAdmitList.push(demand);
          remainingByIndex.set(demandIndex, 0);
        }
        return;
      }
      layerEntries.push({ demandIndex, hasLaterType, demand, candidates });
    });
    if (layerEntries.length === 0) {
      continue;
    }
    const result = new Planner(assignmentCounts).plan(layerEntries.map((entry) => ({
      demand: entry.demand,
      candidates: entry.candidates,
    })));
    assignmentCounts = result.bundleAssignmentCounts;
    result.allocations.forEach((allocation, allocationIndex) => {
      const entry = layerEntries[allocationIndex];
      const remainingValueCent = remainingByIndex.get(entry.demandIndex) ?? 0;
      if (remainingValueCent <= 0 || allocation.plannedValueCent <= 0) {
        if (!entry.hasLaterType) {
          allocations.push(retargetAllocation(allocation, remainingValueCent));
          remainingByIndex.set(entry.demandIndex, 0);
        }
        return;
      }
      const nextRemaining = Math.max(0, remainingValueCent - allocation.plannedValueCent);
      const segmentRequest = nextRemaining > 0 && entry.hasLaterType ? allocation.plannedValueCent : remainingValueCent;
      allocations.push(retargetAllocation(allocation, segmentRequest));
      remainingByIndex.set(entry.demandIndex, entry.hasLaterType ? nextRemaining : 0);
    });
  }

  return {
    demands: aggregateDemands(allocations.map((allocation) => allocation.demand)),
    allocations,
    bundleAssignmentCounts: assignmentCounts,
    notInAdmitList,
  };
}

function buildCandidates(demand: DemandRecord, bundles: ActivityBundle[], eligibility: Awaited<ReturnType<typeof buildEligibilityMap>>): BundleCandidate[] {
  const matches = eligibility.matchesByDemand[demandKey(demand)] ?? [];
  const bundlesByKey = new Map<string, ActivityBundle[]>();
  for (const bundle of bundles) {
    const key = JSON.stringify([bundle.activityId, bundle.creditType]);
    const values = bundlesByKey.get(key) ?? [];
    values.push(bundle);
    bundlesByKey.set(key, values);
  }
  return matches.flatMap((match) => (bundlesByKey.get(JSON.stringify([match.activityId, match.creditType])) ?? []).map((bundle) => ({
    bundle,
    signUpId: match.signUpId,
    userId: match.userId,
  })));
}

async function collectPreissuedPreview(client: PlanWorkflowClient, allocations: DemandAllocation[]): Promise<Plan["preissued"]> {
  const cache = new Map<string, Set<string>>();
  const alreadyPartiallyIssued: PreissuedRecord[] = [];
  const alreadyFullyIssued: PreissuedRecord[] = [];
  for (const allocation of allocations) {
    for (const assignment of allocation.assignments) {
      let creditedCount = 0;
      for (const item of assignment.bundle.creditItems) {
        const key = `${assignment.bundle.activityId}:${item.creditId}`;
        if (!cache.has(key)) {
          const rows = await client.getCreditList("credited", assignment.bundle.activityId, item.creditId);
          cache.set(key, new Set(rows.map((row) => getString(row, "signUpId"))));
        }
        if (cache.get(key)?.has(assignment.signUpId)) {
          creditedCount += 1;
        }
      }
      if (creditedCount === 0) {
        continue;
      }
      const record: PreissuedRecord = {
        activityId: assignment.bundle.activityId,
        activityName: assignment.bundle.activityName,
        creditType: assignment.bundle.creditType,
        studentId: allocation.demand.studentId,
        studentName: allocation.demand.studentName,
        signUpId: assignment.signUpId,
        note: creditedCount === assignment.bundle.creditItems.length ? "全部计划学分项已发放" : "部分计划学分项已发放",
      };
      if (creditedCount === assignment.bundle.creditItems.length) {
        alreadyFullyIssued.push(record);
      } else {
        alreadyPartiallyIssued.push(record);
      }
    }
  }
  return { alreadyPartiallyIssued, alreadyFullyIssued };
}

function buildPlanSummary(demands: DemandRecord[], bundles: ActivityBundle[], allocations: DemandAllocation[], notInAdmitList: DemandRecord[], preissued: Plan["preissued"]): PlanSummary {
  return {
    demandCount: demands.length,
    studentCount: new Set(demands.map((demand) => demand.studentId)).size,
    activityCount: new Set(bundles.map((bundle) => bundle.activityId)).size,
    plannedIssueCount: allocations.reduce((sum, allocation) => sum + allocation.assignments.length, 0),
    notInAdmitCount: notInAdmitList.length,
    underIssuedCount: allocations.filter((allocation) => allocation.deltaCent < 0).length,
    overIssuedCount: allocations.filter((allocation) => allocation.deltaCent > 0).length,
    alreadyPartiallyIssuedCount: preissued.alreadyPartiallyIssued.length,
    alreadyFullyIssuedCount: preissued.alreadyFullyIssued.length,
  };
}

function zeroAllocation(demand: DemandRecord): DemandAllocation {
  return {
    demand,
    assignments: [],
    plannedValueCent: 0,
    deltaCent: -demand.requestedValueCent,
    enabled: true,
  };
}

function retargetAllocation(allocation: DemandAllocation, requestedValueCent: number): DemandAllocation {
  return {
    ...allocation,
    demand: {
      ...allocation.demand,
      requestedValueCent,
    },
    deltaCent: allocation.plannedValueCent - requestedValueCent,
  };
}

function getString(value: unknown, key: string): string {
  if (typeof value !== "object" || value === null) {
    return "";
  }
  const raw = (value as Record<string, unknown>)[key];
  return raw === undefined || raw === null ? "" : String(raw);
}
