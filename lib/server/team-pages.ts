import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { validateWorkspace, type Page, type Workspace, descendants } from "../folio/model.ts";
import { activity, addHistory, allPages, bumpWorkspace, fail, grantsFor, permissions, requirePage, type UserRow, type Grant } from "./team-db.ts";

export function workspaceSnapshot(db: DatabaseSync, user: UserRow) {
  const rows = allPages(db);
  const visible = [...rows.values()].filter((row) => permissions(db, user, row, rows).read);
  const visibleIds = new Set(visible.map((row) => row.id));
  const favoriteIds=new Set((db.prepare("SELECT page_id FROM team_favorites WHERE user_id=?").all(user.id) as {page_id:string}[]).map((row)=>row.page_id));
  const meta = db.prepare("SELECT name,revision FROM team_meta WHERE id=1").get() as { name: string; revision: number };
  const pageRevisions: Record<string, number> = Object.create(null);
  const permissionMap: Record<string, ReturnType<typeof permissions>> = Object.create(null);
  const access: Record<string, { ownerId: string; visibility: "private" | "team"; grants: Grant[]; inherited: boolean; accessRevision: number }> = Object.create(null);
  const pages = visible.map((row) => {
    const page = JSON.parse(row.data) as Page;
    page.favorite=favoriteIds.has(page.id);
    pageRevisions[row.id] = row.revision;
    permissionMap[row.id] = permissions(db, user, row, rows);
    access[row.id] = { ownerId: row.owner_id, visibility: row.visibility, grants: grantsFor(db,row.id), inherited: Boolean(page.parentId), accessRevision: row.access_revision };
    // Reference privacy survives schema edits and reparenting: a page ID remains
    // protected even if a relation column has subsequently become plain text.
    for(const [key,value] of Object.entries(page.properties)){
      if(typeof value==="string" && rows.has(value) && !visibleIds.has(value))page.properties[key]="";
    }
    // A directly shared child is a root in the recipient's tree. Parent titles/IDs stay private.
    if (page.parentId && !visibleIds.has(page.parentId)) page.parentId = null;
    return page;
  });
  return { userId: user.id, workspace: { version: 1 as const, name: meta.name, theme: user.theme, pages }, revision: meta.revision, pageRevisions, permissions: permissionMap, access };
}

type ChangeBody = { changes?: { page: Page; baseRevision: number | null }[]; deleted?: { id: string; baseRevision: number }[]; name?: string; baseName?: string; theme?: Workspace["theme"] };
export function applyWorkspaceChanges(db: DatabaseSync, user: UserRow, body: ChangeBody) {
  if (!body || typeof body !== "object" || !Array.isArray(body.changes ?? []) || !Array.isArray(body.deleted ?? [])) fail(400,"Invalid workspace changes.");
  const changes = body.changes || [], deleted = body.deleted || [];
  if (changes.length > 2000 || deleted.length > 2000) fail(400,"Too many page changes.");
  const rows = allPages(db);
  const originalPages = [...rows.values()].map((row) => JSON.parse(row.data) as Page);
  const next = new Map(originalPages.map((page) => [page.id,page]));
  const touched = new Set<string>();
  const meta = db.prepare("SELECT name FROM team_meta WHERE id=1").get() as { name: string };
  let name = meta.name;
  if (body.name !== undefined && body.name !== name) {
    if (!["owner","admin"].includes(user.role)) fail(403,"Only administrators can rename the workspace.");
    if (body.baseName !== name) fail(409,"The workspace name changed. Reload before renaming.","conflict");
    name = body.name;
  }
  if (body.theme !== undefined && !["light","dark","system"].includes(body.theme)) fail(400,"Invalid theme.");
  for (const change of changes) {
    const page = change?.page;
    if (!page || typeof page.id !== "string" || touched.has(page.id)) fail(400,"Invalid or duplicate page change.");
    touched.add(page.id);
    const existing = rows.get(page.id);
    if (existing) {
      requirePage(db,user,page.id,"edit",rows);
      if (change.baseRevision !== existing.revision) fail(409,"A page changed in another session. Reload or keep a copy of your draft.","conflict");
      const previous = JSON.parse(existing.data) as Page;
      const normalized = { ...page, favorite: previous.favorite, createdAt: previous.createdAt, updatedAt: Date.now() };
      if (previous.parentId && !page.parentId) {
        const parent = rows.get(previous.parentId);
        if (parent && !permissions(db,user,parent,rows).read) normalized.parentId = previous.parentId;
      }
      for(const [key,oldValue] of Object.entries(previous.properties)){
        if(typeof oldValue==="string" && oldValue && !normalized.properties[key]){
          const target=rows.get(oldValue);
          if(target && !permissions(db,user,target,rows).read)normalized.properties={...normalized.properties,[key]:oldValue};
        }
      }
      if (normalized.parentId !== previous.parentId) {
        for (const id of descendants(originalPages, page.id)) requirePage(db,user,id,"manage",rows);
      }
      next.set(page.id, normalized);
    } else {
      if (change.baseRevision !== null) fail(409,"This page no longer exists.","conflict");
      if (user.role === "viewer") fail(403,"Viewers cannot create pages.");
      next.set(page.id,{ ...page, createdAt: Date.now(), updatedAt: Date.now() });
    }
  }
  for (const deletion of deleted) {
    if (!deletion || typeof deletion.id !== "string" || touched.has(deletion.id)) fail(400,"Invalid or duplicate page deletion.");
    touched.add(deletion.id);
    const row = requirePage(db,user,deletion.id,"manage",rows);
    if (row.revision !== deletion.baseRevision) fail(409,"A page changed before deletion.","conflict");
    if (!(JSON.parse(row.data) as Page).trashedAt) fail(400,"Move a page to Trash before permanently deleting it.");
    next.delete(deletion.id);
  }
  for (const change of changes) {
    const candidate = next.get(change.page.id)!;
    const old = rows.get(candidate.id);
    const oldParent = old ? (JSON.parse(old.data) as Page).parentId : undefined;
    if (candidate.parentId && candidate.parentId !== oldParent) {
      const parent = rows.get(candidate.parentId);
      if (parent) requirePage(db,user,parent.id,"edit",rows);
      else if (!next.has(candidate.parentId) || !changes.some((item) => item.page.id === candidate.parentId && item.baseRevision === null)) fail(400,"Invalid destination page.");
    }
  }
  let validated: Workspace;
  try { validated = validateWorkspace({ version:1, name, theme: body.theme ?? user.theme, pages:[...next.values()] }); }
  catch { fail(400,"The workspace contains invalid pages or an incomplete subtree change."); }
  if (Buffer.byteLength(JSON.stringify(validated)) > 10 * 1024 * 1024) fail(413,"The workspace exceeds the 10 MB limit.");
  const validatedPages = new Map(validated.pages.map((page) => [page.id,page]));
  for(const change of changes){
    const page=validatedPages.get(change.page.id)!;
    const previous=rows.get(page.id);const old=previous?JSON.parse(previous.data) as Page:undefined;
    for(const [key,value] of Object.entries(page.properties)){
      if(typeof value!=="string" || value===old?.properties[key])continue;
      const target=rows.get(value);
      if(target && !permissions(db,user,target,rows).read)fail(400,"Select a page you can access.");
    }
    const columns=(page.parentId?validatedPages.get(page.parentId)?.columns:page.columns)||[];
    for(const column of columns){
      const value=page.properties[column.id];
      if(!value || value===old?.properties[column.id])continue;
      if(column.type==="relation"){
        if(typeof value!=="string" || !validatedPages.has(value))fail(400,"Select an existing related page.");
        const target=rows.get(value);
        if(target && !permissions(db,user,target,rows).read)fail(400,"Select a page you can access.");
      }
      if(column.type==="person" && (typeof value!=="string" || !db.prepare("SELECT id FROM team_users WHERE id=? AND disabled=0").get(value)))fail(400,"Select an active team member.");
    }
  }
  for (const change of changes) {
    const page = validatedPages.get(change.page.id)!;
    const existing = rows.get(page.id);
    if (existing) {
      addHistory(db,existing,user.id);
      db.prepare("UPDATE team_pages SET data=?,revision=revision+1 WHERE id=?").run(JSON.stringify(page),page.id);
      activity(db,user.id,page.id,"page.updated");
    } else {
      db.prepare("INSERT INTO team_pages (id,data,revision,owner_id,visibility) VALUES (?,?,0,?,'private')").run(page.id,JSON.stringify(page),user.id);
      if(page.favorite)db.prepare("INSERT INTO team_favorites (page_id,user_id) VALUES (?,?)").run(page.id,user.id);
      activity(db,user.id,page.id,"page.created");
    }
    notifyAssignments(db,user,page,existing ? JSON.parse(existing.data) as Page : undefined);
  }
  const removedFileIds: string[] = [];
  for (const deletion of deleted) {
    removedFileIds.push(...(db.prepare("SELECT id FROM team_files WHERE page_id=?").all(deletion.id) as {id:string}[]).map((file)=>file.id));
    db.prepare("DELETE FROM team_pages WHERE id=?").run(deletion.id);
    activity(db,user.id,null,"page.deleted","A trashed page was permanently deleted");
  }
  if (name !== meta.name) { db.prepare("UPDATE team_meta SET name=? WHERE id=1").run(name); activity(db,user.id,null,"workspace.renamed"); }
  if (body.theme !== undefined) { db.prepare("UPDATE team_users SET theme=? WHERE id=?").run(body.theme,user.id); user.theme=body.theme; }
  if (changes.length || deleted.length || name !== meta.name) bumpWorkspace(db);
  return { snapshot: workspaceSnapshot(db,user), removedFileIds };
}

export function notify(db: DatabaseSync, actor: UserRow, recipient: string, pageId: string, kind: string, message: string) {
  if (recipient === actor.id) return;
  const target = db.prepare("SELECT * FROM team_users WHERE id=? AND disabled=0").get(recipient) as UserRow | undefined;
  const pages=allPages(db), row=pages.get(pageId);
  if (!target || !row || !permissions(db,target,row,pages).read) return;
  db.prepare("INSERT INTO team_notifications (id,user_id,page_id,actor_id,kind,message,created_at) VALUES (?,?,?,?,?,?,?)").run(randomUUID(),recipient,pageId,actor.id,kind,message.slice(0,500),Date.now());
}
function notifyAssignments(db: DatabaseSync, user: UserRow, page: Page, old?: Page) {
  if (!page.parentId) return;
  const parent=db.prepare("SELECT data FROM team_pages WHERE id=?").get(page.parentId) as {data:string}|undefined;
  if (!parent) return;
  const columns=(JSON.parse(parent.data) as Page).columns;
  for (const column of columns) {
    if (String(column.type)!=="person") continue;
    const assigned=page.properties[column.id];
    if (typeof assigned === "string" && assigned && old?.properties[column.id]!==assigned) notify(db,user,assigned,page.id,"assignment",`Assigned you to ${page.title || "Untitled"}`);
  }
}
export function updateAccess(db: DatabaseSync,user:UserRow,id:string,body:{visibility?:unknown;grants?:unknown;baseRevision?:unknown}) {
  const rows=allPages(db),row=requirePage(db,user,id,"manage",rows);
  if(body.baseRevision!==row.access_revision)fail(409,"Sharing changed in another session. Reload before updating access.","conflict");
  if (!["private","team"].includes(String(body.visibility)) || !Array.isArray(body.grants) || body.grants.length>200) fail(400,"Invalid sharing settings.");
  // Sharing a parent changes every descendant's audience, including private children.
  const tree=[...rows.values()].map((item)=>JSON.parse(item.data) as Page);
  for (const child of descendants(tree,id)) requirePage(db,user,child,"manage",rows);
  const seen=new Set<string>();
  const grants:Grant[]=body.grants.map((value:unknown)=> {
    const grant=value as Grant;
    if (!grant || typeof grant.userId!=="string" || seen.has(grant.userId) || !["viewer","editor"].includes(grant.role) || !db.prepare("SELECT id FROM team_users WHERE id=? AND disabled=0").get(grant.userId)) fail(400,"Invalid sharing recipient.");
    seen.add(grant.userId); return {userId:grant.userId,role:grant.role};
  });
  db.prepare("UPDATE team_pages SET visibility=?,access_revision=access_revision+1 WHERE id=?").run(String(body.visibility),id);
  db.prepare("DELETE FROM team_grants WHERE page_id=?").run(id);
  for (const grant of grants) db.prepare("INSERT INTO team_grants (page_id,user_id,role) VALUES (?,?,?)").run(id,grant.userId,grant.role);
  bumpWorkspace(db); activity(db,user.id,id,"page.shared");
  return {access:{ownerId:row.owner_id,visibility:body.visibility,grants,inherited:Boolean((JSON.parse(row.data) as Page).parentId),accessRevision:row.access_revision+1}};
}

export function restoreVersion(db:DatabaseSync,user:UserRow,id:string,body:{versionId?:unknown;baseRevision?:unknown}) {
  const row=requirePage(db,user,id,"edit");
  if (body.baseRevision!==row.revision) fail(409,"The page changed before restoration.","conflict");
  if (typeof body.versionId!=="string") fail(400,"Choose a saved version.");
  const version=db.prepare("SELECT data FROM team_history WHERE id=? AND page_id=?").get(body.versionId,id) as {data:string}|undefined;
  if (!version) fail(404,"Version not found.");
  const current=JSON.parse(row.data) as Page, historic=JSON.parse(version.data) as Page;
  // History restores editable content; current tree/trash/ownership/sharing remain intact.
  const page={...historic,properties:{...historic.properties},id:current.id,parentId:current.parentId,createdAt:current.createdAt,trashedAt:current.trashedAt,trashBatch:current.trashBatch,updatedAt:Date.now()};
  const pages=allPages(db);
  for(const [key,value] of Object.entries(page.properties)){
    const target=typeof value==="string"?pages.get(value):undefined;
    if(target&&!permissions(db,user,target,pages).read)page.properties[key]=current.properties[key]??"";
  }
  const output=applyWorkspaceChanges(db,user,{changes:[{page,baseRevision:row.revision}]});
  activity(db,user.id,id,"page.restored");
  return output.snapshot;
}
