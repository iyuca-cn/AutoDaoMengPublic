import { describe, expect, it } from "vitest";
import { loadConfig } from "../../server/config";

describe("loadConfig", () => {
  it("uses Windows proxy defaults", () => {
    const config = loadConfig({});
    expect(config.localApi.executablePath).toBe("E:\\work\\daomeng\\AutoDaoMengPublic\\src\\dist\\dmlocalapi_server.exe");
    expect(config.localApi.baseUrl).toBe("http://127.0.0.1:8765");
    expect(config.localApi.autoStart).toBe(true);
  });

  it("accepts environment overrides", () => {
    const config = loadConfig({
      PORT: "6000",
      DMLOCALAPI_BASE_URL: "http://127.0.0.1:9000/",
      DMLOCALAPI_SERVER_EXE: "/opt/dm/dmlocalapi",
      DMLOCALAPI_DISABLE_AUTOSTART: "1",
      DMLOCALAPI_PORT: "9000",
      DMLOCALAPI_START_ARGS: "--listen 9000",
    });
    expect(config.port).toBe(6000);
    expect(config.localApi.baseUrl).toBe("http://127.0.0.1:9000");
    expect(config.localApi.executablePath).toBe("/opt/dm/dmlocalapi");
    expect(config.localApi.autoStart).toBe(false);
    expect(config.localApi.startArgs).toEqual(["--listen", "9000"]);
  });
});
