#!/bin/bash
# Run with sudo ONLY on development/backup server 10.26.10.38.
set -Eeuo pipefail
hostname -I | tr ' ' '\n' | grep -qx '10.26.10.38' || { echo 'Wrong host'; exit 1; }
[[ "$(id -u)" == 0 ]] || { echo 'Run with sudo'; exit 1; }
if ! id casebackup >/dev/null 2>&1; then
    useradd --system --create-home --home-dir /var/lib/casebackup --shell /bin/bash casebackup
fi
install -d -m 755 /srv/case-system
install -d -m 700 -o casebackup -g casebackup /srv/case-system/backups
install -d -m 700 -o casebackup -g casebackup /var/lib/casebackup/.ssh
touch /var/lib/casebackup/.ssh/authorized_keys
KEY='from="10.26.10.12",restrict ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMLxGsTcpRpRnjCaI+PFaImGTKmwsXWs3trFLsIQmpmV case-system-12-to-38-ops'
grep -qxF "$KEY" /var/lib/casebackup/.ssh/authorized_keys || printf '%s\n' "$KEY" >> /var/lib/casebackup/.ssh/authorized_keys
chown casebackup:casebackup /var/lib/casebackup/.ssh/authorized_keys
chmod 600 /var/lib/casebackup/.ssh/authorized_keys
echo 'Backup account created; development user cannot read or change backup snapshots.'
