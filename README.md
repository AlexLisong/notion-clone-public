# Folio

A document and project workspace with nested pages, a rich text editor, and databases that switch between table, board, calendar, and list views.

Folio is an independent implementation of familiar Notion-style interactions. It is built for personal use and small teams, with readable TypeScript, SQLite storage, and portable exports.

## Get started

Use **Node.js 22.13 or later in the Node 22 release line** (`nvm use` selects it).

```sh
git clone https://github.com/AlexLisong/notion-clone-public.git
cd notion-clone-public
npm ci
npm run setup
npm run dev
```

Open **http://127.0.0.1:5183**. The local personal workspace needs no cloud account, API key, or Notion account. Setup applies tracked migrations and is safe to repeat. Data lives in the ignored `.wrangler/state` directory and survives restarts.

The default runtime accepts loopback connections and has no team login. For native accounts and page permissions, follow the separate [team runtime setup](docs/aws.md#local-team-development). To preview a built personal workspace, run `npm run build`, then `npm start` and use the loopback URL it prints.

## Features

- **Write:** Rich text, Markdown shortcuts, slash menu, headings, lists, nested checklists, code, callouts, toggles, links, highlights, undo and redo.
- **Organize:** Nested pages, drag-to-nest, templates, favorites, full-text search, breadcrumbs, Trash and restore.
- **Plan:** Table, board, calendar and list views over the same editable records; filters, sorts, assignees, dates and simple relations.
- **Collaborate:** The team runtime adds owner/admin/member/viewer accounts, inherited page access, comments, mentions, inbox, attachments and page history.
- **Keep your data:** SQLite persistence, visible save failures, conflict recovery, JSON import/export, Markdown and CSV exports.

## Scope and privacy

Folio is an early-stage, single-instance project for one small workspace. Saved team data refreshes every five seconds. Different-page edits merge; conflicting changes to the same page preserve the local draft for recovery. There is no character-level coediting, offline sync, SSO/MFA, public publishing, AI, formulas or rollups.

Owners and admins can access every team page. A child inherits access from shared ancestors. The [team guide](docs/team-guide.md) explains this model and account recovery. Normal exports include accessible page data; they do not include account records, comments, history or attachment bytes. Complete server backups require the separate [operations procedure](docs/aws.md).

Current limits include 200 team accounts, 2,000 pages, 10 MB per attachment and 512 MB total attachment storage. These are application limits, not a capacity certification. See the detailed [feature comparison](docs/team-feature-comparison.md).

## Development

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run build:aws
npm run test:aws
npm run test:aws:team
```

Run the two builds sequentially: both generate `.next` route types. The standalone checks start disposable local servers. With a personal server running, `FOLIO_TEST_URL=http://127.0.0.1:5183 npm run test:api` checks the API using a temporary page and advances its workspace revision.

The frontend uses React 19, TypeScript, Tiptap/ProseMirror, Radix and Tailwind. Personal development uses Vinext/Vite with local D1/SQLite; the native team runtime uses Next standalone and Node's SQLite API. [Architecture](docs/architecture.md) describes the boundaries and key files.

## Contribute

Bug reports, focused fixes, accessibility improvements and documentation are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md) for setup, tests and the review process. Discuss significant changes in an issue before implementing them. See the [Code of Conduct](CODE_OF_CONDUCT.md) and [security policy](SECURITY.md).

- [Documentation index](docs/README.md)
- [Team user guide](docs/team-guide.md)
- [Architecture and data model](docs/architecture.md)
- [Verification guide](docs/verification.md)
- [Self-hosting and recovery](docs/aws.md)

## License

Project code is available under the [MIT License](LICENSE). Third-party dependencies and vendored files retain their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Folio is unaffiliated with Notion and does not use Notion's private services or proprietary code.
