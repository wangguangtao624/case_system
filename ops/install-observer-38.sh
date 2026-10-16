#!/bin/bash
set -Eeuo pipefail
hostname -I | tr ' ' '\n' | grep -qx '10.26.10.38' || exit 1
[[ "$(id -u)" == 0 ]] || exit 1
cat > /etc/systemd/system/case-system-observer.service <<'EOF'
[Unit]
Description=Case System backup observer dashboard (loopback only)
After=network-online.target
Wants=network-online.target
[Service]
User=casebackup
Group=casebackup
Environment=CASE_OPS_STATE=/var/lib/casebackup/ops-state
ExecStart=/usr/bin/python3 /var/lib/casebackup/tools/case_ops.py serve
Restart=on-failure
RestartSec=5
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=/var/lib/casebackup/ops-state
[Install]
WantedBy=multi-user.target
EOF
cat > /etc/systemd/system/case-system-observer-sample.service <<'EOF'
[Unit]
Description=Sample production and backup health from independent server
After=network-online.target
[Service]
Type=oneshot
User=casebackup
Group=casebackup
Environment=CASE_OPS_STATE=/var/lib/casebackup/ops-state
ExecStart=/usr/bin/python3 /var/lib/casebackup/tools/case_ops.py monitor
TimeoutStartSec=50
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=/var/lib/casebackup/ops-state
StandardOutput=null
EOF
cat > /etc/systemd/system/case-system-observer-sample.timer <<'EOF'
[Unit]
Description=Case System independent health sampling every minute
[Timer]
OnBootSec=30s
OnUnitActiveSec=60s
AccuracySec=5s
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now case-system-observer.service case-system-observer-sample.timer
systemctl start case-system-observer-sample.service
systemctl is-active case-system-observer.service case-system-observer-sample.timer
