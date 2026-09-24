"""C++ System One kernel. Falls back to numpy-free Python math helpers."""

from __future__ import annotations

import ctypes
import json
import math
from pathlib import Path
from typing import Any

_lib = None


def _so_path() -> Path:
    return Path(__file__).resolve().parents[2] / "cpp" / "libopenjev.so"


def _load():
    global _lib
    if _lib is not None:
        return _lib
    root = _so_path()
    if not root.exists():
        _lib = False
        return False
    lib = ctypes.CDLL(str(root))
    lib.openjev_softmax.argtypes = [
        ctypes.POINTER(ctypes.c_double),
        ctypes.c_int,
        ctypes.c_double,
        ctypes.POINTER(ctypes.c_double),
    ]
    lib.openjev_confidence.argtypes = [ctypes.POINTER(ctypes.c_double), ctypes.c_int]
    lib.openjev_confidence.restype = ctypes.c_double
    lib.openjev_cosine.argtypes = [
        ctypes.POINTER(ctypes.c_double),
        ctypes.POINTER(ctypes.c_double),
        ctypes.c_int,
    ]
    lib.openjev_cosine.restype = ctypes.c_double
    lib.openjev_eval_dup.argtypes = [ctypes.c_char_p]
    lib.openjev_eval_dup.restype = ctypes.c_void_p
    lib.openjev_free.argtypes = [ctypes.c_void_p]
    lib.openjev_version.restype = ctypes.c_char_p
    _lib = lib
    return lib


def softmax(logits: list[float], temperature: float = 0.38) -> list[float]:
    lib = _load()
    n = len(logits)
    if n == 0:
        return []
    if lib:
        arr = (ctypes.c_double * n)(*logits)
        out = (ctypes.c_double * n)()
        lib.openjev_softmax(arr, n, temperature, out)
        return [out[i] for i in range(n)]
    t = max(0.12, temperature)
    mx = max(logits)
    exps = [math.exp((x - mx) / t) for x in logits]
    s = sum(exps) or 1.0
    return [e / s for e in exps]


def confidence(p: list[float]) -> float:
    lib = _load()
    n = len(p)
    if n <= 1:
        return 1.0
    if lib:
        arr = (ctypes.c_double * n)(*p)
        return float(lib.openjev_confidence(arr, n))
    h = -sum(x * math.log(x) for x in p if x > 1e-12)
    hmax = math.log(n)
    peaked = 1.0 if hmax == 0 else 1.0 - h / hmax
    ordered = sorted(p, reverse=True)
    margin = (ordered[0] - ordered[1]) / (1 - 1 / n)
    return min(1.0, max(0.0, 0.55 * peaked + 0.45 * margin))


def eval_cpp(req: dict[str, Any]) -> dict[str, Any] | None:
    lib = _load()
    if not lib:
        return None
    payload = json.dumps(req, ensure_ascii=False).encode("utf-8")
    ptr = lib.openjev_eval_dup(payload)
    if not ptr:
        return None
    try:
        raw = ctypes.cast(ptr, ctypes.c_char_p).value
        if not raw:
            return None
        return json.loads(raw.decode("utf-8"))
    finally:
        lib.openjev_free(ptr)


def kernel_version() -> str:
    lib = _load()
    if not lib:
        return "python-fallback"
    v = lib.openjev_version()
    return v.decode() if v else "unknown"
