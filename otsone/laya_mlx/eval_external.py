"""Run the otsone gold-case calibration report against a THIRD PARTY's own model.

``laya_mlx.eval_gold`` already computes the real report -- per-case pass/fail,
accuracy, and the 15-bin ECE/adaptive-ECE/MCE/Brier/NLL reliability summary --
for OpenJev's own ONNX checkpoints (``otsone eval``). This module is the piece
that turns that internal eval script into something an outside team can point
at *their own* typed-decision model or API and get the identical report back,
with zero changes to the scoring math in :mod:`laya_mlx.eval_gold` or
:mod:`laya_mlx.calibration`.

Two ways to plug in a third-party model, both satisfying the exact
``predict(state, questions) -> {"answers": ...}`` / ``model_id`` contract that
:func:`laya_mlx.eval_gold.evaluate` already expects from
:class:`laya_mlx.server.OnnxEngine`:

* :class:`HttpEngine` -- POST ``{"state": ..., "questions": ...}`` to a live
  HTTP endpoint the third party runs, and parse their JSON response. This is
  for a model/API the third party can serve over HTTP during the eval run.
* :class:`AnswersFileEngine` -- replay a JSON file of precomputed
  ``{case_id: answers}`` the third party produced offline (e.g. by running
  their own model over the gold cases in their own infra, with no live
  endpoint exposed to this machine).

Both are driven by the same CLI::

    otsone eval-external --url https://example.com/predict --model-id acme-v1
    otsone eval-external --answers-file my_answers.json --model-id acme-v1

No new runtime dependency is introduced: HTTP uses the standard library
(``urllib.request``), exactly like the existing teacher-model client in
:mod:`laya_mlx.data_gen`.
"""

from __future__ import annotations

import argparse
import json
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence
from urllib.parse import urlparse

from .eval_gold import evaluate, find_gold

ALLOWED_URL_SCHEMES = ("http", "https")


class ExternalEvalError(RuntimeError):
    """Raised for any problem reaching, parsing, or matching a third-party model."""


def _require_safe_url(url: str) -> None:
    """Reject anything that is not a plain http(s) URL (no file://, no gopher://, ...).

    The URL comes from a CLI flag the operator controls on their own machine, not
    from an untrusted request body, so this is not a cross-request SSRF boundary --
    but a typo'd or malicious ``--url`` value (``file:///etc/passwd``, a ``gopher://``
    probe, etc.) should still fail loudly instead of ``urlopen`` quietly honoring it.
    """
    scheme = urlparse(url).scheme.lower()
    if scheme not in ALLOWED_URL_SCHEMES:
        raise ExternalEvalError(
            f"refusing to call {url!r}: scheme must be one of {ALLOWED_URL_SCHEMES}, got {scheme!r}"
        )


class HttpEngine:
    """Calls a live third-party HTTP endpoint for ``predict()``.

    The endpoint must accept ``POST {"state": ..., "questions": ...}`` and
    return a JSON object with an ``"answers"`` key shaped exactly like
    otsone's own served answers -- the same contract
    :class:`laya_mlx.server.OnnxEngine` already returns and
    :func:`laya_mlx.eval_gold.evaluate` already scores:

    * choice question: ``{"choice": "<option id>", "probabilities": {"<option id>": <float>, ...}}``
    * noul question: ``{"noul": <float 0..1>}``
    * score question: ``{"score": <number>, "confidence": <float 0..1>}``

    This is a thin adapter, not a new scoring implementation -- every accuracy
    and calibration number still comes from the untouched
    :mod:`laya_mlx.eval_gold` / :mod:`laya_mlx.calibration` math.
    """

    def __init__(
        self,
        url: str,
        *,
        model_id: Optional[str] = None,
        headers: Optional[Dict[str, str]] = None,
        timeout: float = 30.0,
    ) -> None:
        _require_safe_url(url)
        self.url = url
        self.model_id = model_id or url
        self.headers = dict(headers or {})
        self.timeout = timeout

    def predict(self, state: Any, questions: dict) -> dict:
        body = json.dumps({"state": state, "questions": questions}, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(
            self.url,
            data=body,
            method="POST",
            headers={"Content-Type": "application/json", **self.headers},
        )
        try:
            # Scheme already restricted to http(s) by _require_safe_url above.
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:  # noqa: S310
                raw = resp.read()
        except urllib.error.URLError as exc:
            raise ExternalEvalError(f"request to {self.url} failed: {exc}") from exc

        try:
            payload = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ExternalEvalError(f"{self.url} did not return valid JSON: {exc}") from exc

        if not isinstance(payload, dict) or "answers" not in payload:
            got = list(payload) if isinstance(payload, dict) else type(payload).__name__
            raise ExternalEvalError(
                f"{self.url} response must be a JSON object with an 'answers' key; got {got}"
            )
        return payload


class AnswersFileEngine:
    """Replays a third party's precomputed answers instead of calling them live.

    ``ordered_answers`` must already be aligned to the gold list's own order
    (see :func:`load_answers_payload`), so this class does no id-matching
    itself -- it just hands back the next entry on each ``predict()`` call,
    which is exactly how :func:`laya_mlx.eval_gold.evaluate` walks the gold
    list (one ``predict`` per case, in order, once).
    """

    def __init__(self, ordered_answers: Sequence[dict], *, model_id: str = "external-answers-file") -> None:
        self._queue: List[dict] = list(ordered_answers)
        self._i = 0
        self.model_id = model_id

    def predict(self, state: Any, questions: dict) -> dict:
        if self._i >= len(self._queue):
            raise ExternalEvalError(
                f"answers file has only {len(self._queue)} entries but more gold cases were asked for"
            )
        answers = self._queue[self._i]
        self._i += 1
        return {"answers": answers}


def load_answers_payload(raw: Any, gold: List[dict]) -> List[dict]:
    """Turn a parsed answers-file payload into a per-case list matching ``gold``'s order.

    Accepts either shape a third party is likely to produce:

    * ``{"<case id>": {<answers>}, ...}`` -- a flat id -> answers map.
    * ``[{"id": "<case id>", "answers": {<answers>}}, ...]`` -- a list of records.

    Raises :class:`ExternalEvalError` listing any gold case id with no matching
    answers, so a partial/misnamed file fails loudly instead of silently
    scoring fewer cases than the report claims.
    """
    if isinstance(raw, dict):
        by_id = raw
    elif isinstance(raw, list):
        by_id = {}
        for i, row in enumerate(raw):
            if not isinstance(row, dict) or "id" not in row or "answers" not in row:
                raise ExternalEvalError(
                    f"answers file entry {i} must be an object with 'id' and 'answers' keys"
                )
            by_id[row["id"]] = row["answers"]
    else:
        raise ExternalEvalError("answers file must be a JSON object or a list of {id, answers} records")

    missing = [g["id"] for g in gold if g["id"] not in by_id]
    if missing:
        raise ExternalEvalError(
            f"answers file is missing {len(missing)} gold case id(s): {missing[:10]}"
            + (" ..." if len(missing) > 10 else "")
        )
    return [by_id[g["id"]] for g in gold]


def _parse_headers(raw_headers: Sequence[str]) -> Dict[str, str]:
    headers: Dict[str, str] = {}
    for item in raw_headers:
        if ":" not in item:
            raise ExternalEvalError(f"--header must look like 'Name: Value', got {item!r}")
        name, _, value = item.partition(":")
        headers[name.strip()] = value.strip()
    return headers


def build_engine(args: argparse.Namespace, gold: List[dict]):
    """Construct the right engine (http or answers-file) from parsed CLI args."""
    if args.url:
        headers = _parse_headers(args.header or [])
        if args.api_key_env:
            import os

            token = os.environ.get(args.api_key_env)
            if not token:
                raise ExternalEvalError(
                    f"--api-key-env {args.api_key_env!r} is not set in the environment"
                )
            headers.setdefault("Authorization", f"Bearer {token}")
        return HttpEngine(args.url, model_id=args.model_id, headers=headers, timeout=args.timeout)

    raw = json.loads(Path(args.answers_file).expanduser().read_text())
    ordered = load_answers_payload(raw, gold)
    return AnswersFileEngine(ordered, model_id=args.model_id or f"answers-file:{args.answers_file}")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        prog="otsone eval-external",
        description=(
            "Run the otsone gold-case accuracy/ECE/MCE/Brier/NLL calibration report "
            "against a THIRD PARTY's own typed-decision model or API."
        ),
    )
    ap.add_argument("--gold", help="Path to gold.json (auto-detected if unset)")
    source = ap.add_mutually_exclusive_group(required=True)
    source.add_argument("--url", help="Live HTTP endpoint accepting POST {state, questions}")
    source.add_argument("--answers-file", help="JSON file of precomputed {case_id: answers}")
    ap.add_argument("--model-id", help="Label for this model in the printed report / --out file")
    ap.add_argument("--api-key-env", help="Env var holding a bearer token sent as Authorization: Bearer <token>")
    ap.add_argument(
        "--header",
        action="append",
        default=[],
        help="Extra HTTP header as 'Name: Value' (repeatable, --url mode only)",
    )
    ap.add_argument("--timeout", type=float, default=30.0, help="HTTP timeout in seconds (--url mode only)")
    ap.add_argument("--out", help="Write the full JSON report to this path in addition to stdout")
    ap.add_argument("--quiet", action="store_true", help="Suppress per-case ok/FAIL lines")
    args = ap.parse_args(argv)

    gold_path = find_gold(None, args.gold)
    if gold_path is None:
        raise SystemExit(
            "No gold.json found. Pass --gold PATH, or place one in benchmarks/, "
            "engine/, or a sibling openjev/engine/."
        )
    gold = json.loads(gold_path.read_text())

    try:
        engine = build_engine(args, gold)
    except ExternalEvalError as exc:
        raise SystemExit(str(exc))

    source_desc = args.url if args.url else f"file:{args.answers_file}"
    print(f"[eval-external] model={engine.model_id} source={source_desc} gold={gold_path} cases={len(gold)}")

    try:
        report = evaluate(engine, gold, verbose=not args.quiet)
    except ExternalEvalError as exc:
        raise SystemExit(f"evaluation aborted: {exc}")

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

    if args.out:
        out_path = Path(args.out).expanduser()
        out_path.write_text(json.dumps(report, indent=2) + "\n")
        print(f"[eval-external] wrote {out_path}")

    return 1 if report["gold_cases_passed"] != report["gold_cases_total"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
