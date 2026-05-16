export interface LocalApiConfig {
  baseUrl: string;
  executablePath: string;
  autoStart: boolean;
  port: number;
  startupTimeoutMs: number;
  requestTimeoutMs: number;
  workingDirectory?: string;
  startArgs?: string[];
}

export interface AppConfig {
  port: number;
  serverIdleTimeoutSeconds: number;
  dataDir: string;
  localApi: LocalApiConfig;
}

const DEFAULT_LOCAL_API_PORT = 8765;
const DEFAULT_LOCAL_API_EXE = "E:\\work\\daomeng\\AutoDaoMengPublic\\src\\dist\\dmlocalapi_server.exe";

export type EnvSource = Record<string, string | undefined>;

function numberFromEnv(value: string | undefined, fallback: number, name: string): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} 必须是正整数`);
  }
  return parsed;
}

function booleanFromEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") {
    return fallback;
  }
  return !["0", "false", "FALSE", "no", "NO"].includes(value);
}

function parseStartArgs(value: string | undefined): string[] | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  return value
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function loadConfig(env: EnvSource = process.env): AppConfig {
  const port = numberFromEnv(env.PORT, 5174, "PORT");
  const localPort = numberFromEnv(env.DMLOCALAPI_PORT, DEFAULT_LOCAL_API_PORT, "DMLOCALAPI_PORT");
  const baseUrl = (env.DMLOCALAPI_BASE_URL || `http://127.0.0.1:${localPort}`).replace(/\/+$/, "");
  const executablePath = env.DMLOCALAPI_SERVER_EXE || DEFAULT_LOCAL_API_EXE;
  const disableAutoStart = env.DMLOCALAPI_DISABLE_AUTOSTART === "1";
  const autoStart = disableAutoStart ? false : booleanFromEnv(env.DMLOCALAPI_AUTO_START, true);

  return {
    port,
    serverIdleTimeoutSeconds: numberFromEnv(env.SERVER_IDLE_TIMEOUT_SECONDS, 60, "SERVER_IDLE_TIMEOUT_SECONDS"),
    dataDir: env.DATA_DIR || "./data",
    localApi: {
      baseUrl,
      executablePath,
      autoStart,
      port: localPort,
      startupTimeoutMs: numberFromEnv(env.DMLOCALAPI_STARTUP_TIMEOUT_MS, 10_000, "DMLOCALAPI_STARTUP_TIMEOUT_MS"),
      requestTimeoutMs: numberFromEnv(env.DMLOCALAPI_REQUEST_TIMEOUT_MS, 8_000, "DMLOCALAPI_REQUEST_TIMEOUT_MS"),
      workingDirectory: env.DMLOCALAPI_WORKING_DIRECTORY || undefined,
      startArgs: parseStartArgs(env.DMLOCALAPI_START_ARGS),
    },
  };
}
