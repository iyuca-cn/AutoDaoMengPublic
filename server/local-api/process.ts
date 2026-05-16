import { existsSync } from "node:fs";
import type { LocalApiConfig } from "../config";

export interface SpawnedProcess {
  kill(signal?: string | number): void;
}

export interface ProcessSpawnOptions {
  cwd?: string;
  stdout?: "ignore" | "pipe";
  stderr?: "ignore" | "pipe";
}

export interface ProcessAdapters {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  spawn: (command: string[], options?: ProcessSpawnOptions) => SpawnedProcess;
  exists: (path: string) => boolean;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

const defaultAdapters: ProcessAdapters = {
  fetch,
  spawn(command, options) {
    return Bun.spawn(command, {
      cwd: options?.cwd,
      stdout: options?.stdout ?? "ignore",
      stderr: options?.stderr ?? "ignore",
    });
  },
  exists: existsSync,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
};

export class LocalApiProcessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalApiProcessError";
  }
}

export class LocalApiProcessManager {
  private child?: SpawnedProcess;
  private readonly adapters: ProcessAdapters;

  constructor(private readonly config: LocalApiConfig, adapters: Partial<ProcessAdapters> = {}) {
    this.adapters = { ...defaultAdapters, ...adapters };
  }

  async ensureRunning(): Promise<string> {
    if (await this.isHealthy()) {
      return this.config.baseUrl;
    }
    if (!this.config.autoStart) {
      throw new LocalApiProcessError("DM 本地代理未运行，且自动启动已关闭");
    }
    if (!this.adapters.exists(this.config.executablePath)) {
      throw new LocalApiProcessError(`DM 本地代理可执行文件不存在：${this.config.executablePath}`);
    }
    if (!this.child) {
      this.child = this.adapters.spawn(this.startCommand(), {
        cwd: this.config.workingDirectory,
        stdout: "ignore",
        stderr: "ignore",
      });
    }
    const startedAt = this.adapters.now();
    while (this.adapters.now() - startedAt <= this.config.startupTimeoutMs) {
      if (await this.isHealthy()) {
        return this.config.baseUrl;
      }
      await this.adapters.sleep(250);
    }
    throw new LocalApiProcessError(`DM 本地代理启动超时：${this.config.startupTimeoutMs}ms`);
  }

  async stop(): Promise<void> {
    this.child?.kill();
    this.child = undefined;
  }

  private startCommand(): string[] {
    return [
      this.config.executablePath,
      ...(this.config.startArgs ?? ["--port", String(this.config.port)]),
    ];
  }

  private async isHealthy(): Promise<boolean> {
    try {
      const response = await this.adapters.fetch(`${this.config.baseUrl}/health`);
      if (!response.ok) {
        return false;
      }
      const payload = (await response.json().catch(() => undefined)) as { success?: boolean } | undefined;
      return payload?.success !== false;
    } catch {
      return false;
    }
  }
}
