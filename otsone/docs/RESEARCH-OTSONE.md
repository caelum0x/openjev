# otsone-1 — Design Spec for the openjev-native Typed-Decision Model

_Synthesized from four research streams (ARCHITECTURE, CALIBRATION & MATH, TRAINING & DATA, COMPETITIVE POSITIONING) — 2026-09-23._

This is the actionable build spec for **otsone-1**, our own System-One typed-decision
model living in the `openjev/otsone` family. It is grounded in the code that already
exists: the MLX `DecisionModel` in `laya-mlx/laya_mlx/model.py` (ModernBERT encoder +
`type_emb` + 2-layer `DecisionHead` + marker `scorer` + a `temperature = mx.ones((3,))`
buffer), the pure-TS reliability harness in
`openjev/src/lib/jev/calibration.ts`, and the HTTP sidecar contract in
`openjev/src/lib/jev/otsone.server.ts` (serves `otsone-base` over 127.0.0.1:8092).

---

## 1. Problem Framing — Typed Decisions and Why Calibration Is the Moat

A **typed decision** takes an unstructured `state` plus one or more typed `questions` and
returns a strict, machine-usable primitive with a probability attached:

- **CHOICE** — pick exactly one label from a closed set; return the full distribution and a confidence.
- **SCORE** — return a scalar in `[0,1]` on an ordinal rubric; return uncertainty.
- **NOUL** — return `P(true)` for a yes/no gate; return a calibrated probability.

This is a **discriminative** problem: given `(state, question, options)`, pick one. It is
_not_ generation. That single observation kills two categories of competitor at once —
LLM-json-mode wrappers (Instructor/Outlines/OpenAI Structured Outputs/DSPy/BAML) that
decode token-by-token at 200–2000 ms, and diffusion LMs (LLaDA/Mercury) that need
`T=10–50` denoising passes. A bidirectional encoder produces the required representation
in **one forward pass**.

**Why calibration is the moat, not accuracy.** On 77-way intent (Banking77) frontier LLMs
already beat Jev on raw accuracy (81.3% vs 76.3%). Nobody wins the accuracy race against a
120B model. What no competitor delivers is a probability you can _trust as a probability_:

- Jev (TypeSafe cloud) hits **ECE 0.246** on forced-uncertainty items and admits
  uncertainty on only 49.7% of them (LLMs: 97–100%); Brier 0.846 on DAIR Emotion.
- Laya's raw ECE is **0.466** before temperature scaling (0.081 after).
- Every structured-output wrapper inherits the base LLM's RLHF overconfidence and exposes
  no ECE at all — "0.9 confidence" carries no obligation to be right 90% of the time.

otsone-1's thesis: **calibration-native training + determinism + self-hosting.** A decision
returned at confidence `c` is right `~c` of the time; the same input always yields the same
output (deterministic encoder forward pass — the laya-mlx benchmark already shows 100/100
argmax agreement, max prob delta < 0.005 at FP16); and it runs on-device at zero token cost
(Jev is ~$42/day at 1M decisions/day; otsone-1 marginal cost is electricity). Calibration is
the property software integrations (routing, moderation, entitlement checks, anti-cheat)
actually need, and it is the property the whole field is worst at.

---

## 2. Recommended Architecture for otsone-1 (ONE concrete design)

**Chosen design: shared ModernBERT-base trunk + type-embedding conditioning + a 2-layer
shared decision head + three per-primitive heads.** This is deliberately the _same skeleton
as the existing `DecisionModel`_ — we extend a validated architecture rather than invent one,
and the MLX code already loads it. Two backbone tiers ship under one family:

| Tier | Backbone | Params (backbone) | d | Target | Latency |
|---|---|---|---|---|---|
| `otsone-base` (primary) | ModernBERT-base | 149M | 768 | GPU + Apple Silicon | ~6–9 ms FP16 M3 Max; ~10–18 ms ONNX INT8 CPU |
| `otsone-lite` (edge) | DeBERTa-v3-xsmall | 22M + 48M emb | 384 | CPU-only / <256 MB RAM | ~4–8 ms CPU INT8 (~12 MB) |

**Why this and not the alternatives.** ModernBERT-base is 2–4× faster than DeBERTa-v3 on GPU,
beats it on GLUE with ~5× less memory, has 8k native context, and its alternating
local(128-tok window)/global(every 3rd layer) attention exports cleanly to ONNX via additive
masks over `ScaledDotProductAttention`. It is 2.6× smaller than Laya's ModernBERT-large (421M)
while keeping the marker-based CHOICE mechanism that Laya validated. DeBERTa-v3-xsmall is the
fastest CPU encoder in existence for the edge tier (FlowBlast on-device anti-cheat, mobile).
Diffusion LMs and dual/cross-encoders are rejected (latency, or options can't attend jointly).

### Input format (marker-token joint encoding)

```
[CLS] <state tokens> [SEP] <instruction tokens> [OPT_0] <opt_0> [OPT_1] <opt_1> ... [SEP]
```

- **CHOICE**: one `[OPT_k]` sentinel per option; options attend to each other + full context.
- **SCORE**: rubric levels ARE the options — `[OPT_0]..[OPT_{K-1}]` labelled `0..K-1`.
- **NOUL**: two markers `[OPT_0]=false`, `[OPT_1]=true` (the existing runtime already pads
  one-option choices to a 2-marker minimum — `k = max(marker_mask.sum, 2)` in `model.py`).
- Truncate to 256 tokens (short path); base supports up to 8192 for long state.

### Type conditioning (already in `model.py` line 221)

```python
type_emb = nn.Embedding(3, d)          # 3 × 768 = 2304 params
h = token_embeddings(input_ids)        # [B, L, d]
h = h + type_emb(qtype)[:, None, :]    # broadcast; qtype ∈ {0=CHOICE,1=SCORE,2=NOUL}
```

Single differentiable `Add`, trivial ONNX export. Rejected: prefix tokens (dynamic-length
export pain), per-type LoRA adapters (export complexity, negligible quality gain for 3
well-separated tasks).

### Shared decision head + per-primitive heads

`DecisionHead` = 2 Pre-LN transformer `HeadLayer`s (d=768, 12 heads, GeGLU FFN 4×d) — the
existing class, ~7.1M params/layer, ~14.2M total. Use 2 layers for base, 1 for lite. The
three primitive heads read off it:

- **CHOICE** — gather hidden states at `[OPT_k]` positions, `LayerNorm → Linear(d→1)`, masked
  softmax over valid markers `/ T_choice`. (This is exactly the current `scorer`.)
- **SCORE** — **CORN ordinal head** on `[CLS]`: `Linear(d, K-1)`, each sigmoid a conditional
  `P(y>k | y>k-1)`; chain-rule to unconditional cumulatives; expected score = mean of
  cumulatives. Rank-consistent by construction, better-calibrated than a unified regressor.
  _(This is the one deliberate upgrade over Laya's unified scorer.)_
- **NOUL** — `Linear(d,1)` on `[CLS]` → `σ(z / T_noul)`.

Optional per-head **confidence auxiliary** (`Linear(d,1)→σ`, trained to predict own
correctness) can be added if verbalized-confidence distillation is used (see §4).

### Tensor shapes (B=batch, L=seq, N=options, K=rubric levels)

```
input_ids      [B,L] int32     attention_mask [B,L] int32     qtype [B] int32
marker_pos     [B,N] int32     marker_mask    [B,N] bool
embeddings/after_type_emb/encoder_out/after_head : [B,L,768]
CHOICE:  h_options [B,N,768] → z_options [B,N] → p_choice [B,N]   (conf = max p)
SCORE:   h_cls [B,768] → z_corn [B,K-1] → p_exceed [B,K-1] → score [B]∈[0,1]
NOUL:    h_cls [B,768] → z_noul [B,1] → p_true [B]
```

**Parameter budget (otsone-base):** ModernBERT-base 149M + type_emb 2.3K + DecisionHead
14.2M + CHOICE/SCORE/NOUL heads ~5K ≈ **163M total**. FP16 on disk ~312 MB; ONNX INT8
(encoder quantized, heads FP32) ~155 MB. otsone-lite INT8 ≈ 44 MB — mobile-deployable where
Jev (network) and Laya (1.7 GB FP32 ONNX) cannot go.

---

## 3. Loss + Calibration Recipe

### Per-head training losses

**CHOICE** — label-smoothed CE + Dual Focal, no post-hoc dependence:
```
ỹ_k = (1-ε)·y_k + ε/K,  ε = 0.10
L_choice = focal_weight · CE(softmax(z), ỹ),   focal_weight = (1 - p_t)^γ,  γ = 0.5
```
Label smoothing and focal both directly attack overconfidence; Dual Focal Loss
(arXiv:2305.13665) calibrates ALL class probabilities, not just the argmax — critical for
CHOICE where the whole distribution is consumed.

**SCORE** — CORN ordinal loss (conditional BCE on the K-1 thresholds):
```
L_CORN = -Σ_{k=0}^{K-2} [ 1(y>k)·log σ(z_k) + 1(y≤k)·log(1-σ(z_k)) ]
         restricted to the conditional training set C_k = {i : y_i > k-1}
P(y>0)=σ(z_0);  P(y>k)=P(y>k-1)·σ(z_k);  E[s] = (1/(K-1))·Σ_k P(y>k)
```
Optionally add the ORCU unimodality log-barrier (arXiv:2410.15658) if SCORE distributions
come out multimodal.

**NOUL** — label-smoothed BCE:
```
ỹ = (1-ε)·y + ε·0.5,   L_noul = BCE(σ(z), ỹ)
```

**Combined multi-task loss** (all flow through the shared trunk + type_emb):
```
L = 0.4·L_choice + 0.3·L_CORN + 0.3·L_noul  (+ 0.1·L_conf if confidence heads used)
```

The calibration-native core is the design principle from the competitive stream expressed
as a supervised objective: adding a **strictly-proper Brier term** (`Σ_k (p_k - y_k)^2`) or
label smoothing to CE means the training objective and the calibration goal stop diverging —
temperature scaling then only fine-tunes, it doesn't do the heavy lifting. Small edge models
benefit from train-time calibration MORE than post-hoc, because the calibration split is tiny
relative to model capacity and label smoothing is free.

### Post-hoc calibration (per-type, never one global T)

Fit **three independent temperatures** on a held-out 10% split by 1-D NLL minimization
(`scipy.optimize.minimize_scalar`, Brent) — argmax-preserving, so accuracy is untouched:
```
T_choice = argmin_T NLL(softmax(z/T), y)
T_noul   = argmin_T BCE(σ(z/T), y)
T_score  = argmin_T Σ_k NLL(σ(z_k/T), 1[y>k])
```
Store as JSON config (not weights) → the existing `temperature = mx.ones((3,))` buffer is
populated from it, exactly as the code comment already anticipates.

Escalation ladder when a head still misses ECE ≤ 0.05:
- CHOICE, |D_cal| ≥ 300 → **Structured Vector Scaling / diagonal Dirichlet** with ODIR
  regularization (2K params, `p̂ = softmax(W·log p_uncal + b)`, `T`-scaling is the `W=I/T`
  special case).
- NOUL, distribution-free guarantee needed → **binary Venn-Abers** fit OFFLINE (PAVA on
  `{(score,label)}`, serialize breakpoints, O(log n) lookup at inference — never PAVA
  per-request). Finite-sample marginal calibration (ICML 2025).
- SCORE → temperature per CDF threshold, or isotonic per threshold if |D_cal| ≥ 500.

### Tie to `openjev/src/lib/jev/calibration.ts`

The pure-TS `buildReliability()` is the acceptance gate. Concrete extensions to make:

1. **Bump default `binCount` 5 → 15.** The current 5-bin equal-width ECE is biased when
   predictions cluster near 1.0 and will miss overconfidence clusters.
2. **Add `binStrategy: "equal-width" | "equal-mass"`** and report **adaptive-ECE** (equal-mass
   quantile bins) alongside ECE — fairer when the model is mostly high-confidence.
3. **Add `nll` to `CalibrationReport`** next to the existing `brier` (both are strictly proper;
   ECE ≠ NLL, track both).
4. **Ordinal ECE for SCORE**: emit one `CalPrediction` per CORN threshold per case
   (`confidence = P(y>k)`, `correct = y_true > k`); report `ECE_ord = mean_k ECE(threshold_k)`.
   The existing `CalPrediction` type already supports this with zero schema change.
5. Keep the per-qtype breakdown but replace the scalar `|acc − avgConf|` gap in the route with
   the full binned ECE.

**Gate targets:** ECE ≤ 0.05 (fail > 0.10) · MCE ≤ 0.15 (fail > 0.25) · Brier ≤ 0.10 NOUL /
≤ 0.15 CHOICE · Ordinal-ECE ≤ 0.08 SCORE. These are hit with label-smoothing ε=0.10 at train
time + per-type temperature post-hoc; Dirichlet/Venn-Abers add a further 20–40% ECE reduction
when |D_cal| is large.

---

## 4. Training + Data Recipe

### Teacher distillation

Teacher = Claude Opus 4.x (or GPT-5). The teacher MUST return the **full label distribution**
(the "dark knowledge"), not just argmax, plus a verbalized confidence — this is the signal a
small student cannot recover from hard labels.

Distillation loss with **CIST sample-adaptive temperature** (don't use a fixed global T):
```
L_KD = α·T_i²·KL(softmax(z_T/T_i) || softmax(z_S/T_i)) + (1-α)·L_choice(z_S, y_hard)
α = 0.7;  T_i = f(H(p_teacher_i))   # high teacher entropy → lower T_i to keep sharpness
                                    # low entropy → higher T_i to expose dark knowledge
```
Optionally distill calibration directly: `L_conf = MSE(conf_student, conf_teacher)`, β = 0.1.

### Synthetic data — 8 gold axes (~100K filtered examples)

| Axis | % | Purpose |
|---|---|---|
| 1 Core | 40 | Clear, unambiguous (teacher conf > 0.80) |
| 2 Adversarial paraphrase | 15 | Robustness to wording |
| 3 Negation injection | 10 | Must invert on "did NOT", "no history of" |
| 4 Domain shift | 10 | OOD generalization of the primitives |
| 5 Ambiguous/borderline | 10 | Teach calibrated uncertainty (keep ALL regardless of conf) |
| 6 Minimal signal | 5 | SCORE must not hallucinate signal from noise |
| 7 Multilingual | 5 | TR/ES/DE/ZH — language-independence |
| 8 Contradictory intent | 5 | Surface points one way, qualifier flips it |

Filter: drop Axis-1 examples with teacher conf < 0.75 (< 0.40 = noise); keep ALL Axis-5.
Dedup by MPNet cosine > 0.93. **100K clean beats 200K noisy.** Online augmentation:
back-translation, synonym sub (15–20% of non-numeric tokens), numeric perturbation ±5–10%
for SCORE (verify teacher score shifts), key-order shuffle for CHOICE invariance, p=0.10
negation stress test.

### Teacher data-generation prompt template

```
SYSTEM:
You are a typed-decision oracle. Given a structured context (state) and typed questions,
answer each with ONLY its typed primitive:
- CHOICE: pick exactly one label from the provided set; ALSO return a full probability
  distribution over ALL labels and a calibration confidence in [0,1].
- SCORE: output a scalar in [0,1] on the stated rubric; give a 90% credible interval and confidence.
- NOUL: output P(true) in [0,1]; give confidence.
Be calibrated: if you say 0.9 confidence you must be right ~90% of the time.
If the input is ambiguous, SPREAD the distribution — do NOT collapse to 1.0.

USER:
GENERATION_AXIS: {{axis_name}}          # one of the 8 axes above
STATE: {{state_json}}
QUESTIONS:
  Q1: {{question_1_with_label_set_or_rubric}}
  Q2: {{question_2}}

Respond in EXACTLY this JSON schema:
{
  "answers": [
    {"question_id":"Q1","primitive":"CHOICE","answer":"LABEL_X",
     "distribution":{"LABEL_X":0.72,"LABEL_Y":0.20,"LABEL_Z":0.08},"confidence":0.78},
    {"question_id":"Q2","primitive":"SCORE","answer":0.65,"interval_90":[0.52,0.78],"confidence":0.81}
  ],
  "reasoning_trace":"brief internal CoT — NOT shown to the student"
}
```

For the **RLCD contrastive** pass (Phase 3), generate negatives 3 ways: (1) teacher prompted
"express maximum uncertainty regardless of evidence" → pathologically hedged; (2) "choose the
LEAST likely label confidently" → confidently wrong; (3) low-temperature samples from an
earlier student checkpoint. Optimize with **SimPO** (`margin γ=0.5`, no reference model),
blended at δ=0.15 — cheaper than PPO.

### Compute-minimal fine-tune schedule (LoRA, 6 epochs, curriculum)

- **PEFT:** LoRA `r=16, α=32, dropout=0.1` on `query_proj/value_proj`; `modules_to_save` =
  all primitive heads + type_emb (full-rank). LoRA dropout 0.1 is itself a calibration
  regularizer (arXiv:2404.09610). Merge weights at export → zero added latency.
- **Optimizer:** AdamW, lr 2e-4 (adapters) / 5e-4 (heads), 6% warmup, cosine decay, batch 32
  (eff. 128 via accum), bf16, clip 1.0.
- **Phase 1 (ep 1–2):** Axis 1+2 only, teacher conf ≥ 0.75, plain CE — build basic associations.
- **Phase 2 (ep 3–4):** full dataset, add `L_KD` + CIST; brief 1000-step head freeze to
  stabilize encoder reps before unfreezing heads.
- **Phase 3 (ep 5–6):** full dataset + RLCD contrastive pairs (Axes 7–8 + synthetic negatives),
  add `L_contrast`, LR ×0.3; early-stop on val ECE (15-bin), patience 5.
- **Post:** fit per-head temperatures (§3), then export + INT8 quantize.

---

## 5. Benchmark Plan

### Tasks (public, license-clean)

| ID | Dataset | Primitive | Labels | Why |
|---|---|---|---|---|
| B10 | nibzard forced-uncertainty S3–S5 (MIT) | CHOICE | varies | **Run FIRST** — Jev's worst suite (ECE 0.246) |
| B1 | Banking77 | CHOICE | 77 | De-facto typed-decision standard |
| B2 | CLINC150 (+OOS) | CHOICE | 150+OOS | High cardinality + OOD |
| B5 | UCI SMS Spam | NOUL | 2 | Binary calibration story |
| B6 | BoolQ | NOUL | 2 | Yes/no with passage |
| B7 | GoEmotions | CHOICE | 27 | Jev documented poor here |
| B8 | Yelp stars | SCORE | 5 | Ordinal calibration |
| B9 | SST-5 | SCORE | 5 | Ordinal sentiment |
| B3/B4 | AG News / SNIPS | CHOICE | 4 / 7 | Easy anchors |

### Metrics

- **Accuracy:** top-1 (+ top-3 for B1/B2/B7).
- **Calibration:** ECE (15-bin equal-width) + adaptive-ECE (equal-mass) + MCE + multiclass
  Brier + NLL + reliability diagram. Ordinal-ECE for SCORE.
- **Latency:** p50/p95 end-to-end (tokenize→forward→calibrate→JSON) on 3 targets — Apple
  M-series CPU, Apple Silicon MLX GPU, Linux T4 ONNX/CUDA — at batch 1/8/32.
- **Cost:** $/1k decisions (cloud = token price × measured tokens; self-hosted = amortized
  $0.50/hr T4g).
- **Determinism:** 10 identical calls × 100 examples; fraction with identical argmax and prob
  within 1e-4. **Headline metric** — a zero-cost win over every LLM-backed tool.
- Composite (leaderboard only): `0.35·acc + 0.35·(1−ECE) + 0.15·(1−norm_latency) + 0.15·(1−norm_cost)`.

### Baselines (ordered by latency)

1. **otsone-1** (DeBERTa/ModernBERT + calibrated loss, ONNX INT8)
2. **Laya** (laya-multilingual, ONNX FP16, temperature-scaled) — this codebase
3. Zero-shot NLI oracle (DeBERTa-v3-large-mnli)
4. Fine-tuned DeBERTa-v3-base, CE-only — **accuracy ceiling, uncalibrated**
5. Same + temperature scaling — **calibration ceiling** (isolates whether our joint loss
   beats plain post-hoc; report honestly)
6. **Jev 1.x** (TypeSafe API, zero-shot, same wire format)
7. GLM-5.3-flash + XGrammar JSON schema (constrained decoding)
8. GPT-5.4-nano + Instructor (Pydantic enum + retry)
9. Majority-class deterministic

**Hypotheses:** otsone-1 ECE < 0.06 on B1–B9 vs Jev 0.246 on B10; Apple Silicon p50 3–8 ms
(vs laya-multilingual 10–18 ms); CPU INT8 30–80 ms; cost $0 self-hosted vs $0.07 Jev vs
$0.19+ GPT-nano; determinism 100% vs ~0% for temp>0 LLM tools.

Protocol: same state string + same shuffled option list (fixed seed) to all; calibration fit
on held-out 10% of train, test never seen; 10 warmup + 100 timed iters; raw predictions +
token counts + timing JSON committed, no test text redistributed.

---

## 6. Implementation Roadmap — mapped to laya-mlx + OpenJev

The architecture is already the `DecisionModel`; we extend rather than rewrite.

### laya-mlx (`laya_mlx/`)

- **`model.py`** — add the **CORN SCORE head** (`Linear(d, K-1)` on `[CLS]` + chain-rule
  cumulatives) alongside the existing marker `scorer`; add DeBERTa-v3 weight loading in
  `sanitize_weights()` for the lite tier (encoder swap only, head architecture unchanged);
  keep `type_emb` and the `temperature = mx.ones((3,))` buffer as-is.
- **`distill.py`** _(new)_ — teacher-distillation trainer: dataset loader for the 8-axis
  synthetic corpus, CIST per-sample temperature, combined loss
  `0.4·L_choice(LS+focal) + 0.3·L_CORN + 0.3·L_noul (+0.1·L_conf)`, LoRA config, 3-phase
  curriculum, SimPO contrastive Phase 3, bf16 + grad-accum.
- **`calibrate.py`** _(new)_ — post-training: fit per-type `T_choice/T_score/T_noul` (Brent
  NLL), optional Dirichlet/SVS for CHOICE, offline Venn-Abers PAVA for NOUL; write the JSON
  config that populates the `temperature` buffer.
- **`eval.py`** _(new)_ — runs the §5 benchmark suite (B1–B10), emits accuracy + the full
  calibration report + latency/determinism, in the same JSON shape the TS `CalibrationReport`
  consumes.
- **`gendata.py`** _(new)_ — teacher data generator driving the §4 prompt across the 8 axes,
  filtering + MPNet dedup.
- **`onnx_export.py` / `cli.py`** — extend the existing `export-onnx` + `quantize` commands:
  ONNX-compatible RoPE (precomputed sin/cos tables, not `mx.fast.rope`), sliding-window as
  additive mask on opset-17 SDPA, dynamic axes on B and L, INT8 dynamic quant on encoder
  MatMuls (heads stay FP32 to protect calibrated outputs). New CLI verbs: `distill`,
  `calibrate`, `eval`, `gendata`.

### OpenJev (`src/lib/jev/`)

- **`calibration.ts`** — the 5 extensions from §3 (15-bin default, `binStrategy` equal-mass,
  `nll` field, ordinal-ECE via per-threshold `CalPrediction`, per-qtype binned ECE).
- **`otsone.server.ts`** — unchanged wire contract; it already probes the sidecar and maps
  `predict` → strict Choice/Score/Noul with a clean `null` fallback. Point `OTSONE_MODEL` at
  the new checkpoints.
- **`model-cards.ts` / `models.ts`** — register the **`openjev/otsone` family**:
  `otsone-base` (ModernBERT, GPU/Apple), `otsone-lite` (DeBERTa-xsmall, edge), each with its
  three per-type temperatures and published benchmark numbers.
- **`gold/` + `gold.ts`** — feed the 8-axis coverage into `buildCoverage()`; the forced-
  uncertainty (Axis 5 / B10) cases become a permanent regression gate.

### Sequence

1. `calibration.ts` extensions (unblocks the acceptance gate, pure TS, no model needed).
2. `model.py` CORN head + DeBERTa loader.
3. `gendata.py` → generate + filter the 100K corpus.
4. `distill.py` → train `otsone-base`; `calibrate.py` → temperatures.
5. `eval.py` → benchmark vs Laya/Jev/LLM-json baselines (B10 first).
6. `onnx_export.py` INT8 → serve via the existing sidecar; register model cards.
7. Repeat 4–6 for `otsone-lite` (DeBERTa-v3-xsmall, d=384).

---

## 7. Sources

**Architecture**
- ModernBERT (arXiv:2412.13663) — https://arxiv.org/abs/2412.13663
- ModernBERT model card — https://huggingface.co/docs/transformers/model_doc/modernbert
- ModernBERT vs DeBERTaV3, Antoun et al. 2025 — https://arxiv.org/pdf/2504.08716
- CORN ordinal regression (arXiv:2111.08851) — https://arxiv.org/abs/2111.08851
- coral-pytorch — https://github.com/Raschka-research-group/coral-pytorch
- DeBERTa-v3-xsmall — https://huggingface.co/microsoft/deberta-v3-xsmall
- MiniLM (arXiv:2002.10957) — https://arxiv.org/pdf/2002.10957
- LLaDA masked diffusion LM (NeurIPS 2025) — https://ml-gsai.github.io/LLaDA-demo/
- Generative vs Discriminative classification survey (ICML 2025) — https://arxiv.org/html/2506.12181v1

**Calibration & Math**
- On Calibration of Modern Neural Networks, Guo et al. 2017 — https://arxiv.org/abs/1706.04599
- Dirichlet Calibration, Kull et al. NeurIPS 2019 — https://papers.neurips.cc/paper/9397-beyond-temperature-scaling-obtaining-well-calibrated-multi-class-probabilities-with-dirichlet-calibration.pdf
- Structured Matrix Scaling (arXiv:2511.03685) — https://arxiv.org/pdf/2511.03685
- ORCU ordinal calibration (arXiv:2410.15658) — https://arxiv.org/abs/2410.15658
- Generalized Venn / Venn-Abers, van der Laan & Alaa, ICML 2025 (arXiv:2502.05676) — https://arxiv.org/abs/2502.05676
- Focal Temperature Scaling, ECAI 2024 — https://aihub.org/2024/11/28/improving-calibration-by-relating-focal-loss-temperature-scaling-and-properness/
- Dual Focal Loss, ICML 2023 — https://proceedings.mlr.press/v202/tao23a/tao23a.pdf
- Adaptive Temperature Scaling, EMNLP 2024 — https://aclanthology.org/2024.emnlp-main.1007.pdf
- CalArena post-hoc calibration benchmark — https://arxiv.org/pdf/2605.30188

**Training & Data**
- CIST sample-adaptive distillation temperature (arXiv:2605.20357) — https://arxiv.org/abs/2605.20357
- RLCD contrastive distillation, ICLR 2024 (arXiv:2307.12950) — https://arxiv.org/abs/2307.12950
- LoRA Dropout as calibration regularizer (arXiv:2404.09610) — https://arxiv.org/pdf/2404.09610
- UQ with pre-trained LMs (arXiv:2210.04714) — https://arxiv.org/pdf/2210.04714
- Diversity-Oriented Data Augmentation, ACL 2025 — https://aclanthology.org/2025.acl-long.1084.pdf
- Classification-head fine-tuning of tiny LMs (arXiv:2607.03801) — https://arxiv.org/pdf/2607.03801

**Competitive Positioning**
- TypeSafe "System One / Jev" launch — https://typesafe.ai/blog/introducing-system-one-models-and-jev
- Laya (Convai) model page — https://systemonemodels.org/models/laya/
- Laya ONNX — https://huggingface.co/receptron/laya-onnx
- nibzard decision-model-benchmark (Jev ECE 0.246) — https://github.com/nibzard/decision-model-benchmark
- kiwi0719 jev-benchmarks — https://github.com/kiwi0719/jev-benchmarks
- kotoba-lang typed-decisions (DeBERTa vs ModernBERT) — https://github.com/kotoba-lang/typed-decisions
- JSONSchemaBench (constrained decoding) — https://arxiv.org/pdf/2501.10868
- Hidden cost of structured generation (arXiv:2603.03305) — https://arxiv.org/pdf/2603.03305
