#!/usr/bin/env bash
#
# laya-sidecar-start.sh — start the Laya neural sidecar on a host (no Docker),
# with a health gate.
#
# This is the documented self-host path for the neural backend the playground
# calls `laya-onnx` / `laya-mlx`. It:
#   1. resolves the backend (mlx on Apple Silicon, onnx elsewhere) and model dir,
#   2. downloads / distils the weights if the model dir is missing,
#   3. launches scripts/laya_sidecar.py,
#   4. polls the sidecar's /health until it reports ok (or times out), so you get
#      an explicit PASS/FAIL instead of a process that "started" but can't serve.
#
# When this reports healthy, GET /api/v1/status on the Node service flips the
# corresponding model from "install" to selectable, and requests stop falling
# back to the local engine.
#
# Usage:
#   scripts/laya-sidecar-start.sh                 # backend auto, port 8092
#   LAYA_BACKEND=onnx scripts/laya-sidecar-start.sh
#   LAYA_PORT=8092 LAYA_HOST=127.0.0.1 scripts/laya-sidecar-start.sh
#   LAYA_SKIP_DOWNLOAD=1 scripts/laya-sidecar-start.sh   # reuse existing weights
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# --- resolve backend (mirror laya.server.ts / laya-download.sh auto-select) ---
BACKEND="${LAYA_BACKEND:-}"
if [[ -z "${BACKEND}" ]]; then
  if [[ "$(uname -s)" == "Darwin" ]]; then BACKEND="mlx"; else BACKEND="onnx"; fi
fi
export LAYA_BACKEND="${BACKEND}"

export LAYA_HOST="${LAYA_HOST:-127.0.0.1}"
export LAYA_PORT="${LAYA_PORT:-8092}"
export LAYA_DEST="${LAYA_DEST:-${REPO_DIR}/models}"
VARIANT="${LAYA_MODEL:-base}"

RESOLVED_PATH="${LAYA_MODEL_PATH:-${LAYA_DEST}/laya-${BACKEND}-${VARIANT}}"

# --- 1/2. ensure weights are present -----------------------------------------
if [[ "${LAYA_SKIP_DOWNLOAD:-0}" != "1" && ! -d "${RESOLVED_PATH}" ]]; then
  echo "[laya] weights not found at ${RESOLVED_PATH}"
  echo "[laya] fetching (backend=${BACKEND} variant=${VARIANT}) ..."
  bash "${SCRIPT_DIR}/laya-download.sh"
fi

if [[ -d "${RESOLVED_PATH}" ]]; then
  export LAYA_MODEL_PATH="${RESOLVED_PATH}"
fi

# --- 3. launch the sidecar ----------------------------------------------------
PYTHON_BIN="${PYTHON_BIN:-python3}"
echo "[laya] starting sidecar: ${PYTHON_BIN} scripts/laya_sidecar.py"
echo "[laya]   backend=${BACKEND} host=${LAYA_HOST} port=${LAYA_PORT} model=${LAYA_MODEL_PATH:-<hub default>}"
"${PYTHON_BIN}" "${SCRIPT_DIR}/laya_sidecar.py" &
SIDECAR_PID=$!

cleanup() {
  if kill -0 "${SIDECAR_PID}" 2>/dev/null; then
    kill "${SIDECAR_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

# --- 4. health gate -----------------------------------------------------------
HEALTH_URL="http://${LAYA_HOST}:${LAYA_PORT}/health"
DEADLINE=$(( $(date +%s) + ${LAYA_HEALTH_TIMEOUT:-60} ))
echo "[laya] waiting for health at ${HEALTH_URL} ..."
while true; do
  if ! kill -0 "${SIDECAR_PID}" 2>/dev/null; then
    echo "[laya] FAIL: sidecar process exited before becoming healthy." >&2
    wait "${SIDECAR_PID}" || true
    exit 1
  fi
  BODY="$(curl -fsS --max-time 2 "${HEALTH_URL}" 2>/dev/null || true)"
  if [[ "${BODY}" == *'"ok": true'* || "${BODY}" == *'"ok":true'* ]]; then
    echo "[laya] PASS: sidecar healthy — ${BODY}"
    break
  fi
  if [[ "$(date +%s)" -ge "${DEADLINE}" ]]; then
    echo "[laya] FAIL: sidecar did not report healthy within the timeout." >&2
    [[ -n "${BODY}" ]] && echo "[laya] last /health: ${BODY}" >&2
    exit 1
  fi
  sleep 1
done

echo "[laya] ready. Point the Node service at LAYA_ENGINE_URL=http://${LAYA_HOST}:${LAYA_PORT}"
echo "[laya] press Ctrl-C to stop."
# Keep the sidecar in the foreground so this script's lifetime == the sidecar's.
wait "${SIDECAR_PID}"
