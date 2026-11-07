"""Evaluate an ONNX typed-decision checkpoint (e.g. ``otsone-1``) on gold cases.

Loads ``model.onnx`` through this package's own :class:`laya_mlx.server.OnnxEngine`
-- the exact code path ``laya-serve`` runs -- so the numbers reported here are the
real served backend, not a re-implementation. Every gold case is run and scored
with the same pass/fail assertions the OpenJev engine uses (choice exact +
``minP``, noul range, score range), then per-case accuracy and a calibration
error (ECE) are written back into the checkpoint's ``model_card.json``.

Gold cases are looked up, in order, from ``--gold`` if given, else the model
directory, this repo's ``benchmarks/``/``engine`` copies, a sibling
``openjev/engine``, or the packaged ``examples/``.

This module is MLX-free at import (onnxruntime/numpy load inside the engine), so
it is importable on CI. ``main(argv=None) -> int`` returns non-zero when any gold
case fails, satisfying the ``laya-mlx eval`` delegation contract.

    laya-mlx eval --model models/otsone-base
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Optional

from .calibration import per_type_reliability, reliability

GOLD_ENV_VALUE = "gold.json"


def find_gold(model_dir: Optional[Path], explicit: Optional[str] = None) -> Optional[Path]:
    """Locate a gold.json across the model dir, this repo, and a sibling checkout."""
    if explicit:
        p = Path(explicit).expanduser()
        return p if p.is_file() else None
    here = Path(__file__).resolve()
    repo = here.parent.parent
    candidates = []
    if model_dir is not None:
        candidates += [model_dir / GOLD_ENV_VALUE, model_dir.parent / GOLD_ENV_VALUE]
    candidates += [
        repo / "benchmarks" / GOLD_ENV_VALUE,
        repo / "engine" / GOLD_ENV_VALUE,
        # Real repo layout: otsone/ (= repo) is a direct child of the openjev/
        # checkout, so engine/gold.json is a plain sibling of otsone/ one level
        # up (repo.parent/engine/gold.json) -- not nested under an extra
        # "openjev" segment. Confirmed by actually running `otsone eval`.
        repo.parent / "engine" / GOLD_ENV_VALUE,
        repo.parent / "openjev" / "engine" / GOLD_ENV_VALUE,
        repo / "examples" / GOLD_ENV_VALUE,
    ]
    for c in candidates:
        if c.is_file():
            return c
    return None


def check(ans: dict, expect: list) -> list:
    """Return a list of failure strings for one case's expectations ([] == pass)."""
    bad: list = []
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


def _calibration_pairs(ans: dict, expect: list) -> list:
    """(confidence, correct) pairs for ECE from choice/noul assertions in one case."""
    pairs = []
    for e in expect:
        if "choice" in e:
            c = e["choice"]
            a = ans.get(c["id"], {})
            probs = a.get("probabilities") or {}
            if a.get("choice") is not None and probs:
                conf = float(probs.get(a["choice"], max(probs.values(), default=0.0)))
                pairs.append((conf, a.get("choice") == c["value"]))
        if "noul" in e:
            n = e["noul"]
            got = ans.get(n["id"], {}).get("noul")
            if got is not None:
                predicted_true = got >= 0.5
                expected_true = "min" in n  # min-bound assertions expect true
                conf = max(float(got), 1.0 - float(got))
                pairs.append((conf, predicted_true == expected_true))
    return pairs


def _typed_calibration_pairs(ans: dict, expect: list) -> list:
    """(qtype, confidence, correct) triples for per-type reliability."""
    triples = []
    for e in expect:
        if "choice" in e:
            c = e["choice"]
            a = ans.get(c["id"], {})
            probs = a.get("probabilities") or {}
            if a.get("choice") is not None and probs:
                conf = float(probs.get(a["choice"], max(probs.values(), default=0.0)))
                triples.append(("choice", conf, a.get("choice") == c["value"]))
        if "noul" in e:
            n = e["noul"]
            got = ans.get(n["id"], {}).get("noul")
            if got is not None:
                predicted_true = got >= 0.5
                expected_true = "min" in n
                conf = max(float(got), 1.0 - float(got))
                triples.append(("noul", conf, predicted_true == expected_true))
        if "score" in e:
            s = e["score"]
            a = ans.get(s["id"], {})
            got, conf = a.get("score"), a.get("confidence")
            if got is not None and conf is not None:
                in_band = got >= s.get("min", -9) and got <= s.get("max", 9)
                triples.append(("score", float(conf), bool(in_band)))
    return triples


def expected_calibration_error(pairs: list, bins: int = 10) -> Optional[float]:
    """Standard binned ECE over (confidence, correct) pairs; None when empty."""
    if not pairs:
        return None
    total = len(pairs)
    ece = 0.0
    for b in range(bins):
        lo, hi = b / bins, (b + 1) / bins
        bucket = [
            (conf, correct)
            for conf, correct in pairs
            if (conf > lo or (b == 0 and conf >= lo)) and conf <= hi
        ]
        if not bucket:
            continue
        avg_conf = sum(conf for conf, _ in bucket) / len(bucket)
        acc = sum(1 for _, correct in bucket if correct) / len(bucket)
        ece += (len(bucket) / total) * abs(avg_conf - acc)
    return round(ece, 4)


def evaluate(engine, gold: list, *, verbose: bool = True) -> dict:
    """Run every gold case through ``engine`` and return an accuracy/ECE report."""
    ok = fail = 0
    checks_ok = checks_total = 0
    pairs: list = []
    typed: list = []
    for g in gold:
        out = engine.predict(g["state"], g["questions"])
        ans = out["answers"]
        bad = check(ans, g["expect"])
        for e in g["expect"]:
            checks_total += 1
            if not check(ans, [e]):
                checks_ok += 1
        pairs.extend(_calibration_pairs(ans, g["expect"]))
        typed.extend(_typed_calibration_pairs(ans, g["expect"]))
        if bad:
            fail += 1
            if verbose:
                print("FAIL", g["id"], ";", " ".join(bad))
        else:
            ok += 1
            if verbose:
                print("ok  ", g["id"])
    accuracy = round(checks_ok / checks_total, 4) if checks_total else None

    by_type: dict = {}
    for qtype, conf, correct in typed:
        by_type.setdefault(qtype, []).append((conf, correct))
    calibration = {
        "bins": 15,
        "overall": reliability([(c, ok_) for _, c, ok_ in typed], bins=15),
        "by_type": per_type_reliability(by_type, bins=15),
    }
    return {
        "model": getattr(engine, "model_id", None),
        "gold_cases_passed": ok,
        "gold_cases_total": ok + fail,
        "gold_checks_passed": checks_ok,
        "gold_checks_total": checks_total,
        "accuracy": accuracy,
        "ece": expected_calibration_error(pairs),
        "calibration": calibration,
    }


def write_card(model_dir: Path, report: dict) -> Optional[Path]:
    """Fold the evaluation numbers into ``model_card.json`` (creating it if absent)."""
    import datetime as _dt

    card_path = model_dir / "model_card.json"
    card = json.loads(card_path.read_text()) if card_path.is_file() else {}
    metrics = dict(card.get("metrics", {}))
    metrics.update(
        {
            "gold_cases_passed": report["gold_cases_passed"],
            "gold_cases_total": report["gold_cases_total"],
            "gold_checks_passed": report["gold_checks_passed"],
            "gold_checks_total": report["gold_checks_total"],
            "accuracy": report["accuracy"],
            "ece": report["ece"],
            "evaluated_at": _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds"),
        }
    )
    card["metrics"] = metrics
    if report.get("calibration"):
        card["calibration"] = report["calibration"]
    card_path.write_text(json.dumps(card, indent=2) + "\n")
    return card_path


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="laya-mlx eval", description="Evaluate an ONNX checkpoint on gold")
    ap.add_argument("--model", default="models/otsone-base", help="Exported ONNX checkpoint directory")
    ap.add_argument("--gold", help="Path to gold.json (auto-detected if unset)")
    ap.add_argument("--no-write", action="store_true", help="Do not update model_card.json")
    args = ap.parse_args(argv)

    model_dir = Path(args.model).expanduser()
    if not model_dir.is_dir():
        raise SystemExit(
            f"Model directory not found: {model_dir}. Train one first:\n"
            f"    laya-mlx distill --out {model_dir}"
        )

    gold_path = find_gold(model_dir, args.gold)
    if gold_path is None:
        raise SystemExit(
            "No gold.json found. Pass --gold PATH, or place one in the model dir, "
            "benchmarks/, engine/, or a sibling openjev/engine/."
        )
    gold = json.loads(gold_path.read_text())

    try:
        from .server import OnnxEngine
    except Exception as exc:  # noqa: BLE001
        raise SystemExit(f"Could not import the ONNX engine: {type(exc).__name__}: {exc}")
    try:
        engine = OnnxEngine(model_dir)
    except Exception as exc:  # noqa: BLE001
        raise SystemExit(
            f"Could not load the ONNX checkpoint at {model_dir}: {type(exc).__name__}: {exc}\n"
            "Install the [onnx] extra (pip install 'laya-mlx[onnx]') and ensure the "
            "directory holds model.onnx + rl_agent_config.json + encoder/config.json + tokenizer/."
        )

    print(f"[eval] model={engine.model_id} temp={engine.temperature} gold={gold_path}")
    report = evaluate(engine, gold)
    print(f"\ncases:  {report['gold_cases_passed']}/{report['gold_cases_total']} passed")
    print(f"checks: {report['gold_checks_passed']}/{report['gold_checks_total']} passed")
    print(f"accuracy={report['accuracy']} ece={report['ece']}")
    cal = report.get("calibration") or {}
    overall = cal.get("overall")
    if overall:
        print(
            f"reliability (15-bin): ece={overall['ece']} mce={overall['mce']} "
            f"brier={overall['brier']} nll={overall['nll']}"
        )
    for qtype, rep in (cal.get("by_type") or {}).items():
        print(
            f"  {qtype:6s} ece={rep['ece']} adaptive_ece={rep.get('adaptive_ece')} "
            f"brier={rep['brier']} n={rep['count']}"
        )

    if not args.no_write:
        card_path = write_card(model_dir, report)
        if card_path is not None:
            print(f"[eval] updated {card_path}")

    return 1 if report["gold_cases_passed"] != report["gold_cases_total"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
