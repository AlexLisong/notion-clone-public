import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import type { AccessPolicy, WorkspaceRow, WorkspaceStore } from "./storage-types.ts";

export function accessPolicy(): AccessPolicy {
  const origin = process.env.FOLIO_PUBLIC_ORIGIN;
  const proxyKey = process.env.FOLIO_PROXY_KEY;
  if (!origin || !proxyKey || proxyKey.length < 32) throw new Error("Hosted access is not configured.");
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.origin !== origin || url.username || url.password) {
    throw new Error("Hosted origin must be an exact HTTPS origin.");
  }
  return { mode: "hosted", origin, proxyKey };
}

export function openSqliteStore(filename: string): WorkspaceStore & { close(): void } {
  if (!isAbsolute(filename)) throw new Error("SQLite path must be absolute.");
  mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename);
  chmodSync(filename, 0o600);
  db.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
  db.exec("CREATE TABLE IF NOT EXISTS workspaces (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL)");
  const initialize = db.prepare("INSERT OR IGNORE INTO workspaces (id, revision, data) VALUES (1, 0, ?)");
  const select = db.prepare("SELECT revision, data FROM workspaces WHERE id = 1");
  const update = db.prepare("UPDATE workspaces SET data = ?, revision = revision + 1 WHERE id = 1 AND revision = ?");
  return {
    async load(initial) {
      initialize.run(initial);
      const row = select.get() as WorkspaceRow | undefined;
      if (!row) throw new Error("Workspace not available.");
      return { revision: row.revision, data: row.data };
    },
    async save(data, revision) {
      return update.run(data, revision).changes === 1;
    },
    close() { db.close(); },
  };
}

let store: ReturnType<typeof openSqliteStore> | undefined;
export function workspaceStorage(): WorkspaceStore {
  if (!store) {
    const filename = process.env.FOLIO_DB_PATH;
    if (!filename) throw new Error("FOLIO_DB_PATH is required.");
    store = openSqliteStore(filename);
  }
  return store;
}
