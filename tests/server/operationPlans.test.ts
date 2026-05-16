import { describe, expect, it } from "vitest";
import { createOperationPlan, patchOperationPlan } from "../../server/domain/operationPlans";
import type { ActivityCreditItem, ActivityPersonRow } from "../../server/domain/models";

const member: ActivityPersonRow = {
  studentId: "20250001",
  studentName: "张三",
  signUpId: "signup-1",
  userId: "user-1",
};

const creditItem: ActivityCreditItem = {
  creditId: "credit-1",
  scoreId: "score-1",
  creditType: "思想成长学分",
  unitcountCent: 50,
  totalCapacity: 10,
  issuedCount: 2,
  remainingCapacity: 8,
};

describe("operation plans", () => {
  it("creates resign plans without credit items", () => {
    const plan = createOperationPlan({
      kind: "resign",
      activityId: "activity-1",
      activityName: "活动一",
      members: [member],
    });
    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0].creditItems).toHaveLength(0);
    expect(plan.summary.expectedResignCount).toBe(1);
    expect(plan.summary.expectedIssueCount).toBe(0);
  });

  it("creates issue plans from selected members and credit items", () => {
    const plan = createOperationPlan({
      kind: "issueCredit",
      activityId: "activity-1",
      activityName: "活动一",
      members: [member],
      creditItems: [creditItem],
    });
    expect(plan.actions[0].creditItems[0]).toMatchObject({ scoreId: "score-1", activityId: "activity-1" });
    expect(plan.summary.expectedIssueCount).toBe(1);
  });

  it("keeps selected credit items independent when an activity has multiple items", () => {
    const otherCreditItem: ActivityCreditItem = {
      ...creditItem,
      creditId: "credit-2",
      scoreId: "score-2",
      creditType: "劳动教育学分",
    };
    const plan = createOperationPlan({
      kind: "issueCredit",
      activityId: "activity-1",
      activityName: "活动一",
      members: [member],
      creditItems: [otherCreditItem],
    });

    expect(plan.actions[0].creditItems).toHaveLength(1);
    expect(plan.actions[0].creditItems[0]).toMatchObject({ scoreId: "score-2", creditType: "劳动教育学分" });
    expect(plan.actions[0].creditItems.some((item) => item.scoreId === "score-1")).toBe(false);
  });

  it("rejects issue credit plans with missing score id", () => {
    expect(() => createOperationPlan({
      kind: "issueCredit",
      activityId: "activity-1",
      activityName: "活动一",
      members: [member],
      creditItems: [{ ...creditItem, scoreId: "" }],
    })).toThrow("缺少 scoreId");
  });

  it("rejects missing signup id", () => {
    expect(() => createOperationPlan({
      kind: "resign",
      activityId: "activity-1",
      activityName: "活动一",
      members: [{ studentName: "李四" }],
    })).toThrow("缺少 signUpId");
  });

  it("patches editable actions and summary", () => {
    const plan = createOperationPlan({
      kind: "issueCredit",
      activityId: "activity-1",
      activityName: "活动一",
      members: [member],
      creditItems: [creditItem],
    });
    const patched = patchOperationPlan(plan, {
      actions: [{ ...plan.actions[0], enabled: false }],
    });
    expect(patched.summary.enabledCount).toBe(0);
    expect(patched.actions[0].status).toBe("disabled");
    expect(patched.status).toBe("ready");
  });

  it("patches operation plan names", () => {
    const plan = createOperationPlan({
      kind: "resign",
      activityId: "activity-1",
      activityName: "活动一",
      members: [member],
    });

    const patched = patchOperationPlan(plan, { name: "  新标题  " });

    expect(patched.name).toBe("新标题");
  });
});
