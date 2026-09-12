#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]] || exit 1
stage=${1:?private deployment staging directory required}
[[ "$stage" =~ ^/tmp/folio-deploy-[0-9]+$ ]] || exit 1
id folio >/dev/null 2>&1 || useradd --system --home-dir /var/lib/folio --shell /usr/sbin/nologin folio
install -d -o root -g root -m 755 /opt/folio /opt/folio/releases
install -d -o folio -g folio -m 700 /var/lib/folio
install -d -o root -g root -m 711 /etc/folio
install -d -o root -g root -m 700 /var/backups/folio
install -d -o root -g root -m 755 /var/www/folio-acme
if [[ -f /etc/folio/runtime.env ]]; then
    cmp /etc/folio/runtime.env "$stage/private/runtime.env" || { echo 'Existing runtime configuration differs; preserve and inspect it'; exit 1; }
else
    install -o root -g folio -m 640 "$stage/private/runtime.env" /etc/folio/runtime.env
    install -o root -g root -m 600 "$stage/private/proxy-key.conf" /etc/folio/proxy-key.conf
    install -o root -g www-data -m 640 "$stage/private/htpasswd" /etc/folio/htpasswd
fi
if [[ ! -f /var/lib/folio/workspace.sqlite ]]; then
    install -o folio -g folio -m 600 "$stage/private/initial.sqlite" /var/lib/folio/workspace.sqlite
fi
if [[ -f /etc/folio/backup.env ]]; then
    cmp /etc/folio/backup.env "$stage/private/backup.env" || { echo 'Existing backup configuration differs; preserve and inspect it'; exit 1; }
else
    install -o root -g root -m 600 "$stage/private/backup.env" /etc/folio/backup.env
fi
install -o root -g root -m 755 "$stage/scripts/health.py" /usr/local/bin/folio-health
install -o root -g root -m 755 "$stage/scripts/backup.sh" /usr/local/bin/folio-backup
install -o root -g root -m 644 "$stage/scripts/folio.service" /etc/systemd/system/folio.service
install -o root -g root -m 644 "$stage/scripts/folio-backup.service" /etc/systemd/system/folio-backup.service
install -o root -g root -m 644 "$stage/scripts/folio-backup.timer" /etc/systemd/system/folio-backup.timer
systemctl daemon-reload
systemctl enable folio
echo 'Folio service, private state and configuration prepared'
