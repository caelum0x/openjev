"""Tests for the 8-axis teacher-distillation data recipe (laya_mlx.data_gen).

Pure-Python and offline: the teacher hook is exercised only via its deterministic
fallback and an injected fake teacher, never over the network.
"""

import math

from laya_mlx import data_gen


def test_axes_are_the_eight_gold_axes():
    assert data_gen.AXES == (
        "paraphrase",
        "negation",
        "domain-shift",
        "ambiguous",
        "minimal",
        "longform",
        "structured",
        "multilingual",
    )


def test_build_synthetic_corpus_is_deterministic():
    a = data_gen.build_synthetic_corpus(13)
    b = data_gen.build_synthetic_corpus(13)
    assert a == b
    assert len(a) == len(data_gen.AXES) * 12  # per_axis default


def test_build_synthetic_corpus_rows_are_well_formed():
    rows = data_gen.build_synthetic_corpus(7, per_axis=6)
    for state, qtype, instructions, criteria, target in rows:
        assert isinstance(state, (str, dict))
        assert qtype in ("choice", "score", "noul")
        assert isinstance(instructions, str)
        assert isinstance(target, int) and target >= 0
        if qtype == "choice":
            assert isinstance(criteria, dict) and target < len(criteria)
        elif qtype == "score":
            assert isinstance(criteria, list) and target < len(criteria)


def test_all_axes_produce_rows():
    for axis in data_gen.AXES:
        rows = data_gen.build_synthetic_corpus(1, axes=[axis], per_axis=8)
        assert rows, f"axis {axis} produced no rows"


def test_teacher_unavailable_without_key():
    assert data_gen.teacher_available({}) is False
    assert data_gen.teacher_available({"OTSONE_TEACHER_API_KEY": "  "}) is False
    assert data_gen.teacher_available({"OTSONE_TEACHER_API_KEY": "sk-x"}) is True


def test_deterministic_soft_labels_peak_at_target_and_sum_to_one():
    rows = [("state", "choice", "q", {"a": None, "b": None, "c": None}, 1)]
    labels = data_gen.soft_labels_for(rows, [3], env={})
    dist = labels[0]
    assert len(dist) == 3
    assert math.isclose(sum(dist), 1.0, abs_tol=1e-9)
    assert dist[1] == max(dist)  # mass concentrates on the target
    assert min(dist) > 0.0  # not one-hot: dark knowledge preserved


def test_injected_teacher_used_and_falls_back_on_none():
    rows = [
        ("s0", "choice", "q", {"a": None, "b": None}, 0),
        ("s1", "choice", "q", {"a": None, "b": None}, 1),
    ]

    def fake_teacher(row, num_options):
        # decline the second row -> forces deterministic fallback for it
        return [0.6, 0.4] if row[0] == "s0" else None

    labels = data_gen.soft_labels_for(rows, [2, 2], teacher=fake_teacher, env={})
    assert labels[0] == [0.6, 0.4]
    assert math.isclose(sum(labels[1]), 1.0, abs_tol=1e-9)
    assert labels[1][1] == max(labels[1])  # fallback peaks at target index 1
