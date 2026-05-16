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
