import { describe, expect, it } from "vitest";
import { executeOperationPlan, precheckOperationPlan, type OperationExecutorClient } from "../../server/domain/operationExecutor";
import type { OperationPlan } from "../../server/domain/models";

describe("operation executor", () => {
  it("blocks when sign card is missing", async () => {
    const report = await precheckOperationPlan(fakeClient({ signCard: null }), plan("resign"));
    expect(report.executable).toBe(false);
    expect(report.issues[0].code).toBe("NO_SIGN_CARD");
  });

  it("warns for already credited members", async () => {
    const report = await precheckOperationPlan(fakeClient({ credited: [{ signUpId: "signup-1" }] }), plan("issueCredit"));
    expect(report.executable).toBe(true);
    expect(report.issues.some((issue) => issue.code === "ALREADY_CREDITED")).toBe(true);
  });

  it("executes resign before issue", async () => {
    const calls: string[] = [];
    const client = fakeClient({ calls });
    const result = await executeOperationPlan(client, plan("resignThenIssueCredit"));
    expect(calls).toEqual(["resign:signup-1", "send:user-1"]);
    expect(result.resignSuccessCount).toBe(1);
    expect(result.issueSuccessCount).toBe(1);
  });
});

function plan(kind: OperationPlan["kind"]): OperationPlan {
  return {
    id: "plan-1",
    name: "操作计划",
    kind,
    activityId: "activity-1",
    activityName: "活动一",
    createdAt: "now",
    updatedAt: "now",
    status: "draft",
    actions: [{
      id: "action-1",
      kind,
      studentId: "20250001",
      studentName: "张三",
      signUpId: "signup-1",
      userId: "user-1",
      enabled: true,
      status: "planned",
      creditItems: kind === "resign" ? [] : [{
        activityId: "activity-1",
        activityName: "活动一",
        creditId: "credit-1",
        scoreId: "score-1",
        creditType: "思想成长学分",
        unitcountCent: 50,
        totalCapacity: 10,
        issuedCount: 0,
        remainingCapacity: 10,
      }],
    }],
    summary: {
      actionCount: 1,
      enabledCount: 1,
      targetMemberCount: 1,
      targetCreditItemCount: kind === "resign" ? 0 : 1,
      expectedResignCount: kind === "issueCredit" ? 0 : 1,
      expectedIssueCount: kind === "resign" ? 0 : 1,
    },
    auditLogs: [],
  };
}

function fakeClient(options: { signCard?: string | null; credited?: unknown[]; calls?: string[] } = {}): OperationExecutorClient {
  return {
    getSignCard: async () => options.signCard === undefined ? "card-1" : options.signCard,
    getSignList: async (_activityId, type) => type === 1 ? [{ signUpId: "signup-1", userId: "user-1" }] : [],
    getCreditList: async () => options.credited ?? [],
    resign: async (_activityId, signUpIds) => {
      options.calls?.push(`resign:${signUpIds[0]}`);
      return true;
    },
    sendCredit: async (_activityId, _scoreId, userIds) => {
      options.calls?.push(`send:${userIds[0]}`);
      return true;
    },
  };
}
