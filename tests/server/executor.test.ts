import { describe, expect, it } from "vitest";
import { executePlan, type ExecutorClient } from "../../server/domain/executor";
import type { Plan } from "../../server/domain/models";

describe("credit plan executor", () => {
  it("uses creditId instead of scoreId for credit reads and writes", async () => {
    const calls: string[] = [];

    await executePlan(fakeClient(calls), plan());

    expect(calls).toEqual(["credited:credit-1", "send:credit-1:user-1"]);
    expect(calls.some((call) => call.includes("score-1"))).toBe(false);
  });

  it("resolves the real user uid from sign lists before sending credit", async () => {
    const calls: string[] = [];

    await executePlan(fakeClient(calls, { signRows: [{ signUpId: "signup-1", userId: "uid-actual" }] }), plan({ userId: "机械工程学院" }));

    expect(calls).toEqual(["credited:credit-1", "send:credit-1:uid-actual"]);
  });

  it("records per-person execution details with issued credit value", async () => {
    const result = await executePlan(fakeClient([]), plan());

    expect(result.details).toEqual([
      expect.objectContaining({
        studentId: "20250001",
        studentName: "张三",
        activityId: "activity-1",
        creditType: "美育实践学分",
        plannedValueCent: 50,
        actualValueCent: 50,
        action: "issueCredit",
        status: "success",
      }),
    ]);
  });
});

function fakeClient(calls: string[], options: { signRows?: unknown[] } = {}): ExecutorClient {
  const signRows = options.signRows ?? [];
  return {
    getSignCard: async () => "card-1",
    getSignList: async (_activityId, type) => type === 1 ? signRows : [],
    resign: async () => true,
    getCreditList: async (_kind, _activityId, creditId) => {
      calls.push(`credited:${creditId}`);
      return [];
    },
    sendCredit: async (_activityId, creditId, userIds) => {
      calls.push(`send:${creditId}:${userIds[0]}`);
      return true;
    },
  };
}

function plan(overrides: { userId?: string } = {}): Plan {
  return {
    id: "plan-1",
    name: "学分计划",
    sourceImportId: "import-1",
    generatedAt: "now",
    status: "draft",
    demands: [{
      studentId: "20250001",
      studentName: "张三",
      creditType: "美育实践学分",
      requestedValueCent: 50,
    }],
    activities: [{
      activityId: "activity-1",
      activityName: "活动一",
      creditType: "美育实践学分",
      bundleValueCent: 50,
      bundleCapacity: 10,
      creditItems: [{
        creditId: "credit-1",
        scoreId: "score-1",
        creditType: "美育实践学分",
        unitcountCent: 50,
        remainingCapacity: 10,
      }],
    }],
    allocations: [{
      demand: {
        studentId: "20250001",
        studentName: "张三",
        creditType: "美育实践学分",
        requestedValueCent: 50,
      },
      assignments: [{
        bundle: {
          activityId: "activity-1",
          activityName: "活动一",
          creditType: "美育实践学分",
          bundleValueCent: 50,
          bundleCapacity: 10,
          creditItems: [{
            creditId: "credit-1",
            scoreId: "score-1",
            creditType: "美育实践学分",
            unitcountCent: 50,
            remainingCapacity: 10,
          }],
        },
        signUpId: "signup-1",
        userId: overrides.userId ?? "user-1",
      }],
      plannedValueCent: 50,
      deltaCent: 0,
      enabled: true,
    }],
    preissued: {
      alreadyPartiallyIssued: [],
      alreadyFullyIssued: [],
    },
    notInAdmitList: [],
    summary: {
      demandCount: 1,
      studentCount: 1,
      activityCount: 1,
      plannedIssueCount: 1,
      notInAdmitCount: 0,
      underIssuedCount: 0,
      overIssuedCount: 0,
      alreadyPartiallyIssuedCount: 0,
      alreadyFullyIssuedCount: 0,
    },
    auditLogs: [],
  };
}
