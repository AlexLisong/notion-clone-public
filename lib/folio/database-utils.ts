import type { Column, Page, TeamMember } from "./model";

export type DueFilter = "all" | "overdue" | "today" | "next7" | "undated";
type DateParts = { year: number; month: number; day: number };
const pad = (value: number, length = 2) => String(value).padStart(length, "0");

// Date properties are calendar days, never UTC timestamps. Reject rollover dates.
export function parseDateKey(value: unknown): DateParts | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return null;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return null;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1] ? { year, month, day } : null;
}

export function localDateKey(date = new Date()): string {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function utcDate(parts: DateParts): Date {
  const date = new Date(0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  return date;
}

function utcDateKey(date: Date): string {
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function addCalendarDays(key: string, days: number): string {
  const parts = parseDateKey(key);
  if (!parts || !Number.isInteger(days))
    throw new Error("Invalid calendar date.");
  const date = utcDate(parts);
  date.setUTCDate(date.getUTCDate() + days);
  return utcDateKey(date);
}

export function shiftMonth(month: string, offset: number): string {
  const parts = parseDateKey(`${month}-01`);
  if (!parts || !Number.isInteger(offset))
    throw new Error("Invalid calendar month.");
  const index = Math.max(
    12,
    Math.min(9999 * 12 + 11, parts.year * 12 + parts.month - 1 + offset),
  );
  return `${pad(Math.floor(index / 12), 4)}-${pad((index % 12) + 1)}`;
}

export function calendarDays(
  month: string,
): { date: string; inMonth: boolean }[] {
  const parts = parseDateKey(`${month}-01`);
  if (!parts) throw new Error("Invalid calendar month.");
  const date = utcDate(parts);
  const leadingDays = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(1 - leadingDays);
  return Array.from({ length: 42 }, () => {
    const key = utcDateKey(date);
    date.setUTCDate(date.getUTCDate() + 1);
    return { date: key, inMonth: key.startsWith(`${month}-`) };
  });
}

export function calendarMonthLabel(month: string): string {
  const parts = parseDateKey(`${month}-01`);
  if (!parts) return month;
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(utcDate(parts));
}

export function matchesDueDate(
  value: unknown,
  filter: DueFilter,
  today: string,
): boolean {
  if (filter === "all") return true;
  const valid = parseDateKey(value);
  if (filter === "undated") return !valid;
  if (!valid || typeof value !== "string" || !parseDateKey(today)) return false;
  if (filter === "overdue") return value < today;
  if (filter === "today") return value === today;
  return value >= today && value <= addCalendarDays(today, 6);
}

export function groupCalendarRows(
  rows: Page[],
  columnId: string,
): { byDate: Map<string, Page[]>; undated: Page[] } {
  const byDate = new Map<string, Page[]>(),
    undated: Page[] = [];
  for (const row of rows) {
    const value = row.properties[columnId];
    if (typeof value !== "string" || !parseDateKey(value)) undated.push(row);
    else byDate.set(value, [...(byDate.get(value) ?? []), row]);
  }
  return { byDate, undated };
}

export type DatabaseFilters = {
  query?: string;
  status?: { columnId: string; value: string };
  assignee?: { columnId: string; memberId: string | null };
  due?: { columnId: string; range: DueFilter };
  today?: string;
  sort?: Page["sort"];
  columns?: Column[];
  members?: TeamMember[];
  pages?: Page[];
};

export function filterDatabaseRows(
  rows: Page[],
  filters: DatabaseFilters,
): Page[] {
  const query = filters.query?.trim().toLocaleLowerCase() ?? "";
  const members = new Map(
    (filters.members ?? []).map((member) => [
      member.id,
      `${member.name} ${member.username}`,
    ]),
  );
  const pages = new Map(
    (filters.pages ?? [])
      .filter((page) => !page.trashedAt)
      .map((page) => [page.id, page.title]),
  );
  return rows
    .filter((row) => {
      if (row.trashedAt) return false;
      if (
        filters.status &&
        String(row.properties[filters.status.columnId] ?? "") !==
          filters.status.value
      )
        return false;
      if (
        filters.assignee &&
        String(row.properties[filters.assignee.columnId] ?? "") !==
          (filters.assignee.memberId ?? "")
      )
        return false;
      if (
        filters.due &&
        !matchesDueDate(
          row.properties[filters.due.columnId],
          filters.due.range,
          filters.today ?? localDateKey(),
        )
      )
        return false;
      if (!query) return true;
      const values = Object.values(row.properties).map(String);
      for (const column of filters.columns ?? []) {
        const id = String(row.properties[column.id] ?? "");
        if (column.type === "person") values.push(members.get(id) ?? "");
        if (column.type === "relation") values.push(pages.get(id) ?? "");
      }
      return `${row.title} ${values.join(" ")}`
        .toLocaleLowerCase()
        .includes(query);
    })
    .sort((a, b) =>
      filters.sort === "title"
        ? a.title.localeCompare(b.title)
        : filters.sort === "updated"
          ? b.updatedAt - a.updatedAt
          : 0,
    );
}
