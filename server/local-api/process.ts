import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { createServer } from "node:net";
import type { LocalApiConfig } from "../config";

export interface SpawnedProcess {
  kill(signal?: string | number): void;
  exited?: Promise<unknown>;
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
  isPortAvailable: (port: number) => Promise<boolean>;
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
  isPortAvailable,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
};

const CANDIDATE_PORT_SPAN = 100;

export class LocalApiProcessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalApiProcessError";
  }
}

export class LocalApiProcessManager {
  private child?: SpawnedProcess;
  private currentBaseUrl: string;
  private readonly adapters: ProcessAdapters;

  constructor(private readonly config: LocalApiConfig, adapters: Partial<ProcessAdapters> = {}) {
    this.adapters = { ...defaultAdapters, ...adapters };
    this.currentBaseUrl = config.baseUrl;
  }

  async ensureRunning(): Promise<string> {
    if (await this.isHealthy(this.currentBaseUrl)) {
      return this.currentBaseUrl;
    }
    if (await this.isHealthy(this.config.baseUrl)) {
      this.currentBaseUrl = this.config.baseUrl;
      return this.currentBaseUrl;
    }
    if (!this.config.autoStart) {
      throw new LocalApiProcessError("DM 本地代理未运行，且自动启动已关闭");
    }
    if (!this.adapters.exists(this.config.executablePath)) {
      throw new LocalApiProcessError(`DM 本地代理可执行文件不存在：${this.config.executablePath}`);
    }
    for (const port of this.candidatePorts()) {
      const baseUrl = this.urlForPort(port);
      if (await this.isHealthy(baseUrl)) {
        this.currentBaseUrl = baseUrl;
        return this.currentBaseUrl;
      }
      if (!(await this.adapters.isPortAvailable(port))) {
        continue;
      }
      this.child = this.adapters.spawn(this.startCommand(port), {
        cwd: this.config.workingDirectory ?? dirname(this.config.executablePath),
        stdout: "ignore",
        stderr: "ignore",
      });
      this.currentBaseUrl = baseUrl;
      await this.waitUntilHealthy(baseUrl);
      return this.currentBaseUrl;
    }
    throw new LocalApiProcessError("没有可用端口启动 DM 本地代理");
  }

  async waitUntilHealthy(baseUrl = this.currentBaseUrl): Promise<void> {
    const startedAt = this.adapters.now();
    while (this.adapters.now() - startedAt <= this.config.startupTimeoutMs) {
      if (this.child?.exited && (await hasProcessExited(this.child.exited))) {
        this.child = undefined;
        throw new LocalApiProcessError("DM 本地代理启动后立即退出，请检查可执行文件、工作目录和启动参数");
      }
      if (await this.isHealthy(baseUrl)) {
        return;
      }
      await this.adapters.sleep(250);
    }
    this.child?.kill();
    this.child = undefined;
    throw new LocalApiProcessError(`DM 本地代理启动超时：${this.config.startupTimeoutMs}ms，地址：${baseUrl}`);
  }

  async stop(): Promise<void> {
    this.child?.kill();
    this.child = undefined;
  }

  private startCommand(port: number): string[] {
    return [
      this.config.executablePath,
      ...(this.config.startArgs ?? ["--port", String(port)]),
    ];
  }

  private async isHealthy(baseUrl: string): Promise<boolean> {
    try {
      const response = await this.adapters.fetch(`${baseUrl}/health`);
      if (!response.ok) {
        return false;
      }
      const payload = (await response.json().catch(() => undefined)) as { success?: boolean } | undefined;
      return payload?.success === true;
    } catch {
      return false;
    }
  }

  private candidatePorts(): number[] {
    const preferredPort = portFromBaseUrl(this.config.baseUrl) ?? this.config.port;
    if (this.config.startArgs) {
      return [preferredPort];
    }
    const ports = [
      preferredPort,
      this.config.port,
      ...Array.from({ length: CANDIDATE_PORT_SPAN }, (_, index) => this.config.port + index + 1),
    ];
    return [...new Set(ports)];
  }

  private urlForPort(port: number): string {
    return `http://127.0.0.1:${port}`;
  }
}

async function hasProcessExited(exited: Promise<unknown>): Promise<boolean> {
  return Promise.race([
    exited.then(() => true, () => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 0)),
  ]);
}

function portFromBaseUrl(baseUrl: string): number | undefined {
  try {
    return new URL(baseUrl).port ? Number(new URL(baseUrl).port) : undefined;
  } catch {
    return undefined;
  }
}

async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => {
      resolve(false);
    });
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}
