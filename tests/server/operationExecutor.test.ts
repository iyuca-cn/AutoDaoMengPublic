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

  it("warns for already credited members matched by user id", async () => {
    const report = await precheckOperationPlan(fakeClient({ credited: [{ id: "user-score-1", userId: "user-1" }] }), plan("issueCredit"));
    expect(report.executable).toBe(true);
    expect(report.issues.some((issue) => issue.code === "ALREADY_CREDITED")).toBe(true);
  });

  it("executes resign before issue", async () => {
    const calls: string[] = [];
    const client = fakeClient({ calls });
    const result = await executeOperationPlan(client, plan("resignThenIssueCredit"));
    expect(calls.indexOf("resign:activity-1:signup-1")).toBeLessThan(calls.indexOf("send:activity-1:credit-1:user-1"));
    expect(result.resignSuccessCount).toBe(1);
    expect(result.issueSuccessCount).toBe(1);
    expect(result.details).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "resign", actualValueCent: 0, status: "success" }),
      expect.objectContaining({ action: "issueCredit", actualValueCent: 50, status: "success" }),
    ]));
  });

  it("batch resigns members by activity and issues one credit type together", async () => {
    const calls: string[] = [];
    const client = fakeClient({
      calls,
      signRows: [
        { signUpId: "signup-1", userId: "user-1" },
        { signUpId: "signup-2", userId: "user-2" },
      ],
    });
    const batchPlan = plan("resignThenIssueCredit");
    batchPlan.actions = [
      batchPlan.actions[0],
      {
        ...batchPlan.actions[0],
        id: "action-2",
        studentId: "20250002",
        studentName: "李四",
        signUpId: "signup-2",
        userId: "user-2",
      },
    ];

    const result = await executeOperationPlan(client, batchPlan);

    expect(calls).toContain("resign:activity-1:signup-1,signup-2");
    expect(calls).toContain("send:activity-1:credit-1:user-1,user-2");
    expect(result.resignSuccessCount).toBe(2);
    expect(result.issueSuccessCount).toBe(2);
  });

  it("executes abandon credit with the credited userScoreId", async () => {
    const calls: string[] = [];
    const client = fakeClient({ calls, credited: [{ signUpId: "signup-1", userScoreId: "user-score-1" }] });

    const result = await executeOperationPlan(client, plan("abandonCredit"));

    expect(calls).toContain("abandon:activity-1:credit-1:user-score-1");
    expect(result.abandonSuccessCount).toBe(1);
    expect(result.failedCount).toBe(0);
  });

  it("executes abandon credit when credited rows only expose user id and id", async () => {
    const calls: string[] = [];
    const client = fakeClient({ calls, credited: [{ id: "user-score-1", userId: "user-1" }] });

    const result = await executeOperationPlan(client, plan("abandonCredit"));

    expect(calls).toContain("abandon:activity-1:credit-1:user-score-1");
    expect(result.abandonSuccessCount).toBe(1);
  });

  it("blocks abandon credit when the member has not been credited", async () => {
    const report = await precheckOperationPlan(fakeClient({ credited: [] }), plan("abandonCredit"));

    expect(report.executable).toBe(false);
    expect(report.issues.some((issue) => issue.code === "NOT_CREDITED")).toBe(true);
  });

  it("uses creditId instead of scoreId for operation credit reads and writes", async () => {
    const calls: string[] = [];
    const client = fakeClient({ calls });
    await executeOperationPlan(client, plan("issueCredit"));

    expect(calls).toContain("credited:activity-1:credit-1");
    expect(calls).toContain("send:activity-1:credit-1:user-1");
    expect(calls.some((call) => call.includes("score-1"))).toBe(false);
  });

  it("prechecks and executes each action with its own activity id", async () => {
    const calls: string[] = [];
    const client = fakeClient({ calls });
    const crossPlan = plan("issueCredit");
    crossPlan.activityIds = ["activity-1", "activity-2"];
    crossPlan.activityNames = ["活动一", "活动二"];
    crossPlan.actions = [
      crossPlan.actions[0],
      {
        ...crossPlan.actions[0],
        id: "action-2",
        activityId: "activity-2",
        activityName: "活动二",
        signUpId: "signup-2",
        userId: "user-2",
        creditItems: [{
          ...crossPlan.actions[0].creditItems[0],
          activityId: "activity-2",
          activityName: "活动二",
          creditId: "credit-2",
          scoreId: "score-2",
        }],
      },
    ];

    await executeOperationPlan(client, crossPlan);

    expect(calls).toContain("signCard:activity-1");
    expect(calls).toContain("signCard:activity-2");
    expect(calls).toContain("signList:activity-1:1");
    expect(calls).toContain("signList:activity-2:1");
    expect(calls).toContain("credited:activity-1:credit-1");
    expect(calls).toContain("credited:activity-2:credit-2");
    expect(calls).toContain("send:activity-1:credit-1:user-1");
    expect(calls).toContain("send:activity-2:credit-2:user-2");
  });

  it("resolves the real user uid from sign lists when the plan has an invalid user id", async () => {
    const calls: string[] = [];
    const client = fakeClient({ calls, signRows: [{ signUpId: "signup-1", userId: "uid-actual" }] });

    await executeOperationPlan(client, plan("issueCredit", { userId: "机械工程学院" }));

    expect(calls).toContain("send:activity-1:credit-1:uid-actual");
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
      activityId: "activity-1",
      activityName: "活动一",
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
      expectedResignCount: kind === "resign" || kind === "resignThenIssueCredit" ? 1 : 0,
      expectedIssueCount: kind === "issueCredit" || kind === "resignThenIssueCredit" ? 1 : 0,
      expectedAbandonCount: kind === "abandonCredit" ? 1 : 0,
    },
    auditLogs: [],
  };
}

function fakeClient(options: { signCard?: string | null; credited?: unknown[]; calls?: string[]; signRows?: unknown[] } = {}): OperationExecutorClient {
  const signRows = options.signRows ?? [{ signUpId: "signup-1", userId: "user-1" }];
  return {
    getSignCard: async (activityId) => {
      options.calls?.push(`signCard:${activityId}`);
      return options.signCard === undefined ? "card-1" : options.signCard;
    },
    getSignList: async (activityId, type) => {
      options.calls?.push(`signList:${activityId}:${type}`);
      return type === 1 ? signRowsForActivity(signRows, activityId) : [];
    },
    getCreditList: async (_kind, _activityId, creditId) => {
      options.calls?.push(`credited:${_activityId}:${creditId}`);
      return options.credited ?? [];
    },
    resign: async (activityId, signUpIds) => {
      options.calls?.push(`resign:${activityId}:${signUpIds.join(",")}`);
      return true;
    },
    sendCredit: async (activityId, creditId, userIds) => {
      options.calls?.push(`send:${activityId}:${creditId}:${userIds.join(",")}`);
      return true;
    },
    abandonCredit: async (activityId, creditId, userScoreIds) => {
      options.calls?.push(`abandon:${activityId}:${creditId}:${userScoreIds[0]}`);
      return true;
    },
  };
}

function signRowsForActivity(signRows: unknown[], activityId: string): unknown[] {
  const suffix = activityId.endsWith("2") ? "2" : "1";
  return signRows.length === 1 && activityId.endsWith("2")
    ? [{ signUpId: `signup-${suffix}`, userId: `user-${suffix}` }]
    : signRows;
}
