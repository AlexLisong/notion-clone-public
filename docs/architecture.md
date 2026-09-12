# Architecture

## Runtime boundaries

The original personal runtime described below remains available locally. The standalone team runtime uses native accounts and normalized `team_*` tables in the same SQLite database. A transaction migrates legacy pages privately to the bootstrap owner, retaining the old snapshot for recovery while denying its API.

`team-db.ts` owns initialization/transactions and ACL evaluation; `team-auth.ts` owns password/session/account flows; `team-pages.ts` owns access-filtered snapshots, atomic revision-checked page commands, history and notifications; `team-node.ts` owns the guarded HTTP dispatcher and protected attachments. The Vinext `team-runtime.ts` stub reports team mode unavailable; The standalone webpack build replaces it with the native handler. The frontend authenticates before mounting workspace state and clears that state across account changes.

Clients receive a filtered workspace-shaped GET plus per-page revisions and effective permissions. Saves send only changed/deleted pages with their base revisions. Sharing uses a separate access revision. Server transactions recheck current sessions, ACLs and revisions before committing page/history/activity changes together. Personal themes/favorites are account-scoped. Polling adopts remote data only while the local draft is saved, with response-order guards. Same-page concurrent edits require explicit conflict recovery; no CRDT or WebSocket coediting is claimed.

Attachments are opaque private files outside static assets. Every download checks current page access. Operational backups contain one coherent SQLite/file snapshot with sessions removed from the backup copy. See [team guide](team-guide.md), [comparison](team-feature-comparison.md) and [AWS recovery](aws.md).

---

## Page and block model

`lib/folio/model.ts` defines the versioned workspace schema. A workspace owns pages; each page has an ID, nullable parent ID, title, description, icon, cover, timestamps, preferences, and a Tiptap JSON document. IDs are UUIDs; starter page IDs are stable for navigation. Database pages additionally define property columns and view settings. Database rows are regular pages whose parent points at the database; property values live on the row page. The sidebar and breadcrumbs use the same hierarchy.

Moves reject cycles. Duplicating a subtree remaps every ID and parent reference. Trashing a subtree attaches a deletion-batch identifier so restoring a parent does not accidentally revive children deleted earlier. Restoring a child of a deleted parent places it at the root. Import rejects missing parents, cycles, duplicate IDs, inconsistent trash ancestry, invalid document structures, unsafe URLs/colors, excessive nesting and size.

## Saving

`GET /api/workspace` reads the local workspace and seeds it only if the database has no record. `PUT /api/workspace` validates the complete snapshot and performs a parameterized compare-and-swap update:

```sql
UPDATE workspaces
SET data = ?, revision = revision + 1
WHERE id = ? AND revision = ?;
```

A revision mismatch returns HTTP 409. `use-workspace.ts` tracks current/saved edit sequence numbers, debounces writes, serializes in-flight requests, and drains edits made while a slow request is still pending. Failure preserves the in-memory edits. The UI offers backup/retry, or backup/reload on conflict. Reload increments an editor generation so document content is replaced along with page state. The browser warns before unloading unsaved edits.

The storage boundary is one JSON snapshot in one SQLite row. This keeps the personal app portable and makes whole-workspace export straightforward. It is not a collaborative CRDT or a normalized backend for large datasets. A future hosted version should use identity-bound workspace rows, normalized pages/blocks, appropriate D1 row-size limits, and an explicit merge strategy.

## Local setup

`scripts/setup-local.mjs` writes an ignored local Wrangler migration configuration and applies `drizzle/*.sql` through Wrangler's migration journal. Development and built-preview runtimes share `.wrangler/state`. Migration SQL is versioned; SQLite files and runtime state are not.

The supplied `.openai/hosting.json` is a logical capability manifest from the Sites starter, with `DB` enabled. No hosted Site is registered or deployed for this repository. The local-only API guard remains in place.

## UI

- `components/folio/workspace.tsx`: navigation, dialogs, page metadata, templates, import/export, trash and settings.
- `components/folio/editor.tsx`: Tiptap extensions, formatting, slash menu, callouts/toggles and block actions.
- `components/folio/database.tsx`: property inputs, table/board views and card status changes.
- `lib/folio/seed.ts`: first-run examples and document templates.
- `app/globals.css`: Notion-inspired spacing and neutral surfaces, themes and responsive behavior.

Third-party interface primitives retain their upstream implementations and licenses. Optional WebMCP registration is feature-detected and does not affect normal use. Its `create_folio_page` response explicitly reports that automatic saving is pending.
