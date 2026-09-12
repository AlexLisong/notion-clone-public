// Vinext/Cloudflare adapter. The AWS build aliases this module to storage-node.
import { env } from "cloudflare:workers";
import type { AccessPolicy, WorkspaceRow, WorkspaceStore } from "./storage-types";

export function accessPolicy(): AccessPolicy {
  return { mode: "local" };
}

export function workspaceStorage(): WorkspaceStore {
  const db = env.DB;
  if (!db) throw new Error("Workspace database is not configured.");
  return {
    async load(initial) {
      await db.prepare("INSERT OR IGNORE INTO workspaces (id, revision, data) VALUES (1, 0, ?)").bind(initial).run();
      const row = await db.prepare("SELECT revision, data FROM workspaces WHERE id = 1").first<WorkspaceRow>();
      if (!row) throw new Error("Workspace not available.");
      return row;
    },
    async save(data, revision) {
      const result = await db.prepare("UPDATE workspaces SET data = ?, revision = revision + 1 WHERE id = 1 AND revision = ?").bind(data, revision).run();
      return Boolean(result.meta.changes);
    },
  };
}
