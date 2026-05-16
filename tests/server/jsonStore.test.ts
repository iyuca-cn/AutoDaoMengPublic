import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JsonStore } from "../../server/storage/jsonStore";
import { createAuditLog, type ImportBatch } from "../../server/domain/models";

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "daomeng-web-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("JsonStore", () => {
  it("creates, reads, lists, updates and appends audit", async () => {
    const store = new JsonStore(dir);
    const batch: ImportBatch = {
      id: "batch-1",
      filename: "demo.xlsx",
      createdAt: "now",
      rows: [],
      aggregatedDemands: [],
      errors: [],
      auditLogs: [],
    };
    await store.create("imports", batch);
    expect(await store.read("imports", "batch-1")).toMatchObject({ filename: "demo.xlsx" });
    expect(await store.list("imports")).toHaveLength(1);
    await store.update("imports", "batch-1", (entity) => ({ ...entity, filename: "next.xlsx" }));
    await store.appendAudit("imports", "batch-1", createAuditLog("test"));
    const updated = await store.read("imports", "batch-1");
    expect(updated?.filename).toBe("next.xlsx");
    expect(updated?.auditLogs).toHaveLength(1);
  });
});
