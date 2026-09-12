# Contributing to Folio

Thank you for helping improve Folio. Documentation, reproducible bug reports, accessibility fixes and small code improvements are useful contributions. Read the [Code of Conduct](CODE_OF_CONDUCT.md) and use the [security policy](SECURITY.md) for private reports.

## Local setup

Fork the repository, clone your fork and create a branch for one change. Use Node 22 (`nvm use`), then `npm ci`, `npm run setup` and `npm run dev`. The personal app opens at `http://127.0.0.1:5183`. Setup is repeatable; keep `.wrangler/state` and `.data` private.

For accounts, permissions or attachments, use the [local team runtime](docs/aws.md#local-team-development). Do not run tests against a shared or personal workspace. Unit and standalone API suites use disposable data; the personal `test:api` suite changes its target workspace revision.

## Find the right place

| Area | Files |
| --- | --- |
| Page schema, tree operations, import/export | `lib/folio/model.ts`, `lib/folio/database-utils.ts` |
| Autosave and conflict handling | `lib/folio/use-workspace.ts`, `lib/folio/team-sync.ts` |
| Editor and database UI | `components/folio/` |
| Team authentication and permission transactions | `lib/server/team-auth.ts`, `team-db.ts`, `team-pages.ts`, `team-node.ts` |
| Personal storage adapters | `lib/server/workspace-storage.ts`, `storage-node.ts`, `db/` |
| HTTP contracts and regression cases | `tests/`, `scripts/aws/verify*.mjs` |

Read [architecture](docs/architecture.md) before changing storage or synchronization. Access checks must happen on the server within the transaction; hiding a control in the UI is not authorization. Preserve import compatibility, revision checks and recovery of unsaved drafts.

## Propose and review a change

1. Search existing issues. For larger features or schema changes, open an issue describing the user problem, scope, alternatives and compatibility before writing code.
2. Keep the change focused and match the surrounding TypeScript style. Avoid unrelated formatting and new dependencies without a concrete need.
3. Add regression coverage for changed behavior, especially permissions, revision races and data recovery. Update the user guide or architecture where behavior changes.
4. Run the relevant checks below and open a pull request with the problem, resulting behavior, verification and any remaining limits. Use synthetic data in screenshots and logs.
5. Respond to review; maintainers decide scope and merge readiness. There is no guaranteed review deadline or separate CLA process.

By contributing, you agree that your contribution is available under the project's MIT license. Include attribution and original license terms for third-party material.

## Checks

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run build:aws
npm run test:aws
npm run test:aws:team
```

Run the builds sequentially because they share generated route types. With a disposable personal server running, run `FOLIO_TEST_URL=http://127.0.0.1:5183 npm run test:api`. For UI changes, verify desktop and mobile widths, keyboard controls, focus, save/reload and error states. CI runs both runtime paths. Documentation-only changes need link/example review rather than new implementation tests.

Good first contributions include a minimal regression case for a reported bug, keyboard/focus fixes, more precise error messages and clearer setup docs. New collaboration protocols, authentication providers and schema redesigns should be discussed first.
