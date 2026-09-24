"""Streaming typed-decision inference: yield one answer per question as ready.

The batch engines (:class:`laya_mlx.server.OnnxEngine` and the MLX
:class:`laya_mlx.Agent`) compute every answer, then return the whole map. When a
caller wants to surface results incrementally -- an SSE stream from the sidecar,
a progress bar over a large question set -- this module runs the same forward
passes but ``yield``s each ``(question_id, answer)`` the moment its batch
completes, in question order.

The answer dictionaries are byte-for-byte the same as the batch path: this module
reuses each engine's own prompt construction, collation and forward, and only
changes *when* a row is emitted, never *what* it contains.

Import safety: only :mod:`numpy` and :mod:`laya_mlx.common` are imported at module
load, so this stays importable off Apple silicon (CI). The MLX runtime is imported
lazily inside the MLX branch; the ONNX branch touches only the engine that was
handed in.
"""

from __future__ import annotations

from typing import Any, Iterator, Optional, Tuple

import numpy as np

from .common import confidence_from_probs, temp_bucket

Answer = dict
StreamItem = Tuple[str, Answer]


def build_answer(q: dict, probs: np.ndarray, k: int, act_prob: Optional[float]) -> Answer:
    """Assemble one answer dict from a probability vector.

    Identical in shape and rounding to ``OnnxEngine.predict`` / ``Agent.system_one``
    so a streamed answer is indistinguishable from a batched one.
    """
    p = np.asarray(probs, dtype=np.float64)[:k]
    answer: Answer = {
        "type": q["t"],
        "confidence": round(confidence_from_probs(p, k), 4),
    }
    if act_prob is not None:
        answer["action"] = {"act_probability": round(float(act_prob), 4)}
    if q["t"] == "choice":
        labels = list(q["crit"])
        answer["choice"] = labels[int(p.argmax())]
        answer["probabilities"] = {lbl: round(float(v), 4) for lbl, v in zip(labels, p)}
    elif q["t"] == "score":
        answer["score"] = round(float((np.arange(k) * p).sum()), 4)
        answer["legend"] = {str(i): value for i, value in enumerate(q["crit"])}
        answer["probabilities"] = {str(i): round(float(v), 4) for i, v in enumerate(p)}
    else:
        p1 = float(p[1])
        answer["noul"] = round(p1, 4)
        answer["confidence"] = round(max(p1, 1.0 - p1), 4)
    return answer


def _softmax_rows(logits: np.ndarray) -> np.ndarray:
    z = logits - logits.max(axis=-1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(axis=-1, keepdims=True)


def _stream_onnx(engine: Any, state: Any, questions: dict, batch_size: int) -> Iterator[StreamItem]:
    """Stream answers from an :class:`laya_mlx.server.OnnxEngine`."""
    np_ = engine.np
    items, internal, qids = engine._prepare(state, questions)
    for start in range(0, len(items), batch_size):
        chunk = items[start : start + batch_size]
        batch = engine._collate(chunk)
        logits, action = engine._run(batch)
        if not np_.isfinite(logits).all():
            raise FloatingPointError("Non-finite logits from ONNX model")
        act = None if action is None else _softmax_rows(np_.asarray(action, dtype=np_.float64))
        for row, item in enumerate(chunk):
            qid, q = qids[start + row], internal[start + row]
            k, qt = len(item["markers"]), item["qtype"]
            scale = engine.temperature_by_options.get(temp_bucket(qt, k), engine.temperature[qt])
            z = np.asarray(logits[row, :k], dtype=np.float64) / scale
            z = z - z.max()
            p = np.exp(z)
            p /= p.sum()
            act_prob = None if act is None else float(act[row, 0])
            yield qid, build_answer(q, p, k, act_prob)


def _stream_mlx(agent: Any, state: Any, questions: dict, batch_size: int) -> Iterator[StreamItem]:
    """Stream answers from the MLX :class:`laya_mlx.Agent` runtime (Apple silicon)."""
    from .agent import collate_items  # lazy: pulls in mlx, Apple-only

    items, internal = agent.prepare(state, questions)
    qids = list(questions)
    for start in range(0, len(items), batch_size):
        chunk = items[start : start + batch_size]
        batch = collate_items(
            chunk,
            agent.tok.pad_token_id,
            pad_to_multiple=agent.pad_to_multiple,
            max_length=agent.cfg.get("max_len", 512),
        )
        logits, act = agent.forward(batch)
        logits, act = np.asarray(logits), np.asarray(act)
        if not np.isfinite(logits).all() or not np.isfinite(act).all():
            raise FloatingPointError("Non-finite model outputs; retry with dtype='float32'")
        act = _softmax_rows(act.astype(np.float64))
        for row, item in enumerate(chunk):
            qid, q = qids[start + row], internal[start + row]
            k, qt = len(item["markers"]), item["qtype"]
            scale = agent.temperature_by_options.get(temp_bucket(qt, k), agent.temperature[qt])
            z = np.asarray(logits[row, :k], dtype=np.float64) / scale
            z = z - z.max()
            p = np.exp(z)
            p /= p.sum()
            yield qid, build_answer(q, p, k, float(act[row, 0]))


def predict_stream(
    engine: Any, state: Any, questions: dict, *, batch_size: Optional[int] = None
) -> Iterator[StreamItem]:
    """Yield ``(question_id, answer)`` per question as each forward batch completes.

    ``engine`` may be an :class:`laya_mlx.server.OnnxEngine`, an
    :class:`laya_mlx.server.MlxEngine`, or an :class:`laya_mlx.Agent`. Answers are
    produced in question-definition order; the caller can assemble them into the
    same ``answers`` map the batch path returns, or emit them one at a time.
    """
    if not isinstance(questions, dict):
        raise ValueError("questions must be an object keyed by question id")
    # Unwrap the sidecar's thin MLX wrapper to its underlying Agent.
    if hasattr(engine, "agent") and not hasattr(engine, "session"):
        engine = engine.agent
    if hasattr(engine, "session"):  # OnnxEngine
        size = batch_size or getattr(engine, "batch_size", 16)
        yield from _stream_onnx(engine, state, questions, max(1, int(size)))
    elif hasattr(engine, "forward") and hasattr(engine, "prepare"):  # MLX Agent
        size = batch_size or getattr(engine, "batch_size", 16)
        yield from _stream_mlx(engine, state, questions, max(1, int(size)))
    else:
        raise TypeError(
            "predict_stream needs an OnnxEngine, MlxEngine, or laya_mlx.Agent; "
            f"got {type(engine).__name__}"
        )


def stream_response(
    engine: Any, state: Any, questions: dict, *, batch_size: Optional[int] = None
) -> dict:
    """Drain :func:`predict_stream` into the same ``{model, answers, usage}`` envelope.

    A convenience for callers that want streaming's early-emit behaviour internally
    but still return the batch schema. ``usage.output_tokens`` is always 0 (System
    One emits no tokens); ``input_tokens`` is reported as 0 here because the token
    counts live on the engine's own prepared items, which streaming does not retain.
    """
    answers: dict[str, Answer] = {}
    for qid, answer in predict_stream(engine, state, questions, batch_size=batch_size):
        answers[qid] = answer
    model_id = getattr(engine, "model_id", None) or getattr(
        getattr(engine, "agent", None), "model_id", "laya"
    )
    return {"model": model_id, "answers": answers, "usage": {"output_tokens": 0}}


__all__ = ["predict_stream", "stream_response", "build_answer"]
