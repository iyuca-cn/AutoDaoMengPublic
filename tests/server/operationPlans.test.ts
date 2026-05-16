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
  });
});
