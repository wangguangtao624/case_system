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
        if [[ "${pid}" =~ ^[0-9]+$ ]] \
            && kill -0 "${pid}" 2>/dev/null \
            && [[ "$(readlink -f "/proc/${pid}/cwd" 2>/dev/null || true)" == "${PROJECT_ROOT}" ]] \
            && tr '\0' ' ' < "/proc/${pid}/cmdline" 2>/dev/null | grep -q 'scripts/supervise.sh'; then
            echo "${pid}"
            return 0
        fi
        rm -f "${PID_FILE}"
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

service_healthy() {
    curl --fail --silent --show-error --max-time 2 \
        "http://127.0.0.1:${PORT}/login" >/dev/null 2>&1
}

rotate_log() {
    if [[ -f "${LOG_FILE}" ]] && (( $(stat -c%s "${LOG_FILE}") > 10485760 )); then
        mv "${LOG_FILE}" "${LOG_FILE}.1"
    fi
}

start_service() {
    if pid="$(running_pid)"; then
        echo "Service is already running with PID ${pid}."
        return 0
    fi

    ensure_port_free
    rotate_log

    cd "${PROJECT_ROOT}"
    setsid bash "${PROJECT_ROOT}/scripts/supervise.sh" >>"${LOG_FILE}" 2>&1 < /dev/null &
    local pid=$!
    echo "${pid}" > "${PID_FILE}"

    for _ in {1..30}; do
        if ! kill -0 "${pid}" 2>/dev/null; then
            break
        fi
        if service_healthy; then
            echo "Service started with PID ${pid}. Log: ${LOG_FILE}"
            return 0
        fi
        sleep 1
    done

    echo "Service failed its startup health check. Recent logs:" >&2
    tail -n 40 "${LOG_FILE}" >&2 || true
    if kill -0 "${pid}" 2>/dev/null; then
        kill -- "-${pid}" 2>/dev/null || kill "${pid}" 2>/dev/null || true
    fi
    rm -f "${PID_FILE}"
    exit 1
}

stop_service() {
    if ! pid="$(running_pid)"; then
        echo "Service is not running."
        rm -f "${PID_FILE}"
        return 0
    fi

    kill -- "-${pid}" 2>/dev/null || kill "${pid}" 2>/dev/null || true
    for _ in {1..10}; do
        if ! kill -0 "${pid}" 2>/dev/null; then
            rm -f "${PID_FILE}"
            echo "Service stopped."
            return 0
        fi
        sleep 1
    done

    kill -9 -- "-${pid}" 2>/dev/null || kill -9 "${pid}" 2>/dev/null || true
    rm -f "${PID_FILE}"
    echo "Service force stopped."
}

status_service() {
    if pid="$(running_pid)"; then
        if service_healthy; then
            echo "Service is healthy with PID ${pid} on port ${PORT}."
            return 0
        fi
        echo "Service process ${pid} is running but its health check failed." >&2
        return 1
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
