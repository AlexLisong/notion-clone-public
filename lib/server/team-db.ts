import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync, existsSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import { createSeed } from "../folio/seed.ts";
import { validateWorkspace, type Page, type Workspace } from "../folio/model.ts";
import { hashPassword, validPassword } from "./team-crypto.ts";

export type Role = "owner" | "admin" | "member" | "viewer";
export type UserRow = { id: string; username: string; name: string; role: Role; password_hash: string; must_change: number; disabled: number; created_at: number; theme: Workspace["theme"] };
export type PageRow = { id: string; data: string; revision: number; owner_id: string; visibility: "private" | "team"; access_revision: number };
export type Grant = { userId: string; role: "viewer" | "editor" };
export type Permission = { read: boolean; edit: boolean; manage: boolean };
export class TeamError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) { super(message); this.status=status; this.code=code; }
}
export function fail(status: number, message: string, code?: string): never { throw new TeamError(status, message, code); }
export function safeUser(user: UserRow) {
  return { id: user.id, username: user.username, name: user.name, role: user.role, mustChangePassword: Boolean(user.must_change), disabled: Boolean(user.disabled) };
}
export function transaction<T>(db: DatabaseSync, run: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try { const result = run(); db.exec("COMMIT"); return result; }
  catch (error) { db.exec("ROLLBACK"); throw error; }
}
let database: DatabaseSync | undefined;
let initializing: Promise<DatabaseSync> | undefined;
let filename: string | undefined;
export function teamMarkerExists(): boolean {
  const file = process.env.FOLIO_DB_PATH;
  if (!file || !isAbsolute(file) || !existsSync(file)) return false;
  const opened = database && filename === file ? database : new DatabaseSync(file, { readOnly: true });
  try {
    return Boolean(opened.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='team_meta'").get() && opened.prepare("SELECT id FROM team_meta WHERE id=1").get());
  } finally { if (opened !== database) opened.close(); }
}
export async function teamDatabase(): Promise<DatabaseSync> {
  const file = process.env.FOLIO_DB_PATH;
  if (!file || !isAbsolute(file)) fail(503, "The team database is not configured.");
  if (initializing && filename === file) return initializing;
  if (database && filename !== file) database.close();
  filename = file;
  initializing = initialize(file).catch((error) => { initializing = undefined; database?.close(); database = undefined; throw error; });
  return initializing;
}
async function initialize(file: string): Promise<DatabaseSync> {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  database = db;
  chmodSync(file, 0o600);
  db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS team_users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL, role TEXT NOT NULL, password_hash TEXT NOT NULL, must_change INTEGER NOT NULL DEFAULT 1, disabled INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, theme TEXT NOT NULL DEFAULT 'system');
    CREATE TABLE IF NOT EXISTS team_meta (id INTEGER PRIMARY KEY CHECK(id=1), name TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, migrated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS team_pages (id TEXT PRIMARY KEY, data TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, owner_id TEXT NOT NULL REFERENCES team_users(id), visibility TEXT NOT NULL DEFAULT 'private', access_revision INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS team_grants (page_id TEXT NOT NULL REFERENCES team_pages(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES team_users(id), role TEXT NOT NULL, PRIMARY KEY(page_id,user_id));
    CREATE TABLE IF NOT EXISTS team_sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES team_users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS team_sessions_user ON team_sessions(user_id);
    CREATE TABLE IF NOT EXISTS team_rate (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS team_comments (id TEXT PRIMARY KEY, page_id TEXT NOT NULL REFERENCES team_pages(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES team_users(id), body TEXT NOT NULL, parent_id TEXT, mentions TEXT NOT NULL DEFAULT '[]', resolved INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS team_comments_page ON team_comments(page_id,created_at);
    CREATE TABLE IF NOT EXISTS team_history (id TEXT PRIMARY KEY, page_id TEXT NOT NULL REFERENCES team_pages(id) ON DELETE CASCADE, revision INTEGER NOT NULL, data TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES team_users(id), created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS team_history_page ON team_history(page_id,created_at);
    CREATE TABLE IF NOT EXISTS team_notifications (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES team_users(id), page_id TEXT REFERENCES team_pages(id) ON DELETE CASCADE, actor_id TEXT NOT NULL REFERENCES team_users(id), kind TEXT NOT NULL, message TEXT NOT NULL, read_at INTEGER, created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS team_notifications_user ON team_notifications(user_id,created_at);
    CREATE TABLE IF NOT EXISTS team_activity (id TEXT PRIMARY KEY, page_id TEXT REFERENCES team_pages(id) ON DELETE CASCADE, actor_id TEXT NOT NULL REFERENCES team_users(id), action TEXT NOT NULL, detail TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS team_files (id TEXT PRIMARY KEY, page_id TEXT NOT NULL REFERENCES team_pages(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES team_users(id), name TEXT NOT NULL, size INTEGER NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS team_presence (page_id TEXT NOT NULL REFERENCES team_pages(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES team_users(id), seen_at INTEGER NOT NULL, PRIMARY KEY(page_id,user_id));
    CREATE TABLE IF NOT EXISTS team_favorites (page_id TEXT NOT NULL REFERENCES team_pages(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES team_users(id), PRIMARY KEY(page_id,user_id));
  `);
  if (!(db.prepare("PRAGMA table_info(team_pages)").all() as {name:string}[]).some((column)=>column.name==="access_revision")) db.exec("ALTER TABLE team_pages ADD COLUMN access_revision INTEGER NOT NULL DEFAULT 0");
  if (!db.prepare("SELECT id FROM team_meta WHERE id=1").get()) {
    const username = (process.env.FOLIO_OWNER_USERNAME || "").trim().toLowerCase();
    const password = process.env.FOLIO_OWNER_PASSWORD;
    if (!/^[a-z0-9][a-z0-9_.-]{2,39}$/.test(username) || !validPassword(password)) fail(503, "Set private owner credentials before enabling team accounts.");
    const passwordHash = await hashPassword(password);
    transaction(db, () => {
      if (db.prepare("SELECT id FROM team_meta WHERE id=1").get()) return;
      if (db.prepare("SELECT id FROM team_users LIMIT 1").get()) fail(503, "Incomplete team migration requires administrator recovery.");
      const ownerId = randomUUID();
      const now = Date.now();
      db.prepare("INSERT INTO team_users (id,username,name,role,password_hash,must_change,created_at) VALUES (?,?,?,'owner',?,1,?)").run(ownerId, username, process.env.FOLIO_OWNER_NAME || username, passwordHash, now);
      const hasLegacy = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='workspaces'").get();
      const legacy = hasLegacy ? db.prepare("SELECT data FROM workspaces WHERE id=1").get() as { data: string } | undefined : undefined;
      const workspace = validateWorkspace(legacy ? JSON.parse(legacy.data) : createSeed());
      db.prepare("INSERT INTO team_meta (id,name,migrated_at) VALUES (1,?,?)").run(workspace.name, now);
      const insert = db.prepare("INSERT INTO team_pages (id,data,owner_id) VALUES (?,?,?)");
      for (const page of workspace.pages) {
        insert.run(page.id, JSON.stringify(page), ownerId);
        if(page.favorite)db.prepare("INSERT INTO team_favorites (page_id,user_id) VALUES (?,?)").run(page.id,ownerId);
      }
      db.prepare("UPDATE team_users SET theme=? WHERE id=?").run(workspace.theme, ownerId);
      activity(db, ownerId, null, "team.enabled", "Private workspace migrated to team accounts");
    });
  }
  return db;
}
export function closeTeamDatabase(): void { database?.close(); database = undefined; initializing = undefined; filename = undefined; }
export function allPages(db: DatabaseSync): Map<string, PageRow> {
  return new Map((db.prepare("SELECT * FROM team_pages ORDER BY rowid").all() as PageRow[]).map((row) => [row.id, row]));
}
export function grantsFor(db: DatabaseSync, id: string): Grant[] {
  return (db.prepare("SELECT user_id,role FROM team_grants WHERE page_id=?").all(id) as { user_id: string; role: Grant["role"] }[]).map((grant) => ({ userId: grant.user_id, role: grant.role }));
}
export function permissions(db: DatabaseSync, user: UserRow, row: PageRow, pages = allPages(db)): Permission {
  if (user.disabled) return { read: false, edit: false, manage: false };
  if (user.role === "owner" || user.role === "admin") return { read: true, edit: true, manage: true };
  let manage = row.owner_id === user.id && user.role !== "viewer";
  let read = false, edit = false;
  const seen = new Set<string>();
  let cursor: PageRow | undefined = row;
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    if (cursor.owner_id === user.id || cursor.visibility === "team") { read = true; edit = true; }
    if (cursor.owner_id === user.id && user.role !== "viewer") manage = true;
    const grant = db.prepare("SELECT role FROM team_grants WHERE page_id=? AND user_id=?").get(cursor.id, user.id) as { role: string } | undefined;
    if (grant) { read = true; if (grant.role === "editor") edit = true; }
    const parentId: string | null = (JSON.parse(cursor.data) as Page).parentId;
    cursor = parentId ? pages.get(parentId) : undefined;
  }
  return { read, edit: edit && user.role !== "viewer", manage };
}
export function requirePage(db: DatabaseSync, user: UserRow, id: string, capability: keyof Permission = "read", pages = allPages(db)): PageRow {
  const row = pages.get(id);
  if (!row || !permissions(db, user, row, pages).read) fail(404, "Page not found.");
  if (!permissions(db, user, row, pages)[capability]) fail(403, "You do not have permission for this action.");
  return row;
}
export function activity(db: DatabaseSync, actorId: string, pageId: string | null, action: string, detail = "") {
  db.prepare("INSERT INTO team_activity (id,page_id,actor_id,action,detail,created_at) VALUES (?,?,?,?,?,?)").run(randomUUID(), pageId, actorId, action, detail.slice(0,500), Date.now());
}
export function bumpWorkspace(db: DatabaseSync) { db.prepare("UPDATE team_meta SET revision=revision+1 WHERE id=1").run(); }
export function addHistory(db: DatabaseSync, row: PageRow, actor: string) {
  db.prepare("INSERT INTO team_history (id,page_id,revision,data,user_id,created_at) VALUES (?,?,?,?,?,?)").run(randomUUID(), row.id, row.revision, row.data, actor, Date.now());
  db.prepare("DELETE FROM team_history WHERE page_id=? AND id NOT IN (SELECT id FROM team_history WHERE page_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100)").run(row.id, row.id);
}
