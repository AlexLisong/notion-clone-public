#!/usr/bin/env bash
set -euo pipefail
umask 077
# Operator-owned settings; never source configuration from a checkout.
source /etc/folio/backup.env
: "${FOLIO_BACKUP_BUCKET:?Configure the private backup bucket}"
: "${FOLIO_BACKUP_REGION:?Configure the backup region}"
: "${FOLIO_NGINX_CONFIG:?Configure the nginx site file}"
backup_root=/var/backups/folio
install -d -m 700 "$backup_root"
exec 9>"$backup_root/.lock"
flock -n 9 || exit 0
stage=$(mktemp -d "$backup_root/.stage.XXXXXX")
snapshot=$(runuser -u folio -- mktemp -d /var/lib/folio/.backup.XXXXXX)
trap 'rm -rf "$stage" "$snapshot"' EXIT
runuser -u folio -- python3 - "$snapshot" <<'PYBACKUP'
import pathlib, shutil, sqlite3, sys, time
from contextlib import closing
stage = pathlib.Path(sys.argv[1])
source_root = pathlib.Path('/var/lib/folio/uploads')
for attempt in range(3):
    try:
        target_file = stage / 'workspace.sqlite'
        if target_file.exists(): target_file.unlink()
        shutil.rmtree(stage / 'uploads', ignore_errors=True)
        with closing(sqlite3.connect('file:/var/lib/folio/workspace.sqlite?mode=ro', uri=True)) as source:
            with closing(sqlite3.connect(target_file)) as target:
                source.backup(target)
                assert target.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
                if target.execute("SELECT name FROM sqlite_master WHERE name='team_sessions'").fetchone():
                    target.execute('DELETE FROM team_sessions')
                    target.commit()
                if target.execute("SELECT name FROM sqlite_master WHERE name='team_files'").fetchone():
                    (stage / 'uploads').mkdir(mode=0o700)
                    for file_id, size in target.execute('SELECT id,size FROM team_files'):
                        assert all(c in '0123456789abcdef-' for c in file_id) and len(file_id) == 36
                        original = source_root / file_id
                        assert not original.is_symlink()
                        shutil.copyfile(original, stage / 'uploads' / file_id)
                        assert (stage / 'uploads' / file_id).stat().st_size == size
        break
    except FileNotFoundError:
        # Concurrent deletion can race an online snapshot. Retry the entire
        # snapshot; never publish an archive with a missing referenced file.
        if attempt == 2: raise
        time.sleep(0.2)
PYBACKUP
mv "$snapshot/workspace.sqlite" "$stage/workspace.sqlite"
if [[ -d "$snapshot/uploads" ]]; then mv "$snapshot/uploads" "$stage/uploads"; fi
chown -R root:root "$stage"
chmod 600 "$stage/workspace.sqlite"
cp /etc/folio/runtime.env /etc/folio/htpasswd /etc/folio/proxy-key.conf "$stage/"
cp /opt/folio/current/release.json "$stage/"
cp "$FOLIO_NGINX_CONFIG" "$stage/nginx.conf"
if [[ -f /etc/folio/team-auth-enabled ]]; then cp /etc/folio/team-auth-enabled "$stage/"; fi
archive="$backup_root/folio-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
tar -C "$stage" -czf "$archive.partial" .
mv "$archive.partial" "$archive"
aws s3 cp "$archive" "s3://$FOLIO_BACKUP_BUCKET/backups/" --region "$FOLIO_BACKUP_REGION" --sse AES256 --only-show-errors
find "$backup_root" -maxdepth 1 -type f -name 'folio-*.tar.gz' -mtime +14 -delete
echo 'Folio backup uploaded'
