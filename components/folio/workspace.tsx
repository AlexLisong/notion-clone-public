"use client";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  Search,
  Home,
  Plus,
  Trash2,
  Settings2,
  ChevronsUpDown,
  ChevronDown,
  ChevronRight,
  Star,
  MoreHorizontal,
  Copy,
  Download,
  Upload,
  ArrowRight,
  ArrowLeft,
  Check,
  FileText,
  FolderInput,
  Link2,
  LayoutTemplate,
  RotateCcw,
  Loader2,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  Command,
  CommandInput,
  CommandList,
  CommandItem,
  CommandEmpty,
  CommandGroup,
} from "@/components/ui/command";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { useWorkspace } from "@/lib/folio/use-workspace";
import {
  ancestors,
  csv,
  descendants,
  duplicatePage,
  markdown,
  mergeBackup,
  movePage,
  plainText,
  restorePage,
  searchPages,
  trashPage,
  validateWorkspace,
  type Page,
  type Workspace,
} from "@/lib/folio/model";
import { fromTemplate, templates } from "@/lib/folio/seed";
import { RichEditor } from "./editor";
import { Choice, DatabaseView, PropertyInput } from "./database";
import { TeamProvider, useTeam } from "@/lib/folio/team-client";
import { TeamNavigation, TeamPageTools } from "./team";
import { samePage } from "@/lib/folio/team-sync";

const icons = [
  "📄",
  "🏡",
  "✏️",
  "📚",
  "👋",
  "🧩",
  "💡",
  "🎯",
  "📝",
  "🌱",
  "☀️",
  "🏕️",
  "📖",
  "💻",
  "🎨",
  "🚀",
  "🗂️",
  "💼",
  "🎧",
  "❤️",
  "◈",
  "✦",
  "◎",
  "☑",
];
function download(name: string, content: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
const filename = (s: string) =>
  s
    .replace(/[^\p{L}\p{N}\-_ ]/gu, "")
    .trim()
    .slice(0, 100) || "Untitled";

export default function Folio() {
  return (
    <TeamProvider><SidebarProvider
      style={{ "--sidebar-width": "15rem" } as React.CSSProperties}
    >
      <WorkspaceApp />
      <Toaster position="bottom-right" />
    </SidebarProvider></TeamProvider>
  );
}
function WorkspaceApp() {
  const team = useTeam();
  const {
    workspace: ws,
    generation,
    status,
    error,
    mutate: rawMutate,
    retry,
    reload,
    flush,
    getWorkspace,
    permissions,
    access,
    pageRevisions,
    remoteVersions,
    setFavorite,
  } = useWorkspace({ team: team.enabled, accountId: team.user?.id });
  const canCreate = !team.enabled || team.user?.role !== "viewer";
  const canAdmin = !team.enabled || team.user?.role === "owner" || team.user?.role === "admin";
  const canEditPage = (id: string) => !team.enabled || Boolean(permissions[id]?.edit || (pageRevisions[id] === undefined && canCreate));
  const mutate = useCallback((fn: (workspace: Workspace) => Workspace) => {
    const current = getWorkspace();
    if (!current) return;
    try {
      const next = fn(current);
      if (team.enabled) {
        const nextIds = new Set(next.pages.map((p) => p.id));
        const before = new Map(current.pages.map((p) => [p.id, p]));
        const edits = next.pages.filter((p) => !samePage(before.get(p.id), p));
        if (edits.some((p) => before.has(p.id) ? pageRevisions[p.id] !== undefined && !permissions[p.id]?.edit : team.user?.role === "viewer" || (p.parentId && before.has(p.parentId) && !permissions[p.parentId]?.edit)) || current.pages.some((p) => !nextIds.has(p.id) && !permissions[p.id]?.edit)) {
          toast.error("You have read-only access. Ask a page owner for edit access."); return;
        }
        if (next.name !== current.name && !canAdmin) { toast.error("Only admins can rename the workspace."); return; }
      }
      rawMutate(() => next);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not update the workspace."); }
  }, [getWorkspace, team.enabled, team.user?.role, permissions, pageRevisions, canAdmin, rawMutate]);
  const updatePage = (id: string, changes: Partial<Page>) => mutate((w) => ({ ...w, pages: w.pages.map((p) => p.id === id ? { ...p, ...changes, updatedAt: Date.now() } : p) }));
  const beforeTeamAction = async () => {
    if (status === "conflict" || status === "error") { toast.error("Resolve the save error before continuing."); return false; }
    if (status === "unsaved" || status === "saving") { await flush(); toast.info("Wait for all changes to save, then try again."); return false; }
    return true;
  };
  const [activeId, setActiveId] = useState("home"),
    [expanded, setExpanded] = useState<Set<string>>(new Set(["home"])),
    [searchOpen, setSearchOpen] = useState(false),
    [query, setQuery] = useState(""),
    [newOpen, setNewOpen] = useState(false),
    [newParent, setNewParent] = useState<string | null>(null),
    [settings, setSettings] = useState(false),
    [trashOpen, setTrashOpen] = useState(false),
    [trashQuery, setTrashQuery] = useState(""),
    [moveOpen, setMoveOpen] = useState(false),
    [confirm, setConfirm] = useState<{
      title: string;
      description: string;
      action: () => void;
    } | null>(null);
  const { setOpenMobile, isMobile } = useSidebar();
  const importRef = useRef<HTMLInputElement>(null),
    scrollRef = useRef<HTMLElement>(null);
  const active = ws?.pages.find((p) => p.id === activeId && !p.trashedAt),
    parent = ws?.pages.find((p) => p.id === active?.parentId),
    lineage = ws && active ? ancestors(ws.pages, active.id) : [];
  const go = useCallback(
    (id: string) => {
      window.location.hash = encodeURIComponent(id);
      setActiveId(id);
      if (isMobile) setOpenMobile(false);
      scrollRef.current?.scrollTo(0, 0);
    },
    [isMobile, setOpenMobile],
  );
  useEffect(() => {
    const change = () => {
      try {
        setActiveId(decodeURIComponent(location.hash.slice(1)) || "home");
      } catch {
        setActiveId("home");
      }
      scrollRef.current?.scrollTo(0, 0);
    };
    change();
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  const displayTitle = active ? active.title || "Untitled" : null;
  useEffect(() => {
    document.title = displayTitle
      ? `${displayTitle} — Folio`
      : "Folio — Your workspace";
  }, [displayTitle]);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        ["k", "p"].includes(e.key.toLowerCase())
      ) {
        e.preventDefault();
        setQuery("");
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  const theme = ws?.theme;
  useEffect(() => {
    if (!theme) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () =>
      document.documentElement.classList.toggle(
        "dark",
        theme === "dark" || (theme === "system" && media.matches),
      );
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  const create = useCallback(
    (page: Page) => {
      mutate((w) => ({ ...w, pages: [...w.pages, page] }));
      if (page.parentId) setExpanded((s) => new Set([...s, page.parentId!]));
      setNewOpen(false);
      go(page.id);
    },
    [mutate, go],
  );
  const addPage = (parentId: string | null = null) => {
    if (!canCreate || (parentId && !canEditPage(parentId))) return;
    setNewParent(parentId);
    setNewOpen(true);
  };
  const duplicate = (id: string) => {
    if (!ws) return;
    const result = duplicatePage(ws, id);
    mutate(() => result.workspace);
    go(result.id);
    toast.success("Page duplicated");
  };
  const remove = (id: string) => {
    if (!ws) return;
    const page = ws.pages.find((p) => p.id === id);
    const ids = descendants(ws.pages, id);
    mutate((w) => trashPage(w, id));
    if (ids.has(activeId))
      go(
        page?.parentId ??
          ws.pages.find((p) => !ids.has(p.id) && !p.trashedAt)?.id ??
          "",
      );
    toast("Moved to Trash", {
      action: {
        label: "Undo",
        onClick: () => {
          mutate((w) => restorePage(w, id));
          go(id);
        },
      },
    });
  };
  const backup = () => {
    if (ws) {
      download(
        `folio-backup-${new Date().toISOString().slice(0, 10)}.json`,
        JSON.stringify(ws, null, 2),
      );
      toast.success("Workspace backup downloaded");
    }
  };
  const exportPage = () => {
    if (!ws || !active) return;
    if (active.kind === "database")
      download(
        `${filename(active.title)}.csv`,
        csv(
          ws.pages.filter((p) => p.parentId === active.id && !p.trashedAt),
          active.columns,
          { members: team.members, pages: ws.pages },
        ),
        "text/csv;charset=utf-8",
      );
    else
      download(
        `${filename(active.title)}.md`,
        `# ${active.title || "Untitled"}\n\n${markdown(active.content)}`,
        "text/markdown;charset=utf-8",
      );
  };
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      toast.success("Page link copied. It opens in this workspace.");
    } catch {
      toast.error("Could not copy. Copy the page address from your browser.");
    }
  };
  // WebMCP is optional; tools use the same validated workspace actions as the UI.
  const stateRef = useRef({ ws, go, create });
  useLayoutEffect(() => {
    stateRef.current = { ws, go, create };
  }, [ws, go, create]);
  useEffect(() => {
    type Context = {
      registerTool: (
        tool: unknown,
        options: { signal: AbortSignal },
      ) => unknown;
    };
    const context = (document as Document & { modelContext?: Context })
      .modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const tools = [
      {
        name: "search_folio_pages",
        description: "Search personal workspace page titles and contents.",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: (input: unknown) => {
          if (
            !input ||
            typeof input !== "object" ||
            !("query" in input) ||
            typeof input.query !== "string"
          )
            throw new Error("query must be a string");
          const w = stateRef.current.ws;
          if (!w) throw new Error("Workspace is loading");
          return searchPages(w, input.query)
            .slice(0, 20)
            .map((p) => ({ id: p.id, title: p.title }));
        },
      },
      {
        name: "create_folio_page",
        description:
          "Create and open a new empty page in the personal workspace. Changes save automatically.",
        inputSchema: {
          type: "object",
          properties: { title: { type: "string", maxLength: 500 } },
          required: ["title"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        execute: (input: unknown) => {
          if (
            !input ||
            typeof input !== "object" ||
            !("title" in input) ||
            typeof input.title !== "string" ||
            input.title.length > 500
          )
            throw new Error("title must be a string up to 500 characters");
          if (!stateRef.current.ws) throw new Error("Workspace is loading");
          const page = fromTemplate("blank");
          page.title = input.title;
          stateRef.current.create(page);
          return {
            id: page.id,
            title: page.title,
            status: "created",
            saving: "pending",
          };
        },
      },
    ];
    for (const tool of tools) {
      try {
        void Promise.resolve(
          context.registerTool(tool, { signal: lifecycle.signal }),
        ).catch((e) => console.warn("Optional workspace tools unavailable", e));
      } catch (e) {
        console.warn("Optional workspace tools unavailable", e);
      }
    }
    return () => lifecycle.abort();
  }, []);
  if (!ws || status === "loading")
    return (
      <main className="workspace-loading">
        <span className="brand-mark">F</span>
        <h1>
          {status === "loading"
            ? "Opening your workspace…"
            : "Your workspace is unavailable"}
        </h1>
        {error ? (
          <>
            <p>{error}</p>
            <button className="primary-button" onClick={() => void reload()}>
              Try again
            </button>
          </>
        ) : (
          <Loader2 className="animate-spin" size={20} />
        )}
      </main>
    );
  const readOnly = Boolean(active && !canEditPage(active.id));
  const visible = ws.pages.filter((p) => !p.trashedAt),
    searchResults = searchPages(ws, query).slice(0, 50),
    children = visible.filter((p) => p.parentId === active?.id),
    excluded = active ? descendants(ws.pages, active.id) : new Set<string>();
  function tree(parentId: string | null, depth = 0): React.ReactNode {
    return visible
      .filter((p) => p.parentId === parentId)
      .map((page) => {
        const hasChildren = visible.some((p) => p.parentId === page.id);
        return (
          <div key={page.id}>
            <div
              className={`tree-row ${page.id === activeId ? "active" : ""}`}
              style={{ paddingLeft: 8 + depth * 13 }}
              draggable={canEditPage(page.id)}
              onDragStart={(e) =>
                e.dataTransfer.setData("application/folio-page", page.id)
              }
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes("application/folio-page"))
                  e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const id = e.dataTransfer.getData("application/folio-page");
                if (!id || !visible.some((p) => p.id === id)) return;
                try {
                  mutate((w) => movePage(w, id, page.id));
                  setExpanded((s) => new Set([...s, page.id]));
                } catch (e) {
                  toast.error(
                    e instanceof Error ? e.message : "Could not move page",
                  );
                }
              }}
            >
              <button
                className="tree-toggle"
                aria-label={`${expanded.has(page.id) ? "Collapse" : "Expand"} ${page.title || "Untitled"}`}
                onClick={() =>
                  setExpanded((s) => {
                    const n = new Set(s);
                    if (n.has(page.id)) n.delete(page.id);
                    else n.add(page.id);
                    return n;
                  })
                }
              >
                {hasChildren ? (
                  expanded.has(page.id) ? (
                    <ChevronDown size={13} />
                  ) : (
                    <ChevronRight size={13} />
                  )
                ) : (
                  <span className="tree-dot" />
                )}
              </button>
              <a
                href={`#${page.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  go(page.id);
                }}
              >
                <span className="tree-icon">{page.icon}</span>
                <span className="truncate">{page.title || "Untitled"}</span>
              </a>
              <button
                className="tree-add"
                aria-label={`Add subpage to ${page.title || "Untitled"}`}
                disabled={!canEditPage(page.id) || !canCreate}
                onClick={() => addPage(page.id)}
              >
                <Plus size={14} />
              </button>
            </div>
            {hasChildren &&
              expanded.has(page.id) &&
              depth < 15 &&
              tree(page.id, depth + 1)}
          </div>
        );
      });
  }
  return (
    <>
      <Sidebar>
        <SidebarHeader>
          <button
            className="workspace-switch"
            onClick={() => setSettings(true)}
          >
            <span className="brand-mark">F</span>
            <strong className="truncate">{ws.name}</strong>
            <ChevronsUpDown size={14} />
          </button>
        </SidebarHeader>
        <SidebarContent>
          <nav className="main-nav">
            <button
              onClick={() => {
                setQuery("");
                setSearchOpen(true);
              }}
            >
              <Search size={17} />
              Search<kbd>⌘ K</kbd>
            </button>
            <button
              onClick={() =>
                go(
                  visible.find((p) => p.id === "home")?.id ??
                    visible.find((p) => !p.parentId)?.id ??
                    "",
                )
              }
            >
              <Home size={17} />
              Home
            </button>
          </nav>
          <div className="nav-section">Favorites</div>
          <nav className="main-nav">
            {visible
              .filter((p) => p.favorite)
              .map((p) => (
                <button
                  key={p.id}
                  className={p.id === activeId ? "active" : ""}
                  onClick={() => go(p.id)}
                >
                  <span className="tree-icon">{p.icon}</span>
                  <span className="truncate">{p.title || "Untitled"}</span>
                </button>
              ))}
            {!visible.some((p) => p.favorite) && (
              <p className="nav-empty">Star pages to keep them close.</p>
            )}
          </nav>
          <div className="nav-section">
            {team.enabled ? "Pages" : "Private"}
            <button
              className="icon-button"
              disabled={!canCreate}
              aria-label="Add root page"
              onClick={() => addPage()}
            >
              <Plus size={14} />
            </button>
          </div>
          <nav className="page-tree" data-testid="page-tree">
            {tree(null)}
          </nav>
          <nav className="main-nav">
            <button disabled={!canCreate} onClick={() => addPage()}>
              <Plus size={16} />
              Add a page
            </button>
          </nav>
        </SidebarContent>
        <SidebarFooter>
          <TeamNavigation openPage={go} hasUnsavedChanges={status !== "saved"} />
          <nav className="main-nav">
            <button disabled={!canCreate} onClick={() => addPage()}>
              <LayoutTemplate size={17} />
              Templates
            </button>
            <button onClick={() => setSettings(true)}>
              <Settings2 size={17} />
              Settings
            </button>
            <button onClick={() => setTrashOpen(true)}>
              <Trash2 size={17} />
              Trash
              {ws.pages.filter((p) => p.trashedAt).length > 0 && (
                <span className="nav-count">
                  {ws.pages.filter((p) => p.trashedAt).length}
                </span>
              )}
            </button>
          </nav>
          <div className="sidebar-footnote">
            Folio<span>Your space to think.</span>
          </div>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="topbar">
          <SidebarTrigger aria-label="Toggle sidebar" />
          <nav className="breadcrumbs" aria-label="Breadcrumbs">
            {lineage.map((p) => (
              <span key={p.id}>
                <button onClick={() => go(p.id)}>
                  {p.icon} {p.title || "Untitled"}
                </button>
                <span className="crumb-slash">/</span>
              </span>
            ))}
            <span className="current-crumb">
              {active?.icon} {active?.title || "Workspace"}
            </span>
          </nav>
          <div className="topbar-spacer" />
          <span
            className={`save-status ${status === "error" || status === "conflict" ? "save-error" : ""}`}
            aria-live="polite"
          >
            {status === "saved" ? (
              <>
                <Check size={13} />
                All changes saved
              </>
            ) : status === "saving" || status === "unsaved" ? (
              <>Saving…</>
            ) : (
              "Not saved"
            )}
          </span>
          {active && (
            <>
              <TeamPageTools key={active.id} page={active} access={access[active.id]} canEdit={!readOnly} canManage={Boolean(permissions[active.id]?.manage)} baseRevision={pageRevisions[active.id] ?? 0} onReload={reload} beforeAction={beforeTeamAction} />
              <button
                className={`icon-button favorite-button ${active.favorite ? "favorited" : ""}`}
                title={
                  active.favorite ? "Remove from favorites" : "Add to favorites"
                }
                aria-label={
                  active.favorite ? "Remove from favorites" : "Add to favorites"
                }
                onClick={() =>
                  team.enabled ? void setFavorite(active.id, !active.favorite).then((saved) => { if (!saved) toast.info("Wait for your changes to save before updating favorites."); }).catch((e) => toast.error(e.message)) : updatePage(active.id, { favorite: !active.favorite })
                }
              >
                <Star size={18} />
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button aria-label="Page actions" className="icon-button">
                    <MoreHorizontal size={21} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="page-menu">
                  <DropdownMenuLabel>Page</DropdownMenuLabel>
                  <DropdownMenuItem disabled={readOnly || !canCreate} onSelect={() => addPage(active.id)}>
                    <Plus />
                    Add subpage
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={!canCreate} onSelect={() => duplicate(active.id)}>
                    <Copy />
                    Duplicate
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={readOnly} onSelect={() => setMoveOpen(true)}>
                    <FolderInput />
                    Move to
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void copyLink()}>
                    <Link2 />
                    Copy page link
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={exportPage}>
                    <Download />
                    {active.kind === "database"
                      ? "Export CSV"
                      : "Export Markdown"}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Customize</DropdownMenuLabel>
                  <DropdownMenuItem disabled={readOnly}
                    onSelect={() =>
                      updatePage(active.id, { fullWidth: !active.fullWidth })
                    }
                  >
                    {active.fullWidth ? (
                      <Check />
                    ) : (
                      <span className="menu-icon-space" />
                    )}
                    Full width
                  </DropdownMenuItem>
                  {(["default", "serif", "mono"] as const).map((font) => (
                    <DropdownMenuItem
                      key={font}
                      disabled={readOnly}
                      onSelect={() => updatePage(active.id, { font })}
                    >
                      {active.font === font ? (
                        <Check />
                      ) : (
                        <span className="menu-icon-space" />
                      )}
                      {font === "default"
                        ? "Default font"
                        : font === "serif"
                          ? "Serif font"
                          : "Mono font"}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    disabled={readOnly}
                    onSelect={() => remove(active.id)}
                  >
                    <Trash2 />
                    Move to Trash
                  </DropdownMenuItem>
                  <div className="menu-meta">
                    {
                      plainText(active.content)
                        .trim()
                        .split(/\s+/)
                        .filter(Boolean).length
                    }{" "}
                    words · Edited{" "}
                    {new Date(active.updatedAt).toLocaleDateString()}
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </header>
        {(status === "error" || status === "conflict") && (
          <div role="alert" className="save-banner">
            <span>{error}</span>
            <button onClick={backup}>Export unsaved backup</button>
            {status === "conflict" ? (
              <button
                onClick={() =>
                  setConfirm({
                    title: "Reload the saved workspace?",
                    description:
                      "Export your unsaved backup first. Reloading replaces the edits on this screen with the saved workspace.",
                    action: () => void reload(),
                  })
                }
              >
                Reload saved workspace
              </button>
            ) : (
              <button onClick={() => void retry()}>Retry save</button>
            )}
          </div>
        )}
        {readOnly && <div className="team-readonly-banner"><FileText size={13} />You have read-only access to this page.</div>}
        <main
          className="page-scroll"
          ref={scrollRef}
          key={active?.id ?? "empty"}
        >
          {active ? (
            <>
              {active.cover !== "none" && (
                <div className={`page-cover cover-${active.cover}`}>
                  {!readOnly && <CoverMenu page={active} update={updatePage} />}
                </div>
              )}
              <article
                className={`document ${active.fullWidth ? "full-width" : ""} font-${active.font} ${active.cover === "none" ? "no-cover" : ""}`}
              >
                <div className="page-heading-controls">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        disabled={readOnly}
                        className="page-icon"
                        title="Change icon"
                        aria-label="Change page icon"
                      >
                        {active.icon}
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <div className="icon-grid">
                        {icons.map((icon) => (
                          <button
                            key={icon}
                            aria-label={`Use ${icon} icon`}
                            onClick={() => updatePage(active.id, { icon })}
                          >
                            {icon}
                          </button>
                        ))}
                      </div>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  {active.cover === "none" && !readOnly && (
                    <button
                      className="plain-button add-cover"
                      onClick={() => updatePage(active.id, { cover: "sand" })}
                    >
                      <Plus size={13} />
                      Add cover
                    </button>
                  )}
                </div>
                <textarea
                  readOnly={readOnly}
                  className="page-title"
                  rows={1}
                  aria-label="Page title"
                  placeholder="Untitled"
                  maxLength={500}
                  value={active.title}
                  onChange={(e) =>
                    updatePage(active.id, {
                      title: e.target.value.replace(/\n/g, ""),
                    })
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      (
                        document.querySelector(
                          ".folio-editor",
                        ) as HTMLElement | null
                      )?.focus();
                    }
                  }}
                />
                <input
                  readOnly={readOnly}
                  className="page-description-input"
                  aria-label="Page description"
                  maxLength={2000}
                  placeholder="Add a description…"
                  value={active.description}
                  onChange={(e) =>
                    updatePage(active.id, { description: e.target.value })
                  }
                />
                {parent?.kind === "database" && (
                  <div className="record-properties">
                    {parent.columns.map((c) => (
                      <div className="record-property" key={c.id}>
                        <label>{c.name}</label>
                        <PropertyInput
                          column={c}
                          members={team.members}
                          pages={ws.pages}
                          readOnly={readOnly}
                          onOpenPage={go}
                          value={active.properties[c.id]}
                          onChange={(value) =>
                            updatePage(active.id, {
                              properties: {
                                ...active.properties,
                                [c.id]: value,
                              },
                            })
                          }
                        />
                      </div>
                    ))}
                    <button
                      className="plain-button"
                      onClick={() => go(parent.id)}
                    >
                      <ArrowLeft size={14} />
                      Back to {parent.title}
                    </button>
                  </div>
                )}
                {active.kind === "database" ? (
                  <DatabaseView
                    key={active.id}
                    database={active}
                    members={team.members}
                    currentUserId={team.user?.id}
                    readOnly={readOnly}
                    canEditPage={canEditPage}
                    pages={ws.pages}
                    update={updatePage}
                    create={create}
                    open={go}
                    duplicate={duplicate}
                    trash={remove}
                  />
                ) : (
                  <>
                    {children.length > 0 && (
                      <div className="child-pages">
                        <h2>In this page</h2>
                        <div className="page-links">
                          {children.map((child) => (
                            <button
                              className="page-link"
                              key={child.id}
                              onClick={() => go(child.id)}
                            >
                              <span className="link-icon">{child.icon}</span>
                              <span className="child-text">
                                <strong>{child.title || "Untitled"}</strong>
                                {child.description && (
                                  <span>{child.description}</span>
                                )}
                              </span>
                              <ArrowRight size={15} />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    <RichEditor
                      key={`${active.id}:${generation}:${remoteVersions[active.id] ?? 0}`}
                      readOnly={readOnly}
                      content={active.content}
                      onChange={(content) => updatePage(active.id, { content })}
                      onSubpage={() => create(fromTemplate("blank", active.id))}
                    />
                    <div className="document-footer">
                      <button
                        className="plain-button"
                        disabled={readOnly || !canCreate}
                        onClick={() => addPage(active.id)}
                      >
                        <Plus size={14} />
                        Add subpage
                      </button>
                      <span>
                        Last edited{" "}
                        {new Date(active.updatedAt).toLocaleDateString()}
                      </span>
                    </div>
                  </>
                )}
              </article>
            </>
          ) : (
            <div className="empty-workspace">
              <FileText size={44} strokeWidth={1} />
              <h1>{activeId ? "This page isn’t here" : "A fresh start"}</h1>
              <p>
                {activeId
                  ? "It may have been moved to Trash. Your other pages are in the sidebar."
                  : team.enabled ? "Create a private page, or ask a teammate to share a page with you." : "Create a page and make this space your own."}
              </p>
              <button disabled={!canCreate} className="primary-button" onClick={() => addPage()}>
                <Plus size={16} />
                Create a page
              </button>
              <button
                className="plain-button"
                onClick={() => setTrashOpen(true)}
              >
                Open Trash
              </button>
            </div>
          )}
        </main>
      </SidebarInset>
      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent className="search-dialog" showCloseButton={false}>
          <DialogTitle className="sr-only">Search your workspace</DialogTitle>
          <DialogDescription className="sr-only">
            Search page titles and content. Use arrow keys and Enter to open a
            result.
          </DialogDescription>
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Search your workspace…"
              value={query}
              onValueChange={setQuery}
            />
            <CommandList>
              <CommandEmpty>No pages found. Try another search.</CommandEmpty>
              <CommandGroup heading={query ? "Pages" : "Recently edited"}>
                {searchResults.map((p) => (
                  <CommandItem
                    value={p.id}
                    key={p.id}
                    onSelect={() => {
                      go(p.id);
                      setSearchOpen(false);
                    }}
                  >
                    <span className="search-icon">{p.icon}</span>
                    <span className="search-result-text">
                      <strong>{p.title || "Untitled"}</strong>
                      <small>
                        {ancestors(ws.pages, p.id)
                          .map((a) => a.title)
                          .join(" / ") || "Private"}
                        {query ? " · " + plainText(p.content).slice(0, 95) : ""}
                      </small>
                    </span>
                    <span className="muted">↵</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
            <div className="search-footer">
              Searches titles and page content<span>esc to close</span>
            </div>
          </Command>
        </DialogContent>
      </Dialog>
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="template-dialog">
          <DialogTitle>
            {newParent ? "Add a subpage" : "Make a little space"}
          </DialogTitle>
          <DialogDescription>
            {newParent
              ? `Inside ${ws.pages.find((p) => p.id === newParent)?.title || "this page"}.`
              : "Start from a blank page, or give yourself a head start."}
          </DialogDescription>
          <div className="template-list">
            {templates.map((t) => (
              <button
                key={t.id}
                onClick={() => create(fromTemplate(t.id, newParent))}
              >
                <span>{t.icon}</span>
                <span>
                  <strong>{t.title}</strong>
                  <small>{t.description}</small>
                </span>
                <Plus size={16} />
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={settings} onOpenChange={setSettings}>
        <DialogContent>
          <DialogTitle>Workspace settings</DialogTitle>
          <DialogDescription>
            Make this workspace feel like yours.
          </DialogDescription>
          <label className="form-label">
            Workspace name
            <input
              className="form-input"
              maxLength={80}
              value={ws.name}
              disabled={!canAdmin}
              onChange={(e) => {
                if (e.target.value)
                  mutate((w) => ({ ...w, name: e.target.value }));
              }}
            />
          </label>
          <label className="form-label">
            Appearance
            <Choice
              label="Appearance"
              value={ws.theme}
              options={[
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
                { value: "system", label: "Use system setting" },
              ]}
              onChange={(theme) =>
                mutate((w) => ({ ...w, theme: theme as Workspace["theme"] }))
              }
            />
          </label>
          <div className="settings-section">
            <h3>Your data</h3>
            <p>
              Your pages save automatically. Download a backup to move your
              workspace or protect your notes.
            </p>
            {team.enabled && <p className="small-note">This export contains pages you can access. Accounts, sharing, comments, history, and files are included in the server’s daily backups.</p>}
            <div className="settings-buttons">
              <button className="outline-button" onClick={backup}>
                <Download size={16} />
                Export backup
              </button>
              <button
                className="outline-button"
                disabled={!canCreate}
                onClick={() => importRef.current?.click()}
              >
                <Upload size={16} />
                Import backup
              </button>
            </div>
            <p className="small-note">
              Import adds pages from a Folio JSON backup. Existing pages stay in
              place.
            </p>
            <input
              type="file"
              ref={importRef}
              accept="application/json,.json"
              className="sr-only"
              aria-label="Import workspace backup"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                try {
                  if (file.size > 10 * 1024 * 1024)
                    throw new Error("Backups must be smaller than 10 MB.");
                  const backup = validateWorkspace(
                    JSON.parse(await file.text()),
                  );
                  mutate((current) => {
                    const merged = validateWorkspace(
                      mergeBackup(current, backup),
                    );
                    if (
                      new Blob([JSON.stringify(merged)]).size >
                      9.9 * 1024 * 1024
                    )
                      throw new Error(
                        "The merged workspace exceeds the 10 MB limit.",
                      );
                    return merged;
                  });
                  toast.success(`Imported ${backup.pages.length} pages`);
                  setSettings(false);
                } catch (error) {
                  toast.error(
                    error instanceof Error
                      ? error.message
                      : "Could not import this backup.",
                  );
                }
              }}
            />
          </div>
          <div className="settings-note">
            <span className="brand-mark">F</span>
            <div>
              <strong>Folio</strong>
              <p>{team.enabled ? "A shared space for your team’s ideas and work." : "A personal workspace. Built around your ideas."}</p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={trashOpen} onOpenChange={setTrashOpen}>
        <DialogContent className="trash-dialog">
          <DialogTitle>Trash</DialogTitle>
          <DialogDescription>
            Pages stay here until you restore or permanently delete them.
          </DialogDescription>
          <input
            className="form-input"
            aria-label="Search Trash"
            placeholder="Search deleted pages…"
            value={trashQuery}
            onChange={(e) => setTrashQuery(e.target.value)}
          />
          <div className="trash-list">
            {ws.pages
              .filter(
                (p) =>
                  p.trashedAt &&
                  p.title.toLowerCase().includes(trashQuery.toLowerCase()),
              )
              .map((p) => (
                <div key={p.id} className="trash-row">
                  <span>{p.icon}</span>
                  <div>
                    <strong>{p.title || "Untitled"}</strong>
                    <small>
                      Deleted {new Date(p.trashedAt!).toLocaleDateString()}
                    </small>
                  </div>
                  <button
                    className="icon-button"
                    disabled={!canEditPage(p.id)}
                    aria-label={`Restore ${p.title}`}
                    title="Restore"
                    onClick={() => {
                      mutate((w) => restorePage(w, p.id));
                      toast.success("Page restored");
                    }}
                  >
                    <RotateCcw size={16} />
                  </button>
                  <button
                    className="icon-button"
                    disabled={!canEditPage(p.id)}
                    aria-label={`Delete ${p.title} permanently`}
                    title="Delete permanently"
                    onClick={() =>
                      setConfirm({
                        title: "Delete this page forever?",
                        description: `“${p.title || "Untitled"}” and its deleted subpages will be permanently removed. This cannot be undone.`,
                        action: () => {
                          const ids = descendants(ws.pages, p.id);
                          mutate((w) => ({
                            ...w,
                            pages: w.pages.filter((x) => !ids.has(x.id)),
                          }));
                          toast("Page permanently deleted");
                        },
                      })
                    }
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            {!ws.pages.some(
              (p) =>
                p.trashedAt &&
                p.title.toLowerCase().includes(trashQuery.toLowerCase()),
            ) && (
              <div className="database-empty">
                <Trash2 size={28} />
                <p>{trashQuery ? "No matching pages" : "Nothing in Trash"}</p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
        <DialogContent>
          <DialogTitle>Move page to</DialogTitle>
          <DialogDescription>
            Choose a new home for {active?.title || "this page"}.
          </DialogDescription>
          <div className="move-list">
            <button
              onClick={() => {
                if (active) mutate((w) => movePage(w, active.id, null));
                setMoveOpen(false);
              }}
            >
              <Home size={18} />
              {team.enabled ? "Pages — top level" : "Private — top level"}
            </button>
            {visible
              .filter((p) => !excluded.has(p.id))
              .map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    if (active) mutate((w) => movePage(w, active.id, p.id));
                    setExpanded((s) => new Set([...s, p.id]));
                    setMoveOpen(false);
                  }}
                >
                  <span>{p.icon}</span>
                  {p.title || "Untitled"}
                </button>
              ))}
          </div>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={!!confirm}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                confirm?.action();
                setConfirm(null);
              }}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
function CoverMenu({
  page,
  update,
}: {
  page: Page;
  update: (id: string, changes: Partial<Page>) => void;
}) {
  return (
    <div className="cover-actions">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button>Change cover</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>Cover color</DropdownMenuLabel>
          <div className="cover-swatches">
            {(["sand", "blue", "sage", "rose", "ink"] as const).map((cover) => (
              <button
                key={cover}
                className={`cover-${cover}`}
                aria-label={`Use ${cover} cover`}
                onClick={() => update(page.id, { cover })}
              />
            ))}
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => update(page.id, { cover: "none" })}>
            Remove cover
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
