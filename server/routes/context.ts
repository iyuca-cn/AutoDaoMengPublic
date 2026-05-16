import type { AppConfig } from "../config";
import type { SessionManager } from "../domain/session";
import type { DmLocalApiClient } from "../local-api/client";
import type { LocalApiProcessManager } from "../local-api/process";
import type { JsonStore } from "../storage/jsonStore";

export interface RouteContext {
  config: AppConfig;
  store: JsonStore;
  localApiClient: DmLocalApiClient;
  localApiProcessManager: LocalApiProcessManager;
  sessionManager: SessionManager;
}

export async function ensureLocalApiRunning(context: RouteContext): Promise<string> {
  const baseUrl = await context.localApiProcessManager.ensureRunning();
  context.localApiClient.setBaseUrl(baseUrl);
  return baseUrl;
}
