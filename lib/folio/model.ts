import { z } from "zod";

export type DocNode = {
  type: string;
  text?: string;
  attrs?: Record<string, string | number | boolean | null>;
  marks?: {
    type: string;
    attrs?: Record<string, string | number | boolean | null>;
  }[];
  content?: DocNode[];
};
export type PropertyValue = string | number | boolean;
export type TeamMember = { id: string; name: string; username: string };
export const columnSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(80),
  type: z.enum([
    "text",
    "number",
    "select",
    "date",
    "checkbox",
    "url",
    "person",
    "relation",
  ]),
  options: z.array(z.string().min(1).max(80)).max(30).default([]),
});
export type Column = z.infer<typeof columnSchema>;
const primitive = z.union([
  z.string().max(1_000_000),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
const nodeSchema: z.ZodType<DocNode> = z.lazy(() =>
  z.object({
    type: z.enum([
      "doc",
      "paragraph",
      "text",
      "heading",
      "bulletList",
      "orderedList",
      "listItem",
      "taskList",
      "taskItem",
      "blockquote",
      "codeBlock",
      "horizontalRule",
      "hardBreak",
      "callout",
      "toggle",
    ]),
    text: z.string().min(1).max(1_000_000).optional(),
    attrs: z.record(primitive).optional(),
    marks: z
      .array(
        z.object({
          type: z.enum([
            "bold",
            "italic",
            "strike",
            "underline",
            "code",
            "link",
            "highlight",
          ]),
          attrs: z.record(primitive).optional(),
        }),
      )
      .max(10)
      .optional(),
    content: z.array(nodeSchema).max(5000).optional(),
  }),
);
export const pageSchema = z.object({
  id: z.string().min(1).max(100),
  parentId: z.string().min(1).max(100).nullable(),
  title: z.string().max(500),
  description: z.string().max(2000).default(""),
  icon: z.string().max(20),
  cover: z.enum(["none", "sand", "blue", "sage", "rose", "ink"]),
  kind: z.enum(["document", "database"]),
  content: nodeSchema,
  favorite: z.boolean(),
  createdAt: z.number().finite(),
  updatedAt: z.number().finite(),
  trashedAt: z.number().nullable(),
  trashBatch: z.string().nullable(),
  properties: z.record(
    z.union([z.string().max(10_000), z.number().finite(), z.boolean()]),
  ),
  columns: z.array(columnSchema).max(40),
  view: z.enum(["table", "board", "calendar", "list"]),
  calendarDateProperty: z.string().min(1).max(100).optional(),
  filter: z.string().max(100),
  sort: z.enum(["manual", "title", "updated"]),
  fullWidth: z.boolean(),
  font: z.enum(["default", "serif", "mono"]),
});
export type Page = z.infer<typeof pageSchema>;
export const workspaceSchema = z.object({
  version: z.literal(1),
  name: z.string().min(1).max(80),
  pages: z.array(pageSchema).max(2000),
  theme: z.enum(["light", "dark", "system"]),
});
export type Workspace = z.infer<typeof workspaceSchema>;
export const emptyDoc = (): DocNode => ({
  type: "doc",
  content: [{ type: "paragraph" }],
});
export const paragraph = (text: string): DocNode => ({
  type: "paragraph",
  ...(text ? { content: [{ type: "text", text }] } : {}),
});
export const heading = (text: string, level = 2): DocNode => ({
  type: "heading",
  attrs: { level },
  content: [{ type: "text", text }],
});
export const doc = (...content: DocNode[]): DocNode => ({
  type: "doc",
  content,
});
export const uid = () => crypto.randomUUID();
export const defaultColumns = (): Column[] => [
  {
    id: "status",
    name: "Status",
    type: "select",
    options: ["To do", "In progress", "Done"],
  },
  {
    id: "priority",
    name: "Priority",
    type: "select",
    options: ["Low", "Medium", "High"],
  },
  { id: "due", name: "Due date", type: "date", options: [] },
  { id: "assignee", name: "Assignee", type: "person", options: [] },
];
export function newPage(
  title = "Untitled",
  parentId: string | null = null,
  kind: Page["kind"] = "document",
): Page {
  const now = Date.now();
  return {
    id: uid(),
    parentId,
    title,
    description: "",
    icon: kind === "database" ? "◈" : "📄",
    cover: "none",
    kind,
    content: emptyDoc(),
    favorite: false,
    createdAt: now,
    updatedAt: now,
    trashedAt: null,
    trashBatch: null,
    properties:
      kind === "document" ? { status: "To do", priority: "Medium" } : {},
    columns: kind === "database" ? defaultColumns() : [],
    view: "table",
    filter: "all",
    sort: "manual",
    fullWidth: kind === "database",
    font: "default",
  };
}
export function descendants(pages: Page[], id: string): Set<string> {
  const found = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of pages)
      if (p.parentId && found.has(p.parentId) && !found.has(p.id)) {
        found.add(p.id);
        changed = true;
      }
  }
  return found;
}
export function ancestors(pages: Page[], id: string): Page[] {
  const result: Page[] = [];
  const seen = new Set([id]);
  let parent = pages.find((p) => p.id === id)?.parentId;
  while (parent && !seen.has(parent)) {
    seen.add(parent);
    const p = pages.find((p) => p.id === parent);
    if (!p) break;
    result.unshift(p);
    parent = p.parentId;
  }
  return result;
}
export function movePage(
  ws: Workspace,
  id: string,
  parentId: string | null,
): Workspace {
  if (
    parentId &&
    (descendants(ws.pages, id).has(parentId) ||
      !ws.pages.some((p) => p.id === parentId && !p.trashedAt))
  )
    throw new Error("A page cannot be moved inside itself or a deleted page.");
  return {
    ...ws,
    pages: ws.pages.map((p) =>
      p.id === id ? { ...p, parentId, updatedAt: Date.now() } : p,
    ),
  };
}
export function trashPage(ws: Workspace, id: string): Workspace {
  const ids = descendants(ws.pages, id),
    now = Date.now(),
    batch = uid();
  return {
    ...ws,
    pages: ws.pages.map((p) =>
      ids.has(p.id) && !p.trashedAt
        ? { ...p, trashedAt: now, trashBatch: batch }
        : p,
    ),
  };
}
export function restorePage(ws: Workspace, id: string): Workspace {
  const page = ws.pages.find((p) => p.id === id);
  if (!page) return ws;
  const ids = descendants(ws.pages, id);
  const parent = ws.pages.find((p) => p.id === page.parentId);
  return {
    ...ws,
    pages: ws.pages.map((p) =>
      ids.has(p.id) && p.trashBatch === page.trashBatch
        ? {
            ...p,
            trashedAt: null,
            trashBatch: null,
            parentId: p.id === id && parent?.trashedAt ? null : p.parentId,
          }
        : p,
    ),
  };
}
function remapRelations(
  page: Page,
  source: Map<string, Page>,
  mapping: Map<string, string>,
): Page["properties"] {
  const properties = { ...page.properties };
  const parent = page.parentId ? source.get(page.parentId) : undefined;
  for (const column of parent?.columns ?? []) {
    const value = properties[column.id];
    if (
      column.type === "relation" &&
      typeof value === "string" &&
      mapping.has(value)
    )
      properties[column.id] = mapping.get(value)!;
  }
  return properties;
}
export function duplicatePage(
  ws: Workspace,
  id: string,
): { workspace: Workspace; id: string } {
  const ids = descendants(ws.pages, id),
    mapping = new Map<string, string>(),
    source = new Map(ws.pages.map((p) => [p.id, p]));
  ws.pages
    .filter((p) => ids.has(p.id) && !p.trashedAt)
    .forEach((p) => mapping.set(p.id, uid()));
  const copies = ws.pages
    .filter((p) => mapping.has(p.id))
    .map((p) => ({
      ...structuredClone(p),
      id: mapping.get(p.id)!,
      properties: remapRelations(p, source, mapping),
      title: p.id === id ? `${p.title || "Untitled"} (copy)` : p.title,
      parentId:
        p.parentId && mapping.has(p.parentId)
          ? mapping.get(p.parentId)!
          : p.parentId,
      favorite: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }));
  if (!mapping.has(id)) throw new Error("Page not found.");
  return {
    workspace: { ...ws, pages: [...ws.pages, ...copies] },
    id: mapping.get(id)!,
  };
}
export function plainText(node: DocNode): string {
  return (
    node.text ??
    (node.content ?? [])
      .map(plainText)
      .join(
        ["doc", "bulletList", "orderedList", "taskList"].includes(node.type)
          ? "\n"
          : " ",
      )
  );
}
export function searchPages(ws: Workspace, query: string): Page[] {
  const q = query.trim().toLowerCase();
  return ws.pages
    .filter(
      (p) =>
        !p.trashedAt &&
        (!q || `${p.title}\n${plainText(p.content)}`.toLowerCase().includes(q)),
    )
    .sort(
      (a, b) =>
        Number(b.title.toLowerCase().includes(q)) -
          Number(a.title.toLowerCase().includes(q)) ||
        b.updatedAt - a.updatedAt,
    );
}
export function safeLink(value: string): boolean {
  return (
    /^(https?:\/\/|mailto:)/i.test(value.trim()) &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}
export function safeColor(value: string): boolean {
  return /^(#[0-9a-f]{3,4}|#[0-9a-f]{6}|#[0-9a-f]{8}|[a-z]{1,30}|(?:rgb|hsl)a?\([0-9.,%+\s/\-deg]+\))$/i.test(
    value,
  );
}
function checkDocument(root: DocNode) {
  if (root.type !== "doc") throw new Error("A page must contain a document.");
  const blocks = new Set([
    "paragraph",
    "heading",
    "bulletList",
    "orderedList",
    "taskList",
    "blockquote",
    "codeBlock",
    "horizontalRule",
    "callout",
    "toggle",
  ]);
  const visit = (node: DocNode) => {
    const children = node.content ?? [];
    if (
      ["doc", "blockquote", "callout", "toggle"].includes(node.type) &&
      (!children.length || children.some((c) => !blocks.has(c.type)))
    )
      throw new Error("Invalid block structure.");
    if (
      ["paragraph", "heading"].includes(node.type) &&
      children.some((c) => !["text", "hardBreak"].includes(c.type))
    )
      throw new Error("Invalid text block.");
    if (
      node.type === "heading" &&
      ![1, 2, 3].includes(Number(node.attrs?.level))
    )
      throw new Error("Invalid heading level.");
    if (
      ["bulletList", "orderedList", "taskList"].includes(node.type) &&
      (!children.length ||
        children.some(
          (c) =>
            c.type !== (node.type === "taskList" ? "taskItem" : "listItem"),
        ))
    )
      throw new Error("Invalid list.");
    if (
      ["listItem", "taskItem"].includes(node.type) &&
      (children[0]?.type !== "paragraph" ||
        children.some((c) => !blocks.has(c.type)))
    )
      throw new Error("Invalid list item.");
    if (
      node.type === "codeBlock" &&
      children.some((c) => c.type !== "text" || c.marks?.length)
    )
      throw new Error("Invalid code block.");
    if (
      ["text", "hardBreak", "horizontalRule"].includes(node.type) &&
      children.length
    )
      throw new Error("Invalid leaf block.");
    if (node.type === "text" && !node.text) throw new Error("Invalid text.");
    for (const mark of node.marks ?? []) {
      if (mark.type === "link" && !safeLink(String(mark.attrs?.href ?? "")))
        throw new Error("Links must use https, http, or mailto.");
      if (
        mark.type === "highlight" &&
        mark.attrs?.color &&
        !safeColor(String(mark.attrs.color))
      )
        throw new Error("Invalid highlight color.");
    }
    children.forEach(visit);
  };
  visit(root);
}
export function validateWorkspace(input: unknown): Workspace {
  // Bound depth before the recursive schema to reject hostile/deep JSON safely.
  const stack: { value: unknown; depth: number }[] = [
    { value: input, depth: 0 },
  ];
  let count = 0;
  while (stack.length) {
    const item = stack.pop()!;
    if (++count > 200_000 || item.depth > 60)
      throw new Error("The workspace is too large or deeply nested.");
    if (item.value && typeof item.value === "object")
      for (const v of Object.values(item.value))
        stack.push({ value: v, depth: item.depth + 1 });
  }
  const ws = workspaceSchema.parse(input),
    byId = new Map(ws.pages.map((p) => [p.id, p]));
  if (byId.size !== ws.pages.length) throw new Error("Duplicate page IDs.");
  const complete = new Set<string>();
  for (const p of ws.pages) {
    if (p.parentId && !byId.has(p.parentId))
      throw new Error("A page refers to a missing parent.");
    if ((p.trashedAt === null) !== (p.trashBatch === null))
      throw new Error("Invalid page trash state.");
    if (p.parentId && byId.get(p.parentId)?.trashedAt && !p.trashedAt)
      throw new Error("A live page cannot have a deleted parent.");
    const path = new Set<string>();
    let cursor: string | null = p.id;
    while (cursor && !complete.has(cursor)) {
      if (path.has(cursor)) throw new Error("Page nesting contains a cycle.");
      path.add(cursor);
      const node = byId.get(cursor);
      if (!node) throw new Error("A page refers to a missing parent.");
      cursor = node.parentId;
    }
    path.forEach((id) => complete.add(id));
    if (new Set(p.columns.map((c) => c.id)).size !== p.columns.length)
      throw new Error("Duplicate property IDs.");
    checkDocument(p.content);
  }
  return ws;
}
export function mergeBackup(current: Workspace, backup: Workspace): Workspace {
  const mapping = new Map(backup.pages.map((p) => [p.id, uid()])),
    source = new Map(backup.pages.map((p) => [p.id, p]));
  return {
    ...current,
    pages: [
      ...current.pages,
      ...backup.pages.map((p) => ({
        ...p,
        id: mapping.get(p.id)!,
        properties: remapRelations(p, source, mapping),
        parentId: p.parentId ? mapping.get(p.parentId)! : null,
        trashBatch: p.trashBatch ? `import-${p.trashBatch}` : null,
      })),
    ],
  };
}
export function markdown(node: DocNode): string {
  if (node.type === "text") {
    let value = node.text ?? "";
    for (const m of node.marks ?? []) {
      if (m.type === "bold") value = `**${value}**`;
      if (m.type === "italic") value = `*${value}*`;
      if (m.type === "strike") value = `~~${value}~~`;
      if (m.type === "code") value = `\`${value}\``;
      if (m.type === "link")
        value = `[${value}](${String(m.attrs?.href ?? "").replace(/\)/g, "%29")})`;
    }
    return value;
  }
  const inner = (node.content ?? []).map(markdown).join("");
  switch (node.type) {
    case "heading":
      return `${"#".repeat(Number(node.attrs?.level ?? 2))} ${inner}\n\n`;
    case "paragraph":
      return `${inner}\n\n`;
    case "hardBreak":
      return "  \n";
    case "horizontalRule":
      return "\n---\n\n";
    case "codeBlock": {
      const fence = "`".repeat(
        Math.max(3, ...(inner.match(/`+/g) ?? []).map((s) => s.length + 1)),
      );
      return `${fence}\n${inner}\n${fence}\n\n`;
    }
    case "blockquote":
    case "callout":
      return (
        inner
          .trim()
          .split("\n")
          .map((s) => `> ${s}`)
          .join("\n") + "\n\n"
      );
    case "bulletList":
    case "orderedList":
    case "taskList":
      return (
        (node.content ?? [])
          .map((c, i) => {
            const prefix =
              node.type === "orderedList"
                ? `${i + 1}. `
                : node.type === "taskList"
                  ? `- [${c.attrs?.checked ? "x" : " "}] `
                  : "- ";
            return prefix + markdown(c).trim().replace(/\n/g, "\n  ");
          })
          .join("\n") + "\n\n"
      );
    case "toggle":
      return `<details>\n<summary>${String(node.attrs?.title ?? "Toggle").replace(/[<>&]/g, "")}</summary>\n\n${inner}</details>\n\n`;
    default:
      return inner;
  }
}
export type CsvContext = {
  members?: readonly TeamMember[];
  pages?: readonly Page[];
};
export function csv(
  pages: Page[],
  columns: Column[],
  context: CsvContext = {},
): string {
  const members = new Map(
    (context.members ?? []).map((member) => [
      member.id,
      member.name || member.username,
    ]),
  );
  const relatedPages = new Map(
    (context.pages ?? pages)
      .filter((page) => !page.trashedAt)
      .map((page) => [page.id, page.title || "Untitled"]),
  );
  const value = (page: Page, column: Column): PropertyValue | undefined => {
    const raw = page.properties[column.id];
    if (typeof raw !== "string" || !raw) return raw;
    if (column.type === "person") return members.get(raw) ?? raw;
    if (column.type === "relation") return relatedPages.get(raw) ?? raw;
    return raw;
  };
  const escape = (v: PropertyValue | undefined) => {
    let s = String(v ?? "");
    if (/^[=+\-@\t\r\n]/.test(s)) s = "'" + s;
    return `"${s.replace(/"/g, '""')}"`;
  };
  return [
    ["Name", ...columns.map((c) => c.name)],
    ...pages.map((p) => [p.title, ...columns.map((c) => value(p, c))]),
  ]
    .map((row) => row.map(escape).join(","))
    .join("\r\n");
}
