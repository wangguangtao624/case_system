#!/bin/bash
set -Eeuo pipefail

PROJECT_ROOT="${APP_WORKSPACE_PATH:-${COZE_WORKSPACE_PATH:-$(pwd)}}"

cd "${PROJECT_ROOT}"

echo "Installing dependencies..."
pnpm install --prefer-frozen-lockfile --prefer-offline --loglevel debug --reporter=append-only
