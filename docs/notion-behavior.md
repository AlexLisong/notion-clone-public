# Public behavior references

Research conducted September 11, 2026 using Notion's public help pages. No private source, authenticated workspace, internal API, or storage implementation was accessed. These references guided visible behavior, not claims about Notion's proprietary architecture.

| Reference                                                                              | Behavior reproduced                                       |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| [Create a subpage](https://www.notion.com/help/create-a-subpage)                       | Parent/child page hierarchy, breadcrumbs, nested creation |
| [Navigate with the sidebar](https://www.notion.com/help/navigate-with-the-sidebar)     | Expandable page tree, favorites, page navigation          |
| [Search](https://www.notion.com/help/search)                                           | Title/body search, recent results, keyboard shortcuts     |
| [Writing and editing](https://www.notion.com/help/writing-and-editing-basics)          | Blocks, slash insertion, rich text, lists and formatting  |
| [Keyboard shortcuts](https://www.notion.com/help/keyboard-shortcuts)                   | Headings/lists, editor history and formatting shortcuts   |
| [Databases](https://www.notion.com/help/intro-to-databases)                            | Every database record is a page                           |
| [Tables](https://www.notion.com/help/tables)                                           | Editable record properties and opening records            |
| [Boards](https://www.notion.com/help/boards)                                           | Grouping by a select/status property, moving cards        |
| [Database properties](https://www.notion.com/help/database-properties)                 | Text, number, select, date, checkbox and URL fields       |
| [Delete and restore](https://www.notion.com/help/duplicate-delete-and-restore-content) | Recoverable deletion and subtree handling                 |
| [Export your content](https://www.notion.com/help/export-your-content)                 | Markdown and CSV export concepts                          |

Deliberate differences: classic sidebar rather than Notion's newest tabbed navigation; full-page record opening rather than side peek; Tiptap's standard `>` quote shortcut; color covers rather than uploaded photos; Trash has no automatic expiry. Property creation is supported; column resizing/reordering and editing/deleting property definitions are not included in this first version. The body editor reorders top-level blocks through its block menu, while sidebar pages and board cards support dragging.
