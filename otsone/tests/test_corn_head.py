"""The optional CORN score head on the MLX DecisionModel (v2 mirror).

Runs on MLX only (no torch), exercising the inference-side head that mirrors the
torch training head so served scores are rank-consistent.
"""

import numpy as np
import pytest

mx = pytest.importorskip("mlx.core")

from laya_mlx.model import DecisionModel, EncoderConfig  # noqa: E402


def _tiny_cfg():
    return EncoderConfig.from_dict(
        {
            "model_type": "modernbert",
            "vocab_size": 64,
            "hidden_size": 32,
            "intermediate_size": 64,
            "num_hidden_layers": 3,
            "num_attention_heads": 2,
        }
    )


def _batch():
    return {
        "input_ids": mx.array(np.random.default_rng(0).integers(1, 64, (2, 20)).astype(np.int32)),
        "attention_mask": mx.array(np.ones((2, 20), np.int32)),
        "marker_pos": mx.array(np.array([[3, 6, 9], [4, 7, 0]], np.int32)),
        "marker_mask": mx.array(np.array([[1, 1, 1], [1, 1, 0]], bool)),
        "qtype": mx.array(np.array([0, 1], np.int32)),
    }


def test_decision_model_without_corn_returns_two_outputs():
    model = DecisionModel(_tiny_cfg(), {"head_layers": 1, "act_costs": {}})
    assert model.corn is None
    out = model(**_batch())
    assert len(out) == 2  # logits, action -- unchanged Laya contract


def test_decision_model_with_corn_emits_threshold_logits():
    model = DecisionModel(_tiny_cfg(), {"head_layers": 1, "act_costs": {}, "corn_levels": 6})
    assert model.corn is not None
    out = model(**_batch())
    assert len(out) == 3  # logits, action, corn_logits
    logits, action, corn = out
    mx.eval(logits, action, corn)
    corn = np.asarray(corn)
    assert corn.shape == (2, 5)  # corn_levels - 1
    assert np.isfinite(corn).all()
