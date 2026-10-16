#!/bin/bash
set -Eeuo pipefail
hostname -I | tr ' ' '\n' | grep -qx '10.26.10.38' || exit 1
[[ -f "$HOME/case-system/staging/current/.next/BUILD_ID" && -f "$HOME/case-system/staging/current/dist/server.js" ]] || { echo 'Build artifacts are required'; exit 1; }
mkdir -p "$HOME/.config/systemd/user"
cat > "$HOME/.config/systemd/user/case-system-staging.service" <<EOF
[Unit]
Description=Case System isolated staging (loopback port 5001)
After=network-online.target
StartLimitIntervalSec=60
StartLimitBurst=3
[Service]
WorkingDirectory=$HOME/case-system/staging/current
Environment=APP_WORKSPACE_PATH=$HOME/case-system/staging/current
Environment=APP_RUNTIME_ENV=PROD
Environment=NODE_ENV=production
Environment=HOSTNAME=127.0.0.1
Environment=PORT=5001
ExecStart=$HOME/case-system/runtime/node20/bin/node dist/server.js
Restart=on-failure
RestartSec=5
TimeoutStopSec=15
NoNewPrivileges=yes
PrivateTmp=yes
UMask=0077
MemoryMax=2G
[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now case-system-staging.service
systemctl --user is-active case-system-staging.service
