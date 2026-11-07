# OpenJev

[![GitHub stars](https://img.shields.io/github/stars/caelum0x/openjev?style=social)](https://github.com/caelum0x/openjev/stargazers)

**Typed decisions instead of prompt-and-parse: an open-source, self-hostable service that
turns text plus typed questions into calibrated `choice` / `score` / `noul` answers.**

Instead of prompting an LLM and parsing prose, you POST application state plus a set of
typed questions and get back typed judgments with probabilities that ordinary code can
compose. The default engine is a local sentence-embedding classifier (gte-small, int8 ONNX,
CPU-only) with a lexical TF-IDF fallback that needs no model at all, so it runs anywhere
Node runs. Accuracy and calibration (ECE) are measured on public datasets, not assumed.

This repository is the whole project in one place: the API server + web console, the
native engine, the SDKs, the agent skills, and the `otsone` model toolkit used to train
and serve our own model family. Licensed under **Apache-2.0** (the SDK, adapter and skills
subdirectories derived from TypeSafe AI's MIT SDKs keep their MIT licenses; see
[Licensing](#licensing)).

> **Status.** OpenJev is self-host only. There is no official hosted OpenJev service, and
> the SDK packages are not yet published to npm or PyPI: install them from this repository
> (see [SDKs](#sdks)). The `openjev.com` domain and the PyPI name `openjev` belong to
> unrelated projects.

## 60-second quickstart

With Docker (API + console on http://localhost:3000, plus the optional laya-onnx sidecar):

```bash
git clone https://github.com/caelum0x/openjev && cd openjev
docker compose up --build
```

Or with Node.js 22+ (dev server on http://localhost:8080):

```bash
git clone https://github.com/caelum0x/openjev && cd openjev
npm install
npm run embed-download           # optional: ~33 MB gte-small model; without it the lexical engine answers
npm run dev
```

Then ask it something (use port 3000 for Docker):

```bash
curl -s localhost:8080/api/v1/systemone -H 'content-type: application/json' -d '{
  "model": "system-one",
  "state": "I was charged twice for order A-104, please refund the duplicate",
  "questions": {
    "department": { "type": "choice", "instructions": "Which team should handle this?",
      "criteria": { "billing": "payments, refunds", "technical": "bugs, outages", "sales": "pricing" } },
    "urgency": { "type": "score", "instructions": "How urgent is this?",
      "criteria": ["low", "medium", "high", "critical"] },
    "is_refund": { "type": "noul", "instructions": "Is the customer asking for a refund?" }
  }
}'
```

Every response says which engine answered (`engine.kind` is `embedding` or `lexical`).
Nothing is required to boot: no API key, no database (an in-memory PGlite is used unless
you set `DATABASE_URL`), no model download.

---

## The three model families

The same `POST /v1/systemone` contract runs on any of three families:

| Family | Models | Runs on | Needs |
|--------|--------|---------|-------|
| **OpenJev (ours)** | `system-one` (sentence-embedding engine; lexical TF-IDF fallback), `otsone-1`, `otsone-mini` | anywhere Node runs; `system-one` in-process on CPU; otsone via the ONNX (CPU) or MLX (Apple silicon) sidecar | for `system-one`, the 33 MB gte-small model (`npm run embed-download`; without it the lexical engine answers and says so); the otsone sidecar + locally trained weights for `otsone-*` |
| **Laya (open weights)** | `laya-onnx`, `laya-mlx` | local sidecar (ONNX on Linux/CPU, MLX on Apple silicon) | the Laya checkpoints from Hugging Face (Convai Innovations, Apache-2.0) |
| **Cloud** | `system-one-cloud` | any wire-compatible hosted System One v1 endpoint | `OPENJEV_API_KEY` + endpoint; degrades to local when unset |

Neural models health-gate: if their sidecar is absent, the request is answered by the
local engine and the response says so (`requested` vs `served_by`). An optional
escalation model (`openjev-grok`) routes hard decisions to OpenAI / xAI / Anthropic
when you supply a provider key.

### Measured accuracy of the default engine

Zero-shot (the engine sees only the class names), full test splits, from
[`src/lib/content/leaderboard.json`](src/lib/content/leaderboard.json) and rendered at
`/leaderboard`. To reproduce (the datasets are downloaded at run time into `.cache/`;
the embedding column needs the pinned gte-small model):

```bash
npm install
npm run embed-download
LEADERBOARD_PUBLIC=1 LEADERBOARD_PUBLIC_SAMPLE=all npm run leaderboard
```


| Test split | `system-one` embedding engine (gte-small) | lexical fallback |
|---|---|---|
| Banking77 test (3,080 rows, 77 intents): accuracy / ECE | 62.4% / 0.035 | 38.7% / 0.475 |
| CLINC150 plus test (4,500 in-scope rows, 150 intents): accuracy / ECE | 67.4% / 0.055 | 11.9% / 0.842 |
| CLINC150 plus test, 1,000 out-of-scope rows: AUROC of `ood` | 0.910 | 0.683 |
| same: out-of-scope flagged at the shipped threshold (in-scope false alarms) | 71.1% (9.5%) | 0.0% (0.0%) |
| same: out-of-scope flagged at a 5% false-alarm rate (threshold tuned on test) | 57.4% | 0.1% |
| AG News test (7,600 rows, 4 topics): accuracy / ECE | 75.0% / 0.053 | 35.7% / 0.425 |

The engine's constants were fitted on held-out data only (Banking77 train, CLINC150
validation, half of the in-repo gold suite); AG News was never used for fitting. On the
small in-repo gold suite, which the lexical engine was tuned on, the lexical engine is
ahead (85.6% vs 82.5% accuracy; 94.7% vs 61.3% of off-topic probe pairs flagged); treat
the gold suite as a regression check, not a benchmark.

---

## The trust layer

What a System One model alone does not give you:

- **Out of scope and abstain.** Every answer carries an `ood` score (on the
  embedding engine, a fitted detector over similarity to the options and their
  centroid plus a Mahalanobis-style distance; on other backends, distance of the
  state from the question's vocabulary, modulated by answer entropy), and
  off-topic inputs lose their confidence instead of coming back at 0.99. Set
  `abstain: true` (request or question) to get `abstained: true` and, for Choice,
  the reserved `__none__` option.
- **`auto` cascade.** `model: "auto"` answers locally (otsone when its sidecar is
  up, else System One) and escalates only low-confidence or out-of-scope
  questions to an LLM: Groq (free tier), Ollama (local), or OpenAI/xAI/Anthropic
  when keyed. The response's `escalation` block lists what escalated and why.
- **Calibration on your labels.** `POST /api/v1/calibrations` fits a temperature
  or isotonic map per question from your labelled rows (CSV/JSONL upload in
  `/calibrations`, or straight from an eval run). With 20+ labels per question a
  stratified quarter is held out: the map is fitted on the rest and the
  before/after accuracy, ECE and Brier are measured on labels it never saw.
  Pass `calibration_id` to apply it. The evals page imports labelled CSV/JSONL
  (validated against the question schema, with a preview) and has a reliability
  diagram and a threshold picker.
- **Shadow mode.** `POST /api/v1/shadow` runs next to your production LLM and
  logs agreement; `/shadow` shows agreement by confidence and projected savings.
  Send `incumbent: { kind: "label", answers }` to log human ground truth instead.
- **Drift alerts.** Each calibration can have a drift monitor
  (`/calibrations/<id>` or `POST /api/v1/drift`). Shadow traffic that used the
  calibration is compared with its held-out numbers; accuracy drops, confidence
  shifts, or confidence running ahead of accuracy POST a `calibration.drift`
  event to your webhook, signed `X-OTS-Signature: t=<unix>,v1=<HMAC-SHA256 of
  "<t>.<body>">`, and `calibration.drift_resolved` when it clears.
- **Public leaderboard.** `npm run leaderboard` scores every available backend on
  the in-repo gold suite and out-of-scope probes and writes
  `src/lib/content/leaderboard.json` (rendered at `/leaderboard`). With
  `LEADERBOARD_PUBLIC=1` it also scores Banking77, CLINC150 (with its
  out-of-scope queries) and AG News, downloaded at run time into `.cache/`.
- **Signed audit reports.** `GET /v1/reports/:calibrationId` (`?format=html` for a
  printable copy) bundles a calibration's maps, raw vs calibrated ECE / Brier, the
  recommended threshold, drift history and shadow agreement, signed with
  HMAC-SHA256; `POST /v1/reports/verify` checks a report was issued by the server
  and not edited.

Set `OPENJEV_SITE_URL` to your deployment's public origin; without it the app
publishes no sitemap and asks crawlers not to index it.

## Layout

```
src/                 API server + web console (TanStack Start / Vite)
  routes/api/v1/     POST /v1/systemone, batch, models, keys, usage, evals, ...
  lib/jev/           the typed-decision engine (TS), backends, validation, cookbooks
engine/              native engine: C++ kernel, Rust HTTP server, Python binding, gold suite
migrations/          SQL migrations (PGlite in-memory by default, Postgres optional)
scripts/             CLI (`openjev serve`), Laya sidecar/download/distill helpers
otsone/              otsone model toolkit (Python): train / calibrate / export / serve
                     otsone-1 and run Laya on MLX or ONNX (formerly laya-mlx)
sdk/js/              `@openjev/sdk` — full TypeScript SDK
sdk/ai-sdk/          `@openjev/ai-sdk` — Vercel AI SDK integration
sdk/js-lite/         `@openjev/lite` — zero-dependency client + decision modules
sdk/python/          Python SDK (import `openjev`)
adapters/python/     `openjev-adapters` (import `openjev_adapters`) — run the same API on top of OpenAI/Anthropic/...
skills/              agent skills (Claude Code, Codex, ...) for building with typed decisions
examples/            runnable examples
docs/                weights provenance, screenshots
```

---

## SDKs

The HTTP API is the primary interface; any language can call it. The SDKs below live in
this repository and are **not yet published** to npm or PyPI, so install them from a clone:

| SDK | Directory | Install from source |
|-----|-----------|---------------------|
| TypeScript (full) | [`sdk/js`](./sdk/js) | `cd sdk/js && npm install && npm run build`, then `npm install /path/to/openjev/sdk/js` |
| TypeScript (zero-dependency) | [`sdk/js-lite`](./sdk/js-lite) | `cd sdk/js-lite && npm install && npm run build`, then install by path |
| Vercel AI SDK integration | [`sdk/ai-sdk`](./sdk/ai-sdk) | build `sdk/js` first, then as above |
| Python | [`sdk/python`](./sdk/python) | `pip install ./sdk/python` |
| Python provider adapters | [`adapters/python`](./adapters/python) | `pip install './adapters/python[openai]'` |

Do not `pip install openjev` from PyPI: that name belongs to an unrelated project.

---

## Self-hosting

Docker (Node service + laya-onnx sidecar):

```bash
cp .env.example .env             # optional — nothing is required to boot
docker compose up --build        # → http://localhost:3000
```

See [SELF-HOSTING.md](./SELF-HOSTING.md) for the non-Docker Node server, Postgres, LLM
escalation and every environment variable ([.env.example](./.env.example)).

### Serving otsone-1 locally

```bash
cd otsone
uv sync --extra onnx --extra train
uv run otsone distill --backbone otsone-base --out models/otsone-base   # train + export
OTSONE_BACKEND=onnx OTSONE_MODEL_PATH=./models/otsone-base uv run otsone-serve
```

Then point the server at it with `OTSONE_MODEL_URL` (see `.env.example`). Model weights are
never committed — see [docs/WEIGHTS.md](./docs/WEIGHTS.md).

---

## Development

| Component | Test command |
|-----------|--------------|
| server / console | `npm test && npm run gold && npm run typecheck` |
| native engine | `make -C engine` |
| `sdk/js` | `cd sdk/js && npm install && npm test` |
| `sdk/js-lite` | `cd sdk/js-lite && npm test` |
| `sdk/python` | `cd sdk/python && uv sync && uv run pytest` |
| `adapters/python` | `cd adapters/python && uv sync && uv run pytest` |
| `skills` | `cd skills && npm test` |
| `otsone` | `cd otsone && uv sync --extra dev && uv run pytest` |

---

## Renamed from opentypesafe

This project was previously called **opentypesafe**. The HTTP API is unchanged
(`POST /v1/systemone`, `/v1/batch`, ... and `ots_live_` keys), and old names keep working.
Package names below are the names the packages are built under; none are published to a
registry yet.

| Old | New | Compatibility |
|-----|-----|---------------|
| npm `opentypesafe-sdk` | `@openjev/sdk` | `OpenTypeSafeClient` / `TypeSafeClient` still exported |
| npm `@caelum/opentypesafe` | `@openjev/lite` | `OpenTypeSafeClient` / `TypeSafeClient` still exported |
| Python `opentypesafe-sdk` (`import opentypesafe_sdk`) | `import openjev` | `opentypesafe_sdk` is kept as a deprecated alias module |
| Python `opentypesafe-adapter` (`import opentypesafe_adapter`) | `openjev-adapters` (`import openjev_adapters`) | `opentypesafe_adapter` is kept as a deprecated alias module |
| `OPENTYPESAFE_*` env vars | `OPENJEV_*` | old names are read as a fallback (then `TYPESAFE_*`) |
| model ids `opentypesafe-grok`, `opentypesafe-latest`, ... | `openjev-grok`, `openjev-latest`, ... | old ids still resolve |
| CLI `opentypesafe` | `openjev` | both bin names are installed |

---

## Origins & licenses

OpenJev began as an open, wire-compatible reimplementation of the TypeSafe AI System One
v1 API, and it is honest about where its pieces come from:

- The MIT-licensed `sdk/js`, `sdk/python`, `adapters/python` and `skills` directories are
  derived from TypeSafe AI's SDKs; each keeps its original `LICENSE` and `NOTICE`.
- "Jev" is the name of TypeSafe AI's model family, and "System One" is the name of
  TypeSafe AI's API. OpenJev is an independent project and is **not affiliated with,
  sponsored by or endorsed by TypeSafe AI**; those names are used only to describe wire
  compatibility, and the `jev-*` model ids exist only as compatibility aliases. OpenJev
  does not ship or reproduce TypeSafe AI's models. Other unrelated open-source projects
  also use the name "OpenJev".
- The `otsone-1` model is our own; the Laya models are Convai Innovations' (Apache-2.0).

## Licensing

- Root project, `engine/`, `otsone/`, `sdk/js-lite/`: **Apache-2.0** ([LICENSE](./LICENSE)).
- `sdk/js`, `sdk/python`, `adapters/python`, `skills`: **MIT**, derived from the
  TypeSafe AI SDKs (each directory keeps its original `LICENSE` and `NOTICE`).
- `otsone/` includes code adapted from [Laya](https://github.com/NandhaKishorM/laya)
  (Convai Innovations, Apache-2.0) — see [otsone/NOTICE](./otsone/NOTICE).
- Model weights are not distributed in this repository.

See [NOTICE](./NOTICE) for attributions.

---

## Roadmap

The live roadmap is rendered at `/roadmap` (source:
[`src/lib/content/roadmap.ts`](./src/lib/content/roadmap.ts)). Near-term priorities:

- Publish the SDKs to npm and PyPI (the Python distribution needs a new name; `openjev` is
  taken on PyPI) and a prebuilt Docker image.
- Improve the default engine's accuracy on the public leaderboard, and add more public
  datasets.
- Go client SDK, decision export (JSONL / CSV), OpenTelemetry trace export, MCP server
  mode.

Suggestions are welcome as GitHub issues.

## Found this useful?

If OpenJev saved you a prompt-and-parse hack, a star helps the next person
wrestling with unreliable LLM output find it. If you know someone building
agents or routing/triage logic who'd rather get a typed answer back than parse
prose, a share or a mention helps more than the star — no worries if not, just
offering since it's free either way.

## Contributing

Contributions are welcome: bug reports, datasets for the leaderboard, engine
improvements, SDKs for more languages. Start with [CONTRIBUTING.md](./CONTRIBUTING.md);
this project follows the [Code of Conduct](./CODE_OF_CONDUCT.md). Please report security
issues privately as described in [SECURITY.md](./SECURITY.md), not in public issues.
