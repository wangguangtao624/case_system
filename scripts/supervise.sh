#!/bin/bash
set -uo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RESTART_DELAY=2
CHILD_PID=""

stop_child() {
    if [[ -n "${CHILD_PID}" ]] && kill -0 "${CHILD_PID}" 2>/dev/null; then
        kill "${CHILD_PID}" 2>/dev/null || true
        wait "${CHILD_PID}" 2>/dev/null || true
    fi
    exit 0
}

trap stop_child SIGINT SIGTERM

while true; do
    STARTED_AT=$(date +%s)
    bash "${PROJECT_ROOT}/scripts/start.sh" &
    CHILD_PID=$!
    wait "${CHILD_PID}"
    EXIT_CODE=$?
    CHILD_PID=""

    RUNTIME_SECONDS=$(( $(date +%s) - STARTED_AT ))
    if (( RUNTIME_SECONDS >= 60 )); then
        RESTART_DELAY=2
    fi

    echo "[$(date --iso-8601=seconds)] Server exited with code ${EXIT_CODE} after ${RUNTIME_SECONDS}s; restarting in ${RESTART_DELAY}s."
    sleep "${RESTART_DELAY}"
    if (( RESTART_DELAY < 30 )); then
        RESTART_DELAY=$((RESTART_DELAY * 2))
        (( RESTART_DELAY > 30 )) && RESTART_DELAY=30
    fi
done
