"use client";
import { createContext, useCallback, useContext, useEffect, useState, useRef, Fragment, type ReactNode } from "react";
import { KeyRound, Loader2, LogIn } from "lucide-react";
import "@/components/folio/team.css";

export type TeamRole = "owner" | "admin" | "member" | "viewer";
export type TeamUser = { id: string; username: string; name: string; role: TeamRole; mustChangePassword: boolean; disabled: boolean };
export type PageAccess = { ownerId: string; visibility: "private" | "team"; accessRevision?: number; inherited?: boolean; grants: { userId: string; role: "viewer" | "editor" }[] };
export type PagePermission = { read: boolean; edit: boolean; manage: boolean };
export type TeamSession = { enabled: boolean; user: TeamUser | null; members: TeamUser[] };
let activeActorId: string | undefined;
export async function teamRequest<T = Record<string, unknown>>(path: string, body?: unknown, method?: string): Promise<T> {
  const response = await fetch(`/api/team/${path}`, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    cache: "no-store",
    headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(activeActorId ? { "X-Folio-User": activeActorId } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json() as { error?: string; code?: string } & Partial<TeamSession>;
  if (!response.ok) {
    if (response.status === 401 || data.code === "password_change_required" || data.code === "account_changed") window.dispatchEvent(new Event("folio:session"));
    throw new Error(data.error || "The request could not be completed.");
  }
  return data as T;
}
const TeamContext = createContext<TeamSession & { refresh: () => Promise<void>; logout: () => Promise<void> }>({ enabled: false, user: null, members: [], refresh: async () => {}, logout: async () => {} });
export const useTeam = () => useContext(TeamContext);

export function TeamProvider({ children }: { children: ReactNode }) {
  const refreshSequence = useRef(0);
  const [session, setSession] = useState<TeamSession | null>(null);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    try {
      const response = await fetch("/api/team/session", { cache: "no-store" });
      const data = await response.json() as { error?: string; code?: string } & Partial<TeamSession>;
      if (sequence !== refreshSequence.current) return;
      activeActorId = data.user?.id;
      if (response.status === 401) setSession({ enabled: true, user: null, members: [] });
      else if (!response.ok) throw new Error(data.error || "Could not check your session.");
      else setSession({ enabled: Boolean(data.enabled), user: data.user ?? null, members: data.members ?? [] });
      setError("");
    } catch (e) { if (sequence === refreshSequence.current) setError(e instanceof Error ? e.message : "Could not connect."); }
  }, []);
  useEffect(() => {
    void Promise.resolve().then(refresh);
    const timer = setInterval(() => void refresh(), 60_000);
    const check = () => void refresh();
    window.addEventListener("folio:session", check);
    return () => { clearInterval(timer); window.removeEventListener("folio:session", check); };
  }, [refresh]);
  const logout = async () => { refreshSequence.current++; await teamRequest("logout", {}); refreshSequence.current++; activeActorId = undefined; setSession({ enabled: true, user: null, members: [] }); };
  if (!session) return <main className="team-login"><div className="login-card"><span className="brand-mark">F</span><h1>Opening Folio</h1>{error ? <><p role="alert">{error}</p><button className="primary-button" onClick={() => void refresh()}>Try again</button></> : <Loader2 className="animate-spin" />}</div></main>;
  return <TeamContext.Provider value={{ ...session, refresh, logout }}>
    {session.enabled && !session.user ? <SignIn onSuccess={refresh} /> : session.user?.mustChangePassword ? <PasswordScreen required onSuccess={refresh} /> : <Fragment key={session.user?.id ?? "local"}>{children}</Fragment>}
  </TeamContext.Provider>;
}
function SignIn({ onSuccess }: { onSuccess: () => Promise<void> }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  return <main className="team-login"><div className="login-card"><span className="brand-mark">F</span><div className="login-kicker">A little space. A shared purpose.</div><h1>Welcome to Folio</h1><p>Your team’s notes, projects, and ideas—in one place.</p>
    <form onSubmit={async (e) => {
      e.preventDefault(); const values = new FormData(e.currentTarget); setBusy(true); setError("");
      try { await teamRequest("login", { username: values.get("username"), password: values.get("password") }); await onSuccess(); }
      catch (e) { setError(e instanceof Error ? e.message : "Sign-in failed."); } finally { setBusy(false); }
    }}>
      <label className="form-label">Username<input className="form-input" name="username" autoComplete="username" autoCapitalize="none" required maxLength={80} autoFocus /></label>
      <label className="form-label">Password<input className="form-input" name="password" type="password" autoComplete="current-password" required maxLength={128} /></label>
      {error && <p className="team-error" role="alert">{error}</p>}
      <button className="primary-button login-submit" disabled={busy}>{busy ? <Loader2 size={16} className="animate-spin" /> : <LogIn size={16} />}Sign in</button>
    </form><p className="small-note">Need an account or password reset? Ask your workspace administrator.</p>
  </div></main>;
}
export function PasswordScreen({ required = false, onSuccess }: { required?: boolean; onSuccess: () => Promise<void> }) {
  const { logout } = useTeam();
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [done, setDone] = useState(false);
  const form = <div className={required ? "login-card" : "password-card"}>
    {required && <span className="brand-mark">F</span>}<h2>{required ? "Make this account yours" : "Change password"}</h2><p>{required ? "Choose a new password before opening your team workspace." : "Changing your password signs out your other sessions."}</p>
    <form onSubmit={async (e) => {
      e.preventDefault(); const form = e.currentTarget, values = new FormData(form); setError(""); setDone(false);
      if (values.get("newPassword") !== values.get("confirmPassword")) { setError("The new passwords do not match."); return; }
      setBusy(true);
      try { await teamRequest("password", { currentPassword: values.get("currentPassword"), newPassword: values.get("newPassword") }); form.reset(); setDone(true); await onSuccess(); }
      catch (e) { setError(e instanceof Error ? e.message : "Could not change password."); } finally { setBusy(false); }
    }}>
      <label className="form-label">Current password<input className="form-input" type="password" name="currentPassword" autoComplete="current-password" required maxLength={128} /></label>
      <label className="form-label">New password<input className="form-input" type="password" name="newPassword" autoComplete="new-password" required minLength={12} maxLength={128} placeholder="At least 12 characters" /></label>
      <label className="form-label">Confirm new password<input className="form-input" type="password" name="confirmPassword" autoComplete="new-password" required minLength={12} maxLength={128} /></label>
      {error && <p role="alert" className="team-error">{error}</p>}{done && <p role="status">Password updated.</p>}
      <button className="primary-button" disabled={busy}><KeyRound size={16} />{busy ? "Saving…" : "Update password"}</button>
    </form>{required && <button className="plain-button" onClick={() => void logout().catch((e) => setError(e.message))}>Sign out</button>}
  </div>;
  return required ? <main className="team-login">{form}</main> : form;
}
