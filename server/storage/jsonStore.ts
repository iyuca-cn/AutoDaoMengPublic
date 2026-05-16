import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AuditLogEntry, ExecutionTask, ImportBatch, Plan } from "../domain/models";

type CollectionName = "imports" | "plans" | "tasks";
type StoredEntity = ImportBatch | Plan | ExecutionTask;
type EntityMap = {
  imports: ImportBatch;
  plans: Plan;
  tasks: ExecutionTask;
};

export class JsonStore {
  constructor(private readonly rootDir = "./data") {}

  async create<K extends CollectionName>(collection: K, entity: EntityMap[K]): Promise<EntityMap[K]> {
    await this.write(collection, entity.id, entity);
    return entity;
  }

  async read<K extends CollectionName>(collection: K, id: string): Promise<EntityMap[K] | null> {
    try {
      const content = await readFile(this.filePath(collection, id), "utf-8");
      return JSON.parse(content) as EntityMap[K];
    } catch (error) {
      if (isNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  async list<K extends CollectionName>(collection: K): Promise<EntityMap[K][]> {
    await mkdir(this.collectionDir(collection), { recursive: true });
    const names = await readdir(this.collectionDir(collection));
    const items: EntityMap[K][] = [];
    for (const name of names.filter((item) => item.endsWith(".json")).sort()) {
      const item = await this.read(collection, name.slice(0, -5));
      if (item) {
        items.push(item);
      }
    }
    return items;
  }

  async update<K extends CollectionName>(collection: K, id: string, updater: (entity: EntityMap[K]) => EntityMap[K]): Promise<EntityMap[K]> {
    const existing = await this.read(collection, id);
    if (!existing) {
      throw new Error(`${collection} ${id} 不存在`);
    }
    const updated = updater(existing);
    await this.write(collection, id, updated);
    return updated;
  }

  async appendAudit<K extends "imports" | "plans">(collection: K, id: string, entry: AuditLogEntry): Promise<EntityMap[K]> {
    return this.update(collection, id, (entity) => ({
      ...entity,
      auditLogs: [...entity.auditLogs, entry],
    }));
  }

  private async write(collection: CollectionName, id: string, entity: StoredEntity): Promise<void> {
    const target = this.filePath(collection, id);
    await mkdir(dirname(target), { recursive: true });
    const tmp = `${target}.${crypto.randomUUID()}.tmp`;
    await writeFile(tmp, `${JSON.stringify(entity, null, 2)}\n`, "utf-8");
    await rename(tmp, target);
  }

  private collectionDir(collection: CollectionName): string {
    return join(this.rootDir, collection);
  }

  private filePath(collection: CollectionName, id: string): string {
    if (!/^[a-zA-Z0-9_.-]+$/.test(id)) {
      throw new Error(`非法 ID：${id}`);
    }
    return join(this.collectionDir(collection), `${id}.json`);
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT";
}
