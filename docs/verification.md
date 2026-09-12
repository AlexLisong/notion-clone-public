# Verification guide

Use Node 22 and disposable data. Passing a suite establishes its tested behavior, not complete security coverage or compatibility with every input.

## Automated checks

```sh
npm run typecheck
npm run lint
npm test
npm run setup
npm run build
npm run build:aws
npm run test:aws
npm run test:aws:team
```

Run personal and standalone builds sequentially because both generate `.next` route types. The unit suite covers page-tree invariants, import validation, Markdown/CSV safety, autosave races, conflict recovery and team permissions. The standalone checks start isolated servers with temporary databases and verify assets, proxy/origin boundaries, account authentication and page access.

With a disposable personal server running, use `FOLIO_TEST_URL=http://127.0.0.1:5183 npm run test:api`. This creates/removes a fixture page and advances the workspace revision. Reload open tabs afterward.

## Browser checks

Use a synthetic workspace. Verify create/edit/save/reload, slash-menu keyboard navigation, nested pages, search, templates, Trash restore, exports and each database view. At a mobile viewport, check overflow, dialogs and sidebar focus. For team changes use separate owner/member/viewer sessions and follow [team verification](verification-team.md).

## Self-hosted releases

Run the checks against the candidate release, then verify authenticated and anonymous API boundaries, restart persistence and a backup restored into a disposable app. Use the [operations guide](aws.md). Keep raw deployment reports, credentials, screenshots of real notes and backup inventories private; public evidence should use synthetic data and describe outcomes without identifying an installation.

React test-renderer deprecation notices, Node SQLite experimental notices and bundle-size advisories may appear. Treat command failures and application errors separately from upstream notices.
