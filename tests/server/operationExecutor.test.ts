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
    expect(calls).toEqual(["credited:credit-1", "resign:signup-1", "credited:credit-1", "send:credit-1:user-1"]);
    expect(result.resignSuccessCount).toBe(1);
    expect(result.issueSuccessCount).toBe(1);
  });

  it("uses creditId instead of scoreId for operation credit reads and writes", async () => {
    const calls: string[] = [];
    const client = fakeClient({ calls });
    await executeOperationPlan(client, plan("issueCredit"));

    expect(calls).toEqual(["credited:credit-1", "credited:credit-1", "send:credit-1:user-1"]);
    expect(calls.some((call) => call.includes("score-1"))).toBe(false);
  });

  it("resolves the real user uid from sign lists when the plan has an invalid user id", async () => {
    const calls: string[] = [];
    const client = fakeClient({ calls, signRows: [{ signUpId: "signup-1", userId: "uid-actual" }] });

    await executeOperationPlan(client, plan("issueCredit", { userId: "机械工程学院" }));

    expect(calls).toEqual(["credited:credit-1", "credited:credit-1", "send:credit-1:uid-actual"]);
  });

  it("blocks issue actions when a valid user uid cannot be resolved", async () => {
    const report = await precheckOperationPlan(
      fakeClient({ signRows: [{ signUpId: "signup-1", userId: "机械工程学院" }] }),
      plan("issueCredit", { userId: "机械工程学院" }),
    );

    expect(report.executable).toBe(false);
    expect(report.issues.some((issue) => issue.code === "MISSING_USER_ID")).toBe(true);
  });
});

function plan(kind: OperationPlan["kind"], overrides: { userId?: string } = {}): OperationPlan {
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
      userId: overrides.userId ?? "user-1",
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

function fakeClient(options: { signCard?: string | null; credited?: unknown[]; calls?: string[]; signRows?: unknown[] } = {}): OperationExecutorClient {
  const signRows = options.signRows ?? [{ signUpId: "signup-1", userId: "user-1" }];
  return {
    getSignCard: async () => options.signCard === undefined ? "card-1" : options.signCard,
    getSignList: async (_activityId, type) => type === 1 ? signRows : [],
    getCreditList: async (_kind, _activityId, creditId) => {
      options.calls?.push(`credited:${creditId}`);
      return options.credited ?? [];
    },
    resign: async (_activityId, signUpIds) => {
      options.calls?.push(`resign:${signUpIds[0]}`);
      return true;
    },
    sendCredit: async (_activityId, creditId, userIds) => {
      options.calls?.push(`send:${creditId}:${userIds[0]}`);
      return true;
    },
  };
}
