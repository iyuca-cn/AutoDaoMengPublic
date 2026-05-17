import { describe, expect, it } from "vitest";
import { buildRandomDrainPreview, executeRandomDrainBatch, type RandomDrainClient } from "../../server/domain/randomDrain";

describe("random drain", () => {
  it("builds preview from selected activity credit items with percent threshold and jitter", async () => {
    const batch = await buildRandomDrainPreview(fakeClient(), {
      thresholdPercent: 90,
      jitterCount: 0,
      selectedItems: [{ activityId: "activity-1", creditId: "credit-1" }],
    }, () => 0);

    expect(batch.activities).toHaveLength(1);
    expect(batch.activities[0].selections).toHaveLength(1);
    expect(batch.activities[0].selections[0]).toMatchObject({
      activityId: "activity-1",
      creditId: "credit-1",
      totalCapacity: 10,
      providedCount: 7,
      thresholdPercent: 90,
      baseTargetCount: 9,
      jitterOffset: 0,
      finalTargetCount: 9,
      candidateCount: 3,
      status: "ready",
    });
    expect(batch.activities[0].selections[0].selectedMembers.map((item) => item.signUpId)).toHaveLength(2);
  });

  it("skips selected credit item that already reached threshold", async () => {
    const batch = await buildRandomDrainPreview(fakeClient(), {
      thresholdPercent: 70,
      jitterCount: 0,
      selectedItems: [{ activityId: "activity-1", creditId: "credit-1" }],
    }, () => 0);

    expect(batch.activities[0].selections[0]).toMatchObject({
      status: "threshold_reached",
      plannedIssueCount: 0,
      selectedMembers: [],
    });
  });

  it("marks no sign card activity without reading credit rows", async () => {
    const batch = await buildRandomDrainPreview(fakeClient({ signCard: null }), {
      thresholdPercent: 90,
      jitterCount: 0,
      selectedItems: [{ activityId: "activity-1", creditId: "credit-1" }],
    }, () => 0);

    expect(batch.activities[0].selections[0]).toMatchObject({
      activityId: "activity-1",
      status: "no_sign_card",
      plannedIssueCount: 0,
    });
  });

  it("executes selected batch and records person-level details", async () => {
    const calls: string[] = [];
    const client = fakeClient({ calls });
    const batch = await buildRandomDrainPreview(client, {
      thresholdPercent: 90,
      jitterCount: 0,
      selectedItems: [{ activityId: "activity-1", creditId: "credit-1" }],
    }, () => 0);

    const result = await executeRandomDrainBatch(client, batch, ["activity-1"]);

    expect(calls.some((call) => call.startsWith("send:activity-1:credit-1:"))).toBe(true);
    expect(result.issueSuccessCount).toBe(2);
    expect(result.details?.filter((item) => item.action === "issueCredit" && item.status === "success")).toHaveLength(2);
    expect(result.details?.[0]).toMatchObject({
      activityId: "activity-1",
      activityName: "活动一",
      creditId: "credit-1",
      scoreId: "score-1",
      creditType: "美育实践学分",
    });
  });
});

function fakeClient(options: { signCard?: string | null; calls?: string[] } = {}): RandomDrainClient {
  const calls = options.calls ?? [];
  const credited = new Set(["signup-1", "signup-4", "signup-5", "signup-6", "signup-7"]);
  const sentByCredit = new Set<string>();
  return {
    getManagedActivities: async () => ({
      "activity-1": { activityId: "activity-1", name: "活动一" },
    }),
    getSignCard: async () => options.signCard === undefined ? "card-1" : options.signCard,
    getCreditTypes: async () => [{
      creditId: "credit-1",
      scoreId: "score-1",
      scorename: "美育实践学分",
      unitcount: "0.50",
      num: "10",
      providenum: "7",
    }],
    getCreditList: async (kind) => {
      if (kind === "credited") {
        return [...credited, ...sentByCredit].map((signUpId) => ({
          signUpId,
          userId: `user-${signUpId.replace("signup-", "")}`,
          name: `学生${signUpId}`,
        }));
      }
      if (kind === "candidates") {
        return [
          { signUpId: "signup-2", userId: "user-2", name: "李四" },
          { signUpId: "signup-3", userId: "user-3", name: "王五" },
        ];
      }
      return [{ signUpId: "signup-8", userId: "user-8", name: "赵六" }];
    },
    getSignList: async () => [{ signUpId: "signup-2", userId: "user-2", name: "李四" }],
    resign: async (activityId, signUpIds) => {
      calls.push(`resign:${activityId}:${signUpIds.join(",")}`);
      return true;
    },
    sendCredit: async (activityId, creditId, userIds) => {
      calls.push(`send:${activityId}:${creditId}:${userIds.join(",")}`);
      for (const userId of userIds) {
        sentByCredit.add(`signup-${userId.replace("user-", "")}`);
      }
      return true;
    },
  };
}
