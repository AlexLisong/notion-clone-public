export type WorkspaceRow = { revision: number; data: string };
export interface WorkspaceStore {
  load(initial: string): Promise<WorkspaceRow>;
  save(data: string, revision: number): Promise<boolean>;
}
export type AccessPolicy =
  | { mode: "local" }
  | { mode: "hosted"; origin: string; proxyKey: string };
