import test from "node:test";
import assert from "node:assert/strict";
import {
  newPage,
  movePage,
  trashPage,
  restorePage,
  duplicatePage,
  mergeBackup,
  validateWorkspace,
  searchPages,
  doc,
  paragraph,
  csv,
  markdown,
  safeLink,
  type Workspace,
} from "../lib/folio/model.ts";
const fixture = (): Workspace => {
  const a = { ...newPage("Parent"), id: "a" },
    b = { ...newPage("Child", "a"), id: "b" },
    c = { ...newPage("Grandchild", "b"), id: "c" };
  return { version: 1, name: "Test", theme: "light", pages: [a, b, c] };
};
test("moves cannot create cycles or reference absent parents", () => {
  const w = fixture();
  assert.throws(() => movePage(w, "a", "c"));
  assert.throws(() => movePage(w, "a", "missing"));
  assert.equal(movePage(w, "c", null).pages[2].parentId, null);
});
test("trashing a parent includes descendants, restoring recovers only that batch", () => {
  let w = trashPage(fixture(), "c");
  w = trashPage(w, "a");
  assert.ok(w.pages.every((p) => p.trashedAt));
  w = restorePage(w, "a");
  assert.equal(w.pages[0].trashedAt, null);
  assert.equal(w.pages[1].trashedAt, null);
  assert.ok(w.pages[2].trashedAt);
});
test("restoring a child with a deleted parent places it at root", () => {
  const w = restorePage(trashPage(fixture(), "a"), "b");
  assert.equal(w.pages[1].parentId, null);
  assert.equal(w.pages[2].trashedAt, null);
  assert.ok(w.pages[0].trashedAt);
});
test("duplicate makes independent IDs and remaps the subtree", () => {
  const w = fixture();
  const copy = duplicatePage(w, "a");
  assert.equal(copy.workspace.pages.length, 6);
  const root = copy.workspace.pages.find((p) => p.id === copy.id)!;
  const child = copy.workspace.pages.find((p) => p.parentId === root.id)!;
  assert.equal(root.title, "Parent (copy)");
  assert.notEqual(child.id, "b");
  assert.equal(
    copy.workspace.pages.find((p) => p.parentId === child.id)?.title,
    "Grandchild",
  );
  assert.deepEqual(validateWorkspace(copy.workspace), copy.workspace);
});
test("backup merge preserves current pages and remaps imported parent IDs", () => {
  const w = fixture();
  const merged = mergeBackup(w, w);
  assert.equal(merged.pages.length, 6);
  assert.equal(merged.pages[4].parentId, merged.pages[3].id);
  assert.equal(new Set(merged.pages.map((p) => p.id)).size, 6);
  validateWorkspace(merged);
});
test("malformed imports reject duplicate IDs, cycles and dangling parents", () => {
  const w = fixture();
  assert.throws(() =>
    validateWorkspace({ ...w, pages: [w.pages[0], w.pages[0]] }),
  );
  assert.throws(() =>
    validateWorkspace({
      ...w,
      pages: w.pages.map((p, i) => (i === 0 ? { ...p, parentId: "c" } : p)),
    }),
  );
  assert.throws(() => validateWorkspace({ ...w, pages: [w.pages[1]] }));
});
test("imports reject malformed editor structures and executable links", () => {
  const w = fixture();
  for (const content of [
    { type: "doc", content: [{ type: "text", text: "bad" }] },
    doc({
      type: "paragraph",
      content: [{ type: "heading", attrs: { level: 2 } }],
    }),
    doc({
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "Click",
          marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
        },
      ],
    }),
  ])
    assert.throws(() =>
      validateWorkspace({ ...w, pages: [{ ...w.pages[0], content }] }),
    );
});
test("deep untrusted objects fail before recursive validation", () => {
  let input: unknown = {};
  for (let i = 0; i < 1000; i++) input = { child: input };
  assert.throws(() => validateWorkspace(input), /deeply nested/);
});
test("search includes body text, prefers title matches, excludes trash", () => {
  let w = fixture();
  w.pages[0].content = doc(paragraph("needle inside"));
  w.pages[1].title = "Needle title";
  w = trashPage(w, "c");
  w.pages[2].title = "needle deleted";
  assert.deepEqual(
    searchPages(w, "needle").map((p) => p.id),
    ["b", "a"],
  );
});
test("CSV quotes newlines and guards spreadsheet formula injection", () => {
  const p = newPage('=HYPERLINK("x")');
  p.properties.note = 'hello,\n"world"';
  const out = csv(
    [p],
    [{ id: "note", name: "Note", type: "text", options: [] }],
  );
  assert.match(out, /"'=HYPERLINK/);
  assert.match(out, /hello,\n""world""/);
});
test("Markdown retains task state, headings, links and code fences", () => {
  const out = markdown(
    doc(
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Plan" }],
      },
      {
        type: "taskList",
        content: [
          {
            type: "taskItem",
            attrs: { checked: true },
            content: [paragraph("Done")],
          },
        ],
      },
      { type: "codeBlock", content: [{ type: "text", text: "```\nexample" }] },
    ),
  );
  assert.match(out, /## Plan/);
  assert.match(out, /- \[x\] Done/);
  assert.match(out, /````\n```/);
});
test("links allow web/mail destinations but reject executable or control URLs", () => {
  assert.ok(safeLink("https://example.com"));
  assert.ok(safeLink("mailto:hello@example.com"));
  assert.equal(safeLink("javascript:alert(1)"), false);
  assert.equal(safeLink("https://example.com\nscript"), false);
});
test("imports reject live children under deleted parents and partial trash state", () => {
  const w = fixture();
  w.pages[0].trashedAt = Date.now();
  w.pages[0].trashBatch = "batch";
  assert.throws(() => validateWorkspace(w), /deleted parent/);
  const other = fixture();
  other.pages[0].trashBatch = "bad";
  assert.throws(() => validateWorkspace(other), /trash state/);
});
test("pasted CSS highlight colors save without accepting executable style values", () => {
  for (const color of [
    "yellow",
    "rgb(255, 255, 0)",
    "#ff0",
    "#ff00ff",
    "hsl(60deg 100% 50%)",
  ]) {
    const w = fixture();
    w.pages[0].content = doc({
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "highlight",
          marks: [{ type: "highlight", attrs: { color } }],
        },
      ],
    });
    validateWorkspace(w);
  }
  const w = fixture();
  w.pages[0].content = doc({
    type: "paragraph",
    content: [
      {
        type: "text",
        text: "unsafe",
        marks: [
          { type: "highlight", attrs: { color: "url(javascript:alert(1))" } },
        ],
      },
    ],
  });
  assert.throws(() => validateWorkspace(w));
});
