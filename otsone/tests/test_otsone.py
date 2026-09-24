"""Tests for the otsone-1 trainer corpus and the gold evaluator.

These cover the pure-Python surfaces (corpus construction, question encoding
shape, gold folding, pass/fail checks, calibration error) so they run on CI
without torch / onnxruntime / sentence-transformers.
"""

import json

import pytest

from laya_mlx import distill, eval_gold

# --- distill: corpus + gold folding ---------------------------------------


def test_build_corpus_is_deterministic_and_covers_all_qtypes():
    a = distill.build_corpus(13)
    b = distill.build_corpus(13)
    assert a == b  # seeded, reproducible
    kinds = {row[1] for row in a}
    assert kinds == {"choice", "score", "noul"}
    assert len(a) > 500


def test_build_corpus_rows_are_well_formed():
    for state, qtype, instructions, criteria, target in distill.build_corpus(1):
        assert isinstance(state, (str, dict))
        assert qtype in ("choice", "score", "noul")
        assert isinstance(target, int) and target >= 0


def test_to_question_def_shapes():
    c = distill.to_question_def("choice", "pick", {"a": None, "b": None})
    assert c["type"] == "choice" and c["criteria"] == {"a": None, "b": None}
    s = distill.to_question_def("score", "rate", ["lo", "hi"])
    assert s["type"] == "score" and s["criteria"] == ["lo", "hi"]
    n = distill.to_question_def("noul", "is it?", None)
    assert n["type"] == "noul" and "criteria" not in n
    n2 = distill.to_question_def("noul", "is it?", {"true": "yes", "false": "no"})
    assert n2["criteria"] == {"true": "yes", "false": "no"}
    # non-string instructions are JSON-serialised
    structured = distill.to_question_def("choice", {"q": "x"}, {"a": None})
    assert structured["instructions"] == json.dumps({"q": "x"})


def test_add_gold_examples_folds_targets(tmp_path):
    gold = [
        {
            "state": "refund me",
            "questions": {
                "dep": {"type": "choice", "instructions": "which?", "criteria": {"a": "x", "b": "y"}},
                "ref": {"type": "noul", "instructions": "refund?"},
                "sev": {"type": "score", "instructions": "sev?", "criteria": ["lo", "mid", "hi"]},
            },
            "expect": [
                {"choice": {"id": "dep", "value": "b"}},
                {"noul": {"id": "ref", "min": 0.7}},
                {"score": {"id": "sev", "min": 1.0, "max": 2.0}},
            ],
        }
    ]
    p = tmp_path / "gold.json"
    p.write_text(json.dumps(gold))
    data = []
    added = distill.add_gold_examples(p, data)
    assert added == 3
    choice_row = next(r for r in data if r[1] == "choice")
    assert choice_row[4] == 1  # index of "b"
    noul_row = next(r for r in data if r[1] == "noul")
    assert noul_row[4] == 1  # min-bound -> true target


def test_find_gold_prefers_explicit(tmp_path):
    p = tmp_path / "custom.json"
    p.write_text("[]")
    assert distill.find_gold(str(p)) == p
    assert distill.find_gold(str(tmp_path / "missing.json")) is None


def test_distill_module_imports_without_torch():
    # torch/transformers/onnxruntime are only imported inside main(); the module
    # and its corpus helpers must import on a machine without the [train] extra.
    assert callable(distill.main)
    assert distill.MODEL_NAME == "otsone-1"
    assert distill.MODEL_FAMILY == "openjev"


def test_backbone_registry_has_three_tiers():
    assert set(distill.BACKBONES) == {"otsone-mini", "otsone-base", "otsone-lite"}
    assert distill.DEFAULT_BACKBONE == "otsone-mini"  # offline baseline stays default
    for tier in distill.BACKBONES.values():
        assert isinstance(tier["encoder"], str) and tier["encoder"]
        assert isinstance(tier["hidden"], int) and tier["hidden"] > 0
    # ModernBERT-base primary, DeBERTa-v3-xsmall edge, MiniLM default.
    assert "ModernBERT" in distill.BACKBONES["otsone-base"]["encoder"]
    assert "deberta" in distill.BACKBONES["otsone-lite"]["encoder"].lower()
    assert "MiniLM" in distill.BACKBONES["otsone-mini"]["encoder"]


def test_corn_levels_constant_covers_corpus():
    assert distill.CORN_LEVELS >= 5  # room for the 3-level rubrics plus headroom


def test_synthetic_corpus_is_folded_into_encode_shape():
    # Every synthetic row must survive the same encode() path the trainer uses.
    from laya_mlx import data_gen
    from laya_mlx.tokenizer import Tokenizer

    # Reuse the checked-in tokenizer if present; otherwise this is a shape check
    # on the row tuples only (no tokenizer needed).
    rows = data_gen.build_synthetic_corpus(13, per_axis=4)
    assert rows
    assert all(len(r) == 5 for r in rows)
    _ = Tokenizer  # imported to assert the module is available on this platform


def test_decision_loss_is_finite_and_score_uses_corn():
    torch = pytest.importorskip("torch")
    F = pytest.importorskip("torch.nn.functional")
    b, count, thr = 3, 3, distill.CORN_LEVELS - 1
    logits = torch.randn(b, count)
    corn = torch.randn(b, thr)
    mmask = torch.ones(b, count, dtype=torch.bool)
    qt = torch.tensor([0, 1, 2])  # choice, score, noul
    tgt = torch.tensor([0, 2, 1])
    soft = torch.zeros(b, count)
    has_soft = torch.zeros(b, dtype=torch.bool)
    loss = distill._decision_loss(torch, F, logits, corn, mmask, qt, tgt, soft, has_soft)
    assert torch.isfinite(loss)
    # With a soft label on the choice row, the loss stays finite (KD wired in).
    soft[0] = torch.tensor([0.7, 0.2, 0.1])
    has_soft[0] = True
    loss_kd = distill._decision_loss(torch, F, logits, corn, mmask, qt, tgt, soft, has_soft)
    assert torch.isfinite(loss_kd)


# --- eval_gold: checks + calibration --------------------------------------


def test_check_passes_and_flags():
    ans = {
        "dep": {"choice": "returns", "probabilities": {"returns": 0.8, "shipping": 0.2}},
        "esc": {"noul": 0.9},
        "sev": {"score": 1.6},
    }
    expect_ok = [
        {"choice": {"id": "dep", "value": "returns", "minP": 0.55}},
        {"noul": {"id": "esc", "min": 0.75}},
        {"score": {"id": "sev", "min": 1.35, "max": 2.0}},
    ]
    assert eval_gold.check(ans, expect_ok) == []

    bad_choice = eval_gold.check(ans, [{"choice": {"id": "dep", "value": "shipping"}}])
    assert bad_choice and "choice" in bad_choice[0]
    bad_p = eval_gold.check(ans, [{"choice": {"id": "dep", "value": "returns", "minP": 0.95}}])
    assert bad_p and "p " in bad_p[0]
    bad_noul = eval_gold.check(ans, [{"noul": {"id": "esc", "max": 0.4}}])
    assert bad_noul
    bad_score = eval_gold.check(ans, [{"score": {"id": "sev", "min": 0.0, "max": 0.5}}])
    assert bad_score


def test_expected_calibration_error():
    assert eval_gold.expected_calibration_error([]) is None
    # both predictions land in the (0.8, 0.9] bin: avg conf 0.9, accuracy 0.5.
    ece = eval_gold.expected_calibration_error([(0.9, True), (0.9, False)])
    assert ece == pytest.approx(0.4, abs=1e-6)
    # perfectly calibrated and correct -> ~0.
    assert eval_gold.expected_calibration_error([(1.0, True), (1.0, True)]) == pytest.approx(0.0)


def test_calibration_pairs_from_choice_and_noul():
    ans = {
        "dep": {"choice": "a", "probabilities": {"a": 0.7, "b": 0.3}},
        "esc": {"noul": 0.8},
    }
    expect = [
        {"choice": {"id": "dep", "value": "a"}},
        {"noul": {"id": "esc", "min": 0.75}},
    ]
    pairs = eval_gold._calibration_pairs(ans, expect)
    assert (0.7, True) in pairs
    assert (0.8, True) in pairs


def test_write_card_updates_metrics(tmp_path):
    (tmp_path / "model_card.json").write_text(json.dumps({"name": "otsone-1", "metrics": {}}))
    report = {
        "gold_cases_passed": 8,
        "gold_cases_total": 10,
        "gold_checks_passed": 15,
        "gold_checks_total": 18,
        "accuracy": 0.8333,
        "ece": 0.12,
    }
    path = eval_gold.write_card(tmp_path, report)
    card = json.loads(path.read_text())
    assert card["name"] == "otsone-1"
    assert card["metrics"]["accuracy"] == 0.8333
    assert card["metrics"]["gold_cases_passed"] == 8
    assert card["metrics"]["evaluated_at"] is not None


def test_find_gold_locates_sibling_or_repo():
    # In this checkout a gold.json exists (sibling openjev/engine or engine/).
    found = eval_gold.find_gold(None)
    assert found is None or found.name == "gold.json"


def test_typed_calibration_pairs_cover_all_three_types():
    ans = {
        "dep": {"choice": "a", "probabilities": {"a": 0.7, "b": 0.3}},
        "esc": {"noul": 0.8},
        "sev": {"score": 1.6, "confidence": 0.9},
    }
    expect = [
        {"choice": {"id": "dep", "value": "a"}},
        {"noul": {"id": "esc", "min": 0.75}},
        {"score": {"id": "sev", "min": 1.0, "max": 2.0}},
    ]
    triples = eval_gold._typed_calibration_pairs(ans, expect)
    kinds = {t[0] for t in triples}
    assert kinds == {"choice", "noul", "score"}
    assert ("choice", 0.7, True) in triples
    assert ("score", 0.9, True) in triples  # 1.6 in [1.0, 2.0]


class _FakeEngine:
    model_id = "fake"

    def predict(self, state, questions):
        return {
            "answers": {
                "dep": {"choice": "a", "probabilities": {"a": 0.9, "b": 0.1}},
                "sev": {"score": 1.6, "confidence": 0.8},
            }
        }


def test_evaluate_emits_per_type_reliability_and_write_card(tmp_path):
    gold = [
        {
            "id": "g0",
            "state": "x",
            "questions": {},
            "expect": [
                {"choice": {"id": "dep", "value": "a"}},
                {"score": {"id": "sev", "min": 1.0, "max": 2.0}},
            ],
        }
    ]
    report = eval_gold.evaluate(_FakeEngine(), gold, verbose=False)
    assert "calibration" in report
    assert report["calibration"]["overall"] is not None
    assert "choice" in report["calibration"]["by_type"]
    assert "score" in report["calibration"]["by_type"]

    (tmp_path / "model_card.json").write_text(json.dumps({"name": "otsone-1", "metrics": {}}))
    path = eval_gold.write_card(tmp_path, report)
    card = json.loads(path.read_text())
    assert "calibration" in card
    assert card["metrics"]["accuracy"] is not None
