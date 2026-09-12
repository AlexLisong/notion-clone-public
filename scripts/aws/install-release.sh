#!/usr/bin/env bash
set -euo pipefail
archive=${1:?release archive required}
[[ $EUID -eq 0 ]] || exit 1
release_name=$(basename "$archive" .tar.gz)
[[ "$release_name" =~ ^folio-[0-9]{8}T[0-9]{6}Z$ ]] || exit 1
release_root="/opt/folio/releases/$release_name"
test ! -e "$release_root"
python3 - "$archive" "$release_name" <<'PY'
import hashlib, json, pathlib, sys, tarfile
archive, name = sys.argv[1:]
base = pathlib.Path('/opt/folio/releases')
with tarfile.open(archive) as tar:
    for item in tar.getmembers():
        path = pathlib.PurePosixPath(item.name)
        assert not path.is_absolute() and path.parts[0] == name and '..' not in path.parts
        assert item.isfile() or item.isdir(), 'No special files or links in release'
    tar.extractall(base, filter='data')
root = base / name
metadata = json.loads((root / 'release.json').read_text())
assert metadata['release'] == name
if pathlib.Path('/etc/folio/team-auth-enabled').exists():
    assert metadata.get('authVersion', 0) >= 1, 'Cannot activate pre-team code after native auth cutover'
actual = {str(p.relative_to(root)) for p in root.rglob('*') if p.is_file()} - {'release.json'}
assert actual == set(metadata['sha256']), 'Release file inventory mismatch'
for relative, expected in metadata['sha256'].items():
    assert hashlib.sha256((root / relative).read_bytes()).hexdigest() == expected, relative
PY
chown -R root:root "$release_root"
chmod -R go-w "$release_root"
previous=$(readlink -f /opt/folio/current || true)
healthy() {
    for attempt in {1..15}; do
        if /usr/local/bin/folio-health >/dev/null 2>&1; then return 0; fi
        sleep 1
    done
    return 1
}
ln -s "$release_root" /opt/folio/.next-release
mv -Tf /opt/folio/.next-release /opt/folio/current
if systemctl restart folio && healthy; then
    echo "Activated $release_name"
else
    if [[ -n "$previous" && "$previous" != /opt/folio/current && -d "$previous" ]]; then
        if [[ -f /etc/folio/team-auth-enabled ]] && ! python3 - "$previous/release.json" <<'PYGUARD'
import json, sys
assert json.load(open(sys.argv[1])).get('authVersion', 0) >= 1
PYGUARD
        then
            systemctl stop folio
            echo 'Unsafe pre-team rollback refused; native access remains protected'
            exit 1
        fi
        ln -s "$previous" /opt/folio/.rollback
        mv -Tf /opt/folio/.rollback /opt/folio/current
        systemctl restart folio
        healthy || { echo 'Rollback health failed'; exit 1; }
    else
        systemctl stop folio
    fi
    echo 'Release failed; previous code restored when available'
    exit 1
fi
