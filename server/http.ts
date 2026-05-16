export interface ApiErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface StreamEvent<T = unknown> {
  type: "started" | "progress" | "data" | "task" | "completed" | "error";
  message?: string;
  data?: T;
  code?: string;
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

export function ndjsonStream(handler: (send: (event: StreamEvent) => void) => Promise<void>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: StreamEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        await handler(send);
      } catch (error) {
        if (error instanceof HttpError) {
          send({ type: "error", message: error.message, code: error.code, data: { status: error.status, details: error.details } });
        } else if (error instanceof Error) {
          send({ type: "error", message: error.message, code: "INTERNAL_ERROR" });
        } else {
          send({ type: "error", message: String(error), code: "INTERNAL_ERROR" });
        }
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache",
    },
  });
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
