import type { ActivityBundle, BundleCandidate, DemandAllocation, DemandRecord, PlannableDemand, PlanningResult } from "./models";

export function bundleKey(bundle: ActivityBundle): string {
  const creditIds = bundle.creditItems.map((item) => item.creditId).sort().join(",");
  return `${bundle.activityId}:${bundle.creditType}:${creditIds}`;
}

function candidateBalanceKey(assignments: BundleCandidate[], usageCounts: Record<string, number>): [number, number, number, string] {
  const rates: number[] = [];
  const keys: string[] = [];
  for (const assignment of assignments) {
    const key = bundleKey(assignment.bundle);
    keys.push(key);
    rates.push(((usageCounts[key] ?? 0) + 1) / Math.max(1, assignment.bundle.bundleCapacity));
  }
  return [
    rates.reduce((sum, rate) => sum + rate * rate, 0),
    Math.max(0, ...rates),
    assignments.length,
    keys.sort().join("|"),
  ];
}

function compareTuple(left: readonly (number | string)[], right: readonly (number | string)[]): number {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] < right[index]) {
      return -1;
    }
    if (left[index] > right[index]) {
      return 1;
    }
  }
  return 0;
}

function chooseBestAssignments(targetValueCent: number, candidates: BundleCandidate[], usageCounts: Record<string, number>, preferOverflow: boolean): BundleCandidate[] {
  if (candidates.length === 0) {
    return [];
  }
  const maxBundleValue = Math.max(...candidates.map((candidate) => candidate.bundle.bundleValueCent));
  const totalLimit = targetValueCent + maxBundleValue;
  let states = new Map<number, BundleCandidate[]>([[0, []]]);

  for (const candidate of candidates) {
    const nextStates = new Map(states);
    const entries = [...states.entries()].sort((left, right) => right[0] - left[0]);
    for (const [total, assignments] of entries) {
      const nextTotal = total + candidate.bundle.bundleValueCent;
      if (nextTotal > totalLimit) {
        continue;
      }
      const nextAssignments = [...assignments, candidate];
      const existing = nextStates.get(nextTotal);
      if (!existing || compareTuple(candidateBalanceKey(nextAssignments, usageCounts), candidateBalanceKey(existing, usageCounts)) < 0) {
        nextStates.set(nextTotal, nextAssignments);
      }
    }
    states = nextStates;
  }

  const totals = [...states.keys()].filter((total) => total > 0);
  if (totals.length === 0) {
    return [];
  }
  if (states.has(targetValueCent)) {
    return states.get(targetValueCent) ?? [];
  }
  if (preferOverflow) {
    const overflowTotals = totals.filter((total) => total > targetValueCent);
    if (overflowTotals.length > 0) {
      return states.get(Math.min(...overflowTotals)) ?? [];
    }
  } else {
    const shortageTotals = totals.filter((total) => total < targetValueCent);
    if (shortageTotals.length > 0) {
      return states.get(Math.max(...shortageTotals)) ?? [];
    }
    return [];
  }
  return states.get(Math.max(...totals)) ?? [];
}

export function planStudentAllocation(demand: DemandRecord, candidates: BundleCandidate[], usageCounts: Record<string, number>, preferOverflow = true): DemandAllocation {
  const availableCandidates = candidates.filter((candidate) => (usageCounts[bundleKey(candidate.bundle)] ?? 0) < candidate.bundle.bundleCapacity);
  const assignments = chooseBestAssignments(demand.requestedValueCent, availableCandidates, usageCounts, preferOverflow);
  const plannedValueCent = assignments.reduce((sum, assignment) => sum + assignment.bundle.bundleValueCent, 0);
  return {
    demand,
    assignments,
    plannedValueCent,
    deltaCent: plannedValueCent - demand.requestedValueCent,
    enabled: true,
  };
}

export class Planner {
  private readonly initialCounts: Record<string, number>;

  constructor(bundleAssignmentCounts: Record<string, number> = {}) {
    this.initialCounts = { ...bundleAssignmentCounts };
  }

  plan(plannableDemands: PlannableDemand[]): PlanningResult {
    const allocationsByIndex = new Map<number, DemandAllocation>();
    const assignmentCounts: Record<string, number> = { ...this.initialCounts };
    const grouped = new Map<string, number[]>();
    plannableDemands.forEach((plannableDemand, index) => {
      const values = grouped.get(plannableDemand.demand.creditType) ?? [];
      values.push(index);
      grouped.set(plannableDemand.demand.creditType, values);
    });

    for (const creditType of [...grouped.keys()].sort((left, right) => left.localeCompare(right, "zh-CN"))) {
      const orderedIndices = [...(grouped.get(creditType) ?? [])].sort((left, right) => {
        return compareTuple(this.sortKey(plannableDemands[left], left, assignmentCounts), this.sortKey(plannableDemands[right], right, assignmentCounts));
      });
      for (const index of orderedIndices) {
        const allocation = planStudentAllocation(plannableDemands[index].demand, plannableDemands[index].candidates, assignmentCounts, false);
        allocationsByIndex.set(index, allocation);
        applyAssignmentCountsDelta(assignmentCounts, allocation.assignments, 1);
      }
      this.upgradeShortages(plannableDemands, orderedIndices, allocationsByIndex, assignmentCounts);
    }

    return {
      allocations: plannableDemands.map((_, index) => allocationsByIndex.get(index) ?? zeroAllocation(plannableDemands[index].demand)),
      bundleAssignmentCounts: assignmentCounts,
    };
  }

  private sortKey(plannableDemand: PlannableDemand, originalIndex: number, assignmentCounts: Record<string, number>): [number, number, number, number] {
    const availableCandidates = plannableDemand.candidates.filter((candidate) => (assignmentCounts[bundleKey(candidate.bundle)] ?? 0) < candidate.bundle.bundleCapacity);
    const reachableTotal = availableCandidates.reduce((sum, candidate) => sum + candidate.bundle.bundleValueCent, 0);
    return [
      availableCandidates.length,
      reachableTotal,
      -plannableDemand.demand.requestedValueCent,
      originalIndex,
    ];
  }

  private upgradeShortages(plannableDemands: PlannableDemand[], orderedIndices: number[], allocationsByIndex: Map<number, DemandAllocation>, assignmentCounts: Record<string, number>): void {
    let pending = orderedIndices.filter((index) => (allocationsByIndex.get(index)?.deltaCent ?? 0) < 0);
    while (pending.length > 0) {
      const options: Array<{ key: (number | string)[]; index: number; upgraded: DemandAllocation; current: BundleCandidate[] }> = [];
      for (const index of pending) {
        const allocation = allocationsByIndex.get(index);
        if (!allocation || allocation.deltaCent >= 0) {
          continue;
        }
        const tempCounts = { ...assignmentCounts };
        applyAssignmentCountsDelta(tempCounts, allocation.assignments, -1);
        const upgraded = planStudentAllocation(plannableDemands[index].demand, plannableDemands[index].candidates, tempCounts, true);
        if (upgraded.plannedValueCent < plannableDemands[index].demand.requestedValueCent || sameAssignments(upgraded.assignments, allocation.assignments)) {
          continue;
        }
        options.push({
          key: [
            incrementalUpgradeCost(allocation.assignments, upgraded.assignments),
            upgraded.deltaCent,
            upgraded.assignments.length,
            ...candidateBalanceKey(upgraded.assignments, tempCounts),
            index,
          ],
          index,
          upgraded,
          current: allocation.assignments,
        });
      }
      if (options.length === 0) {
        break;
      }
      const selected = options.sort((left, right) => compareTuple(left.key, right.key))[0];
      applyAssignmentCountsDelta(assignmentCounts, selected.current, -1);
      applyAssignmentCountsDelta(assignmentCounts, selected.upgraded.assignments, 1);
      allocationsByIndex.set(selected.index, selected.upgraded);
      pending = orderedIndices.filter((index) => (allocationsByIndex.get(index)?.deltaCent ?? 0) < 0);
    }
  }
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

function applyAssignmentCountsDelta(counts: Record<string, number>, assignments: BundleCandidate[], delta: number): void {
  for (const assignment of assignments) {
    const key = bundleKey(assignment.bundle);
    counts[key] = (counts[key] ?? 0) + delta;
  }
}

function sameAssignments(left: BundleCandidate[], right: BundleCandidate[]): boolean {
  return left.map((item) => bundleKey(item.bundle)).join("|") === right.map((item) => bundleKey(item.bundle)).join("|");
}

function incrementalUpgradeCost(currentAssignments: BundleCandidate[], upgradedAssignments: BundleCandidate[]): number {
  const currentCounts = countAssignments(currentAssignments);
  const upgradedCounts = countAssignments(upgradedAssignments);
  const keys = new Set([...Object.keys(currentCounts), ...Object.keys(upgradedCounts)]);
  let cost = 0;
  for (const key of keys) {
    cost += Math.max(0, (upgradedCounts[key] ?? 0) - (currentCounts[key] ?? 0));
  }
  return cost;
}

function countAssignments(assignments: BundleCandidate[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const assignment of assignments) {
    const key = bundleKey(assignment.bundle);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}
