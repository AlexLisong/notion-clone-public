# Team verification checklist

Use a disposable database, synthetic pages and separate owner, member and viewer sessions. Start with `npm test`, `npm run build:aws`, `npm run test:aws` and `npm run test:aws:team`; see [verification](verification.md).

## Accounts and isolation

- Anonymous requests cannot read the team workspace or attachments; the legacy personal endpoint stays denied after team initialization.
- Temporary passwords require a change before data access. Logout, account deactivation, role changes and password resets revoke affected sessions.
- A member cannot discover a private page through search, history, comments, relations, notifications, exports or guessed file IDs.
- A viewer cannot mutate content, files, sharing or comments through forged HTTP requests.
- Parent grants, direct grants and workspace roles produce the documented effective access. Stale sharing forms cannot restore revoked permissions.

## Editing and recovery

- Different-page writes from two sessions survive; same-page conflicts preserve the local draft.
- Polling and account switching do not apply stale state or expose the previous account's workspace.
- Comments, mentions, history restore and attachment downloads recheck current access.
- Table, board, calendar and list views operate on the same records. Viewer filtering generates no writes.
- Keyboard navigation, focus, mobile dialogs and save/error states remain usable.

## Operations

- Migration preserves synthetic page IDs and content and makes legacy pages private to the bootstrap owner.
- Restart retains accounts, pages, comments, history and file bytes.
- Backups contain every referenced file, a valid database and matching private configuration. Restored backups contain no live sessions.
- A deletion during an online snapshot triggers a complete retry rather than a partial archive.
- Backup reads run as the service user so SQLite sidecars retain correct ownership.
- Only team-aware releases can be activated after native-auth cutover. A code rollback does not reverse a database migration.

Document the commands and outcomes for the change under review. Keep real account identifiers, hostnames, backup keys and personal content out of public reports. These checks do not imply an external audit, high availability or realtime coediting.
