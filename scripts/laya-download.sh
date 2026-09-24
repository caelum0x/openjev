#!/usr/bin/env bash
#
# laya-download.sh — fetch Laya typed-decision weights from Hugging Face.
#
# The published Laya checkpoints live under the aac6fef account (named in
# laya-mlx/README.md), mirroring upstream convaiinnovations/laya:
#
#     mlx  : aac6fef/laya-mlx | aac6fef/laya-multilingual-mlx | aac6fef/laya-typed-decisions-mlx
#     onnx : produced by exporting those checkpoints to ONNX. Override the source
#            repo with LAYA_ONNX_REPO if you publish/host your own ONNX export.
#
# The MLX backend loads the safetensors checkpoints directly. The ONNX backend
# (laya_sidecar.py) needs a `model.onnx` graph alongside the tokenizer + configs;
# this script downloads the repo and then VERIFIES a `.onnx` file is present,
# failing clean (exit 3) if it is not — so nobody boots the sidecar against a
# checkpoint that has no ONNX graph to run.
#
#   ./scripts/laya-download.sh                       # backend from LAYA_BACKEND
#   LAYA_BACKEND=mlx ./scripts/laya-download.sh
#   LAYA_MODEL=multilingual ./scripts/laya-download.sh
#   LAYA_ONNX_REPO=youracct/laya-onnx ./scripts/laya-download.sh
#   LAYA_DEST=./models ./scripts/laya-download.sh
#
set -euo pipefail

# --- resolve backend (mirror laya.server.ts auto-select) --------------------
BACKEND="${LAYA_BACKEND:-}"
if [[ -z "$BACKEND" ]]; then
  if [[ "$(uname -s)" == "Darwin" ]]; then BACKEND="mlx"; else BACKEND="onnx"; fi
fi

# --- resolve variant: base | multilingual | typed-decisions ----------------
VARIANT="${LAYA_MODEL:-base}"

# HF repos named in laya-mlx/README.md (aac6fef account).
case "$BACKEND" in
  mlx)
    case "$VARIANT" in
      base)            REPO="aac6fef/laya-mlx" ;;
      multilingual)    REPO="aac6fef/laya-multilingual-mlx" ;;
      typed-decisions) REPO="aac6fef/laya-typed-decisions-mlx" ;;
      *) echo "Unknown LAYA_MODEL='$VARIANT' (base|multilingual|typed-decisions)" >&2; exit 1 ;;
    esac
    ;;
  onnx)
    # ONNX source. There is NO public Laya ONNX checkpoint: laya-mlx exports only
    # MLX safetensors, and aac6fef/laya-onnx does not exist on the Hub. So unless
    # you host your own ONNX export (LAYA_ONNX_REPO), we PRODUCE a compact,
    # CPU-runnable distilled model locally (scripts/laya_distill.py) that matches
    # the sidecar's exact ONNX I/O contract. This is a real trained model — it is
    # never a fabricated/placeholder graph.
    if [[ -n "${LAYA_ONNX_REPO:-}" ]]; then
      REPO="$LAYA_ONNX_REPO"        # hosted ONNX export: download it
    else
      DISTILL=1                     # no hosted export: distil locally
    fi
    ;;
  *)
    echo "Unknown LAYA_BACKEND='$BACKEND' (expected 'mlx' or 'onnx')" >&2
    exit 1
    ;;
esac

DEST="${LAYA_DEST:-./models}/laya-${BACKEND}-${VARIANT}"

echo "Laya download"
echo "  backend : $BACKEND"
echo "  variant : $VARIANT"
echo "  repo    : ${REPO:-"(none — distil locally)"}"
echo "  dest    : $DEST"

# --- distil path: no hosted ONNX export → train a compact model locally -------
if [[ "${DISTILL:-0}" == "1" ]]; then
  echo ""
  echo "No hosted ONNX checkpoint (aac6fef/laya-onnx is absent on the Hub, and"
  echo "laya-mlx exports MLX only). Producing a compact distilled ONNX model."
  echo "Requires: python3 with torch>=2.5, transformers, onnx, onnxruntime."
  if [[ -d "$DEST" && -f "$DEST/model.onnx" && "${LAYA_FORCE_DISTILL:-0}" != "1" ]]; then
    echo "  reuse   : $DEST/model.onnx already exists (LAYA_FORCE_DISTILL=1 to rebuild)."
  else
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    python3 "$SCRIPT_DIR/laya_distill.py" --out "$DEST"
  fi
  echo ""
  echo "Done. Point the sidecar at: $DEST"
  echo "  export LAYA_MODEL_PATH=\"$DEST\""
  exit 0
fi

mkdir -p "$DEST"

# --- fetch (prefer the huggingface CLI, fall back to python) ----------------
if command -v hf >/dev/null 2>&1; then
  hf download "$REPO" --local-dir "$DEST"
elif command -v huggingface-cli >/dev/null 2>&1; then
  huggingface-cli download "$REPO" --local-dir "$DEST"
elif command -v python3 >/dev/null 2>&1; then
  python3 - "$REPO" "$DEST" <<'PY'
import sys
from huggingface_hub import snapshot_download
repo, dest = sys.argv[1], sys.argv[2]
snapshot_download(repo_id=repo, local_dir=dest)
PY
else
  echo "Need one of: hf, huggingface-cli, or python3 with huggingface_hub installed." >&2
  echo "  pip install huggingface_hub" >&2
  exit 1
fi

# --- verify the artifact the chosen backend actually needs ------------------
if [[ "$BACKEND" == "onnx" ]]; then
  if ! ls "$DEST"/*.onnx >/dev/null 2>&1; then
    echo "" >&2
    echo "ERROR: no *.onnx graph found in $DEST." >&2
    echo "The Laya checkpoints ship 'model.safetensors', not ONNX. The onnx sidecar" >&2
    echo "needs a real ONNX graph to run — it will NOT fabricate decisions without one." >&2
    echo "Fix by either:" >&2
    echo "  * setting LAYA_ONNX_REPO to a repo that hosts a model.onnx export, or" >&2
    echo "  * exporting model.onnx from the checkpoint into $DEST." >&2
    exit 3
  fi
  echo "  onnx    : $(ls "$DEST"/*.onnx | head -1)"
fi

echo "Done. Point the sidecar at: $DEST"
echo "  export LAYA_MODEL_PATH=\"$DEST\""
