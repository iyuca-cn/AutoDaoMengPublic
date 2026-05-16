import type { DmLocalApiClient } from "../local-api/client";
import type { JsonStore } from "../storage/jsonStore";
import type { SessionSource, SessionStatus, StoredSession } from "./models";

const EXPORT_URL_PREFIX = "https://apph5.5idream.net/apih5/api/activity/join/export";

export interface LoginInput {
  account: string;
  pwd: string;
  persist?: boolean;
}

export interface ExportUrlInput {
  url: string;
  persist?: boolean;
}

export class SessionManager {
  private memorySession: StoredSession | null = null;

  constructor(private readonly store: JsonStore, private readonly client: DmLocalApiClient) {}

  async status(): Promise<SessionStatus> {
    const session = await this.currentSession();
    if (!session) {
      return { authenticated: false };
    }
    try {
      await this.restoreWith(session);
      const verified = { ...session, lastVerifiedAt: new Date().toISOString() };
      await this.replaceSession(session, verified);
      return publicStatus(verified, true);
    } catch {
      return publicStatus(session, false);
    }
  }

  async loginWithAccount(input: LoginInput): Promise<SessionStatus> {
    const account = input.account?.trim();
    const pwd = input.pwd ?? "";
    if (!account || !pwd) {
      throw new Error("账号和密码不能为空");
    }
    const credentials = await this.client.login(account, pwd);
    const session = buildSession(credentials.uid, credentials.token, "account");
    await this.setSession(session, Boolean(input.persist));
    return publicStatus(session, true);
  }

  async importExportUrl(input: ExportUrlInput): Promise<SessionStatus> {
    validateExportUrl(input.url);
    const credentials = await this.client.importExportUrl(input.url);
    const session = buildSession(credentials.uid, credentials.token, "exportUrl");
    await this.setSession(session, Boolean(input.persist));
    return publicStatus(session, true);
  }

  async restore(): Promise<SessionStatus> {
    const session = await this.currentSession();
    if (!session) {
      throw new Error("没有可恢复的登录态");
    }
    await this.restoreWith(session);
    const verified = { ...session, lastVerifiedAt: new Date().toISOString() };
    await this.replaceSession(session, verified);
    return publicStatus(verified, true);
  }

  async requireAuthenticated(): Promise<StoredSession> {
    const session = await this.currentSession();
    if (!session) {
      throw new Error("未登录，请先登录");
    }
    await this.restoreWith(session);
    const verified = { ...session, lastVerifiedAt: new Date().toISOString() };
    await this.replaceSession(session, verified);
    return verified;
  }

  async logout(): Promise<SessionStatus> {
    this.memorySession = null;
    await this.store.deleteSession();
    return { authenticated: false };
  }

  async currentSession(): Promise<StoredSession | null> {
    return this.memorySession ?? (await this.store.readSession());
  }

  private async setSession(session: StoredSession, persist: boolean): Promise<void> {
    if (persist) {
      await this.store.writeSession(session);
      this.memorySession = null;
      return;
    }
    this.memorySession = session;
  }

  private async replaceSession(previous: StoredSession, next: StoredSession): Promise<void> {
    if (this.memorySession?.uid === previous.uid && this.memorySession.token === previous.token) {
      this.memorySession = next;
      return;
    }
    const stored = await this.store.readSession();
    if (stored?.uid === previous.uid && stored.token === previous.token) {
      await this.store.writeSession(next);
    }
  }

  private async restoreWith(session: StoredSession): Promise<void> {
    await this.client.restoreSession(session.uid, session.token);
    await this.client.getManagedActivities();
  }
}

export function validateExportUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("导出 URL 格式不合法");
  }
  const prefixUrl = new URL(EXPORT_URL_PREFIX);
  if (url.origin !== prefixUrl.origin || url.pathname !== prefixUrl.pathname || !url.searchParams.get("activityid")) {
    throw new Error("导出 URL 必须来自管理活动人员导出入口");
  }
  if (!url.searchParams.get("api_token")) {
    throw new Error("导出 URL 缺少 api_token");
  }
  return url;
}

function buildSession(uid: string, token: string, source: SessionSource): StoredSession {
  if (!uid || !token) {
    throw new Error("代理没有返回有效 uid/token");
  }
  const now = new Date().toISOString();
  return {
    uid,
    token,
    source,
    savedAt: now,
    lastVerifiedAt: now,
  };
}

function publicStatus(session: StoredSession, authenticated: boolean): SessionStatus {
  return {
    authenticated,
    source: session.source,
    savedAt: session.savedAt,
    lastVerifiedAt: session.lastVerifiedAt,
  };
}
