import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../server/config";
import { SessionManager } from "../../server/domain/session";
import { routeRequest } from "../../server/routes/router";
import { JsonStore } from "../../server/storage/jsonStore";
import { LocalApiProcessManager } from "../../server/local-api/process";
import { DmLocalApiClient } from "../../server/local-api/client";
import type { RouteContext } from "../../server/routes/context";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("routes", () => {
  it("serves health and config", async () => {
    const config = loadConfig({ DMLOCALAPI_DISABLE_AUTOSTART: "1" });
    const store = new JsonStore("./data-test");
    const localApiClient = new DmLocalApiClient(config.localApi.baseUrl);
    const context = {
      config,
      store,
      localApiClient,
      localApiProcessManager: new LocalApiProcessManager(config.localApi, {
        fetch: async () => Response.json({ success: false }, { status: 503 }),
        exists: () => false,
      }),
      sessionManager: new SessionManager(store, localApiClient),
    };
    const health = await routeRequest(new Request("http://local/api/health"), context);
    const configResponse = await routeRequest(new Request("http://local/api/config"), context);
    expect(health.status).toBe(200);
    expect(configResponse.status).toBe(200);
  });

  it("serves session and operation plan routes", async () => {
    const context = createTestContext();
    const session = await routeRequest(jsonRequest("http://local/api/session/login", {
      account: "alice",
      pwd: "secret",
      persist: false,
    }), context);
    expect(session.status).toBe(200);

    const created = await routeRequest(jsonRequest("http://local/api/operation-plans", {
      kind: "resign",
      activityId: "activity-1",
      activityName: "活动一",
      members: [{ studentName: "张三", signUpId: "signup-1", userId: "user-1" }],
    }), context);
    expect(created.status).toBe(201);
    const body = await created.json() as { data: { id: string } };

    const list = await routeRequest(new Request("http://local/api/operation-plans"), context);
    expect(list.status).toBe(200);

    const precheck = await routeRequest(new Request(`http://local/api/operation-plans/${body.data.id}/precheck`, { method: "POST" }), context);
    expect(precheck.status).toBe(200);
  });

  it("deletes editable operation plans", async () => {
    const context = createTestContext();
    await routeRequest(jsonRequest("http://local/api/session/login", {
      account: "alice",
      pwd: "secret",
      persist: false,
    }), context);
    const created = await routeRequest(jsonRequest("http://local/api/operation-plans", {
      kind: "resign",
      activityId: "activity-1",
      activityName: "活动一",
      members: [{ studentName: "张三", signUpId: "signup-1", userId: "user-1" }],
    }), context);
    const body = await created.json() as { data: { id: string } };

    const deleted = await routeRequest(new Request(`http://local/api/operation-plans/${body.data.id}`, { method: "DELETE" }), context);
    const readDeleted = await routeRequest(new Request(`http://local/api/operation-plans/${body.data.id}`), context);

    expect(deleted.status).toBe(200);
    expect(readDeleted.status).toBe(404);
  });

  it("returns unauthorized for protected routes without a valid session", async () => {
    const context = createTestContext();

    const response = await routeRequest(new Request("http://local/api/activities"), context);
    const body = await response.json() as { error: { code: string; message: string } };

    expect(response.status).toBe(401);
    expect(body.error).toMatchObject({
      code: "AUTH_REQUIRED",
      message: "未登录，请先登录",
    });
  });
});

function createTestContext(): RouteContext {
  const dataDir = mkdtempSync(join(tmpdir(), "daomeng-routes-"));
  tempDirs.push(dataDir);
  const config = loadConfig({ DMLOCALAPI_DISABLE_AUTOSTART: "1", DATA_DIR: dataDir });
  const store = new JsonStore(config.dataDir);
  const localApiClient = {
    setBaseUrl: () => undefined,
    login: async () => ({ uid: "uid-1", token: "token-1" }),
    restoreSession: async () => true,
    getManagedActivities: async () => ({ "activity-1": { activityId: "activity-1", name: "活动一" } }),
    getSignCard: async () => "card-1",
    getSignList: async () => [{ signUpId: "signup-1", userId: "user-1", studentName: "张三" }],
    getCreditList: async () => [],
  } as unknown as DmLocalApiClient;
  return {
    config,
    store,
    localApiClient,
    localApiProcessManager: {
      ensureRunning: async () => config.localApi.baseUrl,
    } as unknown as LocalApiProcessManager,
    sessionManager: new SessionManager(store, localApiClient),
  };
}

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
