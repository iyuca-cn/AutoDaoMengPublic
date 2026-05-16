export interface ApiResult<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface ApiUnauthorizedEventDetail {
  path: string;
  message: string;
  code: string;
}

export const API_UNAUTHORIZED_EVENT = "daomeng:api-unauthorized";

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(path);
  return readResponse<T>(response, path);
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: body instanceof FormData ? undefined : { "content-type": "application/json" },
    body: body instanceof FormData ? body : JSON.stringify(body ?? {}),
  });
  return readResponse<T>(response, path);
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return readResponse<T>(response, path);
}

export async function apiDelete<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    method: "DELETE",
  });
  return readResponse<T>(response, path);
}

export interface ApiStreamOptions<T> {
  method?: "GET" | "POST";
  body?: unknown;
  onEvent?: (event: import("./types").ApiStreamEvent<T>) => void;
  nonFatalErrorCodes?: string[];
}

export async function apiStream<T>(path: string, options: ApiStreamOptions<T> = {}): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? (options.body === undefined ? "GET" : "POST"),
    headers: options.body === undefined ? undefined : { "content-type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (!response.ok) {
    await readResponse<never>(response, path);
  }
  if (!response.body) {
    throw new Error("接口没有返回流式响应");
  }
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = "";
  let completedData: T | undefined;
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      const event = JSON.parse(trimmed) as import("./types").ApiStreamEvent<T>;
      options.onEvent?.(event);
      if (event.type === "error") {
        if (event.code && options.nonFatalErrorCodes?.includes(event.code)) {
          continue;
        }
        if (event.code === "AUTH_REQUIRED" && typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent<ApiUnauthorizedEventDetail>(API_UNAUTHORIZED_EVENT, {
            detail: {
              path,
              message: event.message || "未登录，请先登录",
              code: event.code,
            },
          }));
        }
        throw new Error(event.message || "流式接口执行失败");
      }
      if (event.type === "completed") {
        completedData = event.data as T;
      }
    }
    if (done) {
      break;
    }
  }
  if (buffer.trim()) {
    const event = JSON.parse(buffer.trim()) as import("./types").ApiStreamEvent<T>;
    options.onEvent?.(event);
    if (event.type === "error") {
      if (event.code && options.nonFatalErrorCodes?.includes(event.code)) {
        return completedData as T;
      }
      throw new Error(event.message || "流式接口执行失败");
    }
    if (event.type === "completed") {
      completedData = event.data as T;
    }
  }
  if (completedData === undefined) {
    throw new Error("流式接口未返回完成结果");
  }
  return completedData;
}

async function readResponse<T>(response: Response, path: string): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const text = await response.text().catch(() => "");
    throw new Error(text.trim() || "接口返回非 JSON 响应，请确认 Bun 后端已启动");
  }
  const payload = (await response.json()) as ApiResult<T>;
  if (!response.ok || !payload.success) {
    const message = payload.error?.message || `HTTP ${response.status}`;
    if (response.status === 401 && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent<ApiUnauthorizedEventDetail>(API_UNAUTHORIZED_EVENT, {
        detail: {
          path,
          message,
          code: payload.error?.code || "UNAUTHORIZED",
        },
      }));
    }
    throw new Error(message);
  }
  return payload.data as T;
}

export function downloadUrl(path: string): string {
  return path;
}
