#!/usr/bin/env python3
"""Run TypeSafe gold cases against the C++ kernel (via Python ctypes)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "python"))

from openjev_engine.kernel import eval_cpp, kernel_version  # noqa: E402


def main() -> int:
    gold = json.loads((ROOT / "gold.json").read_text())
    print("kernel", kernel_version())
    ok = fail = 0
    for g in gold:
        out = eval_cpp(
            {"model": "system-one", "state": g["state"], "questions": g["questions"]}
        )
        if not out or "answers" not in out:
            print("FAIL", g["id"], "no output")
            fail += 1
            continue
        ans = out["answers"]
        bad: list[str] = []
        for e in g["expect"]:
            if "choice" in e:
                c = e["choice"]
                a = ans.get(c["id"], {})
                if a.get("choice") != c["value"]:
                    bad.append(f"choice {c['id']}={a.get('choice')} want {c['value']}")
                elif c.get("minP") is not None and (a.get("probabilities") or {}).get(
                    c["value"], 0
                ) < c["minP"]:
                    bad.append(f"p {c['id']}")
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
        if bad:
            fail += 1
            print("FAIL", g["id"], ";", " ".join(bad))
        else:
            ok += 1
            print("ok  ", g["id"])
    print(f"{ok}/{ok + fail} passed")
    return 1 if fail else 0


if __name__ == "__main__":
    raise SystemExit(main())
