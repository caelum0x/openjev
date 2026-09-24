#!/usr/bin/env bash
#
# embed-download.sh — fetch the sentence encoder for the default System One
# embedding engine (gte-small, int8 ONNX, ~33 MB, MIT license).
#
# Source: the ONNX export of thenlper/gte-small published at Xenova/gte-small
# on Hugging Face, pinned to one revision and verified by sha256, so every
# install embeds identically (the leaderboard numbers depend on it).
#
#   ./scripts/embed-download.sh                       # -> ./models/embed/gte-small
#   EMBED_DEST=/opt/models/gte-small ./scripts/embed-download.sh
#
# Then either keep the default path or set OPENJEV_EMBED_MODEL_PATH.
set -euo pipefail

REPO="Xenova/gte-small"
REV="5927d1727bb12db490052a1b33265ad78058de08"
DEST="${EMBED_DEST:-models/embed/gte-small}"
BASE="https://huggingface.co/${REPO}/resolve/${REV}"

# file  sha256
FILES=(
  "onnx/model_quantized.onnx 18dec105109b6004369799ca4761fb8fb413c64172c02147bcfac186b5c5f6cb"
  "tokenizer.json da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0"
  "config.json 73f82cfb2bab7b9b7da090b2a71dac32f7ca79b12b2824d4caf9ecf0769b44ae"
)

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

mkdir -p "$DEST"
for entry in "${FILES[@]}"; do
  src="${entry%% *}"
  want="${entry##* }"
  out="$DEST/$(basename "$src")"
  if [[ -f "$out" && "$(sha256 "$out")" == "$want" ]]; then
    echo "ok       $out"
    continue
  fi
  echo "download $src"
  curl -fsSL --retry 3 -o "$out.part" "$BASE/$src"
  got="$(sha256 "$out.part")"
  if [[ "$got" != "$want" ]]; then
    rm -f "$out.part"
    echo "sha256 mismatch for $src: expected $want, got $got" >&2
    exit 2
  fi
  mv "$out.part" "$out"
done

cat > "$DEST/embed.json" <<JSON
{
  "id": "gte-small",
  "pooling": "mean",
  "query_prefix": "",
  "doc_prefix": "",
  "max_length": 256,
  "onnx_file": "model_quantized.onnx",
  "source": "https://huggingface.co/${REPO}/tree/${REV}",
  "license": "MIT (thenlper/gte-small)"
}
JSON
echo "embedding model ready in $DEST"
