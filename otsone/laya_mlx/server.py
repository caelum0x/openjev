"""Laya HTTP sidecar: real typed-decision inference over the SystemOne wire.

Ported from ``openjev/scripts/laya_sidecar.py`` into this package so both
backends share this package's prompt construction and calibration
(:mod:`laya_mlx.common`) and its Rust tokenizer (:mod:`laya_mlx.tokenizer`)
rather than a duplicated copy.

Two backends, both real (a fabricated decision is never returned):

* ``mlx``  -- delegates to the installed :class:`laya_mlx.Agent` runtime
  (Apple silicon; the default on macOS).
* ``onnx`` -- loads ``model.onnx`` + tokenizer + configs from a local checkpoint
  directory and runs :mod:`onnxruntime` directly (the default off macOS). The
  prompt/calibration pipeline is this package's own, so the ONNX path does not
  import MLX and stays importable on CI.

Fail-clean contract: when the model or its runtime is not present the engine is
``None``; ``GET /health`` reports ``{"ok": false, "error": ...}`` and
``POST /v1/systemone`` returns HTTP 503. The Node caller treats a non-OK health
or non-200 response as a signal to fall back to its deterministic local engine.

Endpoints
    GET  /health        -> {"ok", "engine", "model"?, "error"?}
    POST /v1/systemone   body {"state", "questions", "model"?}
                         -> {"model", "answers", "usage"}  (Laya native schema)

Environment (OTSONE_* is primary; the LAYA_* names are read as aliases so the
Laya model keeps working — OTSONE_* wins when both are set)
    OTSONE_BACKEND / LAYA_BACKEND         "mlx" | "onnx"  (default: mlx on macOS, onnx elsewhere)
    OTSONE_MODEL_PATH / LAYA_MODEL_PATH   local checkpoint dir (preferred; onnx requires it)
    OTSONE_MODEL / LAYA_MODEL             HF repo id or local path (fallback / mlx hub default)
    OTSONE_HOST / LAYA_HOST               bind host (default 127.0.0.1)
    OTSONE_PORT / LAYA_PORT               bind port (default 8092)
    OTSONE_BATCH_SIZE / LAYA_BATCH_SIZE   onnx batch size (default 16)
    OTSONE_ORT_THREADS / LAYA_ORT_THREADS onnxruntime intra-op threads (default: library default)

Run
    otsone-serve
    OTSONE_BACKEND=onnx OTSONE_MODEL_PATH=./models/otsone-base otsone-serve
    # aliases still work: LAYA_BACKEND=onnx LAYA_MODEL_PATH=./models/laya-onnx-base laya-serve
"""

from __future__ import annotations

import json
import os
import platform
import sys
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Optional

from .calibration import corn_expected_level, corn_pmf
from .common import (
    QTYPES,
    build_sequence,
    clamp_temperature,
    confidence_from_probs,
    render_options,
    temp_bucket,
)
from .tokenizer import Tokenizer

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8092
HEALTH_PATH = "/health"
SYSTEMONE_PATH = "/v1/systemone"

# Canonical model inputs; order matches DecisionModel.__call__ / the ONNX export.
CANONICAL_INPUTS = ["input_ids", "attention_mask", "marker_pos", "marker_mask", "qtype"]


def to_internal(qdef: Any) -> dict:
    """Validate a public question definition into the internal {t, ins, crit} form.

    Mirrors :meth:`laya_mlx.Agent._to_internal` without importing MLX so the ONNX
    path can validate requests on a machine without the MLX runtime.
    """
    if not isinstance(qdef, dict):
        raise ValueError("Each question must be a dictionary")
    kind = qdef.get("type")
    if kind not in QTYPES:
        raise ValueError(f"Unknown question type {kind!r}; expected choice, score, or noul")
    if "instructions" not in qdef:
        raise ValueError("Question is missing instructions")
    criteria = qdef.get("criteria")
    if kind == "choice":
        if isinstance(criteria, list):
            if not all(isinstance(c, str) for c in criteria):
                raise ValueError("Choice labels must be strings")
            if len(set(criteria)) != len(criteria):
                raise ValueError("Choice labels must be unique")
            criteria = dict.fromkeys(criteria)
        if not isinstance(criteria, dict) or not criteria:
            raise ValueError("Choice criteria must be a nonempty dictionary or list")
        if not all(isinstance(k, str) for k in criteria):
            raise ValueError("Choice labels must be strings")
    elif kind == "score":
        if not isinstance(criteria, list) or not criteria:
            raise ValueError("Score criteria must be a nonempty list")
    elif criteria is not None and not isinstance(criteria, dict):
        raise ValueError("Noul criteria must be a dictionary with false/true descriptions")
    instructions = qdef["instructions"]
    if not isinstance(instructions, str):
        instructions = json.dumps(instructions)
    return {"t": kind, "ins": instructions, "crit": criteria}


class OnnxEngine:
    """Real Laya inference via onnxruntime. Raises on any missing prerequisite."""

    def __init__(self, model_dir: Path) -> None:
        import numpy as np
        import onnxruntime as ort

        self.np = np
        for name in ("rl_agent_config.json", "encoder/config.json"):
            if not (model_dir / name).is_file():
                raise FileNotFoundError(
                    f"Not a complete Laya checkpoint: missing {model_dir / name}"
                )
        tok_dir = model_dir / "tokenizer"
        if not (tok_dir / "tokenizer.json").is_file():
            raise FileNotFoundError(f"Missing tokenizer at {tok_dir / 'tokenizer.json'}")

        self.model_dir = model_dir
        self.model_id = f"laya-onnx:{model_dir.name}"
        self.cfg = json.loads((model_dir / "rl_agent_config.json").read_text())
        self.max_len = int(self.cfg.get("max_len", 512))
        self.head_max_len = int(self.cfg.get("head_max_len", 192))
        self.batch_size = int(env_setting(os.environ, "BATCH_SIZE", "16"))

        temps = self.cfg.get("temperature", [1.0, 1.0, 1.0])
        self.temperature = [clamp_temperature(t) for t in temps]
        self.temperature_by_options = {
            k: clamp_temperature(v) for k, v in self.cfg.get("temperature_by_options", {}).items()
        }

        self.tok = Tokenizer(tok_dir)

        onnx_path = _find_onnx_file(model_dir)
        so = ort.SessionOptions()
        threads = int(env_setting(os.environ, "ORT_THREADS", "0"))
        if threads:
            so.intra_op_num_threads = threads
        self.session = ort.InferenceSession(
            str(onnx_path), sess_options=so, providers=["CPUExecutionProvider"]
        )
        self.input_names = [i.name for i in self.session.get_inputs()]
        self.input_types = {i.name: i.type for i in self.session.get_inputs()}
        self.output_names = [o.name for o in self.session.get_outputs()]

    def _np_dtype(self, onnx_type: str):
        np = self.np
        if "int64" in onnx_type:
            return np.int64
        if "int32" in onnx_type:
            return np.int32
        if "bool" in onnx_type:
            return np.bool_
        if "float16" in onnx_type:
            return np.float16
        return np.float32

    def _feed_name(self, canonical: str, index: int) -> str:
        """Map a canonical input to this graph's input name (by name, else position)."""
        for name in self.input_names:
            if name == canonical:
                return name
        for name in self.input_names:
            if canonical in name.lower():
                return name
        if index < len(self.input_names):
            return self.input_names[index]
        raise KeyError(f"ONNX graph has no input for {canonical!r} (inputs: {self.input_names})")

    def _collate(self, items: list[dict]):
        np = self.np
        pad_id = self.tok.pad_token_id
        n = len(items)
        length = max(len(it["ids"]) for it in items)
        count = max(2, max(len(it["markers"]) for it in items))
        batch = {
            "input_ids": np.full((n, length), pad_id, dtype=np.int64),
            "attention_mask": np.zeros((n, length), dtype=np.bool_),
            "marker_pos": np.zeros((n, count), dtype=np.int64),
            "marker_mask": np.zeros((n, count), dtype=np.bool_),
            "qtype": np.array([it["qtype"] for it in items], dtype=np.int64),
        }
        for i, it in enumerate(items):
            li, ci = len(it["ids"]), len(it["markers"])
            batch["input_ids"][i, :li] = it["ids"]
            batch["attention_mask"][i, :li] = True
            batch["marker_pos"][i, :ci] = it["markers"]
            batch["marker_mask"][i, :ci] = True
        return batch

    def _run(self, batch: dict):
        np = self.np
        feeds = {}
        for idx, canonical in enumerate(CANONICAL_INPUTS):
            name = self._feed_name(canonical, idx)
            arr = batch[canonical].astype(self._np_dtype(self.input_types.get(name, "tensor(float)")))
            feeds[name] = arr
        outputs = self.session.run(None, feeds)
        logits, action, corn = None, None, None
        for name, val in zip(self.output_names, outputs):
            low = name.lower()
            if corn is None and "corn" in low:
                # otsone-v2 CORN threshold logits; matched before "logit" so the
                # substring in "corn_logits" is not misread as the marker logits.
                corn = val
            elif logits is None and ("logit" in low or "score" in low):
                logits = val
            elif action is None and "act" in low:
                action = val
        if logits is None:
            logits = outputs[0]
            action = outputs[1] if len(outputs) > 1 else None
        return (
            np.asarray(logits, dtype=np.float32),
            None if action is None else np.asarray(action, dtype=np.float32),
            None if corn is None else np.asarray(corn, dtype=np.float32),
        )

    def _prepare(self, state: Any, questions: dict):
        items, internal, qids = [], [], []
        for qid, definition in questions.items():
            q = to_internal(definition)
            ids, markers = build_sequence(self.tok, state, q, self.max_len, self.head_max_len)
            if len(markers) != len(render_options(q)):
                raise ValueError(f"Question {qid!r} has too many options for the token budget")
            items.append({"ids": ids, "markers": markers, "qtype": QTYPES[q["t"]]})
            internal.append(q)
            qids.append(qid)
        return items, internal, qids

    def predict(self, state: Any, questions: dict) -> dict:
        if not isinstance(questions, dict):
            raise ValueError("questions must be an object keyed by question id")
        np = self.np
        items, internal, qids = self._prepare(state, questions)
        answers: dict[str, Any] = {}
        for start in range(0, len(items), self.batch_size):
            chunk = items[start : start + self.batch_size]
            batch = self._collate(chunk)
            logits, action, corn = self._run(batch)
            if not np.isfinite(logits).all():
                raise FloatingPointError("Non-finite logits from ONNX model")
            act = None
            if action is not None:
                act = np.exp(action - action.max(axis=-1, keepdims=True))
                act /= act.sum(axis=-1, keepdims=True)
            for row, item in enumerate(chunk):
                qid, q = qids[start + row], internal[start + row]
                k, qt = len(item["markers"]), item["qtype"]
                scale = self.temperature_by_options.get(temp_bucket(qt, k), self.temperature[qt])
                z = logits[row, :k] / scale
                z = z - z.max()
                p = np.exp(z)
                p /= p.sum()
                answer: dict[str, Any] = {
                    "type": q["t"],
                    "confidence": round(confidence_from_probs(p, k), 4),
                }
                if act is not None:
                    answer["action"] = {"act_probability": round(float(act[row, 0]), 4)}
                if q["t"] == "choice":
                    labels = list(q["crit"])
                    answer["choice"] = labels[int(p.argmax())]
                    answer["probabilities"] = {lbl: round(float(v), 4) for lbl, v in zip(labels, p)}
                elif q["t"] == "score":
                    answer["legend"] = {str(i): value for i, value in enumerate(q["crit"])}
                    if corn is not None:
                        # CORN rank-consistent ordinal head: a k-level rubric uses
                        # the first k-1 thresholds, softened by the score temperature.
                        thresholds = [float(v) for v in corn[row, : max(0, k - 1)]]
                        t_score = self.temperature[QTYPES["score"]]
                        pmf = corn_pmf(thresholds, t_score)
                        answer["score"] = round(corn_expected_level(thresholds, t_score), 4)
                        answer["confidence"] = round(confidence_from_probs(np.asarray(pmf), k), 4)
                        answer["probabilities"] = {str(i): round(float(v), 4) for i, v in enumerate(pmf)}
                    else:
                        answer["score"] = round(float((np.arange(k) * p).sum()), 4)
                        answer["probabilities"] = {
                            str(i): round(float(v), 4) for i, v in enumerate(p)
                        }
                else:
                    p1 = float(p[1])
                    answer["noul"] = round(p1, 4)
                    answer["confidence"] = round(max(p1, 1.0 - p1), 4)
                answers[qid] = answer
        return {
            "model": self.model_id,
            "answers": answers,
            "usage": {"input_tokens": sum(len(it["ids"]) for it in items), "output_tokens": 0},
        }


def _find_onnx_file(model_dir: Path) -> Path:
    candidates = sorted(model_dir.glob("*.onnx"))
    if not candidates:
        raise FileNotFoundError(
            f"No .onnx graph found in {model_dir}. Export one with "
            f"'laya-mlx export-onnx' (or 'laya-mlx distill')."
        )
    for candidate in candidates:
        if candidate.name == "model.onnx":
            return candidate
    return candidates[0]


class MlxEngine:
    """Real Laya inference via the installed laya_mlx MLX runtime (Apple silicon)."""

    def __init__(self, model_ref: str = "") -> None:
        from .agent import load

        self.agent = load(model_ref) if model_ref else load()
        self.model_id = f"laya-mlx:{model_ref or self.agent.model_id}"

    def predict(self, state: Any, questions: dict) -> dict:
        return self.agent.predict(state, questions)


# ---------------------------------------------------------------------------
# Engine bootstrap (fail-clean).
# ---------------------------------------------------------------------------


@dataclass
class EngineState:
    """The loaded (or failed) engine and enough context to answer /health."""

    backend: str
    engine_name: str
    engine: Optional[Any] = None
    model_id: Optional[str] = None
    load_error: Optional[str] = None

    @property
    def ok(self) -> bool:
        return self.engine is not None


def env_setting(env: dict, name: str, default: str = "") -> str:
    """Read a sidecar setting, preferring ``OTSONE_<name>`` over ``LAYA_<name>``.

    OTSONE_* is the primary openjev naming; the LAYA_* name is kept as a
    backward-compatible alias (the Laya model still ships under it). OTSONE_*
    wins when both are set; falls back to ``default`` when neither is present.
    """
    value = env.get(f"OTSONE_{name}")
    if value is None:
        value = env.get(f"LAYA_{name}")
    return default if value is None else value


def resolve_backend(env: Optional[dict] = None) -> str:
    env = os.environ if env is None else env
    raw = env_setting(env, "BACKEND").strip().lower()
    if raw in ("mlx", "onnx"):
        return raw
    return "mlx" if platform.system() == "Darwin" else "onnx"


def resolve_model_ref(env: Optional[dict] = None) -> str:
    env = os.environ if env is None else env
    return env_setting(env, "MODEL_PATH") or env_setting(env, "MODEL") or ""


def build_engine(backend: str, model_ref: str):
    """Return a ready engine, or raise with an explicit message on any gap."""
    if backend == "onnx":
        if not model_ref:
            raise RuntimeError(
                "onnx backend needs a local model dir. Set OTSONE_MODEL_PATH (or the LAYA_MODEL_PATH "
                "alias) to a directory produced by 'otsone distill' or 'otsone export-onnx'."
            )
        model_dir = Path(model_ref).expanduser()
        if not model_dir.is_dir():
            raise RuntimeError(
                f"OTSONE_MODEL_PATH is not a local directory: {model_dir}. onnxruntime cannot "
                f"load a Hugging Face id directly; point it at an exported checkpoint."
            )
        return OnnxEngine(model_dir)
    if backend == "mlx":
        return MlxEngine(model_ref)
    raise ValueError(f"Unknown backend {backend!r}; expected 'mlx' or 'onnx'")


def load_engine_state(backend: Optional[str] = None, model_ref: Optional[str] = None) -> EngineState:
    """Build the engine, degrading cleanly (never raising) so /health can report it."""
    backend = backend or resolve_backend()
    model_ref = resolve_model_ref() if model_ref is None else model_ref
    state = EngineState(backend=backend, engine_name=f"laya-{backend}")
    try:
        engine = build_engine(backend, model_ref)
        state.engine = engine
        state.model_id = engine.model_id
    except Exception as exc:  # noqa: BLE001 -- degrade cleanly, never fabricate
        state.load_error = f"{type(exc).__name__}: {exc}"
        print(
            f"[laya] MODEL NOT READY ({state.engine_name}): {state.load_error}",
            file=sys.stderr,
            flush=True,
        )
    return state


def make_handler(state: EngineState):
    """Build a request handler bound to one loaded (or failed) engine state."""

    class Handler(BaseHTTPRequestHandler):
        def _send(self, code: int, payload: dict) -> None:
            body = json.dumps(payload).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:  # noqa: N802
            if self.path.rstrip("/") in ("", HEALTH_PATH):
                if state.engine is None:
                    self._send(
                        200, {"ok": False, "engine": state.engine_name, "error": state.load_error}
                    )
                else:
                    self._send(
                        200, {"ok": True, "engine": state.engine_name, "model": state.model_id}
                    )
            else:
                self._send(404, {"error": {"type": "not_found", "message": self.path}})

        def do_POST(self) -> None:  # noqa: N802
            if self.path.rstrip("/") != SYSTEMONE_PATH:
                self._send(404, {"error": {"type": "not_found", "message": self.path}})
                return
            if state.engine is None:
                # No real model -> refuse cleanly; never return a fabricated decision.
                self._send(
                    503,
                    {
                        "error": {
                            "type": "model_unavailable",
                            "message": state.load_error or "Laya model not loaded",
                        }
                    },
                )
                return
            try:
                length = int(self.headers.get("Content-Length") or 0)
                req = json.loads(self.rfile.read(length) or b"{}")
                request_state = req.get("state")
                questions = req.get("questions")
                if request_state is None or not isinstance(questions, dict):
                    raise ValueError("request needs 'state' and object 'questions'")
                self._send(200, state.engine.predict(request_state, questions))
            except Exception as exc:  # noqa: BLE001 -- surface to caller as JSON
                self._send(400, {"error": {"type": "invalid_request", "message": str(exc)}})

        def log_message(self, *_args) -> None:  # silence default stderr logging
            pass

    return Handler


def create_server(host: str, port: int, state: EngineState) -> ThreadingHTTPServer:
    return ThreadingHTTPServer((host, port), make_handler(state))


def main(argv: Optional[list] = None) -> int:
    del argv  # configured through the environment, matching the sidecar contract
    host = env_setting(os.environ, "HOST", DEFAULT_HOST)
    port = int(env_setting(os.environ, "PORT", str(DEFAULT_PORT)))
    state = load_engine_state()
    server = create_server(host, port, state)
    status = (
        f"model={state.model_id}"
        if state.ok
        else f"DEGRADED (no model: {state.load_error})"
    )
    print(
        f"laya sidecar listening on http://{host}:{port} backend={state.backend} {status}",
        file=sys.stderr,
        flush=True,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
