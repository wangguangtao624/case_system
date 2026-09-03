#!/bin/bash
set -Eeuo pipefail


PORT=5000
PROJECT_ROOT="${APP_WORKSPACE_PATH:-${COZE_WORKSPACE_PATH:-$(pwd)}}"
DEPLOY_RUN_PORT=5000
RUNTIME_DIR="${PROJECT_ROOT}/.runtime"
LOCK_FILE="${RUNTIME_DIR}/case-system-dev.lock"

cd "${PROJECT_ROOT}"
mkdir -p "${RUNTIME_DIR}"

ensure_single_instance() {
    exec 9>"${LOCK_FILE}"
    if ! flock -n 9; then
      echo "Another development server is already running for this workspace." >&2
      exit 1
    fi
}

ensure_port_free() {
    local pids
    pids=$(ss -H -lntp 2>/dev/null | awk -v port="${DEPLOY_RUN_PORT}" '$4 ~ ":"port"$"' | grep -o 'pid=[0-9]*' | cut -d= -f2 | paste -sd' ' - || true)
    if [[ -z "${pids}" ]]; then
      echo "Port ${DEPLOY_RUN_PORT} is free."
      return
    fi
    echo "Port ${DEPLOY_RUN_PORT} is already in use by PID(s): ${pids}." >&2
    echo "Stop the existing service before starting development mode." >&2
    exit 1
}

ensure_single_instance
ensure_port_free
echo "Starting HTTP service on port ${PORT} for dev..."

exec env PORT="${PORT}" pnpm tsx watch src/server.ts
