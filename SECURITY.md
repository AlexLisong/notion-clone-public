# Security policy

Security fixes target the latest code on the default branch. This early-stage project does not currently maintain older release branches or promise a response deadline.

## Report privately

Use GitHub's **Security → Report a vulnerability** for this repository if that option is available. If private reporting is unavailable, open an issue titled **Private security contact requested** containing only a request for a private channel. A maintainer will arrange one before you share details. Do not put exploit details, credentials, personal data or private vault/workspace files in a public issue or pull request.

Include the affected revision, a minimal synthetic reproduction, expected and actual behavior, potential impact, and any proposed fix. Share only the information needed to reproduce the issue. Allow time for coordinated investigation and a fix before public disclosure.

## Development boundaries

Use disposable accounts and synthetic data. Keep runtime environments, databases, backups, device pairings and browser session state out of Git. Test access controls at the API boundary as well as in the interface. Report accidental credential exposure privately and revoke affected credentials; deleting a file does not remove it from Git history.

Team pages are not end-to-end encrypted. Owners and admins can read all pages. The loopback personal runtime has no account boundary and must not be exposed as a shared server.

This policy is not a security certification or a claim that private vulnerability reporting has been enabled on GitHub.

## Known dependency limitation

As of 2026-09-12, `npm audit` reports four moderate entries for one development-only chain: `drizzle-kit` → `@esbuild-kit/esm-loader` → `@esbuild-kit/core-utils` → `esbuild` ([GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99)). The advisory concerns esbuild's development server accepting cross-origin requests; normal Folio app commands and migration generation do not start that server. Avoid exposing auxiliary development servers and keep the toolchain updated.

The current stable migration tool has no compatible upstream fix for this chain. npm proposes a breaking downgrade, which is not applied automatically. Production dependency auditing reports no known advisories at this check; rerun audits before releases because advisory data changes.
