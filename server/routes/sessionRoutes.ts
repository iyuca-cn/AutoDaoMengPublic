import { HttpError, jsonOk, readJson } from "../http";
import { ensureLocalApiRunning, type RouteContext } from "./context";

interface LoginBody {
  account?: string;
  pwd?: string;
  persist?: boolean;
}

interface ExportUrlBody {
  url?: string;
  persist?: boolean;
}

export async function handleSessionRoutes(request: Request, context: RouteContext): Promise<Response | null> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/api/session") {
    await ensureLocalApiRunning(context);
    return jsonOk(await context.sessionManager.status());
  }
  if (request.method === "POST" && url.pathname === "/api/session/login") {
    await ensureLocalApiRunning(context);
    const body = await readJson<LoginBody>(request);
    return jsonOk(await context.sessionManager.loginWithAccount({
      account: body.account ?? "",
      pwd: body.pwd ?? "",
      persist: body.persist,
    }));
  }
  if (request.method === "POST" && url.pathname === "/api/session/import-export-url") {
    await ensureLocalApiRunning(context);
    const body = await readJson<ExportUrlBody>(request);
    if (!body.url) {
      throw new HttpError("导出 URL 不能为空", 400, "EXPORT_URL_REQUIRED");
    }
    return jsonOk(await context.sessionManager.importExportUrl({
      url: body.url,
      persist: body.persist,
    }));
  }
  if (request.method === "POST" && url.pathname === "/api/session/restore") {
    await ensureLocalApiRunning(context);
    return jsonOk(await context.sessionManager.restore());
  }
  if (request.method === "DELETE" && url.pathname === "/api/session") {
    return jsonOk(await context.sessionManager.logout());
  }
  return null;
}
