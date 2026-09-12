"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Workspace, Page } from "./model";
import { workspaceCommand, rebasePending } from "./team-sync.ts";
import type { PageAccess, PagePermission } from "./team-client";
export type SaveStatus =
  "loading" | "saved" | "saving" | "unsaved" | "error" | "conflict";
export function useWorkspace({ team = false, accountId }: { team?: boolean; accountId?: string } = {}) {
  const requestEpoch = useRef(0), pollSequence = useRef(0);
  const invalidateRequests = useCallback(() => { requestEpoch.current++; }, []);
  const expectedActor = useCallback((data: { userId?: string }) => {
    if (!team || !accountId || data.userId === accountId) return true;
    window.dispatchEvent(new Event("folio:session"));
    return false;
  }, [team, accountId]);
  const endpoint = team ? "/api/team/workspace" : "/api/workspace";
  const [permissions, setPermissions] = useState<Record<string, PagePermission>>({});
  const [access, setAccess] = useState<Record<string, PageAccess>>({});
  const base = useRef<Workspace | null>(null);
  const pageRevisions = useRef<Record<string, number>>({});
  const [revisionMap, setRevisionMap] = useState<Record<string, number>>({});
  const [remoteVersions, setRemoteVersions] = useState<Record<string, number>>({});
  const recordRemoteChanges = useCallback((before: Workspace | null, after: Workspace) => {
    const old = new Map(before?.pages.map((p) => [p.id, p]) ?? []);
    const changed = after.pages.filter((p) => old.has(p.id) && JSON.stringify(old.get(p.id)?.content) !== JSON.stringify(p.content)).map((p) => p.id);
    if (changed.length) setRemoteVersions((versions) => { const next = { ...versions }; for (const id of changed) next[id] = (next[id] ?? 0) + 1; return next; });
  }, []);
  const [generation, setGeneration] = useState(0);
  const [workspace, setWorkspace] = useState<Workspace | null>(null),
    [status, setStatus] = useState<SaveStatus>("loading"),
    [error, setError] = useState("");
  const current = useRef<Workspace | null>(null),
    revision = useRef(0),
    serial = useRef(0),
    savedSerial = useRef(0),
    saving = useRef(false),
    blocked = useRef(false),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    mounted = useRef(true);
  const flush = useCallback(async function drain() {
    if (
      saving.current ||
      blocked.current ||
      !current.current ||
      serial.current === savedSerial.current
    )
      return;
    requestEpoch.current++;
    saving.current = true;
    setStatus("saving");
    const snapshot = current.current,
      seq = serial.current;
    let success = false;
    try {
      const response = await fetch(endpoint, {
        method: team ? "POST" : "PUT",
        headers: { "Content-Type": "application/json", ...(team && accountId ? { "X-Folio-User": accountId } : {}) },
        body: JSON.stringify(team && base.current ? workspaceCommand(base.current, snapshot, pageRevisions.current) : {
          revision: revision.current,
          workspace: snapshot,
        }),
      });
      const data = (await response.json()) as {
        error?: string;
        userId?: string;
        code?: string;
        revision: number;
        workspace: Workspace;
        pageRevisions?: Record<string, number>;
        permissions?: Record<string, PagePermission>;
        access?: Record<string, PageAccess>;
      };
      if (!response.ok) {
        if (response.status === 409 || response.status === 403) blocked.current = true;
        if (team && (response.status === 401 || data.code === "account_changed")) window.dispatchEvent(new Event("folio:session"));
        throw new Error(data.error || "Saving failed.");
      }
      if (!expectedActor(data)) throw new Error("Your account changed. Reopening the workspace…");
      requestEpoch.current++;
      revision.current = data.revision;
      if (team) {
        base.current = data.workspace;
        pageRevisions.current = data.pageRevisions ?? {};
        setRevisionMap(data.pageRevisions ?? {});
        const next = serial.current === seq ? data.workspace : rebasePending(snapshot, current.current!, data.workspace);
        recordRemoteChanges(current.current, next);
        current.current = next;
        if (mounted.current) {
          setWorkspace(next);
          setPermissions(data.permissions ?? {});
          setAccess(data.access ?? {});
        }
      }
      savedSerial.current = seq;
      success = true;
      if (mounted.current) {
        setError("");
        setStatus(serial.current === seq ? "saved" : "unsaved");
      }
    } catch (e) {
      if (mounted.current) {
        setError(e instanceof Error ? e.message : "Saving failed.");
        setStatus(blocked.current ? "conflict" : "error");
      }
    } finally {
      saving.current = false;
      if (
        success &&
        mounted.current &&
        serial.current !== savedSerial.current
      ) {
        timer.current = setTimeout(() => void drain(), 250);
      }
    }
  }, [team, endpoint, recordRemoteChanges, accountId, expectedActor]);
  const load = useCallback(async () => {
    const epoch = ++requestEpoch.current, atSerial = serial.current;
    setStatus("loading");
    if (!blocked.current) setError("");
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      const data = (await response.json()) as {
        error?: string;
        userId?: string;
        revision: number;
        workspace: Workspace;
        pageRevisions?: Record<string, number>;
        permissions?: Record<string, PagePermission>;
        access?: Record<string, PageAccess>;
      };
      if (!mounted.current || epoch !== requestEpoch.current || atSerial !== serial.current) return;
      if (!response.ok) {
        if (team && response.status === 401) window.dispatchEvent(new Event("folio:session"));
        throw new Error(data.error);
      }
      if (!expectedActor(data)) return;
      current.current = data.workspace;
      base.current = data.workspace;
      pageRevisions.current = data.pageRevisions ?? {};
        setRevisionMap(data.pageRevisions ?? {});
      setPermissions(data.permissions ?? {});
      setAccess(data.access ?? {});
      revision.current = data.revision;
      serial.current = 0;
      savedSerial.current = 0;
      blocked.current = false;
      setError("");
      setWorkspace(data.workspace);
      setGeneration((n) => n + 1);
      setStatus("saved");
    } catch (e) {
      if (!mounted.current || epoch !== requestEpoch.current || atSerial !== serial.current) return;
      setError(
        e instanceof Error ? e.message : "Could not load the workspace.",
      );
      setStatus(blocked.current ? "conflict" : "error");
    }
  }, [team, endpoint, expectedActor]);
  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    void Promise.resolve().then(() => { if (!cancelled) void load(); });
    return () => {
      cancelled = true;
      mounted.current = false;
      invalidateRequests();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load, invalidateRequests]);
  useEffect(() => {
    if (!team) return;
    const poll = async () => {
      if (saving.current || blocked.current || !current.current || serial.current !== savedSerial.current) return;
      const atSerial = serial.current, epoch = requestEpoch.current, sequence = ++pollSequence.current;
      try {
        const response = await fetch(endpoint, { cache: "no-store" });
        if (response.status === 401) { window.dispatchEvent(new Event("folio:session")); return; }
        if (!response.ok) return;
        const data = await response.json() as { userId?: string; workspace: Workspace; pageRevisions: Record<string, number>; revision: number; permissions: Record<string, PagePermission>; access: Record<string, PageAccess> };
        if (!mounted.current || sequence !== pollSequence.current || epoch !== requestEpoch.current || saving.current || blocked.current || atSerial !== serial.current || serial.current !== savedSerial.current) return;
        if (!expectedActor(data)) return;
        if (JSON.stringify(data.workspace) !== JSON.stringify(current.current)) {
          recordRemoteChanges(current.current, data.workspace);
          current.current = data.workspace;
          base.current = data.workspace;
          setWorkspace(data.workspace);
        }
        pageRevisions.current = data.pageRevisions ?? {};
        setRevisionMap(data.pageRevisions ?? {});
        revision.current = data.revision;
        setPermissions(data.permissions ?? {});
        setAccess(data.access ?? {});
      } catch { /* Background refresh is retried; foreground saves surface failures. */ }
    };
    const interval = setInterval(() => void poll(), 5000);
    window.addEventListener("focus", poll);
    return () => { clearInterval(interval); window.removeEventListener("focus", poll); };
  }, [team, endpoint, recordRemoteChanges, expectedActor]);
  useEffect(() => {
    if (status === "unsaved") {
      timer.current = setTimeout(() => void flush(), 300);
      return () => {
        if (timer.current) clearTimeout(timer.current);
      };
    }
  }, [workspace, status, flush]);
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (serial.current !== savedSerial.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, []);
  const mutate = useCallback((fn: (ws: Workspace) => Workspace) => {
    if (!current.current) return;
    const next = fn(current.current);
    requestEpoch.current++;
    current.current = next;
    serial.current++;
    setWorkspace(next);
    setStatus(blocked.current ? "conflict" : "unsaved");
  }, []);
  const updatePage = useCallback(
    (id: string, changes: Partial<Page>) =>
      mutate((ws) => ({
        ...ws,
        pages: ws.pages.map((p) =>
          p.id === id ? { ...p, ...changes, updatedAt: Date.now() } : p,
        ),
      })),
    [mutate],
  );
  const favoriteSequence = useRef(0);
  const setFavorite = useCallback(async (pageId: string, favorite: boolean) => {
    if (!team || saving.current || blocked.current || serial.current !== savedSerial.current) return false;
    const sequence = ++favoriteSequence.current;
    const response = await fetch("/api/team/preferences", { method: "POST", headers: { "Content-Type": "application/json", ...(accountId ? { "X-Folio-User": accountId } : {}) }, body: JSON.stringify({ pageId, favorite }) });
    const data = await response.json() as { error?: string; code?: string; userId?: string };
    if (!response.ok) {
      if (response.status === 401 || data.code === "account_changed") window.dispatchEvent(new Event("folio:session"));
      throw new Error(data.error || "Could not update favorites.");
    }
    if (!expectedActor(data)) return false;
    if (!mounted.current || sequence !== favoriteSequence.current) return true;
    // A preference response must never replace page contents or revisions. A
    // concurrent poll/save may already have delivered newer content.
    const apply = (workspace: Workspace) => ({ ...workspace, pages: workspace.pages.map((page) => page.id === pageId ? { ...page, favorite } : page) });
    if (current.current) { current.current = apply(current.current); setWorkspace(current.current); }
    if (base.current) base.current = apply(base.current);
    return true;
  }, [team, accountId, expectedActor]);
  const getWorkspace = useCallback(() => current.current, []);
  return {
    workspace,
    generation,
    status,
    error,
    mutate,
    updatePage,
    retry: flush,
    reload: load,
    getWorkspace,
    remoteVersions,
    setFavorite,
    flush,
    permissions,
    access,
    pageRevisions: revisionMap,
  };
}
