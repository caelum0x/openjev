#!/usr/bin/env bash
#
# laya-entrypoint.sh — container entrypoint for the laya-onnx sidecar.
#
# 1. Download the ONNX weights on first boot (unless LAYA_SKIP_DOWNLOAD=1 or a
#    LAYA_MODEL_PATH is already provided / present).
# 2. Launch the HTTP sidecar (scripts/laya_sidecar.py), which serves the same
#    /health + /v1/systemone contract the Node service talks to.
#
set -euo pipefail

export LAYA_BACKEND="${LAYA_BACKEND:-onnx}"
export LAYA_HOST="${LAYA_HOST:-0.0.0.0}"
export LAYA_PORT="${LAYA_PORT:-8092}"
export LAYA_DEST="${LAYA_DEST:-/models}"
VARIANT="${LAYA_MODEL:-base}"

RESOLVED_PATH="${LAYA_MODEL_PATH:-${LAYA_DEST}/laya-${LAYA_BACKEND}-${VARIANT}}"

if [[ "${LAYA_SKIP_DOWNLOAD:-0}" != "1" && ! -d "${RESOLVED_PATH}" ]]; then
  echo "[laya] downloading weights (backend=${LAYA_BACKEND} variant=${VARIANT}) ..."
  bash /app/scripts/laya-download.sh
fi

# The sidecar reads LAYA_MODEL_PATH; point it at the resolved local dir if present.
if [[ -d "${RESOLVED_PATH}" ]]; then
  export LAYA_MODEL_PATH="${RESOLVED_PATH}"
fi

echo "[laya] starting sidecar on http://${LAYA_HOST}:${LAYA_PORT} (model=${LAYA_MODEL_PATH:-<hub default>})"
exec python3 /app/scripts/laya_sidecar.py
