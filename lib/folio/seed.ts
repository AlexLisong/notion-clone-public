import {
  doc,
  heading,
  newPage,
  paragraph,
  type Page,
  type Workspace,
} from "./model.ts";
const task = (text: string, checked = false) => ({
  type: "taskItem",
  attrs: { checked },
  content: [paragraph(text)],
});
export function createSeed(): Workspace {
  const home = {
    ...newPage("Personal space"),
    id: "home",
    icon: "🏡",
    cover: "sand" as const,
    favorite: true,
    description: "A little structure. A lot of possibility.",
    content: doc(
      {
        type: "callout",
        content: [
          paragraph("Make room for what matters."),
          paragraph(
            "A home for your notes, ideas, and everything you’re working on.",
          ),
        ],
      },
      heading("A little focus for today"),
      paragraph("Choose one thing that will make today feel worthwhile."),
      {
        type: "taskList",
        content: [
          task("Make something you’re proud of"),
          task("Leave space for a new idea"),
          task("Set up my personal workspace", true),
        ],
      },
      heading("On my mind"),
      paragraph(
        "The best ideas usually start as a small, unfinished thought. Give yours a place to land.",
      ),
      paragraph(""),
    ),
  };
  const projects = {
    ...newPage("Projects", "home", "database"),
    id: "projects",
    icon: "◈",
    description: "Small steps. Meaningful progress.",
    favorite: true,
  };
  const notes = {
    ...newPage("Quick notes", "home"),
    id: "notes",
    icon: "✏️",
    description: "Catch a thought before it goes.",
    content: doc(
      heading("A place for the unfinished"),
      paragraph(
        "A thought, a link, a question worth coming back to. Start anywhere.",
      ),
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [paragraph("What could I make simpler this week?")],
          },
          {
            type: "listItem",
            content: [
              paragraph(
                "An idea is worth writing down before it is worth sharing.",
              ),
            ],
          },
        ],
      },
      paragraph(""),
    ),
  };
  const reading = {
    ...newPage("Reading list", "home", "database"),
    id: "reading",
    icon: "📚",
    description: "Good things to come back to.",
    columns: [
      {
        id: "status",
        name: "Status",
        type: "select" as const,
        options: ["To read", "Reading", "Finished"],
      },
      { id: "author", name: "Author", type: "text" as const, options: [] },
      { id: "rating", name: "Rating", type: "number" as const, options: [] },
    ],
  };
  const guide = {
    ...newPage("Getting started"),
    id: "guide",
    icon: "👋",
    content: doc(
      heading("Welcome to Folio"),
      paragraph(
        "Your documents, projects, and ideas in one personal workspace. Click a title or any paragraph to start editing.",
      ),
      heading("Everything starts with a page"),
      paragraph(
        "Use Add a page to create a document or database. Hover over a page in the sidebar and click + to add a subpage. Drag pages in the sidebar to nest them, or use Move to in the page menu.",
      ),
      heading("Think in blocks"),
      paragraph(
        "Type / on an empty line to insert a heading, checklist, quote, callout, toggle, code block, or subpage. Use the toolbar for formatting. Markdown shortcuts like #, -, 1., and [] followed by a space also work.",
      ),
      heading("A few useful shortcuts"),
      {
        type: "bulletList",
        content: [
          "⌘/Ctrl + K or P — search your workspace",
          "⌘/Ctrl + B / I — bold / italic while editing",
          "⌘/Ctrl + Z — undo changes in the editor",
          "Enter — new block; Shift + Enter — new line",
          "Escape — close menus",
        ].map((text) => ({ type: "listItem", content: [paragraph(text)] })),
      },
      heading("Your pages stay with you"),
      paragraph(
        "Changes save automatically to your workspace database. Settings → Export backup downloads every page, including items in Trash. Import merges a backup into your workspace without replacing existing pages.",
      ),
      paragraph(
        "Folio is a personal, single-user app. It does not sync with Notion or provide cloud sharing. Keep the server on your own machine.",
      ),
    ),
  };
  const items: Page[] = [
    ["Design a calmer morning", "In progress", "High", "☀️"],
    ["Build my personal website", "To do", "Medium", "🧩"],
    ["Plan a weekend away", "To do", "Low", "🏕️"],
    ["Organize my reading notes", "Done", "Medium", "📖"],
  ].map(([title, status, priority, icon]) => ({
    ...newPage(title, "projects"),
    icon,
    properties: { status, priority, due: "" },
    content: doc(
      heading("The idea"),
      paragraph("What would a good outcome look like?"),
      heading("Next steps"),
      { type: "taskList", content: [task("Take the first small step")] },
    ),
  }));
  const books: Page[] = [
    ["The Creative Act", "Rick Rubin", "Reading"],
    ["Four Thousand Weeks", "Oliver Burkeman", "To read"],
    ["A Philosophy of Walking", "Frédéric Gros", "Finished"],
  ].map(([title, author, status]) => ({
    ...newPage(title, "reading"),
    icon: "📖",
    properties: { author, status, rating: "" },
    content: doc(heading("Notes & highlights"), paragraph("")),
  }));
  return {
    version: 1,
    name: "My workspace",
    theme: "light",
    pages: [home, projects, notes, reading, guide, ...items, ...books],
  };
}
export const templates = [
  {
    id: "blank",
    icon: "📄",
    title: "Empty page",
    description: "A fresh page for whatever comes next.",
  },
  {
    id: "project",
    icon: "🧩",
    title: "Project brief",
    description: "Give an idea a direction and a next step.",
  },
  {
    id: "meeting",
    icon: "📝",
    title: "Meeting notes",
    description: "Turn a conversation into clear actions.",
  },
  {
    id: "journal",
    icon: "🌤️",
    title: "Daily journal",
    description: "A little space to reflect.",
  },
  {
    id: "database",
    icon: "◈",
    title: "Project tracker",
    description: "Organize your work in a table or board.",
  },
];
export function fromTemplate(
  template: string,
  parentId: string | null = null,
): Page {
  if (template === "database")
    return newPage("Untitled database", parentId, "database");
  const page = newPage(
    template === "blank"
      ? "Untitled"
      : (templates.find((t) => t.id === template)?.title ?? "Untitled"),
    parentId,
  );
  page.icon = templates.find((t) => t.id === template)?.icon ?? "📄";
  if (template === "project")
    page.content = doc(
      heading("Overview"),
      paragraph("What are we making, and why does it matter?"),
      heading("Success looks like"),
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [paragraph("A clear, measurable outcome")],
          },
        ],
      },
      heading("Next steps"),
      { type: "taskList", content: [task("Define the first milestone")] },
    );
  if (template === "meeting")
    page.content = doc(
      paragraph(new Date().toLocaleDateString()),
      heading("Agenda"),
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [paragraph("What do we need to decide?")],
          },
        ],
      },
      heading("Notes"),
      paragraph(""),
      heading("Action items"),
      { type: "taskList", content: [task("Follow up on the next step")] },
    );
  if (template === "journal")
    page.content = doc(
      heading("Today I’m grateful for"),
      paragraph(""),
      heading("What’s on my mind"),
      paragraph(""),
      heading("One thing for tomorrow"),
      paragraph(""),
    );
  return page;
}
