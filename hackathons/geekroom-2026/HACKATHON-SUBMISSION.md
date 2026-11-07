# Geek Room Global AI Hackathon submission — OpenJev "Benchmark Submissions"

Geek Room Global AI Hackathon, $11,500 pool, deadline Nov 15 2026 (registration
+ prototype), judging Nov 29 2026. Targets the published theme **"a
benchmarking platform for AI agents"** (one of 6 real problem statements for
this event, confirmed via third-party mirrors of the official listing —
`hacklist.io/hackathon/73642591-da1e-4a4a-9cf4-3dbe1d365801` and
`geekroom-mu.vercel.app/event/global-ai-hackathon` — since hackculture.io's own
page requires joining their Discord to see the real rules).

## What this actually is (read this before the pitch)

OpenJev is a real, production-grade open-source platform already in daily
use: a TypeScript web console + API server (TanStack Router/Vite + React,
Postgres via Neon or embedded PGLite), a native calibration engine
([`src/lib/jev/calibration.ts`](../../src/lib/jev/calibration.ts)), a public
[`/leaderboard`](../../src/routes/leaderboard.tsx) that scores every OpenJev
model on a 93-case in-repo gold suite plus three public datasets (Banking77,
CLINC150+OOS, AG News), and a real auth/API-key/quota/rate-limit system
(`src/lib/auth/`, `migrations/0004_quotas.sql`,
`migrations/0005_llm_rate_limit.sql`). It is not a toy or a side CLI script.

A first pass on this theme shipped `otsone eval-external`, a Python CLI
addition that let a third party point the existing gold-case harness at their
own model. The owner's correction: that was too small a surface for "a
benchmarking platform for AI agents" — the real submission has to be a
first-class part of the platform itself, not a script judges have to go dig
for in a subfolder. **This is that submission: "Benchmark Submissions," a
production-integrated subsystem of the real platform.**

### What was built

1. **A real migration** —
   [`migrations/0011_external_benchmarks.sql`](../../migrations/0011_external_benchmarks.sql):
   `benchmark_submissions` (submitter, model label, source — a live HTTP
   endpoint or a precomputed-answers upload, status, timestamps) and
   `benchmark_results` (one row for the overall score plus one row per
   question type — choice/noul/score — each with accuracy, strict pass rate,
   ECE, adaptive ECE, MCE, Brier, NLL).
2. **A real, pure scoring module** —
   [`src/lib/jev/benchmark-scoring.ts`](../../src/lib/jev/benchmark-scoring.ts):
   builds a `Runner` that either POSTs `{state, questions}` to the
   submitter's endpoint and reads back `{answers}` (the identical contract
   `HttpEngine` in `otsone/laya_mlx/eval_external.py` expects), or replays a
   precomputed answers payload in the gold suite's own order (mirrors
   `AnswersFileEngine`). The actual scoring is NOT reimplemented — it calls
   the exact same `evalGoldWith` (`src/lib/jev/gold.ts`) and `buildReliability`
   (`src/lib/jev/calibration.ts`) engine every OpenJev model, and
   `scripts/leaderboard.mjs`, already use. One canonical TypeScript scoring
   engine; the Python harness and this module compute the same metric
   definitions (ECE/MCE/Brier/NLL per question type), not two divergent ones.
3. **A real API route** —
   [`src/routes/api/v1/benchmark-submissions.ts`](../../src/routes/api/v1/benchmark-submissions.ts)
   (`GET`/`POST`, same auth as every other `/api/v1/*` route —
   `resolveConsoleUser`, then the real `checkQuota` rate-limit/monthly-quota
   check — so a submission counts against the submitter's own quota like any
   other decision volume) plus a public, unauthenticated
   [`.../leaderboard`](../../src/routes/api/v1/benchmark-submissions.leaderboard.ts)
   feed for the public page. `POST` runs the full 93-case gold suite
   synchronously, persists the submission + its overall and per-type results,
   and returns real computed scores — not a queued job id to poll.
4. **A new shared SSRF guard** —
   [`src/lib/jev/outbound-guard.server.ts`](../../src/lib/jev/outbound-guard.server.ts),
   extracted from the existing outbound-webhooks SSRF protection (one
   guard, not two implementations that could drift) — rejects
   localhost/loopback/RFC1918-private/link-local/cloud-metadata/CGNAT targets
   before any submitted endpoint URL is ever called, both by literal-IP check
   and a real DNS-resolution check.
5. **Real UI integration, not a separate page** —
   [`src/routes/leaderboard.tsx`](../../src/routes/leaderboard.tsx) now fetches
   completed submissions client-side and renders them as extra rows, kind
   `"external"` / "Community submitted," in the SAME gold-suite table as
   OpenJev's own models (same columns: accuracy, strict pass, ECE, Brier).
   A new [`/submit-model`](../../src/routes/submit-model.tsx) page, linked
   from the leaderboard header and method notes, is a real form (model label,
   live-endpoint URL or pasted answers JSON) that calls the API and renders
   the computed scores plus the per-question-type breakdown table.
6. **Real tests** — `src/lib/jev/benchmark-scoring.test.ts` (9 tests,
   including an end-to-end check that replaying the real `system-one`
   engine's own answers through the external-submission path reproduces
   `evalGold()`'s numbers byte-for-byte — proof it is the same engine, not a
   parallel one) and `src/lib/jev/outbound-guard.server.test.ts` (6 tests for
   the SSRF guard), run via the existing native-Node `--test` runner
   (`npm test`).

## Real run against the real gold set (not simulated)

This was exercised end to end on a real local server (`npm run dev`), not
just read from source. A precomputed-answers payload built from the real
`system-one` engine's own 93 gold-case answers was submitted through the
actual UI form at `/submit-model` (filled the model-label field, pasted the
answers JSON, clicked "Submit and score" — a real browser session, not a
curl-only check):

```
Scored: ui-driven-e2e-test
ACCURACY 85.6%   STRICT PASS 100.0%   ECE 0.096   ADAPTIVE ECE 0.081
MCE 0.806        BRIER 0.127          NLL 0.828   CASES 93

choice  n=48  accuracy=87.5%  ece=0.136  brier=0.132  nll=1.292
noul    n=32  accuracy=78.1%  ece=0.124  brier=0.159  nll=0.484
score   n=17  accuracy=94.1%  ece=0.025  brier=0.049  nll=0.162
```

These numbers are byte-identical to `evalGold("system-one")`'s own internal
report run directly against `src/lib/jev/gold.ts` — proof the external
submission path is scored by the real engine, not a second implementation.
The submission then appeared, live, as a "Community submitted" row on
`/leaderboard`'s gold-suite tab, ranked in the same table next to OpenJev's
own `system-one` / lexical rows, confirmed with a real headless-browser
screenshot after JS hydration (not just the server-rendered shell).

The SSRF guard was also exercised for real: submitting
`endpointUrl: "http://127.0.0.1:.../leaderboard"` and
`endpointUrl: "http://169.254.169.254/latest/meta-data"` (the cloud metadata
address) both returned a real 400 rejection before any outbound request was
attempted.

```bash
npm run typecheck   # clean
npm test             # 138 passed, 1 pre-existing skip, 0 failed
npm run gold          # gold: 61 passed, 0 failed (unchanged by this work)
```

## How to run it yourself

```bash
npm install
npm run dev          # self-hosted: PGLite embedded DB, auth disabled (dev-user)
# open http://localhost:8080/submit-model
```

Your HTTP endpoint must accept `POST {"state": ..., "questions": {...}}` and
return `{"answers": {"<question_id>": {...}}}` — the same shape OpenJev's own
`/api/v1/systemone` responses use (choice: `{"type":"choice","choice":...,
"probabilities":{...},"confidence":...}`; noul: `{"type":"noul","noul":<0..1>}`;
score: `{"type":"score","score":<number>,"confidence":<0..1>}`). Or skip the
live endpoint and paste a precomputed `{"<gold case id>": {<answers>}}` JSON
map directly into the form.

The earlier, smaller `otsone eval-external` Python CLI addition
(`otsone/laya_mlx/eval_external.py`) still exists and still works
standalone — this platform feature supersedes it as the real submission, but
does not remove it; both compute the same metric definitions against the
same kind of gold-case contract, one as a platform feature, one as a
local CLI script for teams that only want the Python harness.

## Honest limits (what this is NOT claiming)

- OpenJev is **self-host only** (see the README's status line) — there is no
  official hosted `openjev.com` service. A judge running this must clone the
  repo and `npm run dev` (or Docker) themselves; there is no public URL to
  submit a model to right now. This doc does not claim otherwise.
- The gold set is OpenJev's own 93-case set (customer-support/agent-style
  choice/score/noul questions, including out-of-scope probes). This is a
  real, working **benchmark harness for typed-decision models**, not an
  independently-curated, cross-domain agent benchmark suite covering every
  possible agent task — a team benchmarking a very different agent would
  still need their own gold cases in this JSON shape.
- Submissions run synchronously inside the request (no background job
  queue exists in this app yet): an "endpoint" submission is up to 93
  sequential HTTP round trips to the submitter's server, so a slow or
  rate-limited third-party endpoint makes a submission slow — not a crash,
  but a real, documented limitation. A future pass could move this to a
  queued/polled job.
- No benchmark numbers are claimed for any real external competitor model in
  this submission — the `ui-driven-e2e-test` / `e2e-test-system-one-replay`
  rows shown above are real but are literally `system-one` replaying its own
  answers, shown specifically because the run is real and reproducible, not
  because they represent a competitive third-party result.
- The SSRF guard blocks loopback/private/link-local/metadata/CGNAT
  addresses via both a literal-IP check and a DNS-resolution check; it does
  not defend against a submitter's endpoint being compromised *after*
  submission-time validation (a standard TOCTOU limitation shared with the
  existing outbound-webhooks feature this guard was extracted from).

## Links

- Repo (source of truth): `~/products/dev-tools/openjev` (local; primary
  development repo).
- Public GitHub mirror: https://github.com/caelum0x/openjev — this is the
  repo a judge would actually clone.
- Live-in-repo capability (after `npm run dev`):
  `http://localhost:8080/leaderboard` (gold-suite tab, "Community submitted"
  rows) and `http://localhost:8080/submit-model` (the submission form).
- New platform code: `migrations/0011_external_benchmarks.sql`,
  `src/lib/jev/benchmark-scoring.ts`, `src/lib/jev/benchmark-scoring.test.ts`,
  `src/lib/jev/benchmark-submissions.server.ts`,
  `src/lib/jev/outbound-guard.server.ts`,
  `src/lib/jev/outbound-guard.server.test.ts`,
  `src/routes/api/v1/benchmark-submissions.ts`,
  `src/routes/api/v1/benchmark-submissions.leaderboard.ts`,
  `src/routes/submit-model.tsx`, plus the `/leaderboard` integration in
  `src/routes/leaderboard.tsx` and `src/lib/jev/leaderboard.ts`.
- Existing calibration engine this reuses (not reimplements):
  `src/lib/jev/calibration.ts`, `src/lib/jev/gold.ts`,
  `src/lib/jev/leaderboard.ts`.
- The earlier, smaller Python addition this supersedes as the primary
  submission: `otsone/laya_mlx/eval_external.py`,
  `otsone/tests/test_eval_external.py`.
