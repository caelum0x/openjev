#!/usr/bin/env python3
"""Evaluate the Laya ONNX neural backend on the OpenJev gold set.

Loads the produced ``model.onnx`` through the SIDECAR's own ``OnnxEngine`` (the
exact code path ``laya_sidecar.py`` serves over HTTP), runs every gold case, and
applies the same pass/fail assertions as ``engine/run_gold.py`` — so the accuracy
reported here is the real neural backend, not a re-implementation.

    LAYA_MODEL_PATH=models/laya-onnx-base python scripts/laya_eval_gold.py
"""
from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
os.environ.setdefault("LAYA_BACKEND", "onnx")
os.environ.setdefault(
    "LAYA_MODEL_PATH", str(ROOT / "models" / "laya-onnx-base")
)


def load_sidecar():
    spec = importlib.util.spec_from_file_location(
        "laya_sidecar", ROOT / "scripts" / "laya_sidecar.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def check(ans: dict, expect: list) -> list[str]:
    bad: list[str] = []
    for e in expect:
        if "choice" in e:
            c = e["choice"]
            a = ans.get(c["id"], {})
            if a.get("choice") != c["value"]:
                bad.append(f"choice {c['id']}={a.get('choice')} want {c['value']}")
            elif c.get("minP") is not None and (a.get("probabilities") or {}).get(c["value"], 0) < c["minP"]:
                bad.append(f"p {c['id']}={(a.get('probabilities') or {}).get(c['value'])}<{c['minP']}")
        if "noul" in e:
            n = e["noul"]
            got = ans.get(n["id"], {}).get("noul", -1)
            if ("min" in n and got < n["min"]) or ("max" in n and got > n["max"]):
                bad.append(f"noul {n['id']}={got}")
        if "score" in e:
            s = e["score"]
            got = ans.get(s["id"], {}).get("score", -1)
            if got < s.get("min", -9) or got > s.get("max", 9):
                bad.append(f"score {s['id']}={got}")
    return bad


def main() -> int:
    sc = load_sidecar()
    model_dir = Path(os.environ["LAYA_MODEL_PATH"])
    engine = sc.OnnxEngine(model_dir)
    print(f"[eval] model={engine.model_id} temp={engine.temperature}")

    gold = json.loads((ROOT / "engine" / "gold.json").read_text())
    ok = fail = 0
    checks_ok = checks_total = 0
    for g in gold:
        out = engine.predict(g["state"], g["questions"])
        ans = out["answers"]
        bad = check(ans, g["expect"])
        # per-assertion tally
        for e in g["expect"]:
            checks_total += 1
            if not check(ans, [e]):
                checks_ok += 1
        if bad:
            fail += 1
            print("FAIL", g["id"], ";", " ".join(bad))
        else:
            ok += 1
            print("ok  ", g["id"])
    print(f"\ncases:  {ok}/{ok + fail} passed")
    print(f"checks: {checks_ok}/{checks_total} passed")
    return 1 if fail else 0


if __name__ == "__main__":
    raise SystemExit(main())
