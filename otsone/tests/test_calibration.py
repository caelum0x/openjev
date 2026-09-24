"""Tests for the pure-Python CORN + reliability math (laya_mlx.calibration).

Dependency-free, so these run on CI without numpy/torch/onnxruntime/MLX.
"""

import math

import pytest

from laya_mlx import calibration as cal

# --- CORN ordinal head -----------------------------------------------------


def test_corn_cumulative_is_rank_consistent_and_monotone():
    # Any real logits must give a non-increasing exceedance chain (P(y>k)).
    for logits in ([2.0, 1.0, 0.0], [-1.0, 3.0, -2.0, 0.5], [0.0, 0.0, 0.0, 0.0]):
        cum = cal.corn_cumulative(logits)
        assert all(0.0 <= p <= 1.0 for p in cum)
        assert all(cum[i] >= cum[i + 1] - 1e-12 for i in range(len(cum) - 1))


def test_corn_pmf_sums_to_one_and_matches_expected_level():
    logits = [1.5, 0.5, -0.5]
    pmf = cal.corn_pmf(logits)
    assert len(pmf) == len(logits) + 1
    assert math.isclose(sum(pmf), 1.0, abs_tol=1e-9)
    # E[y] = sum_k k*pmf_k == sum_k P(y>k)  (the tail-sum identity)
    by_pmf = sum(i * p for i, p in enumerate(pmf))
    assert math.isclose(by_pmf, cal.corn_expected_level(logits), abs_tol=1e-9)


def test_corn_temperature_softens_cumulatives():
    logits = [2.0, 2.0, 2.0]
    sharp = cal.corn_expected_level(logits, temperature=0.5)
    soft = cal.corn_expected_level(logits, temperature=3.0)
    # A higher temperature pulls thresholds toward 0.5, lowering the expected level.
    assert soft < sharp


def test_corn_ordinal_pairs_grade_each_threshold():
    logits = [3.0, 3.0, 3.0]  # strongly exceeds every threshold
    pairs = cal.corn_ordinal_pairs(logits, y_true=3)  # true level 3 > every k
    assert len(pairs) == 3
    assert all(correct for _, correct in pairs)
    # A low true level makes the high-confidence exceed predictions wrong.
    wrong = cal.corn_ordinal_pairs(logits, y_true=0)
    assert not any(correct for _, correct in wrong)


def test_corn_conditional_nll_prefers_correct_thresholds():
    # Logits that exceed the first threshold; level 1 (>0, not >1).
    rows = [([4.0, -4.0], 1)]
    good = cal.corn_conditional_nll(rows, temperature=1.0)
    assert good < 0.1  # near-perfect conditional fit
    bad_rows = [([-4.0, 4.0], 1)]  # says "does not exceed 0" -> wrong
    assert cal.corn_conditional_nll(bad_rows) > good


# --- reliability -----------------------------------------------------------


def test_reliability_reports_ece_mce_brier_nll():
    # Two predictions at conf 0.9, one right one wrong -> acc 0.5 in that bin.
    rep = cal.reliability([(0.9, True), (0.9, False)], bins=10)
    assert rep is not None
    assert rep["ece"] == pytest.approx(0.4, abs=1e-6)
    assert rep["mce"] == pytest.approx(0.4, abs=1e-6)
    assert 0.0 <= rep["brier"] <= 1.0
    assert rep["nll"] > 0.0
    assert cal.reliability([]) is None


def test_reliability_equal_mass_vs_equal_width():
    pairs = [(0.95, True)] * 8 + [(0.55, False)] * 2
    width = cal.reliability(pairs, bins=5, strategy="equal-width")
    mass = cal.reliability(pairs, bins=5, strategy="equal-mass")
    assert width is not None and mass is not None
    # Both are valid ECEs in [0,1]; equal-mass rebalances bucket counts.
    assert 0.0 <= width["ece"] <= 1.0
    assert 0.0 <= mass["ece"] <= 1.0


def test_per_type_reliability_skips_empty_and_adds_adaptive():
    by_type = {
        "choice": [(0.8, True), (0.8, True), (0.2, False)],
        "noul": [],
    }
    out = cal.per_type_reliability(by_type, bins=5)
    assert "choice" in out and "noul" not in out
    assert "adaptive_ece" in out["choice"]


# --- temperature fitting ---------------------------------------------------


def test_fit_temperature_nll_softens_overconfident_logits():
    # Very sharp logits that are only 50% correct should be softened (T > 1).
    rows = [([5.0, -5.0], 0), ([5.0, -5.0], 1)]
    t = cal.fit_temperature_nll(rows)
    assert t > 1.0


def test_fit_temperature_corn_returns_grid_value():
    rows = [([3.0, -1.0], 1), ([2.0, -2.0], 1), ([-3.0, -3.0], 0)]
    t = cal.fit_temperature_corn(rows)
    assert t in cal.TEMP_GRID
    assert cal.fit_temperature_corn([]) == 1.0
