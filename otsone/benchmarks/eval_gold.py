#!/usr/bin/env python3
"""Gold-set evaluation entrypoint for the ONNX typed-decision model (``otsone-1``).

Thin, runnable wrapper over :mod:`laya_mlx.eval_gold` -- the canonical, shipped
implementation that ``laya-mlx eval`` also delegates to. Keeping one implementation
(and re-exporting it here) means the benchmark harness and the CLI report the exact
same accuracy/ECE from the exact same :class:`laya_mlx.server.OnnxEngine` path, and
there is no second copy of the scoring logic to drift.

Run from the repo root::

    python benchmarks/eval_gold.py --model models/otsone-base
    # or, equivalently, through the package CLI:
    laya-mlx eval --model models/otsone-base

It loads the gold cases (from the model dir, ``benchmarks/``/``engine`` copies, a
sibling ``openjev/engine``, or ``examples/``), runs every case through the
served ONNX backend, prints per-case pass/fail with accuracy and ECE, and writes
those numbers back into the checkpoint's ``model_card.json``.
"""

from __future__ import annotations

import sys

from laya_mlx.eval_gold import (
    check,
    evaluate,
    expected_calibration_error,
    find_gold,
    main,
    write_card,
)

__all__ = ["main", "evaluate", "check", "find_gold", "write_card", "expected_calibration_error"]


if __name__ == "__main__":
    sys.exit(main())
