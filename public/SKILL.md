---
name: openjev
license: MIT
description: >
  Build AI-powered software with openjev: small units of AI intelligence you
  can use like programming primitives. Its decision models turn natural language
  and application state into typed judgments and probabilities that code can
  combine. Wire-compatible with the upstream System One v1 API, so the same
  code runs against a self-hosted OpenJev URL or any compatible endpoint.
  Use when a feature needs programmable common sense, when brainstorming what AI
  could make possible in an app, or when an LLM prompt-and-parse step could
  become a structured decision. Applications include routing, ranking,
  extraction, verification, and interactive experiences; these are starting
  points, not the limits. Read live docs and cookbooks to find useful patterns
  and discover new combinations.
---

# Build with OpenJev

OpenJev makes units of AI intelligence usable like programming primitives: small
judgments you can compose into larger capabilities. Its **System One models** return
fast, focused judgments that software can consume directly. They understand natural
language and return typed answers and probabilities rather than generating text or
reasoning explanations. Code owns the workflow; the model supplies programmable common
sense where ordinary code needs semantic understanding.

OpenJev is an open-source, self-hostable decision engine and stays
**wire-compatible with the upstream System One v1 API**. The same request and
response shapes run against a self-hosted OpenJev deployment or any
compatible endpoint — see [Wire contract and endpoints](#wire-contract-and-endpoints).

## Read the live docs

**The live docs are the source of truth. Read them as part of the task.** This skill
gives direction; the docs carry current concepts, prompting guidance, API contracts,
SDK usage, models, limits, and worked examples.

- Prefer the docs of the deployment you are targeting. A self-hosted OpenJev
  serves its own docs, playground, and cookbooks at `/docs`, `/playground`, and
  `/cookbooks`, and serves this skill at `GET /api/v1/skill` (Markdown) or `/skill`.
- The self-hosted docs at `/docs` are the primary reference. For a new workflow,
  also inspect the closest cookbook: it often shows a better decomposition than a
  generic classifier.
- Before writing an integration, read the current API or chosen SDK page and the
  question guidance relevant to the design.
- If a docs source is unavailable, use local docs or installed SDK types, state that
  limitation, and avoid inventing version-dependent details.

| Task | Start here; follow the relevant details |
| --- | --- |
| Understand the programming model | `/docs` — primitives, API reference, backends |
| Explore what to build | `/use-cases`, then `/cookbooks` |
| Prepare inputs and questions | `/docs/primitives` — Choice, Score, Noul |
| Decide how to handle uncertainty | `/docs/primitives` — Confidence section |
| Write API code | `/docs/api-reference` or `/docs/sdk` |
| Try it interactively | `/playground` |

## Wire contract and endpoints

OpenJev and any wire-compatible endpoint share one contract: `POST /v1/systemone`.
The request is a **model**, a **state**, and a map of typed **questions** (a dict keyed
by question ID). Answers come back under the same keys, plus `usage` and `latency_ms`.

Configure the base URL and credential from the environment so the same code targets
either deployment:

- `OPENJEV_BASE_URL` — base URL, **default `http://localhost:3000/api/v1`** for
  self-hosted. Override to point at the OpenJev Cloud endpoint or any compatible
  deployment (for example `https://systemone.internal/api/v1`). Always let the env
  override it; never hardcode.
- `OPENJEV_API_KEY` — the API key. For back-compat, falls back to `TYPESAFE_API_KEY`
  when `OPENJEV_API_KEY` is unset. Sent as `Authorization: Bearer <key>`.
  Keep credentials server-side in web apps.

Request (questions as a dict; IDs are for your code and are not sent to the model):

```json
{
  "model": "system-one",
  "state": "Help! My payouts have been failing for 3 days.",
  "questions": {
    "department": {
      "type": "choice",
      "instructions": "Which team should handle this?",
      "criteria": {
        "billing": "Payments, invoicing, refunds",
        "technical": "Bugs, outages, integrations",
        "sales": "Pricing, upgrades, new accounts"
      }
    },
    "is_urgent": { "type": "noul", "instructions": "Does this convey urgency?" }
  }
}
```

Response (answers keyed by the same IDs):

```json
{
  "model": "system-one",
  "answers": {
    "department": { "type": "choice", "choice": "billing" },
    "is_urgent": { "type": "noul", "noul": 0.83 }
  },
  "usage": { "input_tokens": 41, "output_tokens": 0 },
  "latency_ms": 9
}
```

The default model alias `system-one` (also `openjev-latest`) resolves per
deployment. Do not change the request/response shapes: they are the compatibility
surface between OpenJev and any wire-compatible endpoint.

## Find the useful shape

Start from the behavior the user wants: what will the application show, select,
change, or hand off? Work backward to the judgments it needs. Keep known rules,
calculations, exact lookups, and execution in code. Preserve the user's chosen stack
and scope; add OpenJev where semantic understanding helps.

When brainstorming or choosing an architecture, consider more than classification.
The patterns below are starting points: combine primitives around the user's goal,
including ideas that do not fit an established recipe.

- **Route and fill known arguments.** A request can select a handler and its typed
  parameters. Ask useful branch-specific questions up front and consume only the
  relevant answers. See the function-calling and parallel-questions cookbooks at
  `/cookbooks`.
- **Select instead of generate.** Find candidate values or source spans in code,
  use a judgment to select the intended one, then copy or normalize it. Code can
  also assemble source text into a formatted document or reading guide. See the
  SDE cascade cookbook at `/cookbooks`.
- **Find and judge evidence.** Retrieve candidates, compare their relevance to a
  query, and select useful context. See the self-consistency and cascade cookbooks
  at `/cookbooks`.
- **Turn judgments into reusable data.** Score dimensions once, then let code or
  user controls change weights, thresholds, rankings, and views. With labeled
  outcomes, those signals can become classical ML features.
- **Verify and escalate.** Check specific claims or fields against their evidence;
  send uncertain or failing cases to a person or reasoning model. See the cascade
  and smart-home cookbooks at `/cookbooks`.
- **Respond to changing state.** Code can retain goals and observations while fresh
  judgments guide the next bounded step. Keep inferred state distinct from observed
  facts, and check freshness before applying a result to a changed situation.

For open-ended requests, offer the few directions that best serve the user's goal
and recommend a starting point. For a concrete request, choose the relevant pattern
and build; a brainstorm is not a mandatory detour.

## Design the judgments

Choose by what the answer means, then read the relevant primitive page:

| Need | Primitive | Important distinction |
| --- | --- | --- |
| One of a defined set | **Choice** | Picks one option; its distribution compares competing options |
| Whether a condition holds | **Noul** | Probability of yes; no separate confidence; use one per label when several may apply |
| Degree along a described dimension | **Score** | Probability-weighted position on ordered levels; use comparable per-item Scores for graded ranking |

Give each question enough relevant **state** to answer: source text, identities,
relationships, policies, and current facts. Prefer named JSON fields when context
has several parts. Put the judgment in **instructions** and define its possible
answers in **criteria**. Question IDs are for code and are not sent to the model;
include complete meaning in the question. Reference nested state with backticked
paths such as `ticket.messages[0].text`.

Ask one narrow, coherent judgment per question. Split independently useful dimensions,
without destroying the relationship being judged. A bounded action selection or
contextual interpretation is valid; atomic does not mean literal fact extraction
or a one-sentence limit. Strings work for simple questions. Use structured objects
or arrays when definitions, contrasts, exclusions, or examples clarify instructions
or criteria. Score levels must describe concrete situations and stand on their own.

Keep the needed answers available. Include a no-match outcome when nothing may fit;
use a separate presence judgment when it is independently useful. For source-value
selection, check candidate coverage: the model cannot choose an omitted value.

## Compose and verify

**Ask independent questions over the same state together**, including useful
speculative questions. They run in parallel and cannot see one another's answers.
State each speculative premise explicitly; code consumes the applicable answers.
A second request is warranted when an earlier answer is needed to fetch evidence,
construct new state, or determine the next options. Extra questions still use tokens;
measure actual request budgets, cost, and end-to-end latency.

Use probabilities and confidence to guide behavior, with thresholds evaluated on
the user's data and consequences. Choice/Score confidence summarizes distribution
concentration, not overall workflow correctness or permission to act. A Noul near
0.5 means similar probability for yes and no, not medium intensity. Several
acceptable alternatives can also spread probability; low confidence need not
invalidate a harmless preference choice. Ignore uncertainty on unused branches.

Keep policy explicit and raw judgments reusable. Weighted scores suit compensating
preferences; an “any serious violation” rule needs separate conditions. Changing a
weight or display filter need not rerun inference when evidence and question meanings
are unchanged. Typed output guarantees the interface, not truth. System One models
are trained for calibrated decisions; validate their performance in the target domain.

Test representative cases and the resulting application behavior. For failures,
inspect the exact state, questions, candidates, answers, composition, and observed
outcome. Separate missing evidence, model errors, code errors, and service failures.
Treat cookbook thresholds and demo results as examples to evaluate, not universal
rules or permanent model limitations. Keep API credentials server-side in web apps.
