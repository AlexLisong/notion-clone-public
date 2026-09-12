# Working with your team in Folio

Open your team workspace URL and sign in with your username and password. An administrator creates accounts directly—there are no invitations or public signups. Temporary passwords must be replaced before opening any workspace data.

## Accounts

Open **People → Create account**, enter a username (3–40 letters, digits, dots, hyphens or underscores), display name, role and temporary password (12–128 characters). Share that password privately with your teammate yourself.

- **Owner:** manages all accounts and pages; the owner cannot be deactivated or demoted.
- **Admin:** manages members/viewers and all pages. Only the owner can create/manage admins.
- **Member:** creates pages and edits pages shared with edit access.
- **Viewer:** reads/downloads accessible pages and keeps personal favorites; cannot modify content, comments, files or sharing.

**People → Manage** changes roles, resets a password or deactivates an account. Resets, role changes and deactivation revoke existing sessions immediately. Click your name in the sidebar to change your password; this signs out your other sessions. Sessions last up to seven days. Password recovery is administrator-assisted; email reset and MFA are not implemented.

## Private and shared pages

Existing personal pages are migrated as private to the owner. New pages are restricted by default. Open **Share** to give everyone in the workspace access or grant a specific teammate view/edit access, then **Save access**. Copying a page link does not grant access.

Permissions from parent pages also apply to children. A restricted child under a shared parent still inherits that parent’s audience. Keep confidential work at the top level or beneath a restricted parent. Workspace owners and admins can access every page. Sharing or moving a parent may require admin help if its descendants belong to different people.

A directly shared child appears at the recipient’s top level when its parent is private. Private pages are filtered on the server before search, navigation, exports, history, comments or file downloads are available.

## Team work

- **Comments:** use the speech-bubble button. Reply to a thread, mention a teammate who already has page access, and resolve/reopen discussions. Mentions, replies and task assignments appear in **Inbox**.
- **Activity:** shows recent accessible page changes; administrators also see account-management events.
- **History:** use the clock button to restore a previous saved page version. Up to 100 previous versions per page are retained. Restoring creates a new version and preserves current sharing and nesting.
- **Files:** use the paperclip button to attach/download files. Maximum 10 MB each, 100 per page, 512 MB total. Files are downloaded as attachments rather than executed or publicly served.
- **Presence:** initials show other teammates recently viewing the same page.
- **Updates:** saved workspaces refresh every five seconds. Different pages can be edited concurrently. A conflicting edit to the same page shows a recovery banner; export your draft before reloading. Folio does not merge simultaneous character-level edits like Notion.

## Projects and databases

Use **Project tracker** in Templates. Rows remain full pages with their own notes, comments, files and history. Switch among **Table**, **Board**, **Calendar** and **List**. Add Person properties for assignees and Relation properties to link visible pages. Filter by assignee, **My tasks**, due date and status; Calendar lets you choose the date property and browse months. Viewers can switch views and filter without modifying shared settings.

## Data and recovery

JSON backup/import, Markdown export and database CSV export contain accessible page data. CSV resolves assignees and related-page names. Page exports do not include account credentials, grants, comments, history or attachment bytes.

Configured private server backups include the SQLite database, referenced files and service access configuration. Backups intentionally omit live sessions, so a restored system requires everyone to sign in again. See [self-hosting and recovery](aws.md) before recovery.

See [Notion comparison](team-feature-comparison.md) for scope and remaining gaps: CRDT coediting, formulas/rollups, automation, public publishing, external integrations, MFA/SSO and AI are not included in this release.
