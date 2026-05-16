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
