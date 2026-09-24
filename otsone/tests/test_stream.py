"""Streaming inference tests that do not require torch or onnxruntime.

They drive :func:`laya_mlx.stream.predict_stream` with a fake engine that mimics
the :class:`laya_mlx.server.OnnxEngine` interface (``session``, ``_prepare``,
``_collate``, ``_run``, temperatures), so the plumbing and per-question answer
shape are exercised on CI without the ML extras installed.
"""

import numpy as np
import pytest

from laya_mlx.common import QTYPES, render_options
from laya_mlx.server import to_internal
from laya_mlx.stream import build_answer, predict_stream, stream_response


class FakeOnnxEngine:
    """Minimal stand-in exposing exactly what the ONNX streaming path touches."""

    def __init__(self, logits_by_qid, batch_size=2):
        self.np = np
        self.session = object()  # marks this as the ONNX branch
        self.model_id = "fake-onnx:test"
        self.batch_size = batch_size
        self.temperature = [1.0, 1.0, 1.0]
        self.temperature_by_options = {}
        self._logits_by_qid = logits_by_qid

    def _prepare(self, state, questions):
        items, internal, qids = [], [], []
        for qid, definition in questions.items():
            q = to_internal(definition)
            k = len(render_options(q))
            items.append(
                {
                    "ids": [0, 1, 2],
                    "markers": list(range(k)),
                    "qtype": QTYPES[q["t"]],
                    "logit": np.asarray(self._logits_by_qid[qid], dtype=np.float32),
                }
            )
            internal.append(q)
            qids.append(qid)
        return items, internal, qids

    def _collate(self, chunk):
        return chunk

    def _run(self, batch):
        count = max(len(it["markers"]) for it in batch)
        out = np.full((len(batch), count), -1e4, dtype=np.float32)
        for i, it in enumerate(batch):
            lg = it["logit"]
            out[i, : len(lg)] = lg
        return out, None


def _questions():
    return {
        "topic": {"type": "choice", "instructions": "Choose", "criteria": ["a", "b", "c"]},
        "level": {"type": "score", "instructions": "Level", "criteria": ["low", "mid", "high"]},
        "yes": {"type": "noul", "instructions": "Is this true?"},
    }


def _logits():
    return {
        "topic": [0.1, 5.0, 0.2],  # argmax -> "b"
        "level": [0.0, 0.0, 6.0],  # score near 2.0
        "yes": [0.0, 4.0],  # noul -> high P(true)
    }


def test_predict_stream_yields_each_question_in_order():
    engine = FakeOnnxEngine(_logits(), batch_size=2)
    out = list(predict_stream(engine, "hello", _questions()))
    assert [qid for qid, _ in out] == ["topic", "level", "yes"]

    answers = dict(out)
    assert answers["topic"]["type"] == "choice"
    assert answers["topic"]["choice"] == "b"
    assert answers["topic"]["probabilities"]["b"] > 0.9
    assert answers["level"]["type"] == "score"
    assert answers["level"]["score"] > 1.8
    assert answers["yes"]["type"] == "noul"
    assert answers["yes"]["noul"] > 0.9
    assert 0.0 <= answers["yes"]["confidence"] <= 1.0


def test_stream_response_matches_streamed_answers():
    engine = FakeOnnxEngine(_logits())
    streamed = dict(predict_stream(engine, "hello", _questions()))
    envelope = stream_response(engine, "hello", _questions())
    assert envelope["model"] == "fake-onnx:test"
    assert envelope["usage"]["output_tokens"] == 0
    assert envelope["answers"] == streamed


def test_predict_stream_batching_is_answer_invariant():
    q = _questions()
    one = dict(predict_stream(FakeOnnxEngine(_logits(), batch_size=1), "x", q))
    big = dict(predict_stream(FakeOnnxEngine(_logits(), batch_size=10), "x", q))
    assert one == big


def test_build_answer_choice_score_noul():
    choice = build_answer({"t": "choice", "crit": {"a": None, "b": None}}, np.array([0.8, 0.2]), 2, 0.3)
    assert choice["choice"] == "a" and choice["action"]["act_probability"] == 0.3
    score = build_answer({"t": "score", "crit": ["lo", "hi"]}, np.array([0.25, 0.75]), 2, None)
    assert score["score"] == 0.75 and "action" not in score
    noul = build_answer({"t": "noul", "crit": None}, np.array([0.1, 0.9]), 2, None)
    assert noul["noul"] == 0.9 and noul["confidence"] == 0.9


def test_predict_stream_rejects_bad_inputs():
    engine = FakeOnnxEngine(_logits())
    with pytest.raises(ValueError):
        list(predict_stream(engine, "x", ["not", "a", "dict"]))
    with pytest.raises(TypeError):
        list(predict_stream(object(), "x", {"q": {"type": "noul", "instructions": "y"}}))
