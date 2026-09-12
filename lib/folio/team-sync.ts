import type { Page, Workspace } from "./model.ts";
export type PageCommand = { changes: { page: Page; baseRevision: number | null }[]; deleted: { id: string; baseRevision: number }[]; name?: string; baseName?: string; theme?: Workspace["theme"] };
export const samePage = (a: Page | undefined, b: Page | undefined) => JSON.stringify(a) === JSON.stringify(b);
export function workspaceCommand(base: Workspace, next: Workspace, revisions: Record<string, number>): PageCommand {
  const before = new Map(base.pages.map((p) => [p.id, p]));
  const after = new Set(next.pages.map((p) => p.id));
  return {
    changes: next.pages.filter((p) => !samePage(before.get(p.id), p)).map((page) => ({ page, baseRevision: before.has(page.id) ? revisions[page.id] : null })),
    deleted: base.pages.filter((p) => !after.has(p.id)).map((p) => ({ id: p.id, baseRevision: revisions[p.id] })),
    ...(base.name !== next.name ? { name: next.name, baseName: base.name } : {}),
    ...(base.theme !== next.theme ? { theme: next.theme } : {}),
  };
}
// Keep edits made while a save was in flight, while accepting unrelated remote pages.
export function rebasePending(sent: Workspace, pending: Workspace, received: Workspace): Workspace {
  const before = new Map(sent.pages.map((p) => [p.id, p]));
  const pendingIds = new Set(pending.pages.map((p) => p.id));
  const changed = new Map(pending.pages.filter((p) => !samePage(before.get(p.id), p)).map((p) => [p.id, p]));
  const removed = new Set(sent.pages.filter((p) => !pendingIds.has(p.id)).map((p) => p.id));
  const receivedIds = new Set(received.pages.map((p) => p.id));
  return {
    ...received,
    ...(pending.name !== sent.name ? { name: pending.name } : {}),
    ...(pending.theme !== sent.theme ? { theme: pending.theme } : {}),
    pages: [...received.pages.filter((p) => !removed.has(p.id)).map((p) => changed.get(p.id) ?? p), ...[...changed.values()].filter((p) => !receivedIds.has(p.id))],
  };
}
