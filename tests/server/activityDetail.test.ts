import { describe, expect, it } from "vitest";
import { buildActivityDetail, normalizePerson, type ActivityDetailClient } from "../../server/domain/activityDetail";

describe("activity detail person normalization", () => {
  it("keeps credited row id as userScoreId instead of signup id", () => {
    const person = normalizePerson({
      id: "user-score-1",
      userId: "user-1",
      name: "张三",
    }, { source: "credit.credited" });

    expect(person.signUpId).toBeUndefined();
    expect(person.userScoreId).toBe("user-score-1");
    expect(person.userId).toBe("user-1");
  });

  it("keeps credit lists separate when two credit items share one score id", async () => {
    const detail = await buildActivityDetail(fakeClient(), "activity-1");
    const item03 = detail.creditItems.find((item) => item.creditId === "credit-03");
    const item02 = detail.creditItems.find((item) => item.creditId === "credit-02");

    expect(item03).toBeTruthy();
    expect(item02).toBeTruthy();
    expect(detail.creditListsByScoreId[item03!.creditId].credited).toHaveLength(1);
    expect(detail.creditListsByScoreId[item03!.creditId].notSent).toHaveLength(0);
    expect(detail.creditListsByScoreId[item02!.creditId].credited).toHaveLength(0);
    expect(detail.creditListsByScoreId[item02!.creditId].notSent).toHaveLength(1);
  });
});

function fakeClient(): ActivityDetailClient {
  return {
    getManagedActivities: async () => ({ "activity-1": { activityId: "activity-1", name: "活动一" } }),
    getSignCard: async () => "sign-card",
    getSignList: async () => [],
    getCreditTypes: async () => [
      { creditId: "credit-03", scoreId: "20924", scorename: "美育实践学分", unitcount: "0.30", num: "200", providenum: "1" },
      { creditId: "credit-02", scoreId: "20924", scorename: "美育实践学分", unitcount: "0.20", num: "300", providenum: "79" },
    ],
    getCreditList: async (kind, _activityId, creditId) => {
      if (kind === "credited" && creditId === "credit-03") {
        return [{ id: "user-score-1", userId: "user-1", name: "张三" }];
      }
      if (kind === "other" && creditId === "credit-02") {
        return [{ id: "signup-1", userId: "user-1", name: "张三" }];
      }
      return [];
    },
    exportMembers: async () => new ArrayBuffer(0),
  };
}
