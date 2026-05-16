import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionManager, validateExportUrl } from "../../server/domain/session";
import type { DmLocalApiClient } from "../../server/local-api/client";
import { JsonStore } from "../../server/storage/jsonStore";

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "daomeng-session-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("SessionManager", () => {
  it("persists only uid and token session fields", async () => {
    const manager = new SessionManager(new JsonStore(dir), fakeClient());
    await manager.loginWithAccount({ account: "alice", pwd: "secret", persist: true });

    const content = await readFile(join(dir, "session", "session.json"), "utf-8");
    const stored = JSON.parse(content) as Record<string, unknown>;
    expect(stored).toMatchObject({ uid: "uid-1", token: "token-1", source: "account" });
    expect(stored.account).toBeUndefined();
    expect(stored.pwd).toBeUndefined();
  });

  it("keeps non-persistent login in memory", async () => {
    const store = new JsonStore(dir);
    const manager = new SessionManager(store, fakeClient());
    await manager.loginWithAccount({ account: "alice", pwd: "secret", persist: false });

    expect(await store.readSession()).toBeNull();
    expect(await manager.currentSession()).toMatchObject({ uid: "uid-1", token: "token-1" });
  });

  it("does not restore again after the current session has been verified", async () => {
    const client = fakeClient();
    const manager = new SessionManager(new JsonStore(dir), client);
    await manager.loginWithAccount({ account: "alice", pwd: "secret", persist: false });
    await manager.requireAuthenticated();

    expect(client.restoreSession).not.toHaveBeenCalled();
  });

  it("restores persisted sessions once before marking them verified", async () => {
    const client = fakeClient();
    const store = new JsonStore(dir);
    const manager = new SessionManager(store, client);
    await manager.loginWithAccount({ account: "alice", pwd: "secret", persist: true });
    const restoredManager = new SessionManager(store, client);

    await restoredManager.requireAuthenticated();
    await restoredManager.requireAuthenticated();

    expect(client.restoreSession).toHaveBeenCalledTimes(1);
  });

  it("validates export urls", () => {
    expect(validateExportUrl("https://apph5.5idream.net/apih5/api/activity/join/export?activityid=1&api_token=t").searchParams.get("api_token")).toBe("t");
    expect(() => validateExportUrl("https://example.com/export?activityid=1&api_token=t")).toThrow("导出 URL 必须来自管理活动人员导出入口");
    expect(() => validateExportUrl("https://apph5.5idream.net/apih5/api/activity/join/export?activityid=1")).toThrow("导出 URL 缺少 api_token");
  });
});

function fakeClient(): DmLocalApiClient & { restoreSession: ReturnType<typeof vi.fn> } {
  return {
    baseUrl: "http://127.0.0.1:18080",
    login: async () => ({ uid: "uid-1", token: "token-1" }),
    importExportUrl: async () => ({ uid: "uid-url", token: "token-url" }),
    restoreSession: vi.fn(async () => true),
    getManagedActivities: async () => ({}),
  } as unknown as DmLocalApiClient & { restoreSession: ReturnType<typeof vi.fn> };
}
