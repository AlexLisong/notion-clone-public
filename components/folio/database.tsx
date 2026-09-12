"use client";
import { useState } from "react";
import { toast } from "sonner";
import {
  Plus,
  Search,
  Table2,
  Columns3,
  ArrowUpDown,
  SlidersHorizontal,
  ArrowUpRight,
  MoreHorizontal,
  Copy,
  Trash2,
  Type,
  Hash,
  CalendarDays,
  CheckSquare,
  Link2,
  CircleDot,
  UserRound,
  List,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  type Page,
  type Column,
  type PropertyValue,
  type TeamMember,
  newPage,
  uid,
  columnSchema,
} from "@/lib/folio/model";
import {
  calendarDays,
  calendarMonthLabel,
  filterDatabaseRows,
  groupCalendarRows,
  localDateKey,
  parseDateKey,
  shiftMonth,
  type DueFilter,
} from "@/lib/folio/database-utils";
import "./database-team.css";

export function Choice({
  label,
  value,
  options,
  onChange,
  className = "",
  disabled = false,
}: {
  label: string;
  value: string;
  options: { value: string; label: string; disabled?: boolean }[];
  onChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
}) {
  // Prefix every value so an actual option named "__empty" stays selectable.
  return (
    <Select
      value={`value:${value}`}
      disabled={disabled}
      onValueChange={(v) => {
        if (!disabled) onChange(v.slice(6));
      }}
    >
      <SelectTrigger className={className} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper">
        {options.map((o) => (
          <SelectItem
            key={o.value}
            value={`value:${o.value}`}
            disabled={o.disabled}
          >
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function PropertyInput({
  column,
  value,
  onChange,
  label,
  members = [],
  pages = [],
  readOnly = false,
  onOpenPage,
}: {
  column: Column;
  value: PropertyValue | undefined;
  onChange: (value: PropertyValue) => void;
  label?: string;
  members?: TeamMember[];
  pages?: Page[];
  readOnly?: boolean;
  onOpenPage?: (id: string) => void;
}) {
  const name = label ?? column.name,
    currentValue = String(value ?? "");
  const change = (next: PropertyValue) => {
    if (!readOnly) onChange(next);
  };
  if (column.type === "checkbox")
    return (
      <Checkbox
        aria-label={name}
        checked={value === true}
        disabled={readOnly}
        onCheckedChange={(v) => change(v === true)}
      />
    );
  if (["select", "person", "relation"].includes(column.type)) {
    const visiblePages = pages.filter((page) => !page.trashedAt);
    const choices =
      column.type === "person"
        ? members.map((member) => ({
            value: member.id,
            label: member.name
              ? `${member.name} (@${member.username})`
              : `@${member.username}`,
          }))
        : column.type === "relation"
          ? visiblePages
              .map((page) => ({
                value: page.id,
                label: page.title || "Untitled",
              }))
              .sort((a, b) => a.label.localeCompare(b.label))
          : [...new Set(column.options)].map((option) => ({
              value: option,
              label: option,
            }));
    const options: { value: string; label: string; disabled?: boolean }[] = [
      { value: "", label: column.type === "person" ? "Unassigned" : "Empty" },
      ...choices,
    ];
    if (
      currentValue &&
      !choices.some((option) => option.value === currentValue)
    )
      options.push({
        value: currentValue,
        label:
          column.type === "person"
            ? "Unavailable member"
            : column.type === "relation"
              ? "Unavailable page"
              : currentValue,
        disabled: true,
      });
    const related =
      column.type === "relation"
        ? visiblePages.find((page) => page.id === currentValue)
        : undefined;
    const choice = (
      <Choice
        label={name}
        className={`property-select ${column.type === "select" ? tagClass(currentValue) : ""}`}
        value={currentValue}
        options={options}
        disabled={readOnly}
        onChange={change}
      />
    );
    return related ? (
      <span className="database-relation-input">
        {choice}
        <a
          className="icon-button"
          aria-label={`Open related page ${related.title || "Untitled"}`}
          href={`#${encodeURIComponent(related.id)}`}
          onClick={
            onOpenPage
              ? (event) => {
                  event.preventDefault();
                  onOpenPage(related.id);
                }
              : undefined
          }
        >
          <ArrowUpRight size={14} />
        </a>
      </span>
    ) : (
      choice
    );
  }
  return (
    <input
      maxLength={10000}
      className="property-input"
      aria-label={name}
      readOnly={readOnly}
      type={
        column.type === "number"
          ? "number"
          : column.type === "date"
            ? "date"
            : column.type === "url"
              ? "url"
              : "text"
      }
      placeholder="Empty"
      value={currentValue}
      onChange={(e) =>
        change(
          column.type === "number" && e.target.value !== ""
            ? Number.isFinite(Number(e.target.value))
              ? Number(e.target.value)
              : ""
            : e.target.value,
        )
      }
    />
  );
}

export function tagClass(value: string) {
  if (["Done", "Finished", "Low"].includes(value)) return "tag-green";
  if (["In progress", "Reading", "Medium"].includes(value)) return "tag-blue";
  if (value === "High") return "tag-red";
  return "tag-gray";
}
const colIcons = {
  text: Type,
  number: Hash,
  date: CalendarDays,
  checkbox: CheckSquare,
  url: Link2,
  select: CircleDot,
  person: UserRound,
  relation: Link2,
};
type ViewSettings = Pick<
  Page,
  "view" | "filter" | "sort" | "calendarDateProperty"
>;
const dueOptions: { value: DueFilter; label: string }[] = [
  { value: "all", label: "Any date" },
  { value: "overdue", label: "Before today" },
  { value: "today", label: "Today" },
  { value: "next7", label: "Next 7 days" },
  { value: "undated", label: "No date" },
];

export function DatabaseView({
  database,
  pages,
  update,
  create,
  open,
  duplicate,
  trash,
  members = [],
  currentUserId,
  readOnly = false,
  canEditPage,
}: {
  database: Page;
  pages: Page[];
  update: (id: string, changes: Partial<Page>) => void;
  create: (page: Page) => void;
  open: (id: string) => void;
  duplicate: (id: string) => void;
  trash: (id: string) => void;
  members?: TeamMember[];
  currentUserId?: string;
  readOnly?: boolean;
  canEditPage?: (id: string) => boolean;
}) {
  const [query, setQuery] = useState(""),
    [addingColumn, setAddingColumn] = useState(false),
    [name, setName] = useState(""),
    [type, setType] = useState<Column["type"]>("text"),
    [options, setOptions] = useState(""),
    [localSettings, setLocalSettings] = useState<{
      id: string;
      values: Partial<ViewSettings>;
    }>({ id: database.id, values: {} }),
    [assigneeProperty, setAssigneeProperty] = useState(""),
    [assignee, setAssignee] = useState("all"),
    [myTasks, setMyTasks] = useState(false),
    [due, setDue] = useState<DueFilter>("all"),
    [month, setMonth] = useState(() => localDateKey().slice(0, 7));
  const canEdit = (id: string) => !readOnly && (canEditPage?.(id) ?? true);
  const canEditDatabase = canEdit(database.id);
  const settings = canEditDatabase
    ? database
    : {
        ...database,
        ...(localSettings.id === database.id ? localSettings.values : {}),
      };
  const changeSettings = (changes: Partial<ViewSettings>) => {
    if (canEditDatabase) update(database.id, changes);
    else
      setLocalSettings((current) => ({
        id: database.id,
        values: {
          ...(current.id === database.id ? current.values : {}),
          ...changes,
        },
      }));
  };
  const columns = database.columns,
    group =
      columns.find((c) => c.id === "status" && c.type === "select") ??
      columns.find((c) => c.type === "select");
  const dateColumns = columns.filter((column) => column.type === "date"),
    personColumns = columns.filter((column) => column.type === "person");
  const dateColumn =
    dateColumns.find((column) => column.id === settings.calendarDateProperty) ??
    dateColumns.find((column) => column.id === "due") ??
    dateColumns[0];
  const personColumn =
    personColumns.find((column) => column.id === assigneeProperty) ??
    personColumns.find((column) => column.id === "assignee") ??
    personColumns[0];
  const all = pages.filter(
      (page) => page.parentId === database.id && !page.trashedAt,
    ),
    today = localDateKey();
  const memberId =
    myTasks && currentUserId
      ? currentUserId
      : assignee.startsWith("member:")
        ? assignee.slice(7)
        : null;
  const rows = filterDatabaseRows(all, {
    query,
    status:
      group && settings.filter !== "all"
        ? { columnId: group.id, value: settings.filter }
        : undefined,
    assignee:
      personColumn && ((myTasks && currentUserId) || assignee !== "all")
        ? { columnId: personColumn.id, memberId }
        : undefined,
    due: dateColumn ? { columnId: dateColumn.id, range: due } : undefined,
    today,
    sort: settings.sort,
    columns,
    members,
    pages,
  });
  const calendar = dateColumn
    ? groupCalendarRows(rows, dateColumn.id)
    : { byDate: new Map<string, Page[]>(), undated: rows };
  const days = calendarDays(month);
  const add = ({ status, date }: { status?: string; date?: string } = {}) => {
    if (!canEditDatabase) return;
    const page = newPage("Untitled", database.id);
    page.properties = Object.fromEntries(
      columns.map((column) => [
        column.id,
        column.type === "checkbox"
          ? false
          : column.id === group?.id
            ? (status ??
              (settings.filter !== "all"
                ? settings.filter
                : column.options[0]) ??
              "")
            : column.id === dateColumn?.id && date
              ? date
              : column.id === personColumn?.id
                ? (memberId ?? "")
                : "",
      ]),
    );
    create(page);
  };
  const property = (row: Page, column: Column, value: PropertyValue) => {
    if (canEdit(row.id))
      update(row.id, { properties: { ...row.properties, [column.id]: value } });
  };
  const propertyInput = (row: Page, column: Column) => (
    <PropertyInput
      key={column.id}
      column={column}
      value={row.properties[column.id]}
      onChange={(value) => property(row, column, value)}
      label={`${row.title || "Untitled"} ${column.name}`}
      members={members}
      pages={pages}
      readOnly={!canEdit(row.id)}
      onOpenPage={open}
    />
  );
  const rowMenu = (row: Page) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="icon-button"
          aria-label={`Actions for ${row.title || "Untitled"}`}
        >
          <MoreHorizontal size={16} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={() => open(row.id)}>
          <ArrowUpRight />
          Open page
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!canEdit(row.id) || !canEditDatabase}
          onSelect={() => {
            if (canEdit(row.id) && canEditDatabase) duplicate(row.id);
          }}
        >
          <Copy />
          Duplicate
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          disabled={!canEdit(row.id)}
          onSelect={() => {
            if (canEdit(row.id)) trash(row.id);
          }}
        >
          <Trash2 />
          Move to Trash
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
  const addProperty = (nextType: Column["type"] = "text", nextName = "") => {
    if (!canEditDatabase || columns.length >= 40) return;
    setName(nextName);
    setType(nextType);
    setOptions("");
    setAddingColumn(true);
  };
  const taskColumns = [
    ...new Map(
      [personColumn, dateColumn, group, ...columns]
        .filter((column): column is Column => !!column)
        .map((column) => [column.id, column]),
    ).values(),
  ];
  const titleButton = (row: Page) => (
    <button className="row-title" onClick={() => open(row.id)}>
      <span>{row.icon}</span>
      {row.title || "Untitled"}
    </button>
  );
  const taskList = (items: Page[]) => (
    <div className="database-task-list">
      {items.map((row) => (
        <article className="database-task-row" key={row.id}>
          <div className="database-task-title">
            {titleButton(row)}
            {rowMenu(row)}
          </div>
          <div className="database-task-properties">
            {taskColumns.slice(0, 4).map((column) => (
              <label key={column.id}>
                <span>{column.name}</span>
                {propertyInput(row, column)}
              </label>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
  const newButton = (defaults: { status?: string; date?: string } = {}) => (
    <button
      className="new-row"
      disabled={!canEditDatabase}
      onClick={() => add(defaults)}
    >
      <Plus size={16} />
      New page
    </button>
  );
  const hasFilters =
    !!query ||
    settings.filter !== "all" ||
    assignee !== "all" ||
    myTasks ||
    due !== "all";
  const clearFilters = () => {
    setQuery("");
    setAssignee("all");
    setMyTasks(false);
    setDue("all");
    changeSettings({ filter: "all" });
  };
  return (
    <section
      className="database database-team"
      aria-label={`${database.title} database`}
    >
      <Tabs
        value={settings.view}
        onValueChange={(view) => changeSettings({ view: view as Page["view"] })}
      >
        <div className="database-toolbar">
          <TabsList variant="line" className="database-view-tabs">
            <TabsTrigger value="table">
              <Table2 size={15} />
              Table
            </TabsTrigger>
            <TabsTrigger value="board">
              <Columns3 size={15} />
              Board
            </TabsTrigger>
            <TabsTrigger value="calendar">
              <CalendarDays size={15} />
              Calendar
            </TabsTrigger>
            <TabsTrigger value="list">
              <List size={15} />
              List
            </TabsTrigger>
          </TabsList>
          <div className="database-tools">
            <label className="database-search">
              <Search size={15} />
              <input
                placeholder="Search"
                aria-label="Search database"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            {group && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className={`plain-button ${settings.filter !== "all" ? "filter-active" : ""}`}
                    aria-label="Filter database"
                  >
                    <SlidersHorizontal size={15} />
                    <span>Status</span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem
                    onSelect={() => changeSettings({ filter: "all" })}
                  >
                    All {group.name.toLowerCase()} values
                  </DropdownMenuItem>
                  {[...new Set(group.options)].map((value) => (
                    <DropdownMenuItem
                      key={value}
                      onSelect={() => changeSettings({ filter: value })}
                    >
                      {value}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="plain-button" aria-label="Sort database">
                  <ArrowUpDown size={15} />
                  <span>Sort</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {(["manual", "title", "updated"] as const).map(
                  (value, index) => (
                    <DropdownMenuItem
                      key={value}
                      onSelect={() => changeSettings({ sort: value })}
                    >
                      {
                        ["Original order", "Name A → Z", "Recently edited"][
                          index
                        ]
                      }
                    </DropdownMenuItem>
                  ),
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <button
              className="plain-button"
              aria-label="Add database property"
              disabled={!canEditDatabase || columns.length >= 40}
              onClick={() => addProperty()}
            >
              <Plus size={15} />
              <span>Property</span>
            </button>
            <button
              className="primary-button compact"
              disabled={!canEditDatabase}
              onClick={() => add()}
            >
              <Plus size={15} />
              New
            </button>
          </div>
        </div>
        <div className="database-team-filters" aria-label="Task filters">
          {personColumns.length > 1 && (
            <Choice
              label="Assignee property"
              value={personColumn?.id ?? ""}
              options={personColumns.map((column) => ({
                value: column.id,
                label: column.name,
              }))}
              onChange={setAssigneeProperty}
              className="database-filter-select"
            />
          )}
          {personColumn ? (
            <>
              <Choice
                label="Filter by assignee"
                value={assignee}
                options={[
                  { value: "all", label: "All assignees" },
                  { value: "unassigned", label: "Unassigned" },
                  ...members.map((member) => ({
                    value: `member:${member.id}`,
                    label: member.name || member.username,
                  })),
                ]}
                onChange={(value) => {
                  setAssignee(value);
                  setMyTasks(false);
                }}
                className="database-filter-select"
              />
              {currentUserId && (
                <button
                  className={`plain-button database-my-tasks ${myTasks ? "filter-active" : ""}`}
                  aria-pressed={myTasks}
                  onClick={() => {
                    setMyTasks(!myTasks);
                    setAssignee("all");
                  }}
                >
                  <UserRound size={14} />
                  My tasks
                </button>
              )}
            </>
          ) : (
            <button
              className="plain-button"
              disabled={!canEditDatabase || columns.length >= 40}
              onClick={() => addProperty("person", "Assignee")}
            >
              <UserRound size={14} />
              Add assignee
            </button>
          )}
          {dateColumn && (
            <>
              <Choice
                label="Date property"
                value={dateColumn.id}
                options={dateColumns.map((column) => ({
                  value: column.id,
                  label: column.name,
                }))}
                onChange={(calendarDateProperty) =>
                  changeSettings({ calendarDateProperty })
                }
                className="database-filter-select"
              />
              <Choice
                label="Filter by due date"
                value={due}
                options={dueOptions}
                onChange={(value) => setDue(value as DueFilter)}
                className="database-filter-select"
              />
            </>
          )}
          {hasFilters && (
            <button className="plain-button" onClick={clearFilters}>
              Clear filters
            </button>
          )}
          {!canEditDatabase && (
            <span className="database-view-note">
              View settings apply only to you.
            </span>
          )}
        </div>
        {settings.filter !== "all" && (
          <div className="filter-summary">
            {group?.name}: {settings.filter}
            <button onClick={() => changeSettings({ filter: "all" })}>
              Clear status ×
            </button>
          </div>
        )}
        <TabsContent value="table">
          <Table className="workspace-table">
            <TableHeader>
              <TableRow>
                <TableHead className="name-column">
                  <Type size={14} />
                  Name
                </TableHead>
                {columns.map((column) => {
                  const Icon = colIcons[column.type];
                  return (
                    <TableHead key={column.id}>
                      <span className="column-heading">
                        <Icon size={14} />
                        {column.name}
                      </span>
                    </TableHead>
                  );
                })}
                <TableHead>
                  <button
                    className="plain-button"
                    aria-label="Add property"
                    disabled={!canEditDatabase || columns.length >= 40}
                    onClick={() => addProperty()}
                  >
                    <Plus size={16} />
                  </button>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <div className="database-name-cell">
                      {titleButton(row)}
                      <button
                        className="open-row"
                        aria-label={`Open ${row.title}`}
                        onClick={() => open(row.id)}
                      >
                        <ArrowUpRight size={14} />
                      </button>
                    </div>
                  </TableCell>
                  {columns.map((column) => (
                    <TableCell key={column.id}>
                      {propertyInput(row, column)}
                    </TableCell>
                  ))}
                  <TableCell>{rowMenu(row)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {newButton()}
          {!rows.length && (
            <div className="database-empty">
              {all.length
                ? "No pages match your filters."
                : "Your database is ready. Add your first page."}
            </div>
          )}
        </TabsContent>
        <TabsContent value="board">
          {group ? (
            <div className="board">
              {[...new Set(group.options), ""].map((status) => {
                const cards = rows.filter((row) =>
                  status
                    ? String(row.properties[group.id] ?? "") === status
                    : !group.options.includes(
                        String(row.properties[group.id] ?? ""),
                      ),
                );
                return (
                  <section
                    className="board-column"
                    key={status}
                    onDragOver={(e) => {
                      if (
                        !readOnly &&
                        e.dataTransfer.types.includes(
                          "application/folio-record",
                        )
                      )
                        e.preventDefault();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const row = all.find(
                        (page) =>
                          page.id ===
                          e.dataTransfer.getData("application/folio-record"),
                      );
                      if (row) property(row, group, status);
                    }}
                  >
                    <header>
                      <span className={`status-tag ${tagClass(status)}`}>
                        {status || "No status"}
                      </span>
                      <span className="board-count">{cards.length}</span>
                      <button
                        className="icon-button"
                        aria-label={`Add page to ${status || "No status"}`}
                        disabled={!canEditDatabase}
                        onClick={() => add({ status })}
                      >
                        <Plus size={15} />
                      </button>
                    </header>
                    {cards.map((row) => (
                      <article
                        className="board-card"
                        key={row.id}
                        draggable={canEdit(row.id)}
                        onDragStart={(e) => {
                          if (canEdit(row.id))
                            e.dataTransfer.setData(
                              "application/folio-record",
                              row.id,
                            );
                          else e.preventDefault();
                        }}
                      >
                        <div className="board-card-title">
                          {titleButton(row)}
                          {rowMenu(row)}
                        </div>
                        <div className="board-card-properties">
                          {taskColumns
                            .filter((column) => column.id !== group.id)
                            .slice(0, 3)
                            .map((column) => propertyInput(row, column))}
                        </div>
                        <Choice
                          label={`Status for ${row.title}`}
                          className="board-status-select"
                          value={String(row.properties[group.id] ?? "")}
                          options={[
                            { value: "", label: "No status" },
                            ...[...new Set(group.options)].map((value) => ({
                              value,
                              label: value,
                            })),
                          ]}
                          disabled={!canEdit(row.id)}
                          onChange={(value) => property(row, group, value)}
                        />
                      </article>
                    ))}
                    {newButton({ status })}
                  </section>
                );
              })}
            </div>
          ) : (
            <div className="database-empty">
              <p>Add a select property to group pages on a board.</p>
              <button
                className="plain-button"
                disabled={!canEditDatabase || columns.length >= 40}
                onClick={() => addProperty("select", "Status")}
              >
                <Plus size={16} />
                Add property
              </button>
            </div>
          )}
        </TabsContent>
        <TabsContent value="calendar">
          {dateColumn ? (
            <>
              <div className="database-calendar-toolbar">
                <h3 aria-live="polite">{calendarMonthLabel(month)}</h3>
                <div>
                  <button
                    className="plain-button"
                    onClick={() => setMonth(today.slice(0, 7))}
                  >
                    Today
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Previous month"
                    disabled={month === "0001-01"}
                    onClick={() => setMonth((value) => shiftMonth(value, -1))}
                  >
                    <ChevronLeft size={17} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Next month"
                    disabled={month === "9999-12"}
                    onClick={() => setMonth((value) => shiftMonth(value, 1))}
                  >
                    <ChevronRight size={17} />
                  </button>
                </div>
              </div>
              <div className="database-calendar-scroll">
                <table
                  className="database-calendar-grid"
                  aria-label={`${calendarMonthLabel(month)} ${dateColumn.name}`}
                >
                  <thead>
                    <tr>
                      {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(
                        (day) => (
                          <th scope="col" key={day}>
                            {day}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: 6 }, (_, week) => (
                      <tr key={week}>
                        {days.slice(week * 7, week * 7 + 7).map((day) => (
                          <td
                            key={day.date}
                            className={`${day.inMonth ? "" : "outside-month"} ${day.date === today ? "is-today" : ""}`}
                          >
                            <div className="database-calendar-day">
                              <time dateTime={day.date}>
                                {Number(day.date.slice(-2))}
                              </time>
                              <button
                                className="icon-button"
                                aria-label={`Add page on ${day.date}`}
                                disabled={
                                  !canEditDatabase || !parseDateKey(day.date)
                                }
                                onClick={() => add({ date: day.date })}
                              >
                                <Plus size={13} />
                              </button>
                            </div>
                            {(calendar.byDate.get(day.date) ?? []).map(
                              (row) => (
                                <button
                                  className="database-calendar-event"
                                  key={row.id}
                                  onClick={() => open(row.id)}
                                >
                                  <span>{row.icon}</span>
                                  <span>
                                    {row.title || "Untitled"}
                                    {personColumn &&
                                      row.properties[personColumn.id] && (
                                        <small>
                                          {members.find(
                                            (member) =>
                                              member.id ===
                                              row.properties[personColumn.id],
                                          )?.name ||
                                            members.find(
                                              (member) =>
                                                member.id ===
                                                row.properties[personColumn.id],
                                            )?.username ||
                                            "Unavailable member"}
                                        </small>
                                      )}
                                  </span>
                                </button>
                              ),
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="database-undated">
                <h3>
                  Undated <span>{calendar.undated.length}</span>
                </h3>
                {calendar.undated.length ? (
                  taskList(calendar.undated)
                ) : (
                  <p>Every matching page has a date.</p>
                )}
              </div>
            </>
          ) : (
            <div className="database-empty">
              <CalendarDays size={28} />
              <p>Add a date property to place pages on a calendar.</p>
              <button
                className="plain-button"
                disabled={!canEditDatabase || columns.length >= 40}
                onClick={() => addProperty("date", "Due date")}
              >
                <Plus size={16} />
                Add date property
              </button>
            </div>
          )}
        </TabsContent>
        <TabsContent value="list">
          {taskList(rows)}
          {!rows.length && (
            <div className="database-empty">No pages match your filters.</div>
          )}
          {newButton()}
        </TabsContent>
        <div className="database-count" aria-live="polite">
          {rows.length} of {all.length} {all.length === 1 ? "page" : "pages"}
        </div>
      </Tabs>
      <Dialog open={addingColumn} onOpenChange={setAddingColumn}>
        <DialogContent>
          <DialogTitle>Add a property</DialogTitle>
          <DialogDescription>
            Every page in this database will have this property.
          </DialogDescription>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!canEditDatabase || columns.length >= 40 || !name.trim())
                return;
              const result = columnSchema.safeParse({
                id: uid(),
                name: name.trim(),
                type,
                options:
                  type === "select"
                    ? [
                        ...new Set(
                          options
                            .split(",")
                            .map((value) => value.trim())
                            .filter(Boolean),
                        ),
                      ]
                    : [],
              });
              if (!result.success) {
                toast.error(
                  "Use up to 30 options, each no longer than 80 characters.",
                );
                return;
              }
              update(database.id, { columns: [...columns, result.data] });
              setAddingColumn(false);
            }}
          >
            <label className="form-label">
              Name
              <input
                autoFocus
                className="form-input"
                maxLength={80}
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Owner"
                disabled={!canEditDatabase}
              />
            </label>
            <label className="form-label">
              Type
              <Choice
                label="Property type"
                value={type}
                disabled={!canEditDatabase}
                onChange={(value) => setType(value as Column["type"])}
                options={Object.keys(colIcons).map((value) => ({
                  value,
                  label:
                    value === "person"
                      ? "Person"
                      : value === "relation"
                        ? "Related page"
                        : value[0].toUpperCase() + value.slice(1),
                }))}
              />
            </label>
            {type === "select" && (
              <label className="form-label">
                Options, separated by commas
                <input
                  className="form-input"
                  required
                  value={options}
                  disabled={!canEditDatabase}
                  onChange={(e) => setOptions(e.target.value)}
                  placeholder="Idea, In progress, Complete"
                />
              </label>
            )}
            {type === "person" && (
              <p className="database-property-help">
                Choose one workspace member for each page.
              </p>
            )}
            {type === "relation" && (
              <p className="database-property-help">
                Link each record to one page you can access. Existing links stay
                intact if a page becomes unavailable.
              </p>
            )}
            <div className="dialog-actions">
              <button
                type="button"
                className="plain-button"
                onClick={() => setAddingColumn(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="primary-button"
                disabled={!canEditDatabase || columns.length >= 40}
              >
                Add property
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
