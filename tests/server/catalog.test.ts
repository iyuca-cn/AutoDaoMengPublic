import { describe, expect, it } from "vitest";
import { buildActivityBundles, buildActivityOverview, type CatalogClient } from "../../server/domain/catalog";

describe("activity catalog", () => {
  it("skips activities without sign cards when building plannable bundles", async () => {
    const client = createCatalogClient({
      getSignCard: async (activityId) => activityId === "activity-with-card" ? "card-1" : null,
    });

    const bundles = await buildActivityBundles(client);

    expect(bundles.map((item) => item.activityId)).toEqual(["activity-with-card"]);
  });

  it("keeps overview rows for activities without sign cards", async () => {
    const creditCalls: string[] = [];
    const client = createCatalogClient({
      getSignCard: async (activityId) => activityId === "activity-with-card" ? "card-1" : null,
      getCreditTypes: async (activityId) => {
        creditCalls.push(activityId);
        return [creditRow()];
      },
    });

    const overview = await buildActivityOverview(client);

    const withoutCard = overview.find((item) => item.activityId === "activity-without-card");
    expect(withoutCard).toMatchObject({
      hasSignCard: false,
      signCounts: { unsigned: 0, signed: 0, signout: 0, leave: 0 },
      creditItems: [],
      creditedCounts: {},
    });
    expect(withoutCard?.readError).toBeUndefined();
    expect(creditCalls).toEqual(["activity-with-card"]);
  });

  it("reports a single activity read error without failing the whole overview", async () => {
    const client = createCatalogClient({
      getSignCard: async (activityId) => {
        if (activityId === "activity-without-card") {
          throw new Error("upstream timeout");
        }
        return "card-1";
      },
    });

    const overview = await buildActivityOverview(client, 1);

    const failed = overview.find((item) => item.activityId === "activity-without-card");
    const healthy = overview.find((item) => item.activityId === "activity-with-card");
    expect(failed?.readError).toContain("upstream timeout");
    expect(failed?.hasSignCard).toBe(false);
    expect(healthy?.hasSignCard).toBe(true);
    expect(healthy?.creditItems).toHaveLength(1);
  });

  it("reads credited counts with credit id and keeps the UI keyed by score id", async () => {
    const requestedCreditIds: string[] = [];
    const client = createCatalogClient({
      getCreditTypes: async () => [
        creditRow({ creditId: "credit-1", scoreId: "score-1", scorename: "美育实践学分" }),
        creditRow({ creditId: "credit-2", scoreId: "score-2", scorename: "思想成长学分" }),
      ],
      getCreditList: async (_kind, _activityId, creditId) => {
        requestedCreditIds.push(creditId);
        return creditId === "credit-1" ? [{ signUpId: "signup-1" }] : [{ signUpId: "signup-2" }, { signUpId: "signup-3" }];
      },
    });

    const overview = await buildActivityOverview(client);

    const item = overview.find((row) => row.activityId === "activity-with-card");
    expect(item?.creditedCounts).toMatchObject({
      "score-1": 1,
      "score-2": 2,
    });
    expect(requestedCreditIds).toContain("credit-1");
    expect(requestedCreditIds).toContain("credit-2");
    expect(requestedCreditIds.some((id) => id.startsWith("score-"))).toBe(false);
  });
});

function createCatalogClient(overrides: Partial<CatalogClient> = {}): CatalogClient {
  return {
    getManagedActivities: async () => ({
      "activity-without-card": { activityId: "activity-without-card", name: "无签到卡活动" },
      "activity-with-card": { activityId: "activity-with-card", name: "有签到卡活动" },
    }),
    getSignCard: async () => "card-1",
    getCreditTypes: async () => [creditRow()],
    getSignList: async () => [{ signUpId: "signup-1" }],
    getCreditList: async () => [{ userId: "user-1" }],
    ...overrides,
  };
}

function creditRow(overrides: Partial<Record<string, string>> = {}): Record<string, string> {
  return {
    creditId: "credit-1",
    scoreId: "score-1",
    scorename: "美育实践学分",
    unitcount: "0.50",
    num: "10",
    providenum: "2",
    ...overrides,
  };
}
