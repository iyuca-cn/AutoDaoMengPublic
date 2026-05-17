import { jsonOk, jsonError, toErrorResponse } from "../http";
import type { RouteContext } from "./context";
import { handleActivityRoutes } from "./activityRoutes";
import { handleConfigRoutes } from "./configRoutes";
import { handleImportRoutes } from "./importRoutes";
import { handleOperationPlanRoutes } from "./operationPlanRoutes";
import { handlePlanRoutes } from "./planRoutes";
import { handleRandomDrainRoutes } from "./randomDrainRoutes";
import { handleReportRoutes } from "./reportRoutes";
import { handleSessionRoutes } from "./sessionRoutes";
import { handleTaskRoutes } from "./taskRoutes";

type RouteHandler = (request: Request, context: RouteContext) => Promise<Response | null>;

const handlers: RouteHandler[] = [
  handleConfigRoutes,
  handleSessionRoutes,
  handleActivityRoutes,
  handleImportRoutes,
  handlePlanRoutes,
  handleOperationPlanRoutes,
  handleTaskRoutes,
  handleReportRoutes,
  handleRandomDrainRoutes,
];

export async function routeRequest(request: Request, context: RouteContext): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(),
    });
  }
  if (request.method === "GET" && url.pathname === "/api/health") {
    return withCors(jsonOk({ service: "daomeng-web", ok: true }));
  }
  if (!url.pathname.startsWith("/api/")) {
    return withCors(jsonError("Not Found", 404, "NOT_FOUND"));
  }
  try {
    for (const handler of handlers) {
      const response = await handler(request, context);
      if (response) {
        return withCors(response);
      }
    }
    return withCors(jsonError("Not Found", 404, "NOT_FOUND"));
  } catch (error) {
    return withCors(toErrorResponse(error));
  }
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders())) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function corsHeaders(): Record<string, string> {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,x-user-timezone",
  };
}
