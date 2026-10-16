#!/bin/bash
set -Eeuo pipefail
hostname -I | tr ' ' '\n' | grep -qx '10.26.10.38' || { echo 'Development is allowed only on 38'; exit 1; }
cd "$(git rev-parse --show-toplevel)"
[[ -f data/platform.db ]] || { echo 'An isolated development database is required'; exit 1; }
export PATH="$HOME/case-system/runtime/node20/bin:$PATH"
export APP_WORKSPACE_PATH="$PWD" APP_RUNTIME_ENV=development NODE_ENV=development
export HOSTNAME=127.0.0.1 PORT=5002
exec pnpm exec tsx watch src/server.ts
