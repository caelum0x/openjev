# Geek Room Global AI Hackathon submission — OpenJev "eval-external"

Geek Room Global AI Hackathon, $11,500 pool, deadline Nov 15 2026 (registration
+ prototype), judging Nov 29 2026. Targets the published theme **"a
benchmarking platform for AI agents"** (one of 6 real problem statements for
this event, confirmed via third-party mirrors of the official listing —
`hacklist.io/hackathon/73642591-da1e-4a4a-9cf4-3dbe1d365801` and
`geekroom-mu.vercel.app/event/global-ai-hackathon` — since hackculture.io's own
page requires joining their Discord to see the real rules).

## What this actually is (read this before the pitch)

OpenJev already ships a real, working calibration/eval harness for its own
typed-decision models (`otsone eval`, see
[`otsone/laya_mlx/eval_gold.py`](../../otsone/laya_mlx/eval_gold.py) and
[`otsone/laya_mlx/calibration.py`](../../otsone/laya_mlx/calibration.py)): it
runs a gold case set through a served model, checks pass/fail per question,
and computes real accuracy plus a 15-bin reliability report — ECE
(equal-width), adaptive ECE (equal-mass), MCE, Brier score, and NLL, broken
down per question type (choice/score/noul).

That harness only ever pointed at OpenJev's own ONNX checkpoints
(`laya_mlx.server.OnnxEngine`). It was an **internal eval script**, not
something a third party could use. This submission is the one real feature
that closes that specific gap: **`otsone eval-external`**, a new CLI command
and module
([`otsone/laya_mlx/eval_external.py`](../../otsone/laya_mlx/eval_external.py))
that lets anyone point the exact same scoring code at **their own**
typed-decision model or agent and get the identical report back — with zero
changes to the underlying accuracy/ECE/MCE/Brier/NLL math.

**What's genuinely new in this submission** (not a relabel of existing docs):

- `HttpEngine` — calls a live HTTP endpoint the third party runs
  (`POST {state, questions}` → `{"answers": {...}}`), using only the standard
  library (`urllib.request`, no new dependency), with a real safety check that
  rejects any non-`http(s)` URL scheme.
- `AnswersFileEngine` / `load_answers_payload` — replays a third party's
  precomputed predictions from a JSON file (an id→answers map, or a list of
  `{id, answers}` records) for teams who can't expose a live endpoint, with a
  loud, explicit error if any gold case id is missing.
- A new `otsone eval-external` CLI subcommand wired into
  [`otsone/laya_mlx/cli.py`](../../otsone/laya_mlx/cli.py), with `--api-key-env`
  / `--header` for auth, `--timeout`, and `--out` to save the full JSON report.
- 22 new tests in
  [`otsone/tests/test_eval_external.py`](../../otsone/tests/test_eval_external.py)
  — including a real local HTTP server (no mocked internals) for the live-URL
  path, both answers-file shapes, the URL-scheme safety check, and an
  end-to-end CLI dispatch test.

**What is NOT new:** the scoring math itself (`evaluate()`, `check()`,
`reliability()`, `per_type_reliability()`) is completely untouched — every
report number still comes from the same code OpenJev already uses on its own
models, which is the honest reason the numbers below are trustworthy and not
invented for this submission.

## Real run against the real gold set (not simulated)

The repo's actual 10-case gold set lives at `engine/gold.json` (a sibling of
`otsone/`). Here is a genuine run of `otsone eval-external` against a
deliberately weak dummy "third-party model" — a local HTTP server that always
answers with the first option / a flat 0.5 — to prove the whole pipeline
(network round trip → scoring → calibration → report) actually works end to
end, not just unit-tested in isolation:

```
$ otsone eval-external --url http://127.0.0.1:PORT/predict --model-id dummy-third-party-model
[eval-external] model=dummy-third-party-model source=http://127.0.0.1:PORT/predict gold=.../engine/gold.json cases=10
ok   shoes-returns
FAIL shoes-multi ; choice tone=calm want frustrated
FAIL return-status-structured ; choice return_topic=return_policy want return_status
FAIL bug-cosmetic ; score bug_severity=1.0
ok   bug-workaround
FAIL bug-blocking ; score bug_severity=1.0
FAIL human-escalation ; noul is_human_escalation=0.5 noul is_repeat_contact=0.5
FAIL refund-requested ; noul refund_requested=0.5
FAIL not-refund ; noul refund_requested=0.5
FAIL spam ; noul is_spam=0.5

cases:  2/10 passed
checks: 5/14 passed
accuracy=0.3571 ece=0.1727
reliability (15-bin): ece=0.1 mce=0.125 brier=0.24 nll=0.6729
  choice ece=0.0667 adaptive_ece=0.4667 brier=0.2267 n=6
  score  ece=0.1667 adaptive_ece=0.5 brier=0.25 n=3
  noul   ece=0.3 adaptive_ece=0.5 brier=0.25 n=5
```

This is the real, un-cherry-picked output of a genuinely bad model (it answers
the same way regardless of input), which is exactly what a calibration report
is supposed to expose — low accuracy *and* a reliability breakdown showing
where its confidence doesn't match its correctness. Swap the dummy server for
any real model's inference endpoint and the same command produces the same
kind of report for it.

## How to run it yourself

```bash
cd otsone
uv sync --extra dev
source .venv/bin/activate

# Option A: your model behind a live HTTP endpoint
otsone eval-external --url https://your-model.example.com/predict \
  --model-id your-model-v1 --api-key-env YOUR_MODEL_API_KEY --out report.json

# Option B: precomputed predictions, no live endpoint needed
otsone eval-external --answers-file my_answers.json --model-id your-model-v1

# Run the new tests directly
pytest tests/test_eval_external.py -q
```

Your HTTP endpoint must accept `POST {"state": ..., "questions": {...}}` and
return `{"answers": {"<question_id>": {...}}}`, matching the same answer shape
documented in `otsone/laya_mlx/server.py`'s own served responses (choice:
`{"choice": ..., "probabilities": {...}}`; noul: `{"noul": <0..1>}`; score:
`{"score": <number>, "confidence": <0..1>}`).

## Honest limits (what this is NOT claiming)

- The gold set is OpenJev's own 10-case set (customer-support-style
  choice/score/noul questions). This is a real, working **harness**, not a
  large, independently-curated, cross-domain agent benchmark suite — a team
  benchmarking a very different kind of agent would need to supply their own
  gold cases in the same JSON shape (documented above and in
  `engine/gold.json`).
- A network failure mid-run currently aborts the whole evaluation rather than
  retrying or skipping the failed case — documented, not silently hidden.
- No hosted/dashboard UI exists; this is a CLI + JSON report. "Platform" here
  means "a reusable, third-party-pointable tool," not a hosted SaaS product.
- No benchmark numbers are claimed for any specific third-party model in this
  submission — the dummy-model run above is shown specifically because it is
  real and reproducible, not because it represents a competitive result.

## Links

- Repo (source of truth): `~/products/dev-tools/openjev` (local; primary
  development repo).
- Public GitHub mirror: https://github.com/caelum0x/openjev (`otsone/`
  subdirectory) — this is the repo a judge would actually clone.
- Existing calibration docs: `otsone/BENCHMARKS.md`,
  `otsone/laya_mlx/eval_gold.py`, `otsone/laya_mlx/calibration.py`.
- New feature: `otsone/laya_mlx/eval_external.py`,
  `otsone/tests/test_eval_external.py`, `otsone/laya_mlx/cli.py`
  (`eval-external` subcommand).
