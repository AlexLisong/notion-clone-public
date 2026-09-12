# Self-hosting and recovery

The repository includes a native Node/SQLite team runtime and optional Linux/nginx/systemd tooling under `scripts/aws/`. The directory name and npm script names identify a supported deployment path; they do not describe any current installation. All domains below are examples. Operators supply their own hosts, credentials and backup destinations outside source control.

## Local team development

Use Node 22 and a disposable directory. Create a private `.env.team.local` file (ignored by Git):

```dotenv
FOLIO_RUNTIME=aws
FOLIO_TEAM_AUTH=1
FOLIO_TEAM_DEV=1
FOLIO_PUBLIC_ORIGIN=http://127.0.0.1:4320
FOLIO_DB_PATH=/absolute/path/to/disposable/folio/workspace.sqlite
FOLIO_UPLOAD_PATH=/absolute/path/to/disposable/folio/uploads
FOLIO_OWNER_USERNAME=owner
FOLIO_OWNER_NAME=Local Owner
FOLIO_OWNER_PASSWORD=replace-with-a-private-password
```

Choose a new password of 12–128 characters. Create the parent data directory, then start Next's webpack dev server:

```sh
node --env-file=.env.team.local node_modules/next/dist/bin/next dev --webpack --hostname 127.0.0.1 --port 4320
```

Open `http://127.0.0.1:4320`, sign in and change the temporary password. The development bypass accepts only an exact loopback HTTP origin and is rejected when `NODE_ENV=production`. Vinext's default personal runtime is separate. Do not run the two builds concurrently.

## Server requirements and configuration

The optional scripts assume a Linux host with Node 22, Python 3.11+, nginx, systemd, AWS CLI, HTTPS certificates and an isolated `folio` Unix user. Releases use `/opt/folio/releases` and `/opt/folio/current`; private state uses `/var/lib/folio`, owned by `folio` with directories 0700 and files 0600. These are tooling defaults, not a record of an existing server.

Supply `/etc/folio/runtime.env` privately, root:folio mode 0640:

```dotenv
NODE_ENV=production
HOSTNAME=127.0.0.1
PORT=4320
FOLIO_PUBLIC_ORIGIN=https://folio.example.com
FOLIO_PROXY_KEY=replace-with-a-private-random-proxy-key
FOLIO_DB_PATH=/var/lib/folio/workspace.sqlite
FOLIO_UPLOAD_PATH=/var/lib/folio/uploads
FOLIO_TEAM_AUTH=1
FOLIO_OWNER_USERNAME=owner
FOLIO_OWNER_PASSWORD=replace-with-a-private-bootstrap-password
```

Replace the example origin and secrets. Configure `/etc/folio/proxy-key.conf` as a root-only nginx include that overwrites `X-Folio-Proxy-Key` with the same private key. Adapt `scripts/aws/nginx.conf` to your domain/certificates; do not install it unchanged. Keep the listener on loopback, overwrite forwarded host/protocol headers and deny `/api/workspace`. The app also enforces the proxy key, exact origin, native session and intended-account header on mutations.

After bootstrap/login, remove the bootstrap password from the runtime environment. Keep `/etc/folio/team-auth-enabled` to prevent activating pre-team releases after native authentication. New team installs and upgrades need operator review: `bootstrap.sh` expects a prepared private staging directory, an initial database, proxy configuration and a legacy recovery `htpasswd` file. It is not an unattended cloud provisioning command.

## Build and release

Run `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build:aws`, `npm run test:aws` and `npm run test:aws:team`. Then package with:

```sh
python3 scripts/aws/package-release.py
```

The packager allowlists standalone output/public assets, rejects private paths and links, records the source revision and hashes each runtime file. Transfer the archive using an authenticated connection, verify its SHA256, and invoke `scripts/aws/install-release.sh` on the chosen host. The installer checks the archive, selects the release, restarts the service and runs its private health check. Validate nginx before reloading it.

Verify public sign-in, anonymous team denial, legacy endpoint denial, native login, save/reload and restart persistence. Keep results free of private account/page data. A code rollback must select a compatible `authVersion >= 1` release and recheck health; it does not undo schema changes or restore data.

## Backups

Copy `scripts/aws/backup.env.example` to `/etc/folio/backup.env`, replace its bucket/region/nginx-path values and make it root-owned mode 0600. The backup helper fails if this private file or a required value is missing. Existing installations must add this file before adopting the updated helper.

Configure a private S3 bucket with public access blocked, TLS required, encryption, versioning and retention appropriate to your needs. Give the backup role only the required write permissions; use separate recovery credentials. No account, bucket or role is provisioned automatically by Folio.

`folio-backup.timer` runs the provided helper daily. It snapshots SQLite as the service user, checks integrity, removes sessions from the backup copy and copies every referenced attachment. A concurrent file deletion retries the complete snapshot. It packages matching runtime/proxy/recovery configuration, nginx settings and the auth marker. Archives contain secrets and plaintext workspace content and must stay private. Local archives are retained for 14 days; configure off-server retention separately.

## Restore procedure

1. Download an off-server backup into private disposable storage. Verify the database integrity, every referenced file and matching private configuration before using it.
2. Preserve current data, stop the service and keep its database/WAL/SHM together. Never copy a restored database over active or stale WAL files.
3. Restore the database and matching uploads from one archive; restore private runtime/proxy/nginx configuration with the required owners and modes. Keep or recreate the team-auth marker.
4. Ensure restored `team_sessions` is empty. Review restored account roles and reset affected credentials after an incident.
5. Start a compatible team-aware release; check `/usr/local/bin/folio-health`, database/sidecar ownership, native login, page access and attachment bytes. Re-enable backups and verify a new off-server archive.

This is a single-instance design without automatic failover. Test recovery on your installation before relying on it. See [team verification](verification-team.md) for migration, permission and rollback scenarios.
