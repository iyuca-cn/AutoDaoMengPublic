import { afterEach, describe, expect, it, vi } from "vitest";
import { apiGet, downloadUrl, resolveApiUrl } from "../../src/api";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("frontend api helper", () => {
  it("uses the Bun backend origin for local Vite pages", () => {
    expect(resolveApiUrl("/api/imports", {
      protocol: "http:",
      hostname: "127.0.0.1",
      port: "5173",
    })).toBe("http://127.0.0.1:5174/api/imports");
  });

  it("keeps relative urls when already on the Bun backend origin", () => {
    expect(resolveApiUrl("/api/imports", {
      protocol: "http:",
      hostname: "127.0.0.1",
      port: "5174",
    })).toBe("/api/imports");
  });

  it("uses the resolved API url for downloads", () => {
    vi.stubGlobal("window", {
      location: {
        protocol: "http:",
        hostname: "127.0.0.1",
        port: "5173",
      },
    });

    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    expect(downloadUrl("/api/reports/plan.xlsx")).toBe(`http://127.0.0.1:5174/api/reports/plan.xlsx?tz=${encodeURIComponent(timeZone)}`);
  });

  it("reports a clear backend connection error when fetch fails", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await expect(apiGet("/api/imports")).rejects.toThrow("无法连接后端接口");
  });

  it("sends the user timezone header with API requests", async () => {
    vi.stubGlobal("window", {
      location: {
        protocol: "http:",
        hostname: "127.0.0.1",
        port: "5174",
      },
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ success: true, data: [] }));

    await apiGet("/api/imports");

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).get("X-User-Timezone")).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  });
});
