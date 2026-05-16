export interface ApiErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export function jsonOk<T>(data: T, init: ResponseInit = {}): Response {
  return Response.json({ success: true, data }, init);
}

export function jsonError(message: string, status = 500, code = "INTERNAL_ERROR", details?: unknown): Response {
  const body: ApiErrorBody = {
    success: false,
    error: {
      code,
      message,
      details,
    },
  };
  return Response.json(body, { status });
}

export async function readJson<T>(request: Request): Promise<T> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new HttpError("请求体必须是 JSON", 415, "UNSUPPORTED_MEDIA_TYPE");
  }
  return (await request.json()) as T;
}

export class HttpError extends Error {
  constructor(message: string, readonly status = 400, readonly code = "BAD_REQUEST", readonly details?: unknown) {
    super(message);
    this.name = "HttpError";
  }
}

export function toErrorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return jsonError(error.message, error.status, error.code, error.details);
  }
  if (error instanceof Error) {
    return jsonError(error.message);
  }
  return jsonError(String(error));
}

export function pathParts(pathname: string): string[] {
  return pathname.split("/").filter(Boolean).map(decodeURIComponent);
}
