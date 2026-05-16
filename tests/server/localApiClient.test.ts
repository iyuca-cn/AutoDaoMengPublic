import { describe, expect, it } from "vitest";
import { DmLocalApiClient } from "../../server/local-api/client";

describe("DmLocalApiClient", () => {
  it("maps routes and payloads", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new DmLocalApiClient("http://127.0.0.1:8765", async (input, init) => {
      calls.push({ url: String(input), init });
      return Response.json({ success: true, data: true });
    });

    await client.getManagedActivities();
    await client.getSignCard("1001");
    await client.getSignList("1001", 1);
    await client.resign("1001", ["9001"], false);
    await client.sendCredit("1001", "301", ["u-001"]);
    await client.sendCreditBySignUpId("1001", "301", ["9001"]);

    expect(calls[0].url).toBe("http://127.0.0.1:8765/manage/activities");
    expect(calls[1].url).toBe("http://127.0.0.1:8765/sign/card/1001");
    expect(calls[2].url).toBe("http://127.0.0.1:8765/sign/list?activityId=1001&type=1");
    expect(JSON.parse(String(calls[3].init?.body))).toMatchObject({ activityId: "1001", signUpId_list: ["9001"], is_all: false });
    expect(JSON.parse(String(calls[4].init?.body))).toMatchObject({ userList: "u-001" });
    expect(JSON.parse(String(calls[5].init?.body))).toMatchObject({ signUpIdList: ["9001"] });
  });

  it("throws clear proxy errors", async () => {
    const client = new DmLocalApiClient("http://127.0.0.1:8765", async () => Response.json({ success: false, error: { code: "BAD", message: "坏了" } }, { status: 400 }));
    await expect(client.getManagedActivities()).rejects.toThrow("坏了");
  });

  it("uses updated base URL after the local proxy starts on another port", async () => {
    const calls: string[] = [];
    const client = new DmLocalApiClient("http://127.0.0.1:8765", async (input) => {
      calls.push(String(input));
      return Response.json({ success: true, data: { uid: "uid-1", token: "token-1" } });
    });

    client.setBaseUrl("http://127.0.0.1:8766/");
    await client.login("alice", "secret");

    expect(client.baseUrl).toBe("http://127.0.0.1:8766");
    expect(calls).toEqual(["http://127.0.0.1:8766/session/login"]);
  });
});
