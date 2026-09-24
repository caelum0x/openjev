"""Pure-Python calibration math for otsone-1 (CORN ordinal + reliability).

This module is the Python twin of ``openjev/src/lib/jev/calibration.ts``.
It is deliberately dependency-free (standard library only) so it imports on CI
without numpy/torch/onnxruntime/MLX, and so the ONNX serving path
(:mod:`laya_mlx.server`) and the trainer (:mod:`laya_mlx.distill`) can share one
implementation of:

* **CORN ordinal head math** -- rank-consistent cumulative exceedance
  probabilities ``P(y>k) = prod_{j<=k} sigmoid(z_j / T)`` and the derived
  expected level, per-level PMF, and ordinal ECE pairs.
* **Reliability** -- binned ECE (equal-width *and* equal-mass / adaptive),
  MCE, Brier, and NLL, plus per-type breakdowns. This mirrors the extensions
  called for in ``docs/RESEARCH-OTSONE.md`` section 3 so the acceptance gate is
  the same shape on both sides of the wire.

The tie to openjev: the TS ``buildReliability`` returns ``{bins, ece, mce,
brier}``; :func:`reliability` returns the same fields plus ``nll`` and the
adaptive (equal-mass) ECE, and CORN thresholds are emitted as one
``(confidence, correct)`` pair per threshold exactly as the TS ``CalPrediction``
schema anticipates. isotonic/Venn-Abers stay offline (post-hoc, not per-request);
here we ship the strictly-proper metrics and the argmax-preserving temperature
objective that populate the ``temperature`` config the runtime already reads.
"""

from __future__ import annotations

import math
from typing import Dict, List, Optional, Sequence, Tuple

# A CORN/temperature scalar is confined to this band for the same reason
# ``common.clamp_temperature`` clamps served temperatures: a value < the floor
# sharpens logits into over-confidence. Fitting is done within this range.
TEMP_GRID = (0.5, 0.7, 0.85, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0)


def sigmoid(x: float) -> float:
    """Numerically stable logistic sigmoid on a Python float."""
    if x >= 0.0:
        z = math.exp(-x)
        return 1.0 / (1.0 + z)
    z = math.exp(x)
    return z / (1.0 + z)


def _temp(temperature: float) -> float:
    try:
        t = float(temperature)
    except (TypeError, ValueError):
        return 1.0
    if not math.isfinite(t) or t <= 0.0:
        return 1.0
    return t


# ---------------------------------------------------------------------------
# CORN ordinal head math (the key otsone upgrade over Laya's unified scorer).
# ---------------------------------------------------------------------------


def corn_conditionals(logits: Sequence[float], temperature: float = 1.0) -> List[float]:
    """Per-threshold conditional probabilities ``q_k = P(y>k | y>k-1)``."""
    t = _temp(temperature)
    return [sigmoid(float(z) / t) for z in logits]


def corn_cumulative(logits: Sequence[float], temperature: float = 1.0) -> List[float]:
    """Rank-consistent cumulative exceedance ``P(y>k) = prod_{j<=k} q_j``.

    The chain of products is monotonically non-increasing because every factor
    is in ``[0,1]`` -- this is what makes the head rank-consistent *by
    construction* (no sorting or projection needed).
    """
    cumulative: List[float] = []
    running = 1.0
    for q in corn_conditionals(logits, temperature):
        running *= q
        cumulative.append(running)
    return cumulative


def corn_expected_level(logits: Sequence[float], temperature: float = 1.0) -> float:
    """Expected ordinal level ``E[y] = sum_k P(y>k)`` in ``[0, K-1]``.

    Uses the identity ``E[Y] = sum_{k>=0} P(Y>k)``. Divide by ``K-1`` for the
    normalized ``[0,1]`` score in the research spec; the served answer keeps the
    ``[0, K-1]`` level so it stays comparable with the gold rubric bands.
    """
    return math.fsum(corn_cumulative(logits, temperature))


def corn_pmf(logits: Sequence[float], temperature: float = 1.0) -> List[float]:
    """Per-level probability mass from the CORN cumulatives (length ``K``)."""
    cumulative = corn_cumulative(logits, temperature)
    levels = len(cumulative) + 1
    if levels == 1:
        return [1.0]
    pmf = [0.0] * levels
    pmf[0] = 1.0 - cumulative[0]
    for k in range(1, levels - 1):
        pmf[k] = cumulative[k - 1] - cumulative[k]
    pmf[levels - 1] = cumulative[-1]
    return [x if x > 0.0 else 0.0 for x in pmf]


def corn_ordinal_pairs(
    logits: Sequence[float], y_true: int, temperature: float = 1.0
) -> List[Tuple[float, bool]]:
    """One ``(confidence, correct)`` pair per CORN threshold for ordinal ECE.

    ``confidence`` is ``P(y>k)`` folded to the predicted side of 0.5, and
    ``correct`` is whether the true level actually exceeds ``k`` -- exactly the
    per-threshold ``CalPrediction`` the TS harness consumes for ``ECE_ord``.
    """
    pairs: List[Tuple[float, bool]] = []
    for k, p_exceed in enumerate(corn_cumulative(logits, temperature)):
        predicted_exceed = p_exceed >= 0.5
        actual_exceed = y_true > k
        confidence = p_exceed if predicted_exceed else 1.0 - p_exceed
        pairs.append((confidence, predicted_exceed == actual_exceed))
    return pairs


def corn_conditional_nll(
    rows: Sequence[Tuple[Sequence[float], int]], temperature: float = 1.0
) -> float:
    """Mean conditional CORN NLL over ``(threshold_logits, level)`` rows.

    Only the conditional training set ``{i : y_i >= k}`` contributes threshold
    ``k`` (CORN's conditional restriction), so the objective is the same one the
    head was trained on -- fitting ``T_score`` against it stays consistent.
    """
    total = 0.0
    count = 0
    for logits, y in rows:
        conditionals = corn_conditionals(logits, temperature)
        for k, q in enumerate(conditionals):
            if y < k:  # outside the conditional subset {y >= k}
                continue
            hit = 1.0 if y > k else 0.0
            q = min(max(q, 1e-9), 1.0 - 1e-9)
            total += -(hit * math.log(q) + (1.0 - hit) * math.log(1.0 - q))
            count += 1
    return total / count if count else 0.0


# ---------------------------------------------------------------------------
# Reliability (ECE / MCE / Brier / NLL), mirroring calibration.ts.
# ---------------------------------------------------------------------------


def _clamp01(x: float) -> float:
    if math.isnan(x):
        return 0.0
    return min(1.0, max(0.0, x))


def reliability(
    pairs: Sequence[Tuple[float, bool]],
    bins: int = 15,
    strategy: str = "equal-width",
) -> Optional[dict]:
    """Binned reliability report over ``(confidence, correct)`` pairs.

    ``strategy`` is ``"equal-width"`` (fixed 1/n buckets, the classic ECE) or
    ``"equal-mass"`` (quantile buckets with ~equal counts, the adaptive ECE that
    is fairer when predictions cluster near 1.0). Returns ``None`` when empty.

    The default ``bins=15`` follows the spec's bump from the biased 5-bin ECE.
    """
    if not pairs:
        return None
    n = max(1, int(bins))
    data = [(_clamp01(float(c)), bool(k)) for c, k in pairs]
    total = len(data)

    if strategy == "equal-mass":
        ordered = sorted(data, key=lambda pc: pc[0])
        buckets: List[List[Tuple[float, bool]]] = []
        for i in range(n):
            lo = (i * total) // n
            hi = ((i + 1) * total) // n
            if hi > lo:
                buckets.append(ordered[lo:hi])
    else:
        indexed: List[List[Tuple[float, bool]]] = [[] for _ in range(n)]
        for c, k in data:
            idx = min(n - 1, int(c * n))
            indexed[idx].append((c, k))
        buckets = [b for b in indexed if b]

    ece = 0.0
    mce = 0.0
    report_bins = []
    for bucket in buckets:
        cnt = len(bucket)
        avg_conf = math.fsum(c for c, _ in bucket) / cnt
        acc = sum(1 for _, k in bucket if k) / cnt
        err = abs(acc - avg_conf)
        ece += (cnt / total) * err
        mce = max(mce, err)
        report_bins.append(
            {
                "count": cnt,
                "avg_confidence": round(avg_conf, 4),
                "accuracy": round(acc, 4),
                "gap": round(acc - avg_conf, 4),
            }
        )

    brier = math.fsum((c - (1.0 if k else 0.0)) ** 2 for c, k in data) / total
    nll = 0.0
    for c, k in data:
        p = min(max(c, 1e-9), 1.0 - 1e-9)
        nll += -(math.log(p) if k else math.log(1.0 - p))
    nll /= total

    return {
        "count": total,
        "accuracy": round(sum(1 for _, k in data if k) / total, 4),
        "avg_confidence": round(math.fsum(c for c, _ in data) / total, 4),
        "ece": round(ece, 4),
        "mce": round(mce, 4),
        "brier": round(brier, 4),
        "nll": round(nll, 4),
        "bins": report_bins,
    }


def per_type_reliability(
    pairs_by_type: Dict[str, Sequence[Tuple[float, bool]]],
    bins: int = 15,
) -> Dict[str, dict]:
    """Reliability per question type (choice/score/noul), skipping empty types."""
    out: Dict[str, dict] = {}
    for qtype, pairs in pairs_by_type.items():
        rep = reliability(pairs, bins=bins)
        if rep is not None:
            rep_adaptive = reliability(pairs, bins=bins, strategy="equal-mass")
            rep["adaptive_ece"] = rep_adaptive["ece"] if rep_adaptive else None
            out[qtype] = rep
    return out


def fit_temperature_nll(
    logits_rows: Sequence[Tuple[Sequence[float], int]],
    grid: Sequence[float] = TEMP_GRID,
) -> float:
    """Argmax-preserving temperature for a softmax head via NLL minimisation.

    ``logits_rows`` are ``(class_logits, target_index)``. Scanning a temperature
    grid keeps this dependency-free; the winner minimises multi-class NLL, which
    (unlike accuracy) is sensitive to the *confidence* of every prediction.
    """
    best_t, best_nll = 1.0, math.inf
    for t in grid:
        t = _temp(t)
        nll = 0.0
        count = 0
        for logits, target in logits_rows:
            if not logits or target < 0 or target >= len(logits):
                continue
            scaled = [float(z) / t for z in logits]
            m = max(scaled)
            exps = [math.exp(z - m) for z in scaled]
            denom = math.fsum(exps)
            p = exps[target] / denom if denom else 1e-9
            nll += -math.log(max(p, 1e-9))
            count += 1
        if count and nll / count < best_nll:
            best_nll, best_t = nll / count, t
    return best_t


def fit_temperature_corn(
    rows: Sequence[Tuple[Sequence[float], int]],
    grid: Sequence[float] = TEMP_GRID,
) -> float:
    """Temperature for the CORN score head that minimises conditional CORN NLL."""
    if not rows:
        return 1.0
    best_t, best_nll = 1.0, math.inf
    for t in grid:
        nll = corn_conditional_nll(rows, _temp(t))
        if nll < best_nll:
            best_nll, best_t = nll, _temp(t)
    return best_t
