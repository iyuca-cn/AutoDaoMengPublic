import { describe, expect, it } from "vitest";
import type { ActivityBundle, BundleCandidate, DemandRecord } from "../../server/domain/models";
import { bundleKey, Planner, planStudentAllocation } from "../../server/domain/planner";

function makeBundle(activityId: string, valueCent: number, capacity = 10, creditId?: string, scoreId?: string): ActivityBundle {
  return {
    activityId,
    activityName: `活动${activityId}`,
    creditType: "美育实践学分",
    bundleValueCent: valueCent,
    bundleCapacity: capacity,
    creditItems: [
      {
        creditId: creditId ?? `${activityId}-${valueCent}`,
        scoreId: scoreId ?? `${activityId}-score`,
        creditType: "美育实践学分",
        unitcountCent: valueCent,
        remainingCapacity: capacity,
      },
    ],
  };
}

function makeCandidate(activityId: string, valueCent: number, capacity = 10, creditId?: string, scoreId?: string): BundleCandidate {
  return {
    bundle: makeBundle(activityId, valueCent, capacity, creditId, scoreId),
    signUpId: `signup-${activityId}`,
    userId: `user-${activityId}`,
  };
}

const demand: DemandRecord = {
  studentId: "20250001",
  studentName: "张三",
  creditType: "美育实践学分",
  requestedValueCent: 50,
};

describe("planner", () => {
  it("prefers exact match", () => {
    const allocation = planStudentAllocation(demand, [makeCandidate("A", 20), makeCandidate("B", 30), makeCandidate("C", 50)], {});
    expect(allocation.assignments.map((item) => item.bundle.activityId)).toEqual(["C"]);
    expect(allocation.deltaCent).toBe(0);
  });

  it("keeps same activity split credit rows distinct", () => {
    const allocation = planStudentAllocation({ ...demand, requestedValueCent: 20 }, [makeCandidate("A", 20, 10, "A-201"), makeCandidate("A", 30, 10, "A-202")], {});
    expect(allocation.assignments[0].bundle.creditItems[0].creditId).toBe("A-201");
  });

  it("tracks same activity credit items by score id when counting capacity", () => {
    const first = makeCandidate("A", 50, 1, "credit-1", "score-1");
    const second = makeCandidate("A", 50, 1, "credit-2", "score-2");
    const result = new Planner().plan([
      { demand: { ...demand, studentId: "20250001" }, candidates: [first] },
      { demand: { ...demand, studentId: "20250002", studentName: "李四" }, candidates: [second] },
    ]);
    expect(result.allocations.map((allocation) => allocation.assignments[0]?.bundle.creditItems[0]?.scoreId)).toEqual(["score-1", "score-2"]);
  });

  it("prefers lower usage concentration", () => {
    const a = makeCandidate("A", 50);
    const b = makeCandidate("B", 50);
    const allocation = planStudentAllocation(demand, [a, b], {
      [bundleKey(a.bundle)]: 8,
      [bundleKey(b.bundle)]: 2,
    });
    expect(allocation.assignments.map((item) => item.bundle.activityId)).toEqual(["B"]);
  });

  it("orders scarce demands and upgrades shortages", () => {
    const low = makeCandidate("A", 30, 2);
    const high = makeCandidate("B", 50, 1);
    const result = new Planner().plan([
      { demand: { ...demand, studentId: "20250001", requestedValueCent: 40 }, candidates: [low, high] },
      { demand: { ...demand, studentId: "20250002", studentName: "李四", requestedValueCent: 40 }, candidates: [low, high] },
    ]);
    expect(result.allocations.map((allocation) => allocation.plannedValueCent).sort()).toEqual([30, 50]);
  });
});
