# Model weights

No model weights, checkpoints or training datasets are committed to this repository.
`.gitignore` excludes `/models/` (including `models/embed/`), `otsone/models/`, and `*.onnx`, `*.onnx.data`,
`*.safetensors`, `*.gguf`, `*.ckpt`, `*.pt`, `*.bin`. The only files tracked under
`otsone/models/otsone-base/` are small config and model-card JSON.

The API works out of the box without any weights: when no model is installed,
`system-one` is served by the lexical (TF-IDF) engine and every response says so
with `engine: { "kind": "lexical", "reason": "..." }`.

## System One embedding engine (default, gte-small)

The default `system-one` engine compares sentence embeddings. It needs a ~33 MB
int8 ONNX export of [thenlper/gte-small](https://huggingface.co/thenlper/gte-small)
(MIT) and the optional `onnxruntime-node` package (installed by `npm install`;
it runs on CPU, no GPU or Python needed).

```bash
npm run embed-download          # wraps scripts/embed-download.sh -> models/embed/gte-small
# or somewhere else:
EMBED_DEST=/opt/models/gte-small bash scripts/embed-download.sh
export OPENJEV_EMBED_MODEL_PATH=/opt/models/gte-small
```

The script downloads `model_quantized.onnx`, `tokenizer.json` and `config.json`
from `Xenova/gte-small` at a pinned revision, checks each file's sha256, and
writes an `embed.json` manifest (pooling, max length). The Docker image does this
at build time (`--build-arg OPENJEV_EMBED=0` skips it).

When the model is present, responses carry
`engine: { "kind": "embedding", "encoder": "gte-small" }`. Set `OPENJEV_EMBED=off`
to force the lexical engine. `GET /api/v1/status` reports which engine is active.

The engine's constants (temperature, lexical blend, out-of-scope detector) live in
`src/lib/jev/embed/params.ts` and were fitted by `npm run embed-fit` on held-out
data only (Banking77 train, CLINC150 validation, half of the gold suite). If you
swap in a different encoder, re-run `npm run embed-fit -- --write`: the constants
are specific to the encoder's similarity scale.
The cookbook decision gates on this engine (smart home, SDE cascade,
consistency) are tuned separately by `scripts/cookbook-thresholds.ts`; re-run it
after a re-fit. See [COOKBOOK-THRESHOLDS.md](./COOKBOOK-THRESHOLDS.md).

## Laya (open weights, Convai Innovations, Apache-2.0)

These checkpoints are published on Hugging Face under the `aac6fef` account.

```bash
# MLX (Apple silicon)
npm run laya-download                       # wraps scripts/laya-download.sh
# or directly:
hf download aac6fef/laya-mlx --local-dir models/laya-mlx
hf download aac6fef/laya-multilingual-mlx --local-dir models/laya-multilingual-mlx

# ONNX (Linux / CPU): export from the reference checkpoint
cd otsone && uv sync --extra onnx
uv run otsone export-onnx --model convaiinnovations/laya --output ../models/laya-onnx
```

The Docker `laya-onnx` sidecar downloads its weights on first boot into the
`laya-models` volume. See [SELF-HOSTING.md](../SELF-HOSTING.md).

## otsone-1 (ours)

You train otsone-1 locally. It is a MiniLM-backbone model with a CORN ordinal score
head and calibration-native training. The ONNX export is about 87 MB, plus a 0.7 MB
tokenizer.

```bash
cd otsone
uv sync --extra train --extra onnx
uv run otsone distill --backbone otsone-base --out models/otsone-base   # train + export ONNX
uv run otsone eval    --model models/otsone-base                        # gold accuracy + ECE report
OTSONE_BACKEND=onnx OTSONE_MODEL_PATH=./models/otsone-base uv run otsone-serve
```

Then set `OTSONE_MODEL_URL` on the Node service so that it routes `otsone-1` and
`otsone-mini` to the sidecar. See [otsone/docs/OUR-MODEL.md](../otsone/docs/OUR-MODEL.md)
and [otsone/docs/RESEARCH-OTSONE.md](../otsone/docs/RESEARCH-OTSONE.md) for the method.
