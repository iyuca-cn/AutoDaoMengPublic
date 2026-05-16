import { loadConfig } from "./config";
import { SessionManager } from "./domain/session";
import { DmLocalApiClient } from "./local-api/client";
import { LocalApiProcessManager } from "./local-api/process";
import { routeRequest } from "./routes/router";
import { JsonStore } from "./storage/jsonStore";

export function createServerContext() {
  const config = loadConfig();
  const store = new JsonStore(config.dataDir);
  const localApiClient = new DmLocalApiClient(config.localApi.baseUrl, fetch, {
    requestTimeoutMs: config.localApi.requestTimeoutMs,
  });
  const localApiProcessManager = new LocalApiProcessManager(config.localApi);
  const sessionManager = new SessionManager(store, localApiClient);
  return {
    config,
    store,
    localApiClient,
    localApiProcessManager,
    sessionManager,
  };
}

if ((import.meta as ImportMeta & { main?: boolean }).main) {
  const context = createServerContext();
  Bun.serve({
    port: context.config.port,
    idleTimeout: context.config.serverIdleTimeoutSeconds,
    async fetch(request) {
      return routeRequest(request, context);
    },
  });
  console.log(`到梦空间 Web 后端已启动：http://127.0.0.1:${context.config.port}`);
}
