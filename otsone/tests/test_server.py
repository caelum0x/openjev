import json
import threading
import urllib.error
import urllib.request

import pytest

from laya_mlx import onnx_export, server


def _get(url):
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read())


def _post(url, payload):
    data = json.dumps(payload).encode() if payload is not None else b""
    req = urllib.request.Request(url, data=data, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read())


@pytest.fixture
def running_server():
    servers = []

    def start(state):
        srv = server.create_server("127.0.0.1", 0, state)
        thread = threading.Thread(target=srv.serve_forever, daemon=True)
        thread.start()
        servers.append((srv, thread))
        return "http://127.0.0.1:%d" % srv.server_address[1]

    yield start
    for srv, thread in servers:
        srv.shutdown()
        thread.join(timeout=5)


def test_resolve_backend_and_model_ref_from_env():
    assert server.resolve_backend({"LAYA_BACKEND": "onnx"}) == "onnx"
    assert server.resolve_backend({"LAYA_BACKEND": "MLX"}) == "mlx"
    assert server.resolve_model_ref({"LAYA_MODEL_PATH": "/a"}) == "/a"
    assert server.resolve_model_ref({"LAYA_MODEL": "hub/x"}) == "hub/x"
    assert server.resolve_model_ref({}) == ""


def test_to_internal_validates_like_the_runtime():
    q = server.to_internal({"type": "choice", "instructions": "x", "criteria": ["a", "b"]})
    assert q == {"t": "choice", "ins": "x", "crit": {"a": None, "b": None}}
    for bad in (
        {"type": "nope", "instructions": "x"},
        {"type": "choice", "instructions": "x", "criteria": []},
        {"type": "score", "instructions": "x", "criteria": {}},
        {"type": "noul"},
    ):
        with pytest.raises(ValueError):
            server.to_internal(bad)


def test_onnx_backend_without_model_fails_clean(running_server):
    state = server.load_engine_state(backend="onnx", model_ref="")
    assert state.engine is None and state.load_error and not state.ok
    base = running_server(state)
    code, health = _get(base + "/health")
    assert code == 200 and health["ok"] is False and health["error"]
    code, body = _post(base + "/v1/systemone", {"state": "x", "questions": {}})
    assert code == 503 and body["error"]["type"] == "model_unavailable"


def test_unknown_backend_rejected():
    state = server.load_engine_state(backend="bogus", model_ref="")
    assert state.engine is None and "Unknown backend" in state.load_error


def test_mlx_engine_serves_real_answers(running_server, tiny_checkpoint, questions):
    state = server.EngineState(backend="mlx", engine_name="laya-mlx")
    engine = server.MlxEngine(str(tiny_checkpoint))
    state.engine, state.model_id = engine, engine.model_id
    base = running_server(state)

    code, health = _get(base + "/health")
    assert code == 200 and health["ok"] is True and health["model"]

    code, out = _post(base + "/v1/systemone", {"state": {"text": "hello"}, "questions": questions})
    assert code == 200
    assert set(out["answers"]) == set(questions)
    assert out["usage"]["output_tokens"] == 0
    assert 0 <= out["answers"]["yes"]["noul"] <= 1

    assert _post(base + "/v1/systemone", {"state": "x"})[0] == 400
    assert _get(base + "/nope")[0] == 404
    assert _post(base + "/wrong", {"state": "x", "questions": {}})[0] == 404


def test_normalize_encoder_config_defaults_layers_and_rope():
    cfg = {
        "model_type": "modernbert",
        "vocab_size": 128,
        "hidden_size": 64,
        "intermediate_size": 96,
        "num_hidden_layers": 3,
        "num_attention_heads": 2,
        "local_attention": 16,
    }
    ec = onnx_export.normalize_encoder_config(cfg)
    assert ec["head_dim"] == 32
    assert ec["layer_types"] == ["full_attention", "sliding_attention", "sliding_attention"]
    assert ec["rope_base"]["full_attention"] == 160000.0
    assert ec["rope_base"]["sliding_attention"] == 10000.0
    with pytest.raises(ValueError):
        onnx_export.normalize_encoder_config({**cfg, "model_type": "bert"})


def test_onnx_export_module_imports_without_torch():
    # The export helpers must be importable on a machine without the [onnx] extra;
    # torch/onnxruntime are only imported inside the functions.
    assert callable(onnx_export.export_onnx)
    assert callable(onnx_export.quantize_onnx)
    assert onnx_export.CANONICAL_INPUTS == server.CANONICAL_INPUTS
