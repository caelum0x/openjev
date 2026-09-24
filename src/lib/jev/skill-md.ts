export const SKILL_MD = `---
name: openjev
license: Apache-2.0
description: >
  Build with OpenJev, an open-source decision engine wire-compatible with
  the upstream System One v1 API. Send state and typed questions (choice, score,
  noul); get calibrated answers code can combine. Use when a feature needs
  programmable common sense, when an LLM prompt-and-parse step could become a
  structured decision, or when routing, ranking, extraction, verification, or
  tool selection is currently a writer model.
---

# OpenJev

OpenJev is an open-source decision engine. The scoring kernel is C++
(openjev_eval); a Rust process serves POST /v1/systemone. It understands
natural language and returns typed answers and probabilities rather than
generating text. Code owns the workflow; the model supplies programmable common
sense.

Wire-compatible HTTP: \`POST /api/v1/systemone\` (upstream System One v1 API).

## Read the live docs in this app

- HTTP API: \`/docs\`
- Playground: \`/playground\`
- Cookbooks: \`/cookbooks\`
- This skill: \`GET /api/v1/skill\` (Markdown) or \`/skill\`

## The three primitives

| Need | Primitive | Returns |
| --- | --- | --- |
| One of a defined set | **choice** | \`choice\`, \`probabilities\`, \`confidence\` |
| Whether a condition holds | **noul** | \`noul\` ∈ [0,1] — probability of yes. No separate confidence. |
| Degree along a dimension | **score** | probability-weighted position on 2–10 ordered levels + \`confidence\` |

Ask independent questions over the **same state** in one call. They cannot see
one another's answers. Extra questions are cheap; extra round-trips are not.

## Request

\`\`\`json
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
    "is_urgent": {
      "type": "noul",
      "instructions": "Does this convey urgency?",
      "criteria": {
        "true": "Explicitly time-sensitive",
        "false": "No urgency expressed"
      }
    }
  }
}
\`\`\`

\`state\` may be a string, object, or array. Question ids are for code and are
not sent to the model — put complete meaning in \`instructions\` and \`criteria\`.

## Models

| id | What |
| --- | --- |
| \`system-one\` / \`jev-latest\` | Balanced — the calibrated local default |
| \`jev-v13\` | Sharp — a hair more peaked than Balanced (compat pin) |
| \`decisive\` (alias \`rlhf\`) | Coldest temperature: most confident argmax, least hedging |
| \`contrastive\` (alias \`rlcd\`) | Up-weights distinctive tokens + not_for penalty |
| \`openjev-grok\` | Escalate the same typed questions to a hosted LLM (OpenAI / xAI Grok / Anthropic) |

## How to build

1. Replace pick-something calls with typed questions.
2. Batch them.
3. Threshold on **confidence** (choice/score) or the **noul** itself. <0.5 escalate. ≥0.85 before anything irreversible.
4. Never invent options. Build the candidate list in code.
5. Router → Gate → Judge. Put it in the loop, not next to it.
6. If all you need is the best option, take \`argmax\` — do not invent a threshold.

## Auth

\`Authorization: Bearer <API_KEY>\` from the API Keys page. Playground calls from
this origin work without a key.

## Cookbooks in this app

- Parallel questions — 13 GDPR briefing questions, one call
- SDE cascade — mini extract → noul verify → escalate
- Self-consistency — 15-question claim rubric, stable nouls
- Function calling — NL → typed function + closed-set args
- Smart home — speculative fan-out over a house: one call asks every device action, code keeps the relevant slice; compound splits; conversation falls through to a writer

Point at \`/cookbooks\` and pick the pattern closest to the code you are changing.
`;
