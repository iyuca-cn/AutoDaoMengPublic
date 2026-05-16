import { CREDIT_LIST_URLS, EXPORT_TYPES, SIGN_TYPES } from "../domain/models";

export interface LocalApiSuccess<T> {
  success: true;
  data: T;
}

export interface LocalApiFailure {
  success: false;
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
}

export class LocalApiError extends Error {
  readonly code: string;
  readonly statusCode?: number;
  readonly details?: unknown;

  constructor(message: string, options: { code?: string; statusCode?: number; details?: unknown } = {}) {
    super(message);
    this.name = "LocalApiError";
    this.code = options.code ?? "";
    this.statusCode = options.statusCode;
    this.details = options.details;
  }
}

export interface FetchLike {
  (input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface DmLocalApiClientOptions {
  requestTimeoutMs?: number;
}

type JsonRecord = Record<string, unknown>;

const SENSITIVE_KEYS = new Set(["uid", "token", "api_token", "pwd", "account"]);
const DEFAULT_REQUEST_TIMEOUT_MS = 8_000;

export class DmLocalApiClient {
  private currentBaseUrl: string;
  private readonly fetcher: FetchLike;
  private readonly requestTimeoutMs: number;

  constructor(baseUrl: string, fetcher: FetchLike = fetch, options: DmLocalApiClientOptions = {}) {
    this.currentBaseUrl = normalizeBaseUrl(baseUrl);
    this.fetcher = fetcher;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  get baseUrl(): string {
    return this.currentBaseUrl;
  }

  setBaseUrl(baseUrl: string): void {
    this.currentBaseUrl = normalizeBaseUrl(baseUrl);
  }

  async health(): Promise<unknown> {
    return this.get("/health");
  }

  async login(account: string, pwd: string): Promise<{ uid: string; token: string }> {
    return this.post("/session/login", { account, pwd });
  }

  async restoreSession(uid: string, token: string): Promise<unknown> {
    return this.post("/session", { uid, token });
  }

  async importExportUrl(url: string): Promise<{ uid: string; token: string }> {
    return this.post("/session/import-export-url", { url });
  }

  async getManagedActivities(): Promise<Record<string, unknown>> {
    return this.get("/manage/activities");
  }

  async getActivities(tribeId: string): Promise<unknown> {
    return this.get("/activities", { tribeId });
  }

  async getSignCard(activityId: string): Promise<string | null> {
    return this.get(`/sign/card/${encodeURIComponent(activityId)}`);
  }

  async getSignList(activityId: string, type: (typeof SIGN_TYPES)[keyof typeof SIGN_TYPES]): Promise<unknown[]> {
    return this.get("/sign/list", { activityId, type: String(type) });
  }

  async resign(activityId: string, signUpIds: string[], isAll = false): Promise<boolean> {
    return this.post("/sign/resign", {
      activityId,
      signUpId_list: signUpIds,
      is_all: isAll,
    });
  }

  async getCreditTypes(activityId: string): Promise<unknown[]> {
    return this.get("/credit/types", { activityId });
  }

  async getCreditTypesMap(activityId: string): Promise<unknown> {
    return this.get("/credit/types-map", { activityId });
  }

  async getCreditList(kind: keyof typeof CREDIT_LIST_URLS, activityId: string, creditId: string): Promise<unknown[]> {
    return this.post("/credit/list", {
      url: CREDIT_LIST_URLS[kind],
      activityId,
      scoreId: creditId,
    });
  }

  async sendCredit(activityId: string, creditId: string, userIds: string[]): Promise<boolean> {
    if (userIds.length === 0) {
      throw new LocalApiError("userList 不能为空", { code: "EMPTY_USER_LIST" });
    }
    return this.post("/credit/send", {
      activityId,
      scoreId: creditId,
      userList: userIds.join(","),
    });
  }

  async abandonCredit(activityId: string, creditId: string, userScoreIds: string[]): Promise<boolean> {
    if (userScoreIds.length === 0) {
      throw new LocalApiError("userScoreIds 不能为空", { code: "EMPTY_USER_SCORE_IDS" });
    }
    return this.post("/credit/abandon", {
      activityId,
      scoreId: creditId,
      userScoreIds: userScoreIds.join(","),
    });
  }

  async sendCreditByName(activityId: string, scoreId: string, usernameList: string[]): Promise<boolean> {
    return this.post("/credit/send-by-name", {
      activityId,
      scoreId,
      usernameList,
    });
  }

  async sendCreditBySignUpId(activityId: string, scoreId: string, signUpIdList: string[]): Promise<unknown> {
    return this.post("/credit/send-by-signup-id", {
      activityId,
      scoreId,
      signUpIdList,
    });
  }

  async findNotSent(activityId: string, scoreId: string, signUpIdList: string[]): Promise<unknown> {
    return this.post("/credit/find-not-sent", {
      activityId,
      scoreId,
      signUpId_list: signUpIdList,
    });
  }

  async exportMembers(activityId: string, type: (typeof EXPORT_TYPES)[keyof typeof EXPORT_TYPES]): Promise<ArrayBuffer> {
    const url = this.buildUrl("/export/members", { activityId, type: String(type) });
    const response = await this.fetchWithTimeout(url);
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || contentType.includes("application/json")) {
      await this.throwFromResponse(response);
    }
    return response.arrayBuffer();
  }

  async get<T>(path: string, params?: JsonRecord): Promise<T> {
    const response = await this.fetchWithTimeout(this.buildUrl(path, params));
    return this.readJsonResponse<T>(response);
  }

  async post<T>(path: string, body: JsonRecord = {}): Promise<T> {
    const response = await this.fetchWithTimeout(this.buildUrl(path), {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    return this.readJsonResponse<T>(response);
  }

  summarizePayload(payload: JsonRecord): JsonRecord {
    return Object.fromEntries(
      Object.entries(payload).map(([key, value]) => [
        key,
        SENSITIVE_KEYS.has(key) ? maskSecret(value) : summarizeValue(key, value),
      ]),
    );
  }

  private buildUrl(path: string, params?: JsonRecord): string {
    const url = new URL(path, `${this.currentBaseUrl}/`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  private async fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    const timeoutMs = Math.max(1, this.requestTimeoutMs);
    const controller = new AbortController();
    const existingSignal = init.signal;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const abortFromCaller = () => controller.abort();
    try {
      if (existingSignal?.aborted) {
        controller.abort();
      } else {
        existingSignal?.addEventListener("abort", abortFromCaller, { once: true });
      }
      return await this.fetcher(input, {
        ...init,
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new LocalApiError(`DM 本地代理请求超时：${timeoutMs}ms`, {
          code: "LOCAL_API_TIMEOUT",
          details: { url: String(input), timeoutMs },
        });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      existingSignal?.removeEventListener("abort", abortFromCaller);
    }
  }

  private async readJsonResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
      await this.throwFromResponse(response);
    }
    let payload: LocalApiSuccess<T> | LocalApiFailure;
    try {
      payload = (await response.json()) as LocalApiSuccess<T> | LocalApiFailure;
    } catch (error) {
      throw new LocalApiError("代理返回了非 JSON 响应", {
        statusCode: response.status,
        details: error,
      });
    }
    if (!payload.success) {
      const error = payload.error ?? {};
      throw new LocalApiError(error.message || "代理接口返回失败", {
        code: error.code,
        statusCode: response.status,
        details: error.details,
      });
    }
    return payload.data;
  }

  private async throwFromResponse(response: Response): Promise<never> {
    let details: unknown;
    let message = `HTTP ${response.status}`;
    let code = "";
    try {
      const payload = (await response.json()) as LocalApiFailure;
      details = payload.error;
      message = payload.error?.message || message;
      code = payload.error?.code || "";
    } catch {
      details = await response.text().catch(() => undefined);
    }
    throw new LocalApiError(message, {
      code,
      statusCode: response.status,
      details,
    });
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function maskSecret(value: unknown): string {
  const text = String(value ?? "");
  if (text.length <= 2) {
    return "*".repeat(text.length);
  }
  if (text.length <= 6) {
    return `${text[0]}***${text[text.length - 1]}`;
  }
  return `${text.slice(0, 3)}***${text.slice(-3)}`;
}

function summarizeValue(key: string, value: unknown): unknown {
  if (key.toLowerCase().includes("url") && typeof value === "string") {
    return summarizeUrl(value);
  }
  if (Array.isArray(value)) {
    return { count: value.length, sample: value.slice(0, 3).map((item) => String(item)) };
  }
  if (typeof value === "string" && value.length > 80) {
    return `${value.slice(0, 80)}...(len=${value.length})`;
  }
  return value;
}

function summarizeUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}?${[...url.searchParams.keys()].sort().join("&")}`;
  } catch {
    return value.length > 40 ? `${value.slice(0, 40)}...(len=${value.length})` : value;
  }
}
