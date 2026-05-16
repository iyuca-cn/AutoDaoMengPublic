import { describe, expect, it } from "vitest";
import type { LocalApiConfig } from "../../server/config";
import { LocalApiProcessManager } from "../../server/local-api/process";

describe("LocalApiProcessManager", () => {
  it("starts on the next candidate port when the configured port is unavailable", async () => {
    const spawnCalls: Array<{ command: string[]; cwd?: string }> = [];
    const config = createConfig();
    const healthyUrls = new Set<string>();
    const manager = new LocalApiProcessManager(config, {
      exists: () => true,
      isPortAvailable: async (port) => port !== 8765,
      spawn: (command, options) => {
        spawnCalls.push({ command, cwd: options?.cwd });
        healthyUrls.add("http://127.0.0.1:8766/health");
        return { kill: () => undefined };
      },
      fetch: async (input) => {
        if (healthyUrls.has(String(input))) {
          return Response.json({ success: true });
        }
        throw new Error("not running");
      },
      sleep: async () => undefined,
      now: fixedClock([0, 1]),
    });

    await expect(manager.ensureRunning()).resolves.toBe("http://127.0.0.1:8766");
    expect(spawnCalls).toEqual([{
      command: ["E:\\tools\\dm\\dmlocalapi_server.exe", "--port", "8766"],
      cwd: "E:\\tools\\dm",
    }]);
  });

  it("reports when the local proxy process exits during startup", async () => {
    const manager = new LocalApiProcessManager(createConfig({ startupTimeoutMs: 500 }), {
      exists: () => true,
      isPortAvailable: async () => true,
      spawn: () => ({ kill: () => undefined, exited: Promise.resolve(1) }),
      fetch: async () => {
        throw new Error("not running");
      },
      sleep: async () => undefined,
      now: fixedClock([0, 1]),
    });

    await expect(manager.ensureRunning()).rejects.toThrow("DM 本地代理启动后立即退出");
  });

  it("does not switch ports when custom start args are configured", async () => {
    const spawnCommands: string[][] = [];
    let killed = false;
    const manager = new LocalApiProcessManager(createConfig({
      startupTimeoutMs: 0,
      startArgs: ["--listen", "127.0.0.1:9000"],
    }), {
      exists: () => true,
      isPortAvailable: async () => true,
      spawn: (command) => {
        spawnCommands.push(command);
        return { kill: () => { killed = true; } };
      },
      fetch: async () => {
        throw new Error("not running");
      },
      sleep: async () => undefined,
      now: fixedClock([0, 1]),
    });

    await expect(manager.ensureRunning()).rejects.toThrow("DM 本地代理启动超时");
    expect(spawnCommands).toEqual([["E:\\tools\\dm\\dmlocalapi_server.exe", "--listen", "127.0.0.1:9000"]]);
    expect(killed).toBe(true);
  });
});

function createConfig(overrides: Partial<LocalApiConfig> = {}): LocalApiConfig {
  return {
    baseUrl: "http://127.0.0.1:8765",
    executablePath: "E:\\tools\\dm\\dmlocalapi_server.exe",
    autoStart: true,
    port: 8765,
    startupTimeoutMs: 10_000,
    requestTimeoutMs: 8_000,
    ...overrides,
  };
}

function fixedClock(values: number[]): () => number {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}
