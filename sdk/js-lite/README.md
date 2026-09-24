# @caelum/typesafe

A reusable [TypeSafe](https://docs.typesafe.ai) (System One / **Jev**) intelligence
layer. Typed judgments as programming primitives: your code owns the workflow and
TypeSafe supplies programmable common sense exactly where ordinary code needs
semantic understanding.

Zero runtime dependencies. Ships as ESM with `.d.ts` types. Node >= 20 (uses the
global `fetch`). Points at `api.typesafe.ai` or any self-hosted `openjev`
instance.

- **Primitives** — `noul` (calibrated yes/no probability), `choice` (closed-set
  label), `score` (ordered position). One narrow judgment each.
- **Decide doctrine** — threshold on *confidence*, escalate the uncertain middle,
  keep policy in code so re-tuning never re-runs inference.
- **Modules** — battle-tested decision surfaces (FlowBlast anti-cheat, aegis RLS
  policy risk, Meta ads scoring, support triage, content moderation, RAG grading).

---

## Install

> Not published to npm yet. Until it is, install from a clone of this repository:

```bash
git clone https://github.com/caelum0x/openjev
cd openjev/sdk/js-lite && npm install && npm run build
# then, from your project:
npm install /path/to/openjev/sdk/js-lite
```

The package name is `@openjev/lite`; `@caelum/typesafe` below is its legacy import name,
kept for compatibility.

```ts
import { TypeSafeClient, noul, choice, score, decideNoul } from '@caelum/typesafe';
```

---

## Quickstart

```ts
import { TypeSafeClient, noul, choice, score, decide } from '@caelum/typesafe';

const client = new TypeSafeClient(); // reads TYPESAFE_API_KEY from the environment

// Batch every judgment you might need into ONE call — they run in parallel server-side.
const res = await client.systemOne({
  state: { document: 'I was charged twice this month and I am furious.' },
  questions: {
    isUrgent: noul('Is this an urgent customer issue?'),
    team: choice('Which team should handle this?', ['billing', 'technical', 'other']),
    frustration: score('How frustrated is the customer?', ['Calm', 'Frustrated', 'Angry']),
  },
});

// Turn typed answers into decisions with explicit thresholds (policy lives in code).
const out = decide<{ isUrgent: boolean; team: string; frustration: 'hot' | 'cool' }>(
  res.answers,
  {
    isUrgent: { type: 'noul', yes: 0.8, map: (v) => v === 'yes' },
    team: { type: 'choice', minConfidence: 0.7, fallback: 'other' },
    frustration: { type: 'score', atOrAbove: 1.5, map: (v) => (v === 'above' ? 'hot' : 'cool') },
  },
);

console.log(out.value);        // { isUrgent: true, team: 'billing', frustration: 'hot' }
console.log(out.escalations);  // fields whose confidence was too low to commit
```

---

## Configuration and environment

Construct with explicit options or rely on environment variables. Precedence for
every setting is: **explicit option → `TYPESAFE_*` → `OPENJEV_*` alias →
default**. `TYPESAFE_*` is primary so the client stays wire-compatible with the
hosted API; the branded `OPENJEV_*` names are read only as a fallback.

| Setting  | Option     | Primary env         | Alias env                | Default                     |
| -------- | ---------- | ------------------- | ------------------------ | --------------------------- |
| API key  | `apiKey`   | `TYPESAFE_API_KEY`  | `OPENJEV_API_KEY` * | (required)                  |
| Base URL | `baseURL`  | `TYPESAFE_BASE_URL` | `OPENJEV_BASE_URL`  | `https://api.typesafe.ai`   |
| Model    | `model`    | `TYPESAFE_MODEL`    | `OPENJEV_MODEL`     | `jev-latest`                |
| Log level| `logLevel` | `TYPESAFE_LOG_LEVEL`| `OPENJEV_LOG_LEVEL` | `off`                       |

\* The lowercase `typesafe_api_key` is also accepted as a last-resort fallback for
the shared `products/.env` convention.

```ts
const client = new TypeSafeClient({
  apiKey: process.env.TYPESAFE_API_KEY,
  baseURL: 'https://api.typesafe.ai', // or your self-hosted OpenJev URL
  model: 'jev-latest',
  timeoutMs: 30_000,
  maxRetries: 2,
});
```

Keys are expected to start with `ots_live_` or `ots_test_`. An unknown prefix
**warns** (it does not throw) so custom or self-hosted keys keep working. A
missing key throws a `TypeSafeError` at construction time.

---

## Primitives

Ask one narrow, coherent judgment per question. The meaning must live entirely in
`instructions`/`criteria` — question ids are for your code and are never sent to
the model. Always include a no-match option when nothing may fit.

```ts
import { noul, choice, score } from '@caelum/typesafe';

// noul — probability of "yes" (0..1). ~0.5 means genuinely uncertain, not "medium".
noul('Is this message spam?');
noul('Valid?', { true: 'Meets the criteria', false: 'Does not meet the criteria' });

// choice — pick one of a defined set. Pass keys, or a key -> description map.
choice('Which team?', ['billing', 'technical', 'other']);
choice('Severity?', { low: 'Minor', high: 'Serious', other: 'Unclear' });

// score — position on an ordered scale. Lowest -> highest; 2+ concrete levels.
score('How urgent?', ['Not urgent', 'Somewhat urgent', 'Very urgent']);
```

Builders validate eagerly and throw `PrimitiveError` on structural mistakes (a
`choice` with no options, a `score` with fewer than two levels).

**Reading answers.** Every answer carries its `type`; use the guards and helpers:

```ts
import { isChoice, isScore, noulConf, isHighConfidence, choiceOrElse } from '@caelum/typesafe';

if (isScore(a)) a.score;              // probability-weighted position
if (isChoice(a)) a.confidence;        // distribution concentration (NOT correctness)
noulConf(nounAnswer);                 // 0 at p=0.5, 1 at p=0 or 1
isHighConfidence(choiceAnswer, 0.9);  // concentration >= threshold
choiceOrElse(choiceAnswer, 0.8, 'unknown');
```

---

## The decide doctrine

Raw judgments are reusable; decisions are policy. Keep thresholds out of the
question and apply them in code so a weight change never re-runs inference.

- Threshold on **confidence**, not just the answer.
- **Escalate** the uncertain middle to a bigger model, a deterministic verifier, or
  a human.
- Require high confidence **before** anything irreversible.

```ts
import { decideNoul, decideChoice, decideScore } from '@caelum/typesafe';

decideNoul(a, { yes: 0.9, no: 0.1 }); // -> { outcome: 'yes' | 'no' | 'escalate', decided, strength, reason }
decideChoice(a, { minConfidence: 0.85 });
decideScore(a, { atOrAbove: 2, minConfidence: 0.6 });
```

Compose a whole typed result in one pass with `decide()` (see Quickstart). Fields
that escalate without a `fallback` are omitted from `value` and listed in
`escalations`; check `allDecided` before relying on the value being complete. Use
`withFallbacks(result, {...})` to fill escalated fields afterwards, and
`compositeScore([...])` to combine independent score dimensions with tunable
weights.

**Co-location.** Bundle the question and its decision parameters per field, then
extract the questions and resolve the answers from the same object:

```ts
import { buildQuestions, decideWithSpec, validateSpec, type DecisionSpec } from '@caelum/typesafe';

type Moderation = { isSpam: boolean; severity: 'low' | 'high' };
const spec: DecisionSpec<Moderation> = {
  isSpam:   { def: noul('Unsolicited or abusive?'), type: 'noul', yes: 0.9, map: (v) => v === 'yes' },
  severity: { def: choice('Harm severity?', { low: 'Minor', high: 'Serious' }),
              type: 'choice', minConfidence: 0.8, map: (v) => v as 'low' | 'high', fallback: 'low' },
};

validateSpec(spec); // at startup: fails fast on malformed questions
const res = await client.systemOne({ state, questions: buildQuestions(spec) });
const result = decideWithSpec<Moderation>(res.answers, spec);
```

---

## Trust layer (OpenJev servers)

```ts
import { withAbstain } from '@openjev/lite';

const res = await client.systemOne({
  model: 'auto',               // local first, LLM only for low-confidence questions
  calibration_id: 'cal_...',   // confidence fitted on your own labels
  state: 'Where is my order?',
  questions: { intent: withAbstain(choice('What does the customer want?', ['refund', 'status']), 0.5) },
});
res.answers.intent.abstained;  // true when out of scope or below 0.5
res.answers.intent.ood;        // out-of-scope score 0..1

// Shadow mode: compare with your production LLM or human labels.
await client.shadow({ state, questions, incumbent: { kind: 'label', answers: { intent: 'status' } } });
const summary = await client.shadowSummary({ days: 7 });
```

## Batching

`/v1/systemone` answers every question in one request, in parallel on the server.
Batch every judgment you might need for a piece of state into a single call to
avoid extra round-trips. `systemOne` (request-object form) and `batch` (positional
form) are equivalent; single-question helpers exist for convenience.

```ts
await client.systemOne({ state, questions: { a: noul('...'), b: choice('...', ['x', 'y']) } });
await client.batch(state, { a: noul('...'), b: choice('...', ['x', 'y']) });

// Convenience single-question helpers:
await client.noul(state, noul('...'));
await client.choice(state, choice('...', ['x', 'y']));
await client.score(state, score('...', ['low', 'high']));
```

Every result carries a `requestId` (server correlation id) alongside the answers.

---

## Error handling and retries

Every failure is a typed subclass of `TypeSafeError`. HTTP failures become an
`APIError` (or a more specific subclass) carrying `status`, `requestId`, and the
parsed `body`. Transport failures become `TimeoutError`, `ConnectionError`
(aliased `NetworkError`), or `AbortError`.

| Class                 | Cause                                            |
| --------------------- | ------------------------------------------------ |
| `ValidationError`     | HTTP 400 / 422 — carries per-field `fields[]`    |
| `AuthenticationError` | HTTP 401 — key missing, malformed, or rejected   |
| `PermissionError`     | HTTP 403 — key valid but not permitted           |
| `NotFoundError`       | HTTP 404 — endpoint or resource missing          |
| `RateLimitError`      | HTTP 429 — exposes `retryAfter` (ms) and `reset` |
| `APIError`            | other non-2xx (e.g. 5xx)                         |
| `TimeoutError`        | request exceeded the configured timeout          |
| `ConnectionError`     | transport failed before a response (DNS/TLS/etc) |
| `AbortError`          | caller cancelled via an `AbortSignal`            |

```ts
import { TypeSafeClient, RateLimitError, ValidationError, TypeSafeError } from '@caelum/typesafe';

try {
  await client.systemOne({ state, questions });
} catch (err) {
  if (err instanceof RateLimitError) {
    // err.retryAfter is the server-advised delay in ms
  } else if (err instanceof ValidationError) {
    for (const f of err.fields) console.error(f.field, f.message);
  } else if (err instanceof TypeSafeError) {
    console.error(err.status, err.requestId, err.message);
  }
}
```

**Retries.** The transport retries `408/429/5xx` and network/timeout failures with
exponential backoff and full jitter, honoring a `Retry-After` header when present
(and short enough). Caller aborts and already-typed API errors are terminal.
Tunable per client or per request:

```ts
const client = new TypeSafeClient({ maxRetries: 3, timeoutMs: 20_000, backoffMs: 500 });
await client.systemOne({ state, questions, maxRetries: 0, timeoutMs: 5_000, signal });
```

---

## Modules

Higher-level decision surfaces built on the primitives. Each is a package subpath
so you import only what you use.

| Subpath                          | Focus                                                                 |
| -------------------------------- | --------------------------------------------------------------------- |
| `@caelum/typesafe/flowblast`     | Anti-cheat triage: which scores need a sim replay, seed retraction    |
| `@caelum/typesafe/aegis`         | RLS policy safety, migration risk, agent-action gate, schema exposure |
| `@caelum/typesafe/meta-ads`      | Score & rank ad creatives, content ideas, competitor audits (`/ads`)  |
| `@caelum/typesafe/support-triage`| Urgency / category / sentiment / routing for support tickets          |
| `@caelum/typesafe/content-moderation` | UGC moderation: allow / flag / remove / escalate                 |
| `@caelum/typesafe/rag-answer-grader`  | Grade RAG answers for faithfulness, relevance, completeness      |

```ts
import { triageDailyScore } from '@caelum/typesafe/flowblast';
import { judgePolicy } from '@caelum/typesafe/aegis';
import { scoreAdCreative, rankAds } from '@caelum/typesafe/meta-ads';
import { triageTicket } from '@caelum/typesafe/support-triage';

const verdict = await judgePolicy(client, {
  table: 'profiles', schema: 'public', command: 'select',
  usingExpr: 'true', roles: ['anon', 'authenticated'], anonReachable: true,
});
// Deterministic red flags (USING(true), service_role to anon) force `dangerous`
// and block the apply regardless of the model's opinion.
```

Modules apply deterministic hard rules in code (the model never overrides a
provable safety violation) and threshold the model's judgment for the gray area.

---

## Examples

Runnable, offline examples live in [`examples/`](./examples):

- `01-basic-primitives.ts` — one call, three primitives.
- `02-batch-decide.ts` — batching with a co-located `DecisionSpec`.
- `03-support-triage-module.ts` — the support-triage module end to end.
- `04-error-handling.ts` — typed errors and retry behavior.

---

## Self-hosting

Point the client at any `openjev`-compatible endpoint with `baseURL` (or
`TYPESAFE_BASE_URL` / `OPENJEV_BASE_URL`). Trailing slashes are normalized
and the URL is validated at construction time.

```ts
const client = new TypeSafeClient({
  baseURL: 'https://openjev.internal/api',
  apiKey: process.env.OPENJEV_API_KEY,
});
```

For advanced transport control the low-level `HttpClient`, `streamText`, and the
config/logging helpers (`resolveConfig`, `createLogger`, `redactHeaders`) are also
exported from the package root.

---

## Local development

```bash
npm install
cp .env.example .env   # add your key
npx tsc --noEmit       # typecheck (strict, ts-extension imports)
npm run build          # tsc -> dist/ (JS + .d.ts, rewrites .ts imports to .js)
node --test            # runs the suite offline; fetch is always injected
```

The test suite never touches the network: every test injects a fake `fetch`.

## License

Apache-2.0
