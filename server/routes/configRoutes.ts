import { jsonOk } from "../http";
import type { RouteContext } from "./context";

export async function handleConfigRoutes(request: Request, context: RouteContext): Promise<Response | null> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/api/config") {
    return jsonOk({
      port: context.config.port,
      dataDir: context.config.dataDir,
      localApi: {
        ...context.config.localApi,
        executableExists: await executableExists(context.config.localApi.executablePath),
      },
    });
  }
  if (request.method === "POST" && url.pathname === "/api/local-api/start") {
    const baseUrl = await context.localApiProcessManager.ensureRunning();
    return jsonOk({ baseUrl });
  }
  return null;
}

async function executableExists(path: string): Promise<boolean> {
  const { existsSync } = await import("node:fs");
  return existsSync(path);
}
