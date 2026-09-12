"use client";
import { useCallback, useEffect, useState } from "react";
import { Bell, Users, LogOut, Shield, MessageSquare, Paperclip, History, LockKeyhole, Globe2, Check, Upload, Download, X, RotateCcw, ChevronRight, Activity, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Choice } from "./database";
import { PasswordScreen, useTeam, teamRequest, type TeamUser, type TeamRole, type PageAccess } from "@/lib/folio/team-client";
import type { Page } from "@/lib/folio/model";

const message = (e: unknown) => e instanceof Error ? e.message : "Something went wrong. Please retry.";
const date = (n: number | string) => new Date(n).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const roles: { value: TeamRole; label: string }[] = [{ value: "admin", label: "Admin" }, { value: "member", label: "Member" }, { value: "viewer", label: "Viewer" }];
function Empty({ children }: { children: React.ReactNode }) { return <p className="team-empty">{children}</p>; }

export function TeamNavigation({ openPage, hasUnsavedChanges }: { openPage: (id: string) => void; hasUnsavedChanges: boolean }) {
  const team = useTeam();
  const [panel, setPanel] = useState<"people" | "inbox" | "security" | "activity" | null>(null);
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (!team.enabled) return;
    let active = true;
    const load = () => teamRequest<{ notifications: TeamNotification[] }>("notifications").then((r) => { if (active) setUnread(r.notifications.filter((n) => !n.readAt && !n.read).length); }).catch(() => {});
    void load(); const timer = setInterval(load, 30_000);
    return () => { active = false; clearInterval(timer); };
  }, [team.enabled, panel]);
  if (!team.enabled || !team.user) return null;
  return <>
    <nav className="main-nav team-nav">
      <button onClick={() => setPanel("inbox")}><Bell size={17} />Inbox{unread > 0 && <span className="nav-count">{unread}</span>}</button>
      <button onClick={() => setPanel("activity")}><Activity size={17} />Activity</button>
      <button onClick={() => setPanel("people")}><Users size={17} />People</button>
    </nav>
    <div className="team-profile"><button onClick={() => setPanel("security")} title="Account settings"><span className="team-avatar">{team.user.name.slice(0, 1).toUpperCase()}</span><span><strong>{team.user.name}</strong><small>{team.user.role}</small></span></button><button className="icon-button" aria-label="Sign out" onClick={() => {
      if (hasUnsavedChanges) { toast.error("Save your changes or export your unsaved backup before signing out."); return; }
      void team.logout().catch((e) => toast.error(message(e)));
    }}><LogOut size={16} /></button></div>
    <Dialog open={panel !== null} onOpenChange={(open) => { if (!open) setPanel(null); }}><DialogContent className="team-dialog">
      <DialogTitle>{panel === "people" ? "People in your workspace" : panel === "inbox" ? "Your inbox" : panel === "activity" ? "Workspace activity" : "Account & security"}</DialogTitle>
      <DialogDescription>{panel === "people" ? "Give each teammate their own account and the access they need." : panel === "inbox" ? "Mentions and updates for pages you can access." : panel === "activity" ? "Recent changes across pages you can access." : `Signed in as ${team.user.username}.`}</DialogDescription>
      {panel === "people" && <People />}{panel === "inbox" && <Inbox openPage={(id) => { openPage(id); setPanel(null); }} />}{panel === "activity" && <ActivityList openPage={(id) => { openPage(id); setPanel(null); }} />}{panel === "security" && <PasswordScreen onSuccess={team.refresh} />}
    </DialogContent></Dialog>
  </>;
}
function People() {
  const team = useTeam();
  const refreshTeam = team.refresh;
  const canManage = team.user?.role === "owner" || team.user?.role === "admin";
  const [users, setUsers] = useState<TeamUser[]>(team.members), [error, setError] = useState(""), [busy, setBusy] = useState(false), [creating, setCreating] = useState(false), [editing, setEditing] = useState<TeamUser | null>(null);
  const load = useCallback(async () => { if (canManage) { const r = await teamRequest<{ users: TeamUser[] }>("users"); setUsers(r.users); } await refreshTeam(); }, [canManage, refreshTeam]);
  useEffect(() => { if (canManage) void teamRequest<{ users: TeamUser[] }>("users").then((r) => setUsers(r.users)).catch((e) => setError(message(e))); }, [canManage]);
  return <div className="team-people">
    <div className="team-role-guide"><Shield size={17} /><p><strong>Admins</strong> manage accounts and all pages. <strong>Members</strong> create and edit shared pages. <strong>Viewers</strong> can read and download.</p></div>
    {error && <p role="alert" className="team-error">{error}</p>}
    <div className="team-member-list">{users.map((user) => <div className="team-member" key={user.id}>
      <span className="team-avatar">{user.name.slice(0, 1).toUpperCase()}</span><div className="team-member-name"><strong>{user.name}{user.id === team.user?.id && " (you)"}</strong><small>@{user.username}{user.disabled ? " · Deactivated" : user.mustChangePassword ? " · Password change required" : ""}</small></div><span className="team-badge">{user.role}</span>
      {canManage && user.role !== "owner" && (team.user?.role === "owner" || user.role !== "admin") && user.id !== team.user?.id && <button className="plain-button" onClick={() => { setEditing(user); setCreating(false); }}>Manage</button>}
    </div>)}</div>
    {canManage && !creating && !editing && <button className="primary-button" onClick={() => setCreating(true)}><Users size={16} />Create account</button>}
    {canManage && (creating || editing) && <form className="team-account-form" key={editing?.id ?? "new"} onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setError(""); const values = new FormData(e.currentTarget);
      const password = String(values.get("password") ?? "");
      try {
        if (editing) await teamRequest(`users/${editing.id}`, { name: values.get("name"), role: values.get("role"), disabled: values.get("disabled") === "on", ...(password ? { password } : {}) }, "PATCH");
        else await teamRequest("users", { username: values.get("username"), name: values.get("name"), role: values.get("role"), password });
        await load(); setCreating(false); setEditing(null); toast.success(editing ? "Account updated" : "Account created. Share the temporary password with your teammate.");
      } catch (e) { setError(message(e)); } finally { setBusy(false); }
    }}>
      <h3>{editing ? `Manage ${editing.name}` : "Create a team account"}</h3>
      {!editing && <label className="form-label">Username<input className="form-input" name="username" required autoComplete="off" autoCapitalize="none" minLength={3} maxLength={40} pattern="[A-Za-z0-9][A-Za-z0-9_.-]{2,39}" placeholder="e.g. jamie" /></label>}
      <label className="form-label">Display name<input className="form-input" name="name" required maxLength={80} defaultValue={editing?.name} /></label>
      <label className="form-label">Role<select className="form-input" name="role" aria-label="Role" defaultValue={editing?.role ?? "member"}>{roles.filter((r) => team.user?.role === "owner" || r.value !== "admin").map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</select></label>
      <label className="form-label">{editing ? "Reset password (optional)" : "Temporary password"}<input className="form-input" name="password" type="password" required={!editing} minLength={12} maxLength={128} autoComplete="new-password" placeholder="At least 12 characters" /></label>
      <p className="small-note">Teammates must replace temporary passwords at first sign-in. A reset signs out their existing sessions.</p>
      {editing && <label className="team-checkbox"><input type="checkbox" name="disabled" defaultChecked={editing.disabled} />Deactivate account and revoke access</label>}
      <div className="dialog-actions"><button className="plain-button" type="button" onClick={() => { setCreating(false); setEditing(null); }}>Cancel</button><button className="primary-button" disabled={busy}>{busy ? "Saving…" : editing ? "Save account" : "Create account"}</button></div>
    </form>}
  </div>;
}

type TeamNotification = { id: string; pageId: string; body?: string; message?: string; title?: string; pageTitle?: string; createdAt: number; readAt?: number | null; read?: boolean; kind?: string };
function Inbox({ openPage }: { openPage: (id: string) => void }) {
  const [items, setItems] = useState<TeamNotification[]>([]), [error, setError] = useState(""), [loading, setLoading] = useState(true);
  const load = useCallback(() => teamRequest<{ notifications: TeamNotification[] }>("notifications").then((r) => setItems(r.notifications)).catch((e) => setError(message(e))).finally(() => setLoading(false)), []);
  useEffect(() => { void load(); }, [load]);
  const read = async (id?: string) => { try { await teamRequest("notifications", id ? { id } : {}, "PATCH"); await load(); } catch (e) { setError(message(e)); } };
  return <div className="team-feed">{error && <p role="alert" className="team-error">{error}</p>}{items.length > 0 && <button className="plain-button" onClick={() => void read()}><Check size={15} />Mark all as read</button>}{loading ? <Loader2 className="animate-spin" /> : !items.length ? <Empty>You’re all caught up. Mentions and updates will appear here.</Empty> : items.map((item) => <button className={`team-feed-item ${!item.readAt && !item.read ? "unread" : ""}`} key={item.id} onClick={() => { void read(item.id); openPage(item.pageId); }}><Bell size={17} /><span><strong>{item.title ?? item.pageTitle ?? "Page update"}</strong><span>{item.body ?? item.message ?? item.kind ?? "You have a new update"}</span><small>{date(item.createdAt)}</small></span><ChevronRight size={15} /></button>)}</div>;
}
type ActivityItem = { id: string | number; pageId?: string; pageTitle?: string; action: string; actorName?: string; userId?: string; createdAt: number; detail?: string };
function ActivityList({ openPage }: { openPage: (id: string) => void }) {
  const team = useTeam(); const [items, setItems] = useState<ActivityItem[]>([]), [error, setError] = useState("");
  useEffect(() => { void teamRequest<{ activity: ActivityItem[] }>("activity").then((r) => setItems(r.activity)).catch((e) => setError(message(e))); }, []);
  return <div className="team-feed">{error && <p role="alert" className="team-error">{error}</p>}{!items.length ? <Empty>Changes your team makes will appear here.</Empty> : items.map((item) => <button className="team-feed-item" key={item.id} disabled={!item.pageId} onClick={() => item.pageId && openPage(item.pageId)}><Activity size={17} /><span><strong>{item.pageTitle || "Workspace"}</strong><span>{item.actorName ?? team.members.find((u) => u.id === item.userId)?.name ?? "Teammate"} · {item.action.replaceAll("_", " ")}</span><small>{date(item.createdAt)}</small></span></button>)}</div>;
}

export function TeamPageTools({ page, access, canEdit, canManage, baseRevision, onReload, beforeAction }: { page: Page; access?: PageAccess; canEdit: boolean; canManage: boolean; baseRevision: number; onReload: () => Promise<void>; beforeAction: () => Promise<boolean> }) {
  const team = useTeam(); const [panel, setPanel] = useState<"comments" | "files" | "history" | "access" | null>(null);
  if (!team.enabled) return null;
  return <>
    <div className="team-page-tools"><Presence pageId={page.id} />
      <button className="plain-button" title="Page access" onClick={() => setPanel("access")}>{access?.visibility === "team" ? <Globe2 size={15} /> : <LockKeyhole size={15} />}<span>Share</span></button>
      <button className="icon-button" aria-label="Page comments" onClick={() => setPanel("comments")}><MessageSquare size={17} /></button>
      <button className="icon-button" aria-label="Page files" onClick={() => setPanel("files")}><Paperclip size={17} /></button>
      <button className="icon-button" aria-label="Page history" onClick={() => setPanel("history")}><History size={17} /></button>
    </div>
    <Dialog open={panel !== null} onOpenChange={(open) => { if (!open) setPanel(null); }}><DialogContent className="team-dialog page-team-dialog">
      <DialogTitle>{panel === "access" ? "Share this page" : panel === "comments" ? "Comments" : panel === "files" ? "Files & attachments" : "Page history"}</DialogTitle><DialogDescription>{page.icon} {page.title || "Untitled"}</DialogDescription>
      <div className="team-tabs">{(["comments", "files", "history", "access"] as const).map((tab) => <button key={tab} className={panel === tab ? "active" : ""} onClick={() => setPanel(tab)}>{tab === "access" ? "Sharing" : tab[0].toUpperCase() + tab.slice(1)}</button>)}</div>
      {panel === "access" && <Sharing pageId={page.id} canManage={canManage} initial={access} onReload={onReload} beforeAction={beforeAction} />}
      {panel === "comments" && <Comments pageId={page.id} canEdit={canEdit} beforeAction={beforeAction} />}
      {panel === "files" && <Files pageId={page.id} canEdit={canEdit} beforeAction={beforeAction} />}
      {panel === "history" && <PageHistory pageId={page.id} canEdit={canEdit} baseRevision={baseRevision} onReload={onReload} beforeAction={beforeAction} />}
    </DialogContent></Dialog>
  </>;
}
function Sharing({ pageId, canManage, initial, onReload, beforeAction }: { pageId: string; canManage: boolean; initial?: PageAccess; onReload: () => Promise<void>; beforeAction: () => Promise<boolean> }) {
  const team = useTeam(); const [access, setAccess] = useState<PageAccess | null>(initial ?? null), [error, setError] = useState(""), [busy, setBusy] = useState(false), [member, setMember] = useState(""), [loading, setLoading] = useState(true);
  useEffect(() => { void teamRequest<{ access: PageAccess }>(`pages/${pageId}/access`).then((r) => setAccess(r.access)).catch((e) => setError(message(e))).finally(() => setLoading(false)); }, [pageId]);
  return <div>{error && <p role="alert" className="team-error">{error}</p>}{access && <>
    <label className="form-label">General access<select className="form-input" aria-label="General access" value={access.visibility} disabled={!canManage || busy || loading} onChange={(e) => setAccess({ ...access, visibility: e.target.value as PageAccess["visibility"] })}><option value="private">Restricted — owner, admins, and people with access</option><option value="team">Team — everyone in the workspace</option></select></label>
    <p className="small-note">Access from parent pages also applies. Workspace owners and admins can access all pages. Team members can edit team pages; viewers can read them.</p>
    <h3 className="team-section-title">People with direct access</h3>
    {access.grants.map((grant) => { const user = team.members.find((u) => u.id === grant.userId); return <div key={grant.userId} className="team-grant"><span>{user?.name ?? "Team member"}</span><select className="form-input" aria-label={`Access for ${user?.name ?? "member"}`} disabled={!canManage || busy || loading} value={grant.role} onChange={(e) => setAccess({ ...access, grants: access.grants.map((g) => g.userId === grant.userId ? { ...g, role: e.target.value as "viewer" | "editor" } : g) })}><option value="viewer">Can view</option><option value="editor">Can edit</option></select>{canManage && <button className="icon-button" aria-label={`Remove access for ${user?.name ?? "member"}`} disabled={busy || loading} onClick={() => setAccess({ ...access, grants: access.grants.filter((g) => g.userId !== grant.userId) })}><X size={15} /></button>}</div>; })}
    {!access.grants.length && <Empty>No direct grants. General and inherited access still apply.</Empty>}
    {canManage && <><div className="team-add-grant"><Choice disabled={busy || loading} label="Select teammate" value={member} options={[{ value: "", label: "Select a teammate" }, ...team.members.filter((u) => u.id !== access.ownerId && !u.disabled && !access.grants.some((g) => g.userId === u.id)).map((u) => ({ value: u.id, label: u.name }))]} onChange={setMember} /><button className="outline-button" disabled={!member || loading || busy} onClick={() => { setAccess({ ...access, grants: [...access.grants, { userId: member, role: "viewer" }] }); setMember(""); }}>Add</button></div>
    <div className="dialog-actions"><button className="outline-button" onClick={() => void navigator.clipboard.writeText(`${location.origin}/#${pageId}`).then(() => toast.success("Page link copied")).catch(() => toast.error("Copy the page address from your browser."))}>Copy link</button><button className="primary-button" disabled={busy || loading} onClick={async () => {
      if (!await beforeAction()) return; setBusy(true); setError("");
      try { const r = await teamRequest<{ access: PageAccess }>(`pages/${pageId}/access`, { visibility: access.visibility, grants: access.grants, baseRevision: access.accessRevision }, "PATCH"); setAccess(r.access); await onReload(); toast.success("Page access updated"); } catch (e) { setError(message(e)); } finally { setBusy(false); }
    }}>{busy ? "Saving…" : "Save access"}</button></div></>}
  </>}</div>;
}

type Comment = { id: string; pageId: string; body: string; parentId: string | null; userId?: string; authorId?: string; authorName?: string; createdAt: number; resolved?: boolean; resolvedAt?: number | null; mentions?: string[] };
function Comments({ pageId, canEdit, beforeAction }: { pageId: string; canEdit: boolean; beforeAction: () => Promise<boolean> }) {
  const team = useTeam(); const [comments, setComments] = useState<Comment[]>([]), [body, setBody] = useState(""), [replyTo, setReplyTo] = useState<string | null>(null), [mentions, setMentions] = useState<string[]>([]), [error, setError] = useState(""), [busy, setBusy] = useState(false), [showResolved, setShowResolved] = useState(false);
  const load = useCallback(() => teamRequest<{ comments: Comment[] }>(`pages/${pageId}/comments`).then((r) => setComments(r.comments)), [pageId]);
  useEffect(() => { void load().catch((e) => setError(message(e))); const timer = setInterval(() => void load().catch(() => {}), 10_000); return () => clearInterval(timer); }, [load]);
  const resolved = (c: Comment) => c.resolved || c.resolvedAt;
  const render = (c: Comment, reply = false) => <div key={c.id} className={`team-comment ${reply ? "reply" : ""}`}><div className="comment-meta"><strong>{c.authorName ?? team.members.find((u) => u.id === (c.userId ?? c.authorId))?.name ?? "Teammate"}</strong><small>{date(c.createdAt)}</small>{resolved(c) && <span className="team-badge">Resolved</span>}</div><p>{c.body}</p>{!!c.mentions?.length && <div className="comment-mentions">{c.mentions.map((id) => <span key={id}>@{team.members.find((u) => u.id === id)?.name ?? "Teammate"}</span>)}</div>}{canEdit && !reply && <div className="comment-actions"><button disabled={busy} onClick={() => { setReplyTo(c.id); setBody(""); }}>Reply</button><button onClick={() => void teamRequest(`comments/${c.id}`, { resolved: !resolved(c) }, "PATCH").then(load).catch((e) => setError(message(e)))}>{resolved(c) ? "Reopen" : "Resolve"}</button></div>}</div>;
  const roots = comments.filter((c) => !c.parentId && (showResolved || !resolved(c)));
  return <div>{error && <p role="alert" className="team-error">{error}</p>}<label className="team-checkbox"><input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />Show resolved threads</label><div className="comment-list">{roots.length ? roots.map((c) => <div key={c.id}>{render(c)}{comments.filter((r) => r.parentId === c.id).map((r) => render(r, true))}</div>) : <Empty>Start a conversation about this page.</Empty>}</div>
    {canEdit ? <form className="comment-compose" onSubmit={async (e) => { e.preventDefault(); if (!body.trim() || !await beforeAction()) return; setBusy(true); setError(""); try { await teamRequest(`pages/${pageId}/comments`, { body: body.trim(), parentId: replyTo, mentions }); setBody(""); setReplyTo(null); setMentions([]); await load(); } catch (e) { setError(message(e)); } finally { setBusy(false); } }}>
      {replyTo && <div className="reply-to">Replying to a thread<button className="icon-button" aria-label="Cancel reply" type="button" disabled={busy} onClick={() => setReplyTo(null)}><X size={14} /></button></div>}
      <textarea className="form-input" aria-label="Comment" disabled={busy} required value={body} onChange={(e) => setBody(e.target.value)} maxLength={10000} rows={3} placeholder="Write a comment…" />
      <details className="mention-picker"><summary>Mention teammates{mentions.length ? ` (${mentions.length})` : ""}</summary><p className="small-note">Share this page with teammates before mentioning them. A mention does not grant access.</p>{team.members.filter((u) => u.id !== team.user?.id && !u.disabled).map((u) => <label className="team-checkbox" key={u.id}><input type="checkbox" disabled={busy} checked={mentions.includes(u.id)} onChange={(e) => setMentions(e.target.checked ? [...mentions, u.id] : mentions.filter((id) => id !== u.id))} />{u.name}</label>)}</details>
      <button className="primary-button" disabled={busy || !body.trim()}>{busy ? "Posting…" : replyTo ? "Post reply" : "Post comment"}</button>
    </form> : <p className="small-note">You have read-only access to this page.</p>}
  </div>;
}

type TeamFile = { id: string; pageId: string; name: string; size: number; createdAt: number; createdBy: string };
function Files({ pageId, canEdit, beforeAction }: { pageId: string; canEdit: boolean; beforeAction: () => Promise<boolean> }) {
  const team = useTeam();
  const [files, setFiles] = useState<TeamFile[]>([]), [error, setError] = useState(""), [busy, setBusy] = useState(false), [deleteId, setDeleteId] = useState<string | null>(null);
  const load = useCallback(() => teamRequest<{ files: TeamFile[] }>(`pages/${pageId}/files`).then((r) => setFiles(r.files)), [pageId]);
  useEffect(() => { void load().catch((e) => setError(message(e))); }, [load]);
  return <div>{error && <p role="alert" className="team-error">{error}</p>}{canEdit && <label className={`file-upload ${busy ? "busy" : ""}`}><Upload size={23} /><strong>{busy ? "Uploading…" : "Attach a file"}</strong><span>Images, documents, and other files · up to 10 MB</span><input type="file" aria-label="Upload attachment" disabled={busy} onChange={async (e) => {
    const file = e.target.files?.[0]; e.target.value = ""; if (!file) return;
    if (file.size > 10 * 1024 * 1024) { setError("Files must be 10 MB or smaller."); return; } if (!await beforeAction()) return;
    setBusy(true); setError(""); try { const response = await fetch(`/api/team/pages/${pageId}/files`, { method: "POST", headers: { "Content-Type": "application/octet-stream", "X-Folio-Filename": encodeURIComponent(file.name), "X-Folio-User": team.user?.id ?? "" }, body: file }); const data = await response.json() as { error?: string }; if (!response.ok) throw new Error(data.error || "Upload failed."); await load(); toast.success("File attached"); } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }} /></label>}
  <div className="team-files">{files.length ? files.map((file) => <div className="team-file" key={file.id}><Paperclip size={19} /><div><strong>{file.name}</strong><small>{file.size < 1024 * 1024 ? `${Math.ceil(file.size / 1024)} KB` : `${(file.size / 1024 / 1024).toFixed(1)} MB`} · {date(file.createdAt)}</small></div><a className="icon-button" href={`/api/team/files/${file.id}`} download={file.name} aria-label={`Download ${file.name}`}><Download size={17} /></a>{canEdit && <button className="icon-button" aria-label={`Remove ${file.name}`} onClick={() => setDeleteId(file.id)}><X size={17} /></button>}{deleteId === file.id && <div className="file-delete-confirm"><span>Remove this attachment?</span><button className="plain-button" onClick={() => setDeleteId(null)}>Keep</button><button className="outline-button" onClick={() => void teamRequest(`files/${file.id}`, undefined, "DELETE").then(() => { setDeleteId(null); return load(); }).catch((e) => setError(message(e)))}>Remove</button></div>}</div>) : <Empty>No attachments yet. Keep documents close to the work they belong to.</Empty>}</div></div>;
}
type Version = { authorName?: string; id: string | number; versionId?: string; revision: number; createdAt: number; actorName?: string; userId?: string; title?: string; page?: Page };
function PageHistory({ pageId, canEdit, baseRevision, onReload, beforeAction }: { pageId: string; canEdit: boolean; baseRevision: number; onReload: () => Promise<void>; beforeAction: () => Promise<boolean> }) {
  const team = useTeam(); const [history, setHistory] = useState<Version[]>([]), [error, setError] = useState(""), [restore, setRestore] = useState<Version | null>(null), [busy, setBusy] = useState(false);
  const load = useCallback(() => teamRequest<{ history: Version[] }>(`pages/${pageId}/history`).then((r) => setHistory(r.history)), [pageId]);
  useEffect(() => { void load().catch((e) => setError(message(e))); }, [load]);
  return <div>{error && <p role="alert" className="team-error">{error}</p>}<p className="small-note">Saved page versions let you recover earlier work. Restoring creates a new version and preserves current sharing permissions.</p><div className="team-history">{history.length ? history.map((version) => <div className="team-version" key={version.id}><History size={18} /><div><strong>{date(version.createdAt)}</strong><small>{version.authorName ?? version.actorName ?? team.members.find((u) => u.id === version.userId)?.name ?? "Teammate"} · Version {version.revision}</small>{version.title && <span>{version.title}</span>}</div>{canEdit && <button className="plain-button" onClick={() => setRestore(version)}><RotateCcw size={14} />Restore</button>}</div>) : <Empty>Saved versions will appear as your team edits this page.</Empty>}</div>{restore && <div className="history-confirm"><strong>Restore the version from {date(restore.createdAt)}?</strong><p>The current page becomes a previous version. Your page’s access stays the same.</p><div className="dialog-actions"><button className="plain-button" onClick={() => setRestore(null)}>Cancel</button><button className="primary-button" disabled={busy} onClick={async () => { if (!await beforeAction()) return; setBusy(true); setError(""); try { await teamRequest(`pages/${pageId}/restore`, { versionId: restore.versionId ?? restore.id, baseRevision }); await onReload(); await load(); setRestore(null); toast.success("Page restored"); } catch (e) { setError(message(e)); } finally { setBusy(false); } }}>Restore version</button></div></div>}</div>;
}

function Presence({ pageId }: { pageId: string }) {
  const team = useTeam();
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    let active = true;
    const update = () => teamRequest<{ presence: { id: string; name: string }[] }>(`pages/${pageId}/presence`, {}).then((r) => { if (active) setPeople(r.presence); }).catch(() => {});
    void update(); const timer = setInterval(update, 15_000);
    return () => { active = false; clearInterval(timer); };
  }, [pageId]);
  const others = people.filter((p) => p.id !== team.user?.id);
  return others.length ? <div className="team-presence" aria-label="Also viewing this page" title={`Also viewing: ${others.map((p) => p.name).join(", ")}`}>{others.slice(0, 3).map((person) => <span key={person.id} className="team-avatar">{person.name[0].toUpperCase()}</span>)}{others.length > 3 && <small>+{others.length - 3}</small>}</div> : null;
}
