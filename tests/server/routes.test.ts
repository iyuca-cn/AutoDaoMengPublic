import { describe, expect, it } from "vitest";
import { loadConfig } from "../../server/config";
import { routeRequest } from "../../server/routes/router";
import { JsonStore } from "../../server/storage/jsonStore";
import { LocalApiProcessManager } from "../../server/local-api/process";
import { DmLocalApiClient } from "../../server/local-api/client";

describe("routes", () => {
  it("serves health and config", async () => {
    const config = loadConfig({ DMLOCALAPI_DISABLE_AUTOSTART: "1" });
    const context = {
      config,
      store: new JsonStore("./data-test"),
      localApiClient: new DmLocalApiClient(config.localApi.baseUrl),
      localApiProcessManager: new LocalApiProcessManager(config.localApi, {
        fetch: async () => Response.json({ success: false }, { status: 503 }),
        exists: () => false,
      }),
    };
    const health = await routeRequest(new Request("http://local/api/health"), context);
    const configResponse = await routeRequest(new Request("http://local/api/config"), context);
    expect(health.status).toBe(200);
    expect(configResponse.status).toBe(200);
  });
});
