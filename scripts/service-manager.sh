#!/bin/bash
set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="${PROJECT_ROOT}/.runtime"
LOG_DIR="${PROJECT_ROOT}/logs"
PID_FILE="${RUNTIME_DIR}/case-system.pid"
LOG_FILE="${LOG_DIR}/case-system.log"
PORT="${DEPLOY_RUN_PORT:-5000}"

mkdir -p "${RUNTIME_DIR}" "${LOG_DIR}"

running_pid() {
    if [[ -f "${PID_FILE}" ]]; then
        local pid
        pid="$(cat "${PID_FILE}")"
        if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
            echo "${pid}"
            return 0
        fi
    fi
    return 1
}

port_pids() {
    ss -H -lntp 2>/dev/null \
        | awk -v port="${PORT}" '$4 ~ ":"port"$"' \
        | grep -o 'pid=[0-9]*' \
        | cut -d= -f2 \
        | sort -u || true
}

ensure_port_free() {
    local pids
    pids="$(port_pids | paste -sd' ' -)"
    if [[ -n "${pids}" ]]; then
        echo "Port ${PORT} is already in use by PID(s): ${pids}" >&2
        echo "Please stop the existing process before starting the managed service." >&2
        exit 1
    fi
}

start_service() {
    if pid="$(running_pid)"; then
        echo "Service is already running with PID ${pid}."
        return 0
    fi

    ensure_port_free

    cd "${PROJECT_ROOT}"
    setsid bash -lc "cd \"${PROJECT_ROOT}\" && exec bash \"${PROJECT_ROOT}/scripts/start.sh\"" >>"${LOG_FILE}" 2>&1 < /dev/null &
    local pid=$!
    echo "${pid}" > "${PID_FILE}"

    sleep 3
    if kill -0 "${pid}" 2>/dev/null; then
        echo "Service started with PID ${pid}. Log: ${LOG_FILE}"
        return 0
    fi

    echo "Service failed to start. Recent logs:" >&2
    tail -n 40 "${LOG_FILE}" >&2 || true
    rm -f "${PID_FILE}"
    exit 1
}

stop_service() {
    if ! pid="$(running_pid)"; then
        echo "Service is not running."
        rm -f "${PID_FILE}"
        return 0
    fi

    kill "${pid}" 2>/dev/null || true
    for _ in {1..10}; do
        if ! kill -0 "${pid}" 2>/dev/null; then
            rm -f "${PID_FILE}"
            echo "Service stopped."
            return 0
        fi
        sleep 1
    done

    kill -9 "${pid}" 2>/dev/null || true
    rm -f "${PID_FILE}"
    echo "Service force stopped."
}

status_service() {
    if pid="$(running_pid)"; then
        echo "Service is running with PID ${pid} on port ${PORT}."
        return 0
    fi

    echo "Service is not running."
    return 1
}

case "${1:-}" in
    build)
        cd "${PROJECT_ROOT}"
        bash "${PROJECT_ROOT}/scripts/build.sh"
        ;;
    start)
        start_service
        ;;
    stop)
        stop_service
        ;;
    restart)
        stop_service
        start_service
        ;;
    status)
        status_service
        ;;
    logs)
        touch "${LOG_FILE}"
        tail -n 100 -f "${LOG_FILE}"
        ;;
    *)
        echo "Usage: $0 {build|start|stop|restart|status|logs}" >&2
        exit 1
        ;;
esac
