import test from "node:test";
import assert from "node:assert/strict";
import {
  newPage,
  columnSchema,
  csv,
  duplicatePage,
  mergeBackup,
  validateWorkspace,
  type Page,
  type Workspace,
} from "../lib/folio/model.ts";
import {
  addCalendarDays,
  calendarDays,
  filterDatabaseRows,
  groupCalendarRows,
  localDateKey,
  matchesDueDate,
  parseDateKey,
  shiftMonth,
} from "../lib/folio/database-utils.ts";

const row = (id: string, properties: Page["properties"] = {}): Page => ({
  ...newPage(id, "db"),
  id,
  properties,
});
const workspace = (pages: Page[]): Workspace => ({
  version: 1,
  name: "Team",
  theme: "light",
  pages,
});

test("calendar dates reject rollover, timestamps and invalid leap days", () => {
  for (const value of [
    "2025-02-29",
    "1900-02-29",
    "2026-04-31",
    "2026-00-10",
    "2026-13-01",
    "2026-01-00",
    "2026-1-01",
    "2026-09-12T00:00:00Z",
    "0000-01-01",
    "",
    undefined,
    1,
  ])
    assert.equal(parseDateKey(value), null, String(value));
  assert.deepEqual(parseDateKey("2024-02-29"), {
    year: 2024,
    month: 2,
    day: 29,
  });
  assert.ok(parseDateKey("2000-02-29"));
  assert.ok(parseDateKey("0001-01-01"));
});

test("month navigation and Monday calendar grids cross years and leap days", () => {
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("0001-01", -1), "0001-01");
  assert.equal(shiftMonth("9999-12", 1), "9999-12");
  const days = calendarDays("2024-02");
  assert.equal(days.length, 42);
  assert.equal(days[0].date, "2024-01-29");
  assert.equal(days.filter((day) => day.inMonth).length, 29);
  assert.equal(days.filter((day) => day.date === "2024-02-29").length, 1);
  assert.equal(calendarDays("2026-02")[0].date, "2026-01-26");
});

test("date-only due filters are stable around midnight and DST", () => {
  const previous = process.env.TZ;
  try {
    process.env.TZ = "America/Vancouver";
    assert.equal(localDateKey(new Date("2026-09-12T00:30:00Z")), "2026-09-11");
    assert.equal(addCalendarDays("2026-03-08", 1), "2026-03-09");
    assert.equal(addCalendarDays("2026-11-01", 1), "2026-11-02");
    assert.equal(addCalendarDays("2024-02-28", 1), "2024-02-29");
    const today = "2026-12-28";
    assert.equal(matchesDueDate("2026-12-27", "overdue", today), true);
    assert.equal(matchesDueDate(today, "overdue", today), false);
    assert.equal(matchesDueDate(today, "today", today), true);
    assert.equal(matchesDueDate(today, "next7", today), true);
    assert.equal(matchesDueDate("2027-01-03", "next7", today), true);
    assert.equal(matchesDueDate("2027-01-04", "next7", today), false);
    assert.equal(matchesDueDate("2026-12-27", "next7", today), false);
    assert.equal(matchesDueDate("2026-02-30", "today", today), false);
    assert.equal(matchesDueDate("2026-02-30", "undated", today), true);
    assert.equal(matchesDueDate(undefined, "undated", today), true);
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test("calendar grouping keeps every valid date and puts invalid values in Undated", () => {
  const rows = [
    row("a", { due: "2026-09-12", start: "2026-10-01" }),
    row("b", { due: "2026-09-12" }),
    row("c", { due: "2026-02-30" }),
    row("d"),
    row("e", { due: "2027-01-01" }),
  ];
  const grouped = groupCalendarRows(rows, "due");
  assert.deepEqual(
    grouped.byDate.get("2026-09-12")?.map((page) => page.id),
    ["a", "b"],
  );
  assert.deepEqual(
    grouped.undated.map((page) => page.id),
    ["c", "d"],
  );
  assert.equal(grouped.byDate.get("2027-01-01")?.[0].id, "e");
  assert.equal(
    groupCalendarRows(rows, "start").byDate.get("2026-10-01")?.[0].id,
    "a",
  );
  assert.equal(groupCalendarRows(rows, "start").undated.length, 4);
});

test("assignee, due and status filters compose, exclude trash, and never change rows", () => {
  const rows = [
    row("a", { owner: "u1", due: "2026-09-12", status: "To do" }),
    row("b", { owner: "u2", due: "2026-09-12", status: "To do" }),
    row("c", { owner: "u1", due: "2026-09-13", status: "Done" }),
    row("d"),
    {
      ...row("trash", { owner: "u1", due: "2026-09-12", status: "To do" }),
      trashedAt: 1,
      trashBatch: "x",
    },
  ];
  const before = structuredClone(rows);
  const result = filterDatabaseRows(rows, {
    assignee: { columnId: "owner", memberId: "u1" },
    status: { columnId: "status", value: "To do" },
    due: { columnId: "due", range: "today" },
    today: "2026-09-12",
  });
  assert.deepEqual(
    result.map((page) => page.id),
    ["a"],
  );
  assert.deepEqual(
    filterDatabaseRows(rows, {
      assignee: { columnId: "owner", memberId: null },
    }).map((page) => page.id),
    ["d"],
  );
  assert.deepEqual(rows, before);
});

test("search finds member names and visible related page titles", () => {
  const columns = [
    columnSchema.parse({ id: "owner", name: "Owner", type: "person" }),
    columnSchema.parse({ id: "related", name: "Related", type: "relation" }),
  ];
  const rows = [
    row("a", { owner: "u1", related: "plan" }),
    row("b", { related: "hidden" }),
  ];
  const context = {
    columns,
    members: [{ id: "u1", name: "Morgan Lee", username: "morgan" }],
    pages: [{ ...newPage("Launch plan"), id: "plan" }],
  };
  assert.deepEqual(
    filterDatabaseRows(rows, { ...context, query: "morgan" }).map(
      (page) => page.id,
    ),
    ["a"],
  );
  assert.deepEqual(
    filterDatabaseRows(rows, { ...context, query: "launch" }).map(
      (page) => page.id,
    ),
    ["a"],
  );
});

test("old workspaces and new calendar, person and relation fields validate", () => {
  const database = { ...newPage("Tasks", null, "database"), id: "db" };
  assert.ok(
    database.columns.some(
      (column) => column.id === "assignee" && column.type === "person",
    ),
  );
  validateWorkspace(workspace([{ ...database, columns: [], view: "board" }]));
  for (const view of ["calendar", "list"] as const)
    validateWorkspace(
      workspace([
        {
          ...database,
          view,
          calendarDateProperty: "due",
          columns: [
            ...database.columns,
            { id: "related", name: "Related", type: "relation", options: [] },
          ],
        },
      ]),
    );
});

test("duplicate and backup import remap internal relations and preserve member IDs", () => {
  const database = {
    ...newPage("Tasks", null, "database"),
    id: "db",
    columns: [
      {
        id: "related",
        name: "Related",
        type: "relation" as const,
        options: [],
      },
      { id: "owner", name: "Owner", type: "person" as const, options: [] },
    ],
  };
  const source = workspace([
    database,
    row("a", { related: "b", owner: "u1" }),
    row("b", { related: "outside" }),
    { ...newPage("External"), id: "outside" },
  ]);
  const duplicate = duplicatePage(source, "db");
  const copies = duplicate.workspace.pages.filter(
    (page) => page.parentId === duplicate.id,
  );
  assert.equal(copies[0].properties.related, copies[1].id);
  assert.equal(copies[0].properties.owner, "u1");
  assert.equal(copies[1].properties.related, "outside");
  const merged = mergeBackup(workspace([]), source);
  assert.equal(merged.pages[1].properties.related, merged.pages[2].id);
  assert.equal(merged.pages[2].properties.related, merged.pages[3].id);
  assert.equal(merged.pages[1].properties.owner, "u1");
  validateWorkspace(merged);
});

test("CSV resolves people and relations with optional context and retains unknown IDs", () => {
  const columns = [
    columnSchema.parse({ id: "owner", name: "Owner", type: "person" }),
    columnSchema.parse({ id: "related", name: "Related", type: "relation" }),
    columnSchema.parse({ id: "due", name: "Due", type: "date" }),
  ];
  const rows = [
    row("a", { owner: "u1", related: "plan", due: "2026-09-12" }),
    row("b", { owner: "former", related: "missing" }),
  ];
  const result = csv(rows, columns, {
    members: [{ id: "u1", name: "Morgan, Lee", username: "morgan" }],
    pages: [{ ...newPage("=Launch"), id: "plan" }],
  });
  assert.match(result, /"Morgan, Lee","'=Launch","2026-09-12"/);
  assert.match(result, /"former","missing",""/);
  assert.match(csv(rows, columns), /"u1","plan"/);
});
