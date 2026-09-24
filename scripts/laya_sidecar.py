#!/usr/bin/env python3
"""Laya HTTP sidecar for OpenJev — REAL typed-decision inference.

``src/lib/jev/laya.server.ts`` forwards the unchanged SystemOne wire contract
to this sidecar over HTTP. The sidecar loads a local Laya checkpoint and runs
real inference, returning Laya's native ``predict`` schema; the TS layer then
projects it onto the strict Choice / Score / Noul response shapes.

Two backends, both real (no fabricated decisions ever):

  * ``onnx`` (default on Linux/CPU) — loads ``model.onnx`` + tokenizer + configs
    from ``LAYA_MODEL_PATH`` and runs ``onnxruntime`` inference directly. This is
    a self-contained port of the Laya prompt-construction + calibration pipeline
    (adapted from laya-mlx / upstream NandhaKishorM/laya; see NOTICE), so it does
    NOT require the ``laya_mlx`` / ``laya_onnx`` Python packages to be importable.
  * ``mlx`` (default on Apple Silicon) — delegates to the installed ``laya_mlx``
    runtime (``laya_mlx.load(path).predict``).

If the model, its files, or the required runtime libraries are not present, the
sidecar FAILS CLEAN: ``/health`` reports ``ok: false`` with the reason and
``POST /v1/systemone`` returns HTTP 503 with an explicit error. It never returns
a made-up answer. The TS caller treats a non-OK health / non-200 response as a
signal to fall back to the deterministic local engine.

Endpoints
    GET  /health        -> {"ok", "engine", "model"?, "error"?}
    POST /v1/systemone   body {"state", "questions", "model"?}
                         -> {"model", "answers", "usage"}  (Laya native schema)

Environment
    LAYA_BACKEND     "mlx" | "onnx"      (default: mlx on macOS, onnx elsewhere)
    LAYA_MODEL_PATH  local checkpoint dir (preferred; produced by laya-download.sh)
    LAYA_MODEL       HF repo id or local path (fallback / mlx hub default)
    LAYA_HOST        bind host (default 127.0.0.1)
    LAYA_PORT        bind port (default 8092, matches LAYA_ENGINE_URL default)

Run
    LAYA_BACKEND=onnx LAYA_MODEL_PATH=./models/laya-onnx-base python3 scripts/laya_sidecar.py
"""
from __future__ import annotations

import json
import math
import os
import platform
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Laya prompt construction + calibration.
# Self-contained port of laya-mlx/laya_mlx/common.py + the numeric tail of
# agent.py::system_one, so the ONNX path reproduces Laya's exact answer schema
# without importing the MLX package. Adapted from NandhaKishorM/laya (Apache-2.0;
# see the repo NOTICE for provenance).
# ---------------------------------------------------------------------------

QTYPES = {"choice": 0, "score": 1, "noul": 2}
QTYPE_NAMES = {v: k for k, v in QTYPES.items()}

TEMP_MIN = 0.5
TEMP_MAX = 5.0


def clamp_temperature(t: Any, lo: float = TEMP_MIN, hi: float = TEMP_MAX) -> float:
    try:
        t = float(t)
    except (TypeError, ValueError):
        return 1.0
    if not math.isfinite(t):
        return 1.0
    return min(hi, max(lo, t))


def temp_bucket(qtype: int, k: int) -> str:
    size = "2" if k <= 2 else "3-5" if k <= 5 else "6-10" if k <= 10 else "11+"
    return "%s:%s" % (QTYPE_NAMES[int(qtype)], size)


def serialize_state(state: Any) -> str:
    if isinstance(state, str):
        return state
    return json.dumps(state, ensure_ascii=False)


def render_criterion(value: Any) -> str:
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False, separators=(", ", ": "), default=str)


def render_options(q: dict) -> list[str]:
    """Render option texts in label-index order. Noul is always [false, true]."""
    t, crit = q["t"], q.get("crit")
    if t == "choice":
        return [
            k if v is None or v == "" else "%s: %s" % (k, render_criterion(v))
            for k, v in crit.items()
        ]
    if t == "score":
        return ["level %d: %s" % (i, render_criterion(c)) for i, c in enumerate(crit)]
    crit = crit or {}
    false_crit, true_crit = crit.get("false"), crit.get("true")
    return [
        "false: "
        + (render_criterion(false_crit) if false_crit not in (None, "") else "no, the statement does not hold"),
        "true: "
        + (render_criterion(true_crit) if true_crit not in (None, "") else "yes, the statement holds"),
    ]


def to_internal(qdef: Any) -> dict:
    if not isinstance(qdef, dict):
        raise ValueError("Each question must be an object")
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
            raise ValueError("Choice criteria must be a nonempty dict or list")
        if not all(isinstance(k, str) for k in criteria):
            raise ValueError("Choice labels must be strings")
    elif kind == "score":
        if not isinstance(criteria, list) or not criteria:
            raise ValueError("Score criteria must be a nonempty list")
    elif criteria is not None and not isinstance(criteria, dict):
        raise ValueError("Noul criteria must be a dict with false/true descriptions")
    instructions = qdef["instructions"]
    if not isinstance(instructions, str):
        instructions = json.dumps(instructions)
    return {"t": kind, "ins": instructions, "crit": criteria}


class RustTokenizer:
    """Load the checkpoint's HF Rust tokenizer (mirrors laya_mlx/tokenizer.py)."""

    def __init__(self, path: Path) -> None:
        from tokenizers import Tokenizer as Backend

        self.backend = Backend.from_file(str(path / "tokenizer.json"))
        self.backend.no_padding()
        self.backend.no_truncation()
        config = json.loads((path / "tokenizer_config.json").read_text())
        for name in ("cls_token", "sep_token", "pad_token", "mask_token"):
            value = config.get(name)
            if isinstance(value, dict):
                value = value.get("content")
            token_id = self.backend.token_to_id(value) if isinstance(value, str) else None
            if token_id is None:
                raise ValueError(f"Tokenizer is missing a valid {name}")
            setattr(self, name, value)
            setattr(self, name + "_id", token_id)

    def __call__(self, text: str, add_special_tokens: bool = False) -> dict:
        return {"input_ids": self.backend.encode(text, add_special_tokens=add_special_tokens).ids}


def build_prefix(tok: RustTokenizer, q: dict, head_max_len: int = 192) -> tuple[list[int], list[int]]:
    mask_tok = tok.mask_token
    opts = render_options(q)
    ins = str(q["ins"]).replace(mask_tok, " ")
    head_ids = tok("%s question: %s" % (q["t"], ins), add_special_tokens=False)["input_ids"]
    opt_ids = []
    for text in opts:
        opt_ids.append(
            [tok.mask_token_id]
            + tok(" " + text.replace(mask_tok, " "), add_special_tokens=False)["input_ids"][:48]
        )
    opt_budget = head_max_len - sum(len(o) for o in opt_ids)
    if opt_budget < 16:
        per = max(4, (head_max_len - 16) // max(1, len(opt_ids)))
        opt_ids = [o[:per] for o in opt_ids]
        opt_budget = head_max_len - sum(len(o) for o in opt_ids)
    head_ids = head_ids[: max(8, opt_budget)]
    ids = [tok.cls_token_id] + head_ids + [tok.sep_token_id]
    markers: list[int] = []
    for o in opt_ids:
        markers.append(len(ids))
        ids.extend(o)
    ids.append(tok.sep_token_id)
    return ids, markers


def build_sequence(
    tok: RustTokenizer, state: Any, q: dict, max_len: int = 512, head_max_len: int = 192
) -> tuple[list[int], list[int]]:
    """[CLS] <type> instructions [SEP] [MASK] opt0 [MASK] opt1 ... [SEP] state [SEP]."""
    ids, markers = build_prefix(tok, q, head_max_len)
    room = max(0, max_len - len(ids) - 1)
    st = tok(serialize_state(state).replace(tok.mask_token, " "), add_special_tokens=False)["input_ids"]
    st = st[:room]
    ids = ids + st + [tok.sep_token_id]
    return ids[:max_len], [m for m in markers if m < max_len]


# ---------------------------------------------------------------------------
# ONNX engine — real onnxruntime inference.
# ---------------------------------------------------------------------------

# Canonical model inputs (order matches DecisionModel.__call__ in laya-mlx).
_CANONICAL_INPUTS = ["input_ids", "attention_mask", "marker_pos", "marker_mask", "qtype"]


def _find_onnx_file(model_dir: Path) -> Path:
    candidates = sorted(model_dir.glob("*.onnx"))
    if not candidates:
        raise FileNotFoundError(
            f"No .onnx graph found in {model_dir}. The published Laya checkpoints ship "
            f"'model.safetensors'; export/download an ONNX graph into this directory "
            f"(see scripts/laya-download.sh)."
        )
    for c in candidates:
        if c.name == "model.onnx":
            return c
    return candidates[0]


class OnnxEngine:
    """Real Laya inference via onnxruntime. Raises on any missing prerequisite."""

    def __init__(self, model_dir: Path) -> None:
        import numpy as np  # noqa: F401 — validated here, used in predict
        import onnxruntime as ort

        self.np = np
        for name in ("rl_agent_config.json", "encoder/config.json"):
            if not (model_dir / name).is_file():
                raise FileNotFoundError(f"Not a complete Laya checkpoint: missing {model_dir / name}")
        tok_dir = model_dir / "tokenizer"
        if not (tok_dir / "tokenizer.json").is_file():
            raise FileNotFoundError(f"Missing tokenizer at {tok_dir / 'tokenizer.json'}")

        self.model_dir = model_dir
        self.model_id = f"laya-onnx:{model_dir.name}"
        self.cfg = json.loads((model_dir / "rl_agent_config.json").read_text())
        self.max_len = int(self.cfg.get("max_len", 512))
        self.head_max_len = int(self.cfg.get("head_max_len", 192))
        self.batch_size = int(os.environ.get("LAYA_BATCH_SIZE", "16"))

        temps = self.cfg.get("temperature", [1.0, 1.0, 1.0])
        self.temperature = [clamp_temperature(t) for t in temps]
        self.temperature_by_options = {
            k: clamp_temperature(v) for k, v in self.cfg.get("temperature_by_options", {}).items()
        }

        self.tok = RustTokenizer(tok_dir)

        onnx_path = _find_onnx_file(model_dir)
        so = ort.SessionOptions()
        so.intra_op_num_threads = int(os.environ.get("LAYA_ORT_THREADS", "0")) or so.intra_op_num_threads
        self.session = ort.InferenceSession(str(onnx_path), sess_options=so, providers=["CPUExecutionProvider"])
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
        feeds = {}
        for idx, canonical in enumerate(_CANONICAL_INPUTS):
            name = self._feed_name(canonical, idx)
            arr = batch[canonical].astype(self._np_dtype(self.input_types.get(name, "tensor(float)")))
            feeds[name] = arr
        outputs = self.session.run(None, feeds)
        logits, action = None, None
        for name, val in zip(self.output_names, outputs):
            low = name.lower()
            if logits is None and ("logit" in low or "score" in low):
                logits = val
            elif action is None and ("act" in low):
                action = val
        if logits is None:
            logits = outputs[0]
            action = outputs[1] if len(outputs) > 1 else None
        return self.np.asarray(logits, dtype=self.np.float32), (
            self.np.asarray(action, dtype=self.np.float32) if action is not None else None
        )

    def _prepare(self, state: Any, questions: dict) -> tuple[list[dict], list[dict], list[str]]:
        items, internal, ids_order = [], [], []
        for qid, definition in questions.items():
            q = to_internal(definition)
            ids, markers = build_sequence(self.tok, state, q, self.max_len, self.head_max_len)
            if len(markers) != len(render_options(q)):
                raise ValueError(f"Question {qid!r} has too many options for the token budget")
            items.append({"ids": ids, "markers": markers, "qtype": QTYPES[q["t"]]})
            internal.append(q)
            ids_order.append(qid)
        return items, internal, ids_order

    def predict(self, state: Any, questions: dict) -> dict:
        if not isinstance(questions, dict) or not questions:
            raise ValueError("questions must be a nonempty object keyed by question id")
        np = self.np
        items, internal, qids = self._prepare(state, questions)
        answers: dict[str, Any] = {}
        for start in range(0, len(items), self.batch_size):
            chunk = items[start : start + self.batch_size]
            batch = self._collate(chunk)
            logits, action = self._run(batch)
            if not np.isfinite(logits).all():
                raise FloatingPointError("Non-finite logits from ONNX model")
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
                    "confidence": round(_confidence_from_probs(np, p, k), 4),
                }
                if action is not None:
                    answer["action"] = {"act_probability": round(float(act[row, 0]), 4)}
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
                answers[qid] = answer
        return {
            "model": self.model_id,
            "answers": answers,
            "usage": {"input_tokens": sum(len(it["ids"]) for it in items), "output_tokens": 0},
        }


def _confidence_from_probs(np, p, k: int) -> float:
    if k < 2:
        return 1.0
    p = p[:k]
    ent = -(p * np.log(np.clip(p, 1e-12, 1.0))).sum()
    return float(np.clip(1.0 - ent / math.log(k), 0.0, 1.0))


class MlxEngine:
    """Real Laya inference via the installed laya_mlx runtime (Apple Silicon)."""

    def __init__(self, model_ref: str) -> None:
        import laya_mlx as laya

        self.agent = laya.load(model_ref)
        self.model_id = f"laya-mlx:{model_ref}"

    def predict(self, state: Any, questions: dict) -> dict:
        return self.agent.predict(state, questions)


# ---------------------------------------------------------------------------
# Engine bootstrap (fail-clean).
# ---------------------------------------------------------------------------

def resolve_backend() -> str:
    raw = (os.environ.get("LAYA_BACKEND") or "").strip().lower()
    if raw in ("mlx", "onnx"):
        return raw
    return "mlx" if platform.system() == "Darwin" else "onnx"


def resolve_model_ref() -> str:
    return os.environ.get("LAYA_MODEL_PATH") or os.environ.get("LAYA_MODEL") or ""


def build_engine(backend: str):
    """Return (engine, model_id). Raises with an explicit message on any gap."""
    ref = resolve_model_ref()
    if backend == "onnx":
        if not ref:
            raise RuntimeError(
                "onnx backend needs a local model dir. Set LAYA_MODEL_PATH (run "
                "scripts/laya-download.sh first)."
            )
        model_dir = Path(ref).expanduser()
        if not model_dir.is_dir():
            raise RuntimeError(
                f"LAYA_MODEL_PATH is not a local directory: {model_dir}. onnxruntime cannot "
                f"load a Hugging Face id directly; download the weights with "
                f"scripts/laya-download.sh and point LAYA_MODEL_PATH at the result."
            )
        engine = OnnxEngine(model_dir)
        return engine, engine.model_id
    # mlx
    engine = MlxEngine(ref or "aac6fef/laya-mlx")
    return engine, engine.model_id


BACKEND = resolve_backend()
ENGINE_NAME = f"laya-{BACKEND}"
ENGINE = None
MODEL_ID: str | None = None
LOAD_ERROR: str | None = None

try:
    ENGINE, MODEL_ID = build_engine(BACKEND)
except Exception as exc:  # noqa: BLE001 — degrade cleanly, never fabricate
    LOAD_ERROR = f"{type(exc).__name__}: {exc}"
    print(f"[laya] MODEL NOT READY ({ENGINE_NAME}): {LOAD_ERROR}", file=sys.stderr, flush=True)


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path.rstrip("/") == "/health":
            if ENGINE is None:
                self._send(200, {"ok": False, "engine": ENGINE_NAME, "error": LOAD_ERROR})
            else:
                self._send(200, {"ok": True, "engine": ENGINE_NAME, "model": MODEL_ID})
        else:
            self._send(404, {"error": {"type": "not_found", "message": self.path}})

    def do_POST(self) -> None:  # noqa: N802
        if self.path.rstrip("/") != "/v1/systemone":
            self._send(404, {"error": {"type": "not_found", "message": self.path}})
            return
        if ENGINE is None:
            # No real model -> refuse cleanly. The Node caller falls back to the
            # deterministic local engine. We NEVER return a fabricated decision.
            self._send(
                503,
                {"error": {"type": "model_unavailable", "message": LOAD_ERROR or "Laya model not loaded"}},
            )
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
            req = json.loads(self.rfile.read(length) or b"{}")
            state = req.get("state")
            questions = req.get("questions")
            if state is None or not isinstance(questions, dict):
                raise ValueError("request needs 'state' and object 'questions'")
            self._send(200, ENGINE.predict(state, questions))
        except Exception as exc:  # noqa: BLE001 — surface to caller as JSON
            self._send(400, {"error": {"type": "invalid_request", "message": str(exc)}})

    def log_message(self, *_args) -> None:  # silence default stderr logging
        pass


def main() -> None:
    host = os.environ.get("LAYA_HOST", "127.0.0.1")
    port = int(os.environ.get("LAYA_PORT", "8092"))
    server = ThreadingHTTPServer((host, port), Handler)
    status = f"model={MODEL_ID}" if ENGINE is not None else f"DEGRADED (no model: {LOAD_ERROR})"
    print(
        f"laya sidecar listening on http://{host}:{port} backend={BACKEND} {status}",
        file=sys.stderr,
        flush=True,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()
