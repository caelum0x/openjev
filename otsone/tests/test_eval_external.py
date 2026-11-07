"""Tests for ``laya_mlx.eval_external`` -- the third-party-model eval entry point.

These cover both ways a third party can plug their own typed-decision model
into the otsone gold-case calibration report (:func:`laya_mlx.eval_gold.evaluate`)
without touching any scoring code:

* :class:`HttpEngine` against a real local HTTP server (no mocking of
  ``urllib`` internals -- an actual socket round trip).
* :class:`AnswersFileEngine` / :func:`load_answers_payload` against both
  supported JSON shapes (id->answers map, and a list of {id, answers} records).

Also covers the CLI entry points (``laya_mlx.eval_external.main`` and the
``otsone eval-external`` dispatch in ``laya_mlx.cli``) end to end against a
small temporary gold.json, and the safety/error paths: non-http(s) URL
schemes, malformed --header values, a missing --api-key-env variable, and an
answers file missing a gold case id.
"""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from laya_mlx import cli, eval_external
from laya_mlx.eval_external import (
    AnswersFileEngine,
    ExternalEvalError,
    HttpEngine,
    build_engine,
    load_answers_payload,
)

# A tiny 3-case gold set covering all three question types, so the report
# exercises choice + noul + score (and therefore every branch of per-type
# reliability), the same shape as the real engine/gold.json.
GOLD = [
    {
        "id": "c1",
        "state": "I want a refund for my shoes",
        "questions": {
            "dep": {
                "type": "choice",
                "instructions": "Which team handles this?",
                "criteria": {"a": "returns", "b": "shipping"},
            }
        },
        "expect": [{"choice": {"id": "dep", "value": "a", "minP": 0.5}}],
    },
    {
        "id": "c2",
        "state": "This is extremely urgent",
        "questions": {"esc": {"type": "noul", "instructions": "Should this escalate?"}},
        "expect": [{"noul": {"id": "esc", "min": 0.5}}],
    },
    {
        "id": "c3",
        "state": "Minor cosmetic issue",
        "questions": {
            "sev": {
                "type": "score",
                "instructions": "Rate severity 0-3",
                "criteria": ["none", "minor", "major", "critical"],
            }
        },
        "expect": [{"score": {"id": "sev", "min": 1.0, "max": 2.0}}],
    },
]

CORRECT_ANSWERS = {
    "c1": {"dep": {"choice": "a", "probabilities": {"a": 0.9, "b": 0.1}}},
    "c2": {"esc": {"noul": 0.8}},
    "c3": {"sev": {"score": 1.5, "confidence": 0.7}},
}

WRONG_ANSWERS = {
    "c1": {"dep": {"choice": "b", "probabilities": {"a": 0.1, "b": 0.9}}},
    "c2": {"esc": {"noul": 0.8}},
    "c3": {"sev": {"score": 1.5, "confidence": 0.7}},
}


@pytest.fixture
def gold_path(tmp_path):
    path = tmp_path / "gold.json"
    path.write_text(json.dumps(GOLD))
    return path


# --- URL safety -------------------------------------------------------------


@pytest.mark.parametrize("bad_url", ["file:///etc/passwd", "gopher://x", "ftp://x/y", "not-a-url"])
def test_http_engine_rejects_non_http_schemes(bad_url):
    with pytest.raises(ExternalEvalError):
        HttpEngine(bad_url)


def test_http_engine_accepts_http_and_https():
    assert HttpEngine("http://localhost:1").url == "http://localhost:1"
    assert HttpEngine("https://example.com/predict").url == "https://example.com/predict"


# --- AnswersFileEngine / load_answers_payload -------------------------------


def test_load_answers_payload_accepts_dict_shape():
    ordered = load_answers_payload(CORRECT_ANSWERS, GOLD)
    assert ordered == [CORRECT_ANSWERS["c1"], CORRECT_ANSWERS["c2"], CORRECT_ANSWERS["c3"]]


def test_load_answers_payload_accepts_list_shape():
    as_list = [{"id": cid, "answers": ans} for cid, ans in CORRECT_ANSWERS.items()]
    ordered = load_answers_payload(as_list, GOLD)
    assert ordered == [CORRECT_ANSWERS["c1"], CORRECT_ANSWERS["c2"], CORRECT_ANSWERS["c3"]]


def test_load_answers_payload_reports_missing_ids():
    partial = {"c1": CORRECT_ANSWERS["c1"]}
    with pytest.raises(ExternalEvalError, match="c2"):
        load_answers_payload(partial, GOLD)


def test_load_answers_payload_rejects_malformed_list_entry():
    with pytest.raises(ExternalEvalError):
        load_answers_payload([{"id": "c1"}], GOLD)  # missing "answers"


def test_answers_file_engine_replays_in_order():
    engine = AnswersFileEngine(load_answers_payload(CORRECT_ANSWERS, GOLD), model_id="acme-offline")
    assert engine.model_id == "acme-offline"
    out1 = engine.predict(GOLD[0]["state"], GOLD[0]["questions"])
    out2 = engine.predict(GOLD[1]["state"], GOLD[1]["questions"])
    assert out1 == {"answers": CORRECT_ANSWERS["c1"]}
    assert out2 == {"answers": CORRECT_ANSWERS["c2"]}


def test_answers_file_engine_raises_when_exhausted():
    engine = AnswersFileEngine([{"x": 1}], model_id="m")
    engine.predict(None, {})
    with pytest.raises(ExternalEvalError):
        engine.predict(None, {})


# --- HttpEngine against a real local server ---------------------------------


class _CannedHandler(BaseHTTPRequestHandler):
    """Serves one canned JSON answers payload per request, in order, and
    records the request bodies it received so tests can assert on them."""

    queue: list = []
    received: list = []

    def do_POST(self):  # noqa: N802 -- http.server's required method name
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length)) if length else {}
        type(self).received.append((dict(self.headers), body))
        payload = type(self).queue.pop(0)
        data = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):  # silence test output
        pass


@pytest.fixture
def canned_server():
    _CannedHandler.queue = []
    _CannedHandler.received = []
    server = ThreadingHTTPServer(("127.0.0.1", 0), _CannedHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server, _CannedHandler
    finally:
        server.shutdown()
        thread.join(timeout=5)


def test_http_engine_round_trips_a_real_request(canned_server):
    server, handler = canned_server
    handler.queue = [{"answers": CORRECT_ANSWERS["c1"]}]
    url = f"http://127.0.0.1:{server.server_port}/predict"
    engine = HttpEngine(url, model_id="acme-live", headers={"Authorization": "Bearer tok"})

    out = engine.predict(GOLD[0]["state"], GOLD[0]["questions"])

    assert out == {"answers": CORRECT_ANSWERS["c1"]}
    sent_headers, sent_body = handler.received[0]
    assert sent_headers["Authorization"] == "Bearer tok"
    assert sent_body == {"state": GOLD[0]["state"], "questions": GOLD[0]["questions"]}


def test_http_engine_raises_when_answers_key_missing(canned_server):
    server, handler = canned_server
    handler.queue = [{"not_answers": {}}]
    engine = HttpEngine(f"http://127.0.0.1:{server.server_port}/predict")
    with pytest.raises(ExternalEvalError, match="answers"):
        engine.predict("x", {})


def test_http_engine_full_gold_set_passes(canned_server, gold_path):
    server, handler = canned_server
    handler.queue = [
        {"answers": CORRECT_ANSWERS["c1"]},
        {"answers": CORRECT_ANSWERS["c2"]},
        {"answers": CORRECT_ANSWERS["c3"]},
    ]
    url = f"http://127.0.0.1:{server.server_port}/predict"
    rc = eval_external.main(["--gold", str(gold_path), "--url", url, "--quiet"])
    assert rc == 0


# --- build_engine / CLI wiring ----------------------------------------------


def test_build_engine_answers_file(tmp_path, gold_path):
    answers_path = tmp_path / "answers.json"
    answers_path.write_text(json.dumps(CORRECT_ANSWERS))
    args = cli.argparse.Namespace(
        url=None, answers_file=str(answers_path), model_id=None, api_key_env=None, header=[], timeout=30.0
    )
    gold = json.loads(gold_path.read_text())
    engine = build_engine(args, gold)
    assert isinstance(engine, AnswersFileEngine)
    assert engine.model_id == f"answers-file:{answers_path}"


def test_build_engine_missing_api_key_env_raises():
    args = cli.argparse.Namespace(
        url="http://localhost:1", answers_file=None, model_id=None, api_key_env="OTSONE_TEST_MISSING_KEY",
        header=[], timeout=30.0,
    )
    with pytest.raises(ExternalEvalError):
        build_engine(args, GOLD)


def test_build_engine_malformed_header_raises():
    args = cli.argparse.Namespace(
        url="http://localhost:1", answers_file=None, model_id=None, api_key_env=None,
        header=["not-a-header"], timeout=30.0,
    )
    with pytest.raises(ExternalEvalError):
        build_engine(args, GOLD)


# --- main() end to end -------------------------------------------------------


def test_main_with_answers_file_all_correct(tmp_path, gold_path):
    answers_path = tmp_path / "answers.json"
    answers_path.write_text(json.dumps(CORRECT_ANSWERS))
    out_path = tmp_path / "report.json"

    rc = eval_external.main(
        [
            "--gold", str(gold_path),
            "--answers-file", str(answers_path),
            "--model-id", "acme-offline-v1",
            "--out", str(out_path),
            "--quiet",
        ]
    )

    assert rc == 0
    report = json.loads(out_path.read_text())
    assert report["gold_cases_passed"] == report["gold_cases_total"] == 3
    assert report["model"] == "acme-offline-v1"
    assert report["calibration"]["overall"] is not None
    assert set(report["calibration"]["by_type"]) == {"choice", "noul", "score"}


def test_main_with_answers_file_reports_failure(tmp_path, gold_path):
    answers_path = tmp_path / "answers.json"
    answers_path.write_text(json.dumps(WRONG_ANSWERS))

    rc = eval_external.main(
        ["--gold", str(gold_path), "--answers-file", str(answers_path), "--quiet"]
    )

    assert rc == 1


def test_main_requires_url_or_answers_file(gold_path):
    with pytest.raises(SystemExit):
        eval_external.main(["--gold", str(gold_path)])


def test_main_rejects_missing_gold():
    with pytest.raises(SystemExit):
        eval_external.main(["--gold", "/nonexistent/gold.json", "--answers-file", "/nonexistent/answers.json"])


def test_cli_dispatches_eval_external(tmp_path, gold_path):
    """Regression test for the laya_mlx.cli._DELEGATED_COMMANDS wiring: `otsone
    eval-external ...` must reach laya_mlx.eval_external.main with no onnx/train
    extras installed, since this path is stdlib-only."""
    answers_path = tmp_path / "answers.json"
    answers_path.write_text(json.dumps(CORRECT_ANSWERS))

    rc = cli.main(
        [
            "eval-external",
            "--gold", str(gold_path),
            "--answers-file", str(answers_path),
            "--quiet",
        ]
    )

    assert rc == 0
