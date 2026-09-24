# otsone-1 — OpenJev's own typed-decision model

`otsone-1` (model family **`openjev`**, trained by **`openjev`**) is a
compact, fully-local typed-decision model trained *from scratch in this repo*. It
answers the same three System One question types as the rest of the stack —
**choice**, **score**, **noul** — and serves through the exact same ONNX backend
(`otsone-serve`, `OTSONE_BACKEND=onnx`; the `laya-serve` / `LAYA_BACKEND` aliases
still work) as an exported Laya checkpoint.

It is a distinct model with its own name, not a re-export of anything.

## How it differs from Laya and Jev

| | **otsone-1** (this doc) | **Laya** (Convai) | **Jev** (TypeSafe) |
|---|---|---|---|
| Origin | Trained here, in `laya_mlx/distill.py` | Convai's published `convaiinnovations/laya` | TypeSafe's proprietary model |
| Backbone | Selectable tier (`--backbone`): ModernBERT-base (`otsone-base`), DeBERTa-v3-xsmall (`otsone-lite`), MiniLM (`otsone-mini`, default) | ModernBERT-large (~421M) | Not public |
| Where it runs | Local ONNX graph, CPU ExecutionProvider | Native MLX on Apple silicon (`laya_mlx.model`) or exported to ONNX | Hosted cloud service |
| Weights | Ours, this repo | Convai's checkpoint | Closed, server-side |
| Role here | Our own baseline you can train, eval, and ship offline | The upstream model this package accelerates | Cloud fallback / reference |

All three speak the same wire contract — the
`[CLS] <type> instructions [SEP] [MASK] opt0 [MASK] opt1 ... [SEP] state [SEP]`
sequence built by `laya_mlx.common.build_sequence`, with one logit read per
option `[MASK]` marker — so `otsone-1` drops straight into
`laya_mlx.server.OnnxEngine` with no bespoke runtime.

## Architecture (v2 — `otsone-v2-corn`)

- **Backbone (selectable tier):** `--backbone otsone-base` = ModernBERT-base
  (768d, primary), `otsone-lite` = DeBERTa-v3-xsmall (384d, CPU/edge), `otsone-mini`
  = MiniLM-L6 (384d, the default so the offline baseline never breaks). The
  head architecture is identical across tiers (encoder swap only); an unavailable
  backbone fails with a clear message pointing at the cached `otsone-mini`.
- **Per-qtype embedding:** a learned bias added to every token, so the same marker
  can be scored differently for choice vs score vs noul.
- **CHOICE / NOUL — shared marker scorer:** `LayerNorm → Linear → GELU → Linear(→1)`
  maps each option marker's contextual vector to a single logit; masked options
  get `-1e4`; a masked softmax over valid markers yields the distribution.
- **SCORE — CORN ordinal head (the key upgrade over Laya):** `Linear(d, K-1)` on the
  pooled `[CLS]`, each sigmoid a conditional `P(y>k | y>k-1)`; chain-rule to
  cumulative exceedance `P(y>k) = Π σ(z_j)`; expected score `= Σ P(y>k)`. It is
  **rank-consistent by construction** and better-calibrated than a unified
  regressor. It exports as a second `corn_logits` ONNX output that both
  `laya_mlx.server.OnnxEngine` and the MLX `laya_mlx.model.DecisionModel` read.
- **Calibration-native loss:** label smoothing (ε=0.10) + Dual-Focal (γ=0.5) on
  CHOICE/NOUL, a strictly-proper Brier term, and the CORN conditional-BCE ordinal
  loss on SCORE — so the training objective and the calibration goal stop
  diverging and post-hoc temperature only fine-tunes.
- **Per-type temperature (never one global T):** `T_choice / T_score / T_noul` are
  fit on a held-out 10% split by NLL minimisation (softmax NLL for choice/noul,
  conditional CORN NLL for score) and written to `rl_agent_config.json`
  (`temperatures`); the engine still clamps each to `[0.5, 5.0]`. This mirrors the
  isotonic/ECE approach in `openjev/src/lib/jev/calibration.ts` — same
  strictly-proper metrics (ECE/MCE/Brier/NLL), argmax-preserving post-hoc scaling.

The graph outputs `logits` **and** `corn_logits`; pre-v2 (Laya) checkpoints that
lack `corn_logits` fall back to the marker-softmax score path unchanged.

## Training corpus + teacher distillation

`build_corpus()` in `laya_mlx/distill.py` synthesises the base labelled set
(department routing, tone, return reason, request type, returns topic → choice;
bug severity and urgency → score; seven noul concepts). It is extended by
`laya_mlx/data_gen.py`, the **8 gold axes** — paraphrase, negation, domain-shift,
ambiguous, minimal, longform, structured, multilingual — generated
deterministically and offline. An **optional LLM teacher** (`OTSONE_TEACHER_API_KEY`)
supplies soft-label distributions (the "dark knowledge") for knowledge
distillation on the discriminative heads; without a key a deterministic
ordinal-aware fallback is used, so training never stalls and stays reproducible.

If an OpenJev `gold.json` is reachable (the model dir, `benchmarks/`,
`engine/`, or a sibling `openjev/engine/`), those gold cases are folded in as
extra labelled targets. Training is CPU-runnable on this tiny corpus; the only
online step is the first backbone download.

## Pipeline: train → eval → export → serve

```bash
# 0. one-time: install the training + onnx extras
pip install 'otsone[train]'

# 1. TRAIN — writes models/otsone-base/{model.onnx (logits + corn_logits),
#    rl_agent_config.json, encoder/config.json, tokenizer/, model_card.json}
otsone distill --backbone otsone-base --out models/otsone-base
#   backbones: otsone-base (ModernBERT, primary) | otsone-lite (DeBERTa-v3-xsmall,
#              edge) | otsone-mini (MiniLM, default/offline)
#   options: --epochs --batch --lr --head-lr --seed --gold PATH --no-gold
#            --no-synthetic --synthetic-per-axis N --no-teacher

# 2. EVAL — runs the served ONNX backend on the gold set, prints per-case
#    pass/fail + accuracy + ECE + a 15-bin per-type reliability summary
#    (ECE/adaptive-ECE/MCE/Brier/NLL), and writes them into model_card.json
otsone eval --model models/otsone-base
#   (equivalently: python benchmarks/eval_gold.py --model models/otsone-base)

# 3. (optional) QUANTIZE — dynamic int8 weights, a complete loadable checkpoint
otsone quantize --model models/otsone-base --output models/otsone-int8

# 4. SERVE — the sidecar loads otsone-1 through the ONNX backend
#    (OTSONE_* is primary; the LAYA_* aliases still work)
OTSONE_BACKEND=onnx OTSONE_MODEL_PATH=./models/otsone-base otsone-serve
#   GET  /health        -> {"ok": true, "engine": "laya-onnx", "model": "..."}
#   POST /v1/systemone  {"state": ..., "questions": {...}} -> {"model","answers","usage"}
```

The `laya-mlx` / `laya-serve` aliases accept the same subcommands and settings.
`export-onnx` is the sibling path for the **Laya** MLX checkpoint
(`otsone export-onnx`); `distill` is how you get **otsone-1**. Both land in the
same directory shape and serve through the same engine.

## Streaming

`laya_mlx.stream.predict_stream(engine, state, questions)` yields
`(question_id, answer)` per question the moment its forward batch completes, in
question order, with byte-identical answer dicts to the batch path. It accepts an
`OnnxEngine`, an `MlxEngine`, or an MLX `Agent`, so the sidecar can emit answers
incrementally (e.g. Server-Sent Events) over large question sets.

## Files

| Path | Role |
|---|---|
| `laya_mlx/distill.py` | Trainer for `otsone-1` (`main(argv)`; `otsone distill`) — backbones, CORN head, calibration-native loss |
| `laya_mlx/data_gen.py` | 8-axis synthetic corpus + optional LLM-teacher soft-label hook |
| `laya_mlx/calibration.py` | Pure-Python CORN math + reliability (ECE/MCE/Brier/NLL); Python twin of `jev/calibration.ts` |
| `laya_mlx/eval_gold.py` | Gold evaluation + per-type reliability + card writer (`otsone eval`) |
| `benchmarks/eval_gold.py` | Runnable benchmark entrypoint (re-exports the above) |
| `laya_mlx/stream.py` | `predict_stream` incremental inference |
| `models/otsone-base/` | Default training output (git-ignored build artifact) |
