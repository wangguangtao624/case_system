#!/bin/bash
set -Eeuo pipefail

COZE_WORKSPACE_PATH="${COZE_WORKSPACE_PATH:-$(pwd)}"

PORT=5000
DEPLOY_RUN_PORT="${DEPLOY_RUN_PORT:-$PORT}"
COZE_PROJECT_ENV="${COZE_PROJECT_ENV:-PROD}"
NODE_ENV="${NODE_ENV:-production}"

resolve_node_bin() {
    if command -v node >/dev/null 2>&1; then
        command -v node
        return
    fi

    if [[ -s "${HOME}/.nvm/nvm.sh" ]]; then
        # shellcheck disable=SC1090
        source "${HOME}/.nvm/nvm.sh"
    fi

    if command -v node >/dev/null 2>&1; then
        command -v node
        return
    fi

    echo "node command not found. Please ensure Node.js is installed and available." >&2
    exit 1
}


start_service() {
    cd "${COZE_WORKSPACE_PATH}"
    echo "Starting HTTP service on port ${DEPLOY_RUN_PORT} for deploy..."
    local node_bin
    node_bin="$(resolve_node_bin)"
    exec env PORT="${DEPLOY_RUN_PORT}" \
    COZE_PROJECT_ENV="${COZE_PROJECT_ENV}" \
    NODE_ENV="${NODE_ENV}" \
    "${node_bin}" dist/server.js
}

echo "Starting HTTP service on port ${DEPLOY_RUN_PORT} for deploy..."
start_service
