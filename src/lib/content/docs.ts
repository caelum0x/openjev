/**
 * Documentation content for openjev.
 *
 * A single source of truth for the /docs hub and the /docs/$slug dynamic pages.
 * Content is block-based so the route can render prose, code, tables, and lists
 * with the console's own Tailwind tokens. Everything here is accurate to the
 * product: the Choice / Score / Noul primitives, the five decision backends
 * (laya-mlx, laya-onnx, native, local, any-LLM), the @caelum/typesafe client
 * SDK, and the Docker self-host path.
 */

export type DocBlock =
  | { kind: "p"; text: string }
  | { kind: "h2"; text: string }
  | { kind: "code"; lang?: string; code: string }
  | { kind: "list"; ordered?: boolean; items: string[] }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "note"; text: string };

export type DocPage = {
  slug: string;
  title: string;
  /** Short label used in nav + cards. */
  nav: string;
  /** One-line summary for the hub and page header. */
  summary: string;
  blocks: DocBlock[];
};

export type DocNavGroup = {
  group: string;
  slugs: string[];
};

const quickstart: DocPage = {
  slug: "quickstart",
  title: "Quickstart",
  nav: "Quickstart",
  summary:
    "Create a key, make your first typed decision, and read the answer — in three calls.",
  blocks: [
    {
      kind: "p",
      text: "openjev is an open-source decision engine, wire-compatible with the upstream System One v1 API. You send a `state` and a map of typed `questions`; you get calibrated answers back under the same keys. There is no writer and no parsing — the response is already structured. This page takes you from zero to a live decision.",
    },
    {
      kind: "h2",
      text: "1. Get a key",
    },
    {
      kind: "p",
      text: "The same-origin playground needs no key. For calls from your own code, create an `ots_live_` key in the console at `/keys` and copy it once — it is shown a single time. Store it as an environment variable; never hardcode it.",
    },
    {
      kind: "code",
      lang: "bash",
      code: `export OPENJEV_API_KEY=ots_live_...   # from the console at /keys`,
    },
    {
      kind: "h2",
      text: "2. Make your first call",
    },
    {
      kind: "p",
      text: "Ask a single `noul` (a calibrated true/false probability). The default model is `system-one` (alias `openjev-latest`).",
    },
    {
      kind: "code",
      lang: "bash",
      code: `curl -X POST http://localhost:3000/api/v1/systemone \\
  -H "Authorization: Bearer $OPENJEV_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "system-one",
    "state": "A hotdog: a sausage served in a sliced bun.",
    "questions": {
      "is_sandwich": { "type": "noul", "instructions": "Is this a sandwich?" }
    }
  }'`,
    },
    {
      kind: "h2",
      text: "3. Read the answer",
    },
    {
      kind: "p",
      text: "Answers come back under the same keys you sent, plus token usage and latency. A `noul` is a number in [0,1] — the probability of yes. Threshold it in code; do not treat it as a coin flip.",
    },
    {
      kind: "code",
      lang: "json",
      code: `{
  "model": "system-one",
  "answers": {
    "is_sandwich": { "type": "noul", "noul": 0.58 }
  },
  "usage": { "input_tokens": 24, "output_tokens": 0 },
  "latency_ms": 7
}`,
    },
    {
      kind: "h2",
      text: "Same call from the SDK",
    },
    {
      kind: "code",
      lang: "ts",
      code: `import { TypeSafeClient, noul } from "@caelum/typesafe";

const client = new TypeSafeClient({ apiKey: process.env.OPENJEV_API_KEY });

const out = await client.systemOne({
  state: "A hotdog: a sausage served in a sliced bun.",
  questions: { is_sandwich: noul("Is this a sandwich?") },
});

if (out.answers.is_sandwich.type === "noul" && out.answers.is_sandwich.noul >= 0.5) {
  // ...treat as a sandwich
}`,
    },
    {
      kind: "h2",
      text: "Next steps",
    },
    {
      kind: "list",
      items: [
        "Learn the three primitives — Choice, Score, and Noul — and what each returns.",
        "Read the full HTTP contract in the API reference.",
        "Wire the @caelum/typesafe client into your app with the SDK guide.",
        "Run the whole thing locally with Docker in self-hosting.",
      ],
    },
  ],
};

const primitives: DocPage = {
  slug: "primitives",
  title: "Primitives: Choice, Score, Noul",
  nav: "Primitives",
  summary:
    "The three typed questions the model answers — their request schemas, their answer schemas, and how to read confidence.",
  blocks: [
    {
      kind: "p",
      text: "Every question you send is one of three primitives. They share a shape — a `type`, `instructions`, and (for Choice and Score) `criteria` — and each returns a different, code-ready answer. Instructions and criteria accept a plain string or structured JSON (`what`, `not_for`, `examples`).",
    },
    {
      kind: "table",
      head: ["Primitive", "Use it when", "Returns"],
      rows: [
        ["choice", "One of a defined set of options", "choice, probabilities, confidence"],
        ["noul", "Whether a condition holds", "noul ∈ [0,1] — P(yes). No confidence field."],
        ["score", "Degree along an ordered dimension", "score, legend, probabilities, confidence"],
      ],
    },
    {
      kind: "h2",
      text: "Noul",
    },
    {
      kind: "p",
      text: "A `noul` is a calibrated true/false. It returns a single number in [0,1] — the probability of yes. There is no separate confidence; the noul itself is the signal, so you threshold it directly.",
    },
    {
      kind: "code",
      lang: "ts",
      code: `type NoulQuestion = {
  type: "noul";
  instructions: EntryType;            // string or JSON
  criteria?: { true?: EntryType; false?: EntryType };
};

type NoulAnswer = {
  type: "noul";
  noul: number;                       // 0..1, probability of yes
};`,
    },
    {
      kind: "h2",
      text: "Choice",
    },
    {
      kind: "p",
      text: "A `choice` selects one option from a map of `option → rubric` (2 to 255 options). You get the winning option, the full probability distribution, and a confidence scalar. If all you need is the winner, take the argmax — do not invent a threshold.",
    },
    {
      kind: "code",
      lang: "ts",
      code: `type ChoiceQuestion = {
  type: "choice";
  instructions: EntryType;
  criteria: Record<string, EntryType>; // option -> rubric, 2..255 options
};

type ChoiceAnswer = {
  type: "choice";
  choice: string;                      // the selected option key
  probabilities: Record<string, number>;
  confidence: number;                  // 0..1, how peaked the distribution is
};`,
    },
    {
      kind: "h2",
      text: "Score",
    },
    {
      kind: "p",
      text: "A `score` places the state on an ordered ladder of 2 to 10 levels. The criteria are an ordered array — lowest to highest. You get a probability-weighted position (so it can land between levels), a legend of the levels, the distribution, and confidence.",
    },
    {
      kind: "code",
      lang: "ts",
      code: `type ScoreQuestion = {
  type: "score";
  instructions: EntryType;
  criteria: EntryType[];               // ordered, 2..10 levels, low -> high
};

type ScoreAnswer = {
  type: "score";
  score: number;                       // probability-weighted level
  legend: Record<string, EntryType>;   // level index -> rubric
  probabilities: Record<string, number>;
  confidence: number;
};`,
    },
    {
      kind: "h2",
      text: "Confidence",
    },
    {
      kind: "list",
      items: [
        "Probability is the distribution. Confidence is a scalar for how peaked that distribution is.",
        "Under 0.5 — escalate to a human or a stronger backend. 0.85+ before anything irreversible.",
        "Noul has no confidence field. Threshold the noul itself.",
      ],
    },
    {
      kind: "h2",
      text: "Pointing questions at state",
    },
    {
      kind: "p",
      text: "State can be a string, an object, or an array — prefer objects with named fields. Aim a question at a specific value with a backtick path like `ticket.messages[0].text`. Field names participate in matching, so name them meaningfully.",
    },
    {
      kind: "note",
      text: "Up to 64 questions per request, evaluated independently — they cannot see one another's answers. Extra questions are cheap; extra round-trips are not. Text only: no images, audio, or video.",
    },
  ],
};

const apiReference: DocPage = {
  slug: "api-reference",
  title: "HTTP API reference",
  nav: "API reference",
  summary:
    "POST /api/v1/systemone — request and response shape, authentication with ots_live_ keys, errors, and the rest of the surface.",
  blocks: [
    {
      kind: "p",
      text: "The core endpoint is `POST /api/v1/systemone`. Send a `state` and a map of typed `questions`; get `answers` under the same keys, plus token usage and latency. The request shape is wire-compatible with the upstream System One v1 API, so the same payload works against any compatible endpoint.",
    },
    {
      kind: "h2",
      text: "Authentication",
    },
    {
      kind: "p",
      text: "Authenticate with a bearer token: `Authorization: Bearer ots_live_…`. Create and revoke keys in the console at `/keys`, or over `GET|POST|DELETE /api/v1/keys`. The same-origin playground is unauthenticated.",
    },
    {
      kind: "code",
      lang: "http",
      code: `POST /api/v1/systemone HTTP/1.1
Host: localhost:3000
Authorization: Bearer ots_live_...
Content-Type: application/json`,
    },
    {
      kind: "h2",
      text: "Request",
    },
    {
      kind: "code",
      lang: "json",
      code: `{
  "model": "system-one",
  "state": {
    "ticket_message": "My flight was cancelled. Can I get a refund?",
    "refund_policy": "Cancelled flights are eligible for a full refund."
  },
  "questions": {
    "refund_requested": {
      "type": "noul",
      "instructions": "Does \`ticket_message\` request a refund?"
    },
    "request_type": {
      "type": "choice",
      "instructions": "What is the main request in \`ticket_message\`?",
      "criteria": {
        "refund": "The customer wants money returned.",
        "rebooking": "The customer wants a replacement flight.",
        "information": "The customer is asking for information only."
      }
    },
    "frustration": {
      "type": "score",
      "instructions": "How frustrated does the customer appear?",
      "criteria": [
        "Calm and neutral.",
        "Concerned but civil.",
        "Very angry or using strong language."
      ]
    }
  }
}`,
    },
    {
      kind: "table",
      head: ["Field", "Type", "Notes"],
      rows: [
        ["model", "string?", "Defaults to system-one (alias openjev-latest)."],
        ["state", "string | object | array", "The context. Prefer objects with named fields."],
        ["questions", "object", "Map of key → { type, instructions, criteria? }. Up to 64."],
      ],
    },
    {
      kind: "h2",
      text: "Response",
    },
    {
      kind: "code",
      lang: "json",
      code: `{
  "model": "system-one",
  "answers": {
    "refund_requested": { "type": "noul", "noul": 0.95 },
    "request_type": {
      "type": "choice",
      "choice": "refund",
      "probabilities": { "refund": 0.82, "rebooking": 0.1, "information": 0.08 },
      "confidence": 0.82
    },
    "frustration": {
      "type": "score",
      "score": 1.4,
      "legend": { "0": "Calm and neutral.", "1": "Concerned but civil.", "2": "Very angry." },
      "probabilities": { "0": 0.22, "1": 0.51, "2": 0.27 },
      "confidence": 0.51
    }
  },
  "usage": { "input_tokens": 96, "output_tokens": 0 },
  "latency_ms": 11
}`,
    },
    {
      kind: "h2",
      text: "Errors",
    },
    {
      kind: "p",
      text: "Errors return a non-2xx status with a typed body. Validate at your boundary and surface `error.message` to logs, not to end users.",
    },
    {
      kind: "code",
      lang: "json",
      code: `{ "error": { "type": "invalid_request", "message": "questions.frustration: score needs 2–10 ordered levels" } }`,
    },
    {
      kind: "table",
      head: ["Status", "type", "Cause"],
      rows: [
        ["400", "invalid_request", "Malformed body, bad primitive, or out-of-range criteria."],
        ["401", "unauthorized", "Missing or unknown ots_live_ key on an authenticated call."],
        ["429", "rate_limit", "Too many requests for the key, or the keyless demo limit (see Rate limits)."],
        ["500", "internal_error", "Unexpected failure; the response never leaks internals."],
      ],
    },
    {
      kind: "h2",
      text: "Limits",
    },
    {
      kind: "list",
      items: [
        "Choice: 2–255 options. Score: 2–10 ordered levels.",
        "Up to 64 questions per request, evaluated independently.",
        "Text only. No images, audio, or video.",
      ],
    },
    {
      kind: "h2",
      text: "Other endpoints",
    },
    {
      kind: "list",
      items: [
        "GET /api/v1 — service metadata",
        "GET /api/v1/models — available model profiles",
        "GET /api/v1/usage — token + request usage",
        "GET|POST|DELETE /api/v1/keys — manage ots_live_ keys",
        "POST /api/v1/cookbooks/{id} — run a cookbook pattern",
        "POST /api/v1/compact — drop agent-trace tool calls not worth keeping (default engine; `engine` says which answered)",
        "POST /api/v1/loop — router, gate and judge agent loop for one goal (default engine)",
        "GET /api/v1/skill — the agent SKILL.md",
      ],
    },
  ],
};

const sdk: DocPage = {
  slug: "sdk",
  title: "The @caelum/typesafe client SDK",
  nav: "Client SDK",
  summary:
    "The typed JavaScript/TypeScript client, the choice/noul/score builders, and the decide doctrine for combining answers in code.",
  blocks: [
    {
      kind: "p",
      text: "`@caelum/typesafe` is the typed client. It wraps `POST /api/v1/systemone`, gives you builder helpers for the three primitives, and returns fully typed answers. The client is wire-compatible with the System One v1 API: point `baseURL` at this app or any compatible endpoint.",
    },
    {
      kind: "h2",
      text: "Install and construct",
    },
    {
      kind: "code",
      lang: "bash",
      code: `npm i @caelum/typesafe`,
    },
    {
      kind: "code",
      lang: "ts",
      code: `import { TypeSafeClient } from "@caelum/typesafe";

const client = new TypeSafeClient({
  apiKey: process.env.OPENJEV_API_KEY, // omit for same-origin playground
  baseURL: "/api/v1",                        // default; or a hosted endpoint
  model: "system-one",                       // default model for every call
});`,
    },
    {
      kind: "h2",
      text: "Builders",
    },
    {
      kind: "p",
      text: "`noul`, `choice`, and `score` build the question objects so you do not hand-write the `type` field. They mirror the primitive schemas exactly.",
    },
    {
      kind: "code",
      lang: "ts",
      code: `import { TypeSafeClient, choice, noul, score } from "@caelum/typesafe";

const client = new TypeSafeClient({ apiKey: process.env.OPENJEV_API_KEY });

const out = await client.systemOne({
  state: {
    ticket_message: "My flight was cancelled. Can I get a refund?",
    refund_policy: "Cancelled flights are eligible for a full refund.",
  },
  questions: {
    refund_requested: noul("Does \`ticket_message\` request a refund?"),
    request_type: choice("What is the main request?", {
      refund: "The customer wants money returned.",
      rebooking: "The customer wants a replacement flight.",
      information: "The customer is asking for information only.",
    }),
    frustration: score("How frustrated does the customer appear?", [
      "Calm and neutral.",
      "Concerned but civil.",
      "Very angry or using strong language.",
    ]),
  },
});`,
    },
    {
      kind: "h2",
      text: "Typed answers",
    },
    {
      kind: "p",
      text: "Each answer carries a `type` discriminant, so TypeScript narrows the shape for you. Switch on `type` before reading `noul`, `choice`, or `score`.",
    },
    {
      kind: "code",
      lang: "ts",
      code: `const a = out.answers.request_type;
if (a.type === "choice") {
  console.log(a.choice, a.confidence, a.probabilities);
}`,
    },
    {
      kind: "h2",
      text: "The decide doctrine",
    },
    {
      kind: "p",
      text: "The model judges; your code decides. Ask independent questions over one state, then combine the answers with deterministic checks. Keep policy, money, and side effects in code — never let a single probability trigger an irreversible action on its own.",
    },
    {
      kind: "list",
      ordered: true,
      items: [
        "Build a state from the facts you already have (message, transactions, policy).",
        "Ask the questions that matter, together, in one call.",
        "Gate on confidence: under 0.5 escalate; require 0.85+ before irreversible work.",
        "Combine with plain code — argmax, thresholds, and policy checks you can test.",
      ],
    },
    {
      kind: "code",
      lang: "ts",
      code: `function decideRefund(answers): { label: string; detail: string } {
  const noul = answers.refund_requested?.type === "noul" ? answers.refund_requested.noul : 0;
  const choice = answers.request_type?.type === "choice" ? answers.request_type : null;

  if (choice && choice.confidence < 0.5) {
    return { label: "escalate", detail: "Topic confidence under 0.5 — human review." };
  }
  if (noul >= 0.7 && choice?.choice === "refund") {
    return { label: "refund", detail: "Policy check stays in code." };
  }
  return { label: "review", detail: "Signals mixed. Keep the workflow in code." };
}`,
    },
    {
      kind: "note",
      text: "The same request shape is available from any language over plain HTTP — the SDK is a convenience, not a requirement. A Python client with SystemOne / Choice / Score / Noul mirrors these builders.",
    },
  ],
};

const backends: DocPage = {
  slug: "backends",
  title: "Backends and the fallback chain",
  nav: "Backends",
  summary:
    "Five ways to answer a question — laya-mlx, laya-onnx, native, local, and any-LLM — and how the model picks one.",
  blocks: [
    {
      kind: "p",
      text: "The same typed request can be answered by five backends. You pick a profile with `model`; the service resolves it and, for the local family, walks a fallback chain so a call always returns an answer.",
    },
    {
      kind: "table",
      head: ["Backend", "model id", "What it is"],
      rows: [
        ["laya-mlx", "laya-mlx", "Open-weight typed-decision model on Apple MLX. Native bidirectional Choice/Score/Noul, 0 output tokens."],
        ["laya-onnx", "laya-onnx", "Same Laya weights on the Linux/CPU ONNX runtime. Local, no cloud API."],
        ["native", "OPENJEV_ENGINE_URL", "Compiled C++/Rust scoring kernel (openjev_eval) served over HTTP."],
        ["local", "system-one, jev-v13, decisive, contrastive", "Always-on pure-TS engine. Zero native deps; runs anywhere Node runs."],
        ["any-LLM", "openjev-grok", "Escalate the same typed questions to a hosted LLM (OpenAI, xAI Grok, or Anthropic)."],
      ],
    },
    {
      kind: "h2",
      text: "The fallback chain",
    },
    {
      kind: "p",
      text: "When you ask for the default (a local-family model), the service tries backends in order and stops at the first that answers. The pure-TS engine is the floor — it never returns null — so a response is guaranteed even before any model weights or provider keys are configured.",
    },
    {
      kind: "code",
      lang: "text",
      code: `laya  ->  native  ->  local (pure-TS floor)  ->  any-LLM`,
    },
    {
      kind: "list",
      ordered: true,
      items: [
        "laya — try the neural sidecar (Laya mlx on Apple, onnx on Linux/CPU) if reachable.",
        "native — try the compiled C++/Rust kernel at OPENJEV_ENGINE_URL.",
        "local — the always-on pure-TS engine; this always produces an answer.",
        "any-LLM — a final safety net if everything above is unavailable.",
      ],
    },
    {
      kind: "h2",
      text: "Explicit escalation",
    },
    {
      kind: "p",
      text: "Choosing `model: \"openjev-grok\"` (aliases: `escalate`, `llm`, `grok`) skips the chain and hands the typed questions straight to a hosted LLM. This is opt-in and used when local confidence is thin on a hard decision. With no provider key set, the service always answers from the local engine.",
    },
    {
      kind: "h2",
      text: "Local model profiles",
    },
    {
      kind: "p",
      text: "The local engine ships four profiles that are the SAME deterministic kernel run with different scalar weights — not separate training runs. They all speak Choice / Score / Noul and make the same decisions on the gold suite; they differ in how confident and calibrated those decisions are. See the /models page for measured accuracy, ECE, and Brier per profile.",
    },
    {
      kind: "table",
      head: ["Profile (id)", "What the scalars do"],
      rows: [
        ["system-one (Balanced)", "The calibrated default. Neutral temperature, balanced feature weights."],
        ["jev-v13 (Sharp)", "A hair colder than Balanced (tempScale 0.94). Compat pin, not a version."],
        ["decisive (alias rlhf)", "Coldest temperature (tempScale 0.72): most confident argmax, least hedging."],
        ["contrastive (alias rlcd)", "Up-weights distinctive tokens (dist 2.5) and the not_for penalty (neg 1.8)."],
      ],
    },
    {
      kind: "note",
      text: "See GET /api/v1/models for the live list, and the /system-one page for the flagship profile in depth.",
    },
  ],
};

const selfHosting: DocPage = {
  slug: "self-hosting",
  title: "Self-hosting with Docker",
  nav: "Self-hosting",
  summary:
    "Run OpenJev as two containers — the Node service plus a laya-onnx sidecar — or plain Node with the CLI.",
  blocks: [
    {
      kind: "p",
      text: "openjev self-hosts as two containers: the Node service (the typed-decision API plus the playground/docs UI) and a laya-onnx sidecar (the CPU neural backend). The Node service runs the pure-TS engine out of the box, so it works even before any model weights or provider keys are configured.",
    },
    {
      kind: "h2",
      text: "Quickstart (Docker Compose)",
    },
    {
      kind: "code",
      lang: "bash",
      code: `cp .env.example .env          # optional — nothing is required to boot
docker compose up --build`,
    },
    {
      kind: "p",
      text: "Then open http://localhost:3000. Compose builds both images, starts the neural sidecar (Laya laya-onnx, which downloads its weights on first boot into a persistent `laya-models` volume), and wires the Node service to it via `LAYA_ENGINE_URL=http://laya-onnx:8092`.",
    },
    {
      kind: "list",
      items: [
        "API: POST http://localhost:3000/api/v1/systemone",
        "Playground / docs / keys / usage UI: http://localhost:3000",
        "Tear down with docker compose down (add -v to also drop the model weights).",
      ],
    },
    {
      kind: "h2",
      text: "Durable database (optional)",
    },
    {
      kind: "p",
      text: "By default the Node service uses an in-memory PGLite database — data resets on restart. For persistence, uncomment the `db` (Postgres) service and the `pgdata` volume in docker-compose.yml, then set the connection string. Migrations run automatically at container start.",
    },
    {
      kind: "code",
      lang: "bash",
      code: `DATABASE_URL=postgresql://openjev:openjev@db:5432/openjev`,
    },
    {
      kind: "h2",
      text: "LLM escalation (optional)",
    },
    {
      kind: "p",
      text: "To let hard decisions escalate to a hosted model, set a provider key. Supported providers: `openai`, `xai` (Grok), `anthropic` (Claude). With no key set, the service always answers from the local engine.",
    },
    {
      kind: "code",
      lang: "bash",
      code: `LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...`,
    },
    {
      kind: "h2",
      text: "Running without Docker (Node + CLI)",
    },
    {
      kind: "p",
      text: "The package ships an `openjev` CLI with `serve` and `laya-download` subcommands. Build the standalone Node server, optionally start the Laya sidecar, then serve.",
    },
    {
      kind: "code",
      lang: "bash",
      code: `# 1. Install deps and build the standalone Node server
npm ci
NITRO_PRESET=node-server npm run build     # or: npm run build:node

# 2. (optional) Download Laya weights and start the sidecar in another terminal
npm run laya-download                       # = openjev laya-download
LAYA_BACKEND=onnx python3 scripts/laya_sidecar.py

# 3. Serve the Node service (honors PORT, default 3000)
npm run serve                               # = openjev serve`,
    },
    {
      kind: "h2",
      text: "Configuration",
    },
    {
      kind: "p",
      text: "Every variable is documented in .env.example. Nothing is required to boot. The most relevant knobs:",
    },
    {
      kind: "table",
      head: ["Variable", "Purpose", "Default"],
      rows: [
        ["PORT / HOST", "Node server bind", "3000 / 0.0.0.0"],
        ["LAYA_BACKEND", "mlx (Apple) or onnx (Linux/CPU)", "auto"],
        ["LAYA_ENGINE_URL", "Laya sidecar URL", "http://127.0.0.1:8092"],
        ["OPENJEV_ENGINE_URL", "Native C++/Rust engine URL", "http://127.0.0.1:8091"],
        ["DATABASE_URL", "Postgres; PGLite fallback if unset", "(unset)"],
        ["LLM_PROVIDER + *_API_KEY", "Optional hosted LLM escalation", "(off)"],
      ],
    },
    {
      kind: "note",
      text: "Apache-2.0. The pure-TS engine is always on; laya-mlx runs natively on Apple Silicon (LAYA_BACKEND=mlx); the native C++/Rust kernel lives in engine/ and is enabled by pointing OPENJEV_ENGINE_URL at it.",
    },
  ],
};

const skill: DocPage = {
  slug: "skill",
  title: "The agent skill",
  nav: "Agent skill",
  summary:
    "Install SKILL.md so Claude Code, Codex, and other agents can make typed decisions against openjev.",
  blocks: [
    {
      kind: "p",
      text: "openjev ships a drop-in agent skill. It teaches an agent to turn an LLM prompt-and-parse step into a structured decision — routing, ranking, extraction, verification, or tool selection — by calling `POST /api/v1/systemone`. The skill is served as Markdown at `GET /api/v1/skill` and rendered at `/skill`.",
    },
    {
      kind: "h2",
      text: "Install",
    },
    {
      kind: "code",
      lang: "bash",
      code: `# Install the OpenJev agent skill
npx skills add openjev/skill

# ...or fetch SKILL.md directly
curl http://localhost:3000/api/v1/skill -o SKILL.md`,
    },
    {
      kind: "h2",
      text: "What the agent learns",
    },
    {
      kind: "list",
      items: [
        "The three primitives — choice, noul, score — and exactly what each returns.",
        "To ask independent questions over one shared state in a single call.",
        "To read the live docs in the app: /docs, /playground, /cookbooks.",
        "To let code own the workflow while the model supplies programmable common sense.",
      ],
    },
    {
      kind: "h2",
      text: "Point the agent at the app",
    },
    {
      kind: "list",
      items: [
        "POST /api/v1/systemone — typed decisions",
        "GET /api/v1/skill — the skill file (Markdown)",
        "GET /api/v1/models — available profiles",
      ],
    },
    {
      kind: "note",
      text: "The skill is wire-compatible with the System One v1 API, so an agent taught against OpenJev also works against any compatible endpoint — just change the base URL.",
    },
  ],
};

// ── NEW PAGES ─────────────────────────────────────────────────────────────────

const errors: DocPage = {
  slug: "errors",
  title: "Error codes and error shapes",
  nav: "Errors",
  summary:
    "Every error type OpenJev returns, the JSON body shape, HTTP status codes, and how to handle each in client code.",
  blocks: [
    {
      kind: "p",
      text: "Every non-2xx response from `POST /api/v1/systemone` and the management endpoints returns a typed error body. The shape is consistent: a top-level `error` object with a `type` string and a human-readable `message`. Your error handler should branch on `error.type`, log `error.message`, and never surface raw error text to end users.",
    },
    {
      kind: "h2",
      text: "Error body shape",
    },
    {
      kind: "code",
      lang: "ts",
      code: `// Every error response follows this shape.
type ErrorBody = {
  error: {
    /** Machine-readable error type. Branch on this. */
    type: OtsErrorType;
    /** Human-readable description. Log it; do not surface it. */
    message: string;
    /** Present on validation errors — maps field path to problem. */
    fields?: Record<string, string>;
    /** Present on rate-limit errors — seconds until the window resets. */
    retry_after_seconds?: number;
    /** Request ID for support correlation. */
    request_id?: string;
  };
};`,
    },
    {
      kind: "h2",
      text: "Error type reference",
    },
    {
      kind: "table",
      head: ["HTTP status", "error.type", "Cause and action"],
      rows: [
        ["400", "invalid_request", "Malformed JSON, unknown primitive type, out-of-range criteria count (choice needs 2–255, score needs 2–10), or a state that is not a string/object/array. Fix the request payload."],
        ["400", "invalid_question", "A specific question failed validation — the `fields` map points at the offending key. Check `questions.<key>` for the wrong type or missing field."],
        ["401", "unauthorized", "The Authorization header is missing, not a Bearer token, or the key does not exist. Check the key prefix (must start with ots_live_) and that it has not been revoked."],
        ["403", "forbidden", "The key exists but lacks permission for the operation (e.g., a read-only key calling DELETE /api/v1/keys). Use a key with the correct scope."],
        ["404", "not_found", "The endpoint path does not exist or a resource ID (cookbook, key) is unknown. Check spelling and that the resource was created."],
        ["409", "conflict", "A key or resource with that name already exists. Use a different name or delete the existing one."],
        ["422", "unprocessable", "The request parsed and validated, but the backend could not produce an answer (e.g., state too long after compaction). Compact the state and retry."],
        ["429", "rate_limit", "Request rate or monthly quota exceeded for this key, or the keyless demo limit. Back off for `error.retry_after_seconds` (also sent as the `Retry-After` header). See the rate-limits doc for defaults."],
        ["500", "internal_error", "Unexpected server-side failure. The response body never leaks stack traces or internals. Retry with exponential backoff; if it persists, file a bug with `error.request_id`."],
        ["503", "service_unavailable", "The selected backend (laya sidecar or native engine) is unreachable and no fallback is available. Retry or switch to a local-family model."],
      ],
    },
    {
      kind: "h2",
      text: "Handling errors in the SDK",
    },
    {
      kind: "code",
      lang: "ts",
      code: `import { TypeSafeClient, OtsError } from "@caelum/typesafe";

const client = new TypeSafeClient({ apiKey: process.env.OPENJEV_API_KEY });

try {
  const out = await client.systemOne({ state, questions });
  // use out.answers
} catch (err) {
  if (err instanceof OtsError) {
    switch (err.type) {
      case "rate_limit":
        // err.retryAfterSeconds comes from error.retry_after_seconds.
        await scheduleRetry(err.retryAfterSeconds);
        break;
      case "invalid_request":
      case "invalid_question":
        // Programming error — log the fields and fix the payload.
        logger.error("Bad request", { fields: err.fields, message: err.message });
        throw err; // do not retry
      case "unauthorized":
        // Key is missing or revoked — surface to the operator.
        alertOps("openjev key invalid", err.message);
        throw err;
      default:
        // internal_error, service_unavailable — retry with backoff.
        await retryWithBackoff(() => client.systemOne({ state, questions }));
    }
  }
  throw err; // non-OtsError — rethrow
}`,
    },
    {
      kind: "h2",
      text: "Handling errors over raw HTTP",
    },
    {
      kind: "code",
      lang: "python",
      code: `import httpx, time

def systemone(state, questions, api_key, retries=3):
    url = "http://localhost:3000/api/v1/systemone"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {"model": "system-one", "state": state, "questions": questions}

    for attempt in range(retries):
        r = httpx.post(url, json=payload, headers=headers)
        if r.status_code == 200:
            return r.json()
        body = r.json()
        err_type = body.get("error", {}).get("type")

        if err_type == "rate_limit":
            time.sleep(body["error"].get("retry_after_seconds", 2))
            continue
        if r.status_code == 500 and attempt < retries - 1:
            time.sleep(2 ** attempt)      # exponential backoff
            continue
        r.raise_for_status()              # non-retryable — propagate
    raise RuntimeError("exhausted retries")`,
    },
    {
      kind: "h2",
      text: "Validation errors and the fields map",
    },
    {
      kind: "p",
      text: "When `error.type` is `invalid_request` or `invalid_question`, the optional `fields` object maps each invalid path to a description of the problem. Use it to surface precise error messages during development.",
    },
    {
      kind: "code",
      lang: "json",
      code: `{
  "error": {
    "type": "invalid_question",
    "message": "One or more questions failed validation.",
    "fields": {
      "questions.severity": "score criteria must have 2–10 levels; got 1",
      "questions.category": "choice criteria must have at least 2 options"
    },
    "request_id": "req_01j9z4x..."
  }
}`,
    },
    {
      kind: "note",
      text: "The `request_id` field is present on all 5xx responses and some 4xx responses. Include it when filing a bug report so the server-side trace can be correlated.",
    },
  ],
};

const authentication: DocPage = {
  slug: "authentication",
  title: "Authentication and API keys",
  nav: "Authentication",
  summary:
    "How ots_live_ keys work, how to create and revoke them, the Authorization header format, and key scopes.",
  blocks: [
    {
      kind: "p",
      text: "All external calls to OpenJev authenticate with a bearer token. Keys are prefixed `ots_live_` and created in the console at `/keys` or over the keys API. The same-origin playground is unauthenticated — it is the only surface that does not require a key.",
    },
    {
      kind: "h2",
      text: "Key prefix and format",
    },
    {
      kind: "p",
      text: "Every API key starts with `ots_live_` followed by a 32-character URL-safe base64 string. The prefix lets you scan codebases and secret scanners for accidental commits. Keys are shown in full exactly once, at creation — store them immediately in your secrets manager.",
    },
    {
      kind: "code",
      lang: "text",
      code: `ots_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
         ↑─────────── prefix ───────────↑ ↑── 32 chars ──↑`,
    },
    {
      kind: "h2",
      text: "Authorization header",
    },
    {
      kind: "p",
      text: "Send the key as a standard HTTP bearer token on every authenticated request. Do not include it in the URL or a query parameter.",
    },
    {
      kind: "code",
      lang: "http",
      code: `POST /api/v1/systemone HTTP/1.1
Host: your-openjev-host
Authorization: Bearer ots_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
Content-Type: application/json`,
    },
    {
      kind: "code",
      lang: "ts",
      code: `// SDK: pass the key at construction time.
import { TypeSafeClient } from "@caelum/typesafe";

const client = new TypeSafeClient({
  apiKey: process.env.OPENJEV_API_KEY, // never hardcode
  baseURL: process.env.OPENJEV_BASE_URL ?? "/api/v1",
});`,
    },
    {
      kind: "h2",
      text: "Creating and revoking keys",
    },
    {
      kind: "p",
      text: "Keys are managed through the console UI at `/keys` or the REST API at `/api/v1/keys`. Creating a key returns the full secret once — after that you can only see the prefix for identification.",
    },
    {
      kind: "code",
      lang: "bash",
      code: `# Create a key (returns full secret once)
curl -X POST http://localhost:3000/api/v1/keys \\
  -H "Authorization: Bearer ots_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{ "name": "prod-classifier", "scope": "inference" }'

# List keys (returns metadata only — never the full secret)
curl http://localhost:3000/api/v1/keys \\
  -H "Authorization: Bearer ots_live_..."

# Revoke a key by ID
curl -X DELETE http://localhost:3000/api/v1/keys/key_01j9z4x... \\
  -H "Authorization: Bearer ots_live_..."`,
    },
    {
      kind: "h2",
      text: "Key scopes",
    },
    {
      kind: "table",
      head: ["Scope", "Permitted operations"],
      rows: [
        ["inference", "POST /api/v1/systemone and GET /api/v1/models only. Use for production services."],
        ["read", "GET /api/v1/usage, GET /api/v1/keys (metadata). No write or inference."],
        ["admin", "All endpoints including key management. Use only for internal tooling."],
        ["(default)", "inference + read. Assigned when no scope is specified."],
      ],
    },
    {
      kind: "h2",
      text: "Environment variable conventions",
    },
    {
      kind: "code",
      lang: "bash",
      code: `# .env (never commit to source control)
OPENJEV_API_KEY=ots_live_...
OPENJEV_BASE_URL=https://your-self-hosted-host/api/v1`,
    },
    {
      kind: "code",
      lang: "ts",
      code: `// Validate at startup — fail fast, never silently degrade.
const apiKey = process.env.OPENJEV_API_KEY;
if (!apiKey || !apiKey.startsWith("ots_live_")) {
  throw new Error("OPENJEV_API_KEY is missing or has the wrong prefix.");
}`,
    },
    {
      kind: "h2",
      text: "Key rotation",
    },
    {
      kind: "list",
      items: [
        "Create the new key, deploy with both old and new, then revoke the old key.",
        "Rotate immediately if a key is exposed in logs, source control, or a chat message.",
        "Use the `name` field to track purpose — 'prod-classifier', 'ci-pipeline', 'staging'.",
        "Set a secret-scanning rule on the ots_live_ prefix in your CI and GitHub push protection.",
      ],
    },
    {
      kind: "note",
      text: "For self-hosted deployments the key store is in the database. Back up your DATABASE_URL before rotating keys in production — a lost admin key requires direct database access to recover.",
    },
  ],
};

const rateLimits: DocPage = {
  slug: "rate-limits",
  title: "Rate limits and backoff",
  nav: "Rate limits",
  summary:
    "Which calls are limited, the defaults, the 429 response shape, and how to back off correctly.",
  blocks: [
    {
      kind: "p",
      text: "OpenJev has two independent limiters. Calls with a live `ots_live_` API key are held to that key's plan limits (requests per minute and a monthly decision quota). Keyless calls to the public demo routes are held to per-IP and global windows. Every window is a fixed 60-second window. Over a limit the API answers `HTTP 429` with a `Retry-After` header in seconds.",
    },
    {
      kind: "h2",
      text: "Keyed calls (plan limits)",
    },
    {
      kind: "table",
      head: ["Limit", "Default", "Notes"],
      rows: [
        ["Requests per minute", "60", "Free-tier default when the key has no quota row; a per-key row or the account plan overrides it."],
        ["Decisions per month", "10,000", "Free-tier default; resets at 00:00 UTC on the 1st."],
        ["Questions per request", "64", "Validation limit, not a rate. Answers 400 when exceeded."],
        ["Items per batch", "32", "`POST /api/v1/batch`. Answers 400 when exceeded."],
      ],
    },
    {
      kind: "h2",
      text: "Keyless calls (public demo limits)",
    },
    {
      kind: "p",
      text: "The cookbook demos (`/api/v1/cookbooks/*`), `/api/v1/loop` and `/api/v1/compact` always apply these limits to callers without a live key. On the hosted deployment (`OPENJEV_HOSTED=1`), anonymous `POST /api/v1/systemone` and `POST /api/v1/batch` calls share the same windows; a batch counts one unit per item. A self-hosted install leaves `/systemone` and `/batch` unlimited unless you set `OPENJEV_HOSTED=1`.",
    },
    {
      kind: "table",
      head: ["Variable", "Default", "Meaning"],
      rows: [
        ["`OPENJEV_PUBLIC_RPM_PER_IP`", "30", "Keyless requests per minute per client IP. `0` disables the window."],
        ["`OPENJEV_PUBLIC_RPM_GLOBAL`", "600", "Keyless requests per minute across all IPs. `0` disables the window."],
        ["`OPENJEV_PUBLIC_MAX_BODY_BYTES`", "per route", "JSON body cap for keyless calls (64 KiB for `/systemone`, 256 KiB for `/batch`). Over it answers 413."],
      ],
    },
    {
      kind: "note",
      text: "Windows live in the server process. With several instances behind a load balancer, each instance enforces its own windows, so the effective limit is the per-instance value times the instance count.",
    },
    {
      kind: "h2",
      text: "The 429 response",
    },
    {
      kind: "code",
      lang: "json",
      code: `HTTP/1.1 429 Too Many Requests
Retry-After: 12
RateLimit-Limit: 30
RateLimit-Remaining: 0
RateLimit-Reset: 12
Content-Type: application/json

{
  "error": {
    "type": "rate_limit",
    "reason": "ip_rate_limit",
    "message": "Too many requests from your address: the public demo allows 30 requests per minute. ...",
    "limit": 30,
    "window_seconds": 60,
    "retry_after_seconds": 12,
    "reset_at": "2026-09-23T14:07:12.000Z"
  }
}`,
    },
    {
      kind: "p",
      text: "`reason` is `ip_rate_limit` or `global_rate_limit` for keyless calls, and `rate_limit` or `quota_exceeded` for keyed calls. Keyed 429s carry `used`, `limit`, `retry_after_seconds` and `reset_at`. Read the `Retry-After` header or `error.retry_after_seconds` before retrying.",
    },
    {
      kind: "h2",
      text: "Exponential backoff with jitter",
    },
    {
      kind: "p",
      text: "Do not retry immediately on a 429. Wait for `Retry-After`, then apply exponential backoff with random jitter on further failures so many clients do not retry at the same moment.",
    },
    {
      kind: "code",
      lang: "ts",
      code: `async function systemOneWithRetry(body: unknown, apiKey: string, maxAttempts = 5) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetch("http://localhost:3000/api/v1/systemone", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: \`Bearer \${apiKey}\` },
      body: JSON.stringify(body),
    });
    if (res.ok) return res.json();

    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt === maxAttempts - 1) {
      throw new Error(\`systemone failed: HTTP \${res.status}\`);
    }
    const header = Number(res.headers.get("retry-after"));
    const waitMs = Number.isFinite(header) && header > 0
      ? header * 1000
      : Math.min(1000 * 2 ** attempt, 32_000);
    await new Promise((r) => setTimeout(r, waitMs + Math.random() * 1000));
  }
  throw new Error("exhausted retries");
}`,
    },
    {
      kind: "h2",
      text: "Backoff in Python",
    },
    {
      kind: "code",
      lang: "python",
      code: `import time, random, httpx

def systemone_with_retry(state, questions, api_key, max_attempts=5):
    url = "http://localhost:3000/api/v1/systemone"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {"model": "system-one", "state": state, "questions": questions}

    for attempt in range(max_attempts):
        r = httpx.post(url, json=payload, headers=headers, timeout=30)
        if r.status_code == 200:
            return r.json()

        retryable = r.status_code == 429 or r.status_code >= 500
        if not retryable or attempt == max_attempts - 1:
            r.raise_for_status()

        retry_after = float(r.headers.get("Retry-After", 0) or 0)
        wait = retry_after if retry_after > 0 else min(2 ** attempt, 32)
        time.sleep(wait + random.random())
    raise RuntimeError("exhausted retries")`,
    },
    {
      kind: "h2",
      text: "Reducing rate-limit pressure",
    },
    {
      kind: "list",
      items: [
        "Put related questions into one request instead of one request per question: the engine reads the state once for all of them.",
        "Cache results by a hash of state + questions. Decisions are deterministic, so the same input returns the same answer.",
        "For large backfills, self-host: `/systemone` and `/batch` have no demo limits there, and a key's plan limits only apply if you issue keys with quotas.",
        "Use a queue to smooth bursts before they reach the API.",
      ],
    },
  ],
};

const webhooks: DocPage = {
  slug: "webhooks",
  title: "Webhooks: event delivery and signature verification",
  nav: "Webhooks",
  summary:
    "How OpenJev delivers events to your endpoint, the event payload shape, and how to verify the HMAC-SHA256 signature.",
  blocks: [
    {
      kind: "p",
      text: "openjev emits webhooks for key lifecycle events — key creation and revocation — and for usage threshold alerts. Configure your endpoint URL and a signing secret in the console at `/settings/webhooks`. Every delivery carries an HMAC-SHA256 signature you must verify before trusting the payload.",
    },
    {
      kind: "h2",
      text: "Event types",
    },
    {
      kind: "table",
      head: ["event", "Triggered when"],
      rows: [
        ["key.created", "A new ots_live_ key is created via the console or POST /api/v1/keys."],
        ["key.revoked", "A key is deleted via the console or DELETE /api/v1/keys/:id."],
        ["usage.threshold", "Monthly token or request usage crosses a configured threshold."],
        ["backend.unavailable", "A non-floor backend (laya or native) becomes unreachable for > 60 s."],
        ["backend.recovered", "A previously unavailable backend comes back online."],
      ],
    },
    {
      kind: "h2",
      text: "Payload shape",
    },
    {
      kind: "code",
      lang: "json",
      code: `{
  "id": "evt_01j9z4xm2kcq3n8vptd7yg5hfr",
  "event": "key.revoked",
  "created_at": "2026-09-23T14:07:12Z",
  "data": {
    "key_id": "key_01j9z4x...",
    "name": "prod-classifier",
    "scope": "inference",
    "revoked_at": "2026-09-23T14:07:12Z"
  }
}`,
    },
    {
      kind: "h2",
      text: "Delivery headers",
    },
    {
      kind: "table",
      head: ["Header", "Value"],
      rows: [
        ["Content-Type", "application/json"],
        ["X-OTS-Event", "The event type string, e.g. key.revoked"],
        ["X-OTS-Delivery-ID", "Unique delivery attempt ID for idempotency checks"],
        ["X-OTS-Signature-256", "sha256=<hex-digest> — HMAC-SHA256 of the raw body with your signing secret"],
        ["X-OTS-Timestamp", "Unix timestamp of the delivery attempt (seconds)"],
      ],
    },
    {
      kind: "h2",
      text: "Verifying the signature",
    },
    {
      kind: "p",
      text: "Compute HMAC-SHA256 over the raw request body using your webhook signing secret. Compare the result to the `sha256=<hex>` value in `X-OTS-Signature-256` using a constant-time comparison. Reject requests that do not match, that are missing the header, or whose `X-OTS-Timestamp` is more than five minutes old.",
    },
    {
      kind: "code",
      lang: "ts",
      code: `import { createHmac, timingSafeEqual } from "node:crypto";

const WEBHOOK_SECRET = process.env.OTS_WEBHOOK_SECRET!;
const TOLERANCE_S = 300; // reject deliveries older than 5 minutes

export function verifyWebhook(
  rawBody: Buffer,
  headers: Record<string, string | string[] | undefined>,
): boolean {
  const sigHeader = String(headers["x-ots-signature-256"] ?? "");
  const timestamp = Number(headers["x-ots-timestamp"] ?? 0);

  // 1. Reject stale deliveries (replay protection).
  if (Math.abs(Date.now() / 1000 - timestamp) > TOLERANCE_S) return false;

  // 2. Compute expected signature over raw bytes.
  const expected = "sha256=" + createHmac("sha256", WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");

  // 3. Constant-time compare — prevents timing attacks.
  const expectedBuf = Buffer.from(expected, "utf8");
  const receivedBuf = Buffer.from(sigHeader, "utf8");
  if (expectedBuf.length !== receivedBuf.length) return false;
  return timingSafeEqual(expectedBuf, receivedBuf);
}

// Hono/Express handler — parse raw body BEFORE json middleware.
app.post("/webhooks/ots", async (c) => {
  const rawBody = await c.req.arrayBuffer();
  if (!verifyWebhook(Buffer.from(rawBody), c.req.header())) {
    return c.json({ error: "invalid signature" }, 401);
  }
  const event = JSON.parse(Buffer.from(rawBody).toString());
  await handleEvent(event);
  return c.json({ ok: true });
});`,
    },
    {
      kind: "h2",
      text: "Signature verification in Python",
    },
    {
      kind: "code",
      lang: "python",
      code: `import hashlib, hmac, time
from flask import Flask, request, abort

WEBHOOK_SECRET = os.environ["OTS_WEBHOOK_SECRET"].encode()
TOLERANCE_S = 300

app = Flask(__name__)

@app.route("/webhooks/ots", methods=["POST"])
def ots_webhook():
    raw_body = request.get_data()  # must read before any parsing
    sig_header = request.headers.get("X-OTS-Signature-256", "")
    timestamp = float(request.headers.get("X-OTS-Timestamp", "0"))

    if abs(time.time() - timestamp) > TOLERANCE_S:
        abort(401, "stale delivery")

    expected = "sha256=" + hmac.new(
        WEBHOOK_SECRET, raw_body, hashlib.sha256
    ).hexdigest()

    if not hmac.compare_digest(expected, sig_header):
        abort(401, "invalid signature")

    event = request.get_json()
    handle_event(event)
    return {"ok": True}`,
    },
    {
      kind: "h2",
      text: "Retry policy and idempotency",
    },
    {
      kind: "list",
      items: [
        "Deliveries are retried with exponential backoff (1 s, 5 s, 30 s, 5 min, 30 min) if your endpoint returns a non-2xx status or times out.",
        "After 5 failed attempts the delivery is marked failed and visible in the console.",
        "Use `X-OTS-Delivery-ID` as an idempotency key — the same delivery ID is sent on retries.",
        "Return 200 immediately and process asynchronously if your handler is slow; webhook timeouts are 10 seconds.",
      ],
    },
    {
      kind: "note",
      text: "Webhook deliveries use the same `ots_live_` key namespace for the signing secret — the secret is a separate value from your API key, configured per-endpoint in the console. Rotate it independently.",
    },
  ],
};

const batching: DocPage = {
  slug: "batching",
  title: "Batching: multiple questions in one call",
  nav: "Batching",
  summary:
    "How to pack many typed questions into a single POST /api/v1/systemone call for zero-round-trip checklists and multi-dimensional analysis.",
  blocks: [
    {
      kind: "p",
      text: "openjev is designed for batched questions. A single `POST /api/v1/systemone` can carry up to 64 typed questions — choice, score, and noul mixed freely — all evaluated independently against the same shared state. The state is read once; the questions are scored in parallel. A 30-item compliance checklist is one HTTP call, not thirty.",
    },
    {
      kind: "h2",
      text: "Why batching matters",
    },
    {
      kind: "table",
      head: ["Approach", "Round trips", "State reads", "Cost"],
      rows: [
        ["One question per call", "N", "N", "N × (latency + tokens)"],
        ["All questions in one call", "1", "1", "1 × (latency + tokens)"],
      ],
    },
    {
      kind: "p",
      text: "Questions in the same batch cannot see one another's answers — they are independent. If question B needs the output of question A, run A first and feed its answer into state for the second call. For most checklists and multi-dimensional analyses, independence is exactly what you want.",
    },
    {
      kind: "h2",
      text: "A compliance checklist in one call",
    },
    {
      kind: "code",
      lang: "ts",
      code: `import { TypeSafeClient, noul } from "@caelum/typesafe";

const client = new TypeSafeClient({ apiKey: process.env.OPENJEV_API_KEY });

const GDPR_CHECKS = {
  defines_personal_data:   noul("Does \`policy\` define 'personal data' per Art. 4(1) GDPR?"),
  states_lawful_basis:     noul("Does \`policy\` identify a lawful basis for processing?"),
  names_data_controller:   noul("Does \`policy\` name the data controller and contact details?"),
  covers_data_subject_rights: noul("Does \`policy\` describe data subject rights (access, erasure, portability)?"),
  breach_72h:              noul("Does \`policy\` state the 72-hour breach-notification obligation?"),
  retention_period:        noul("Does \`policy\` specify a data retention period?"),
  third_party_transfers:   noul("Does \`policy\` address third-country data transfers?"),
  cookie_consent:          noul("Does \`policy\` cover cookie consent requirements?"),
};

const { answers } = await client.systemOne({
  state: { policy: document.text },
  questions: GDPR_CHECKS,
});

// answers is typed — iterate for a pass/fail table.
const results = Object.fromEntries(
  Object.entries(answers).map(([k, v]) => [
    k,
    { pass: v.type === "noul" && v.noul >= 0.5, noul: v.type === "noul" ? v.noul : 0 },
  ]),
);`,
    },
    {
      kind: "h2",
      text: "Multi-dimensional triage in one call",
    },
    {
      kind: "code",
      lang: "ts",
      code: `import { choice, noul, score } from "@caelum/typesafe";

// Classify a support ticket on every relevant dimension at once.
const { answers } = await client.systemOne({
  state: { ticket: req.body.message, account: req.body.account },
  questions: {
    // Routing
    department: choice("Which department handles \`ticket\`?", {
      billing: "Payment, invoice, or subscription issues.",
      technical: "Software bugs, outages, or configuration problems.",
      sales: "Pricing, upgrades, or new feature interest.",
      general: "Everything else.",
    }),
    // Urgency
    urgency: score("How urgent is \`ticket\`? (0 = can wait, 4 = production down)", [
      "No time pressure — the customer is gathering information.",
      "Moderate — the issue affects their work but has a workaround.",
      "High — no workaround; the customer is blocked.",
      "Critical — production system is down or data is at risk.",
      "Emergency — legal or financial exposure in the next 24 hours.",
    ]),
    // Flags
    is_churn_risk:   noul("Does \`ticket\` suggest the customer may cancel?"),
    is_escalated:    noul("Does \`ticket\` mention a manager, lawyer, or formal complaint?"),
    is_bug_report:   noul("Does \`ticket\` describe a specific reproducible bug?"),
  },
});

const { department, urgency, is_churn_risk, is_escalated } = answers;
route({ department, urgency, is_churn_risk, is_escalated });`,
    },
    {
      kind: "h2",
      text: "Mixing primitives in one batch",
    },
    {
      kind: "p",
      text: "Choice, Score, and Noul can be freely mixed in a single request. There is no penalty for mixing — the engine scores each question type against the shared state, and the response maps each key to the right answer shape.",
    },
    {
      kind: "code",
      lang: "json",
      code: `{
  "model": "system-one",
  "state": { "article": "..." },
  "questions": {
    "topic":       { "type": "choice", "instructions": "What is the main topic?",
                     "criteria": { "politics": "...", "science": "...", "sport": "..." } },
    "quality":     { "type": "score",  "instructions": "Editorial quality (1–5)?",
                     "criteria": ["Poor", "Below average", "Average", "Good", "Excellent"] },
    "has_opinion":  { "type": "noul",   "instructions": "Does the article express a strong opinion?" },
    "cites_sources":{ "type": "noul",   "instructions": "Does the article cite named sources?" }
  }
}`,
    },
    {
      kind: "h2",
      text: "Dependent questions: two-call pattern",
    },
    {
      kind: "p",
      text: "If question B's answer depends on question A's answer, use two calls. Run A, include the typed answer in state for the second call, then run B. This is rarer than it sounds — most checklists are genuinely independent.",
    },
    {
      kind: "code",
      lang: "ts",
      code: `// Call 1: classify the document type.
const { answers: step1 } = await client.systemOne({
  state: { doc },
  questions: { doc_type: choice("What type is \`doc\`?", { invoice: "...", contract: "...", receipt: "..." }) },
});

// Call 2: run type-specific checks using the answer as state.
const { answers: step2 } = await client.systemOne({
  state: { doc, doc_type: step1.doc_type.choice },
  questions: {
    needs_signature: noul("Does an \`invoice\` type document require a signature under the company policy?"),
    has_po_number: noul("Does \`doc\` contain a purchase-order number?"),
  },
});`,
    },
    {
      kind: "note",
      text: "The 64-question limit applies per request. For datasets where a single item has more dimensions, split into logical groups and run two parallel calls — the answers compose cleanly in code.",
    },
  ],
};

const streaming: DocPage = {
  slug: "streaming",
  title: "Streaming incremental answers",
  nav: "Streaming",
  summary:
    "How to receive typed answers as they are scored, reduce time-to-first-answer, and handle the stream in TypeScript and Python.",
  blocks: [
    {
      kind: "p",
      text: "When a request carries many questions or a large state, streaming lets you act on each answer as it is ready instead of waiting for all of them. The streaming endpoint is the same `POST /api/v1/systemone` — add `\"stream\": true` to the request body and switch to reading a Server-Sent Events (SSE) stream in the response.",
    },
    {
      kind: "h2",
      text: "Enabling streaming",
    },
    {
      kind: "code",
      lang: "json",
      code: `{
  "model": "system-one",
  "stream": true,
  "state": { "ticket": "My flight was cancelled. Can I get a refund?" },
  "questions": {
    "refund_requested": { "type": "noul", "instructions": "Does \`ticket\` request a refund?" },
    "request_type":     { "type": "choice", "instructions": "What is the main request?",
                          "criteria": { "refund": "...", "rebooking": "...", "info": "..." } },
    "frustration":      { "type": "score", "instructions": "Frustration level?",
                          "criteria": ["Calm", "Concerned", "Very angry"] }
  }
}`,
    },
    {
      kind: "h2",
      text: "SSE event format",
    },
    {
      kind: "p",
      text: "The response is `Content-Type: text/event-stream`. Each scored answer is an `answer` event. The stream closes with a `done` event that carries usage totals and overall latency.",
    },
    {
      kind: "code",
      lang: "text",
      code: `data: {"event":"answer","key":"refund_requested","answer":{"type":"noul","noul":0.95}}

data: {"event":"answer","key":"frustration","answer":{"type":"score","score":1.4,"legend":{"0":"Calm","1":"Concerned","2":"Very angry"},"probabilities":{"0":0.22,"1":0.51,"2":0.27},"confidence":0.51}}

data: {"event":"answer","key":"request_type","answer":{"type":"choice","choice":"refund","probabilities":{"refund":0.82,"rebooking":0.1,"info":0.08},"confidence":0.82}}

data: {"event":"done","model":"system-one","usage":{"input_tokens":96,"output_tokens":0},"latency_ms":18}`,
    },
    {
      kind: "h2",
      text: "Consuming a stream in TypeScript",
    },
    {
      kind: "code",
      lang: "ts",
      code: `import { TypeSafeClient } from "@caelum/typesafe";

const client = new TypeSafeClient({ apiKey: process.env.OPENJEV_API_KEY });

// The SDK's streamSystemOne returns an async iterable.
const stream = client.streamSystemOne({
  state: { ticket: "My flight was cancelled." },
  questions: {
    refund_requested: { type: "noul", instructions: "Refund request?" },
    request_type:     { type: "choice", instructions: "Request type?",
                        criteria: { refund: "...", rebooking: "...", info: "..." } },
  },
});

for await (const event of stream) {
  if (event.event === "answer") {
    console.log(event.key, event.answer);
    // Act on each answer as it arrives — no need to wait for all.
    if (event.key === "refund_requested" && event.answer.type === "noul") {
      if (event.answer.noul > 0.9) showRefundBanner();
    }
  }
  if (event.event === "done") {
    console.log("all done", event.usage, event.latency_ms);
  }
}`,
    },
    {
      kind: "h2",
      text: "Raw SSE in the browser",
    },
    {
      kind: "code",
      lang: "ts",
      code: `// Browser: use fetch with ReadableStream — EventSource does not support POST.
const res = await fetch("/api/v1/systemone", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": \`Bearer \${apiKey}\`,
  },
  body: JSON.stringify({ stream: true, state, questions }),
});

const reader = res.body!.getReader();
const decoder = new TextDecoder();
let buf = "";

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buf += decoder.decode(value, { stream: true });
  for (const line of buf.split("\\n")) {
    if (line.startsWith("data: ")) {
      const event = JSON.parse(line.slice(6));
      if (event.event === "answer") renderAnswer(event.key, event.answer);
    }
  }
  buf = buf.slice(buf.lastIndexOf("\\n") + 1);
}`,
    },
    {
      kind: "h2",
      text: "Streaming in Python",
    },
    {
      kind: "code",
      lang: "python",
      code: `import httpx, json

def stream_systemone(state, questions, api_key):
    url = "http://localhost:3000/api/v1/systemone"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {"model": "system-one", "stream": True, "state": state, "questions": questions}

    with httpx.stream("POST", url, json=payload, headers=headers, timeout=60) as r:
        r.raise_for_status()
        for line in r.iter_lines():
            if line.startswith("data: "):
                event = json.loads(line[6:])
                if event["event"] == "answer":
                    yield event["key"], event["answer"]
                elif event["event"] == "done":
                    return

for key, answer in stream_systemone(state, questions, api_key):
    print(key, answer)`,
    },
    {
      kind: "h2",
      text: "When to use streaming",
    },
    {
      kind: "list",
      items: [
        "Large batches (10+ questions) where the first answer can unblock UI or workflow immediately.",
        "Long states where the backend scores questions in score-order, not insertion-order — streaming lets you show whatever is ready first.",
        "Server-sent progress updates to a browser while a multi-stage decision runs.",
        "Skip streaming for small batches (< 5 questions) or server-side code that needs all answers at once — non-streaming is simpler.",
      ],
    },
    {
      kind: "note",
      text: "Answers arrive in score-completion order, not in the order the questions were listed. Always key answers by the question name, not by position.",
    },
  ],
};

const determinism: DocPage = {
  slug: "determinism",
  title: "Determinism: reproducible typed decisions",
  nav: "Determinism",
  summary:
    "Why OpenJev decisions are deterministic, what that means for testing and caching, and how to reason about changes across model versions.",
  blocks: [
    {
      kind: "p",
      text: "A typed decision in OpenJev is deterministic: the same state and the same questions produce the same answer every time, on the same backend. There is no sampling temperature, no random seed, no generation. The scoring kernel is a pure function of its inputs. This single property changes the engineering contract — you can write golden tests, cache by input hash, replay production traffic, and upgrade with a diff.",
    },
    {
      kind: "h2",
      text: "Why there is no temperature",
    },
    {
      kind: "p",
      text: "Temperature controls the randomness of token sampling in a generative model. OpenJev does not generate tokens. The backends (laya, native scorer, and the local engine) compute a probability distribution over a fixed answer set — a scoring step, not a sampling step. There is nothing to add temperature to. The distribution is deterministic for a given input and model profile.",
    },
    {
      kind: "h2",
      text: "Golden tests",
    },
    {
      kind: "p",
      text: "Because answers are deterministic, you can write stable regression tests over real production examples. Capture a set of representative states and expected answers, run them on every deploy, and treat unexpected changes as regressions.",
    },
    {
      kind: "code",
      lang: "ts",
      code: `import { TypeSafeClient, noul, choice } from "@caelum/typesafe";
import { describe, it, expect } from "vitest";

const client = new TypeSafeClient({
  apiKey: "ots_live_test_key",
  baseURL: "http://localhost:3000/api/v1",
});

// Golden fixtures — captured from production and pinned.
const GOLDEN = [
  {
    state: { ticket: "My card was charged twice for the same order." },
    expectations: {
      is_billing_issue: { type: "noul" as const, min: 0.9 },
      department: { type: "choice" as const, choice: "billing" },
    },
  },
];

describe("golden tests (deterministic per backend)", () => {
  for (const { state, expectations } of GOLDEN) {
    it("matches golden answer", async () => {
      const { answers } = await client.systemOne({
        state,
        questions: {
          is_billing_issue: noul("Is this a billing issue?"),
          department: choice("Which department?", {
            billing: "Payment or invoice issue.",
            technical: "Bug or outage.",
          }),
        },
      });

      const billing = answers.is_billing_issue;
      if (billing.type === "noul") {
        expect(billing.noul).toBeGreaterThan(expectations.is_billing_issue.min);
      }

      const dept = answers.department;
      if (dept.type === "choice") {
        expect(dept.choice).toBe(expectations.department.choice);
      }
    });
  }
});`,
    },
    {
      kind: "h2",
      text: "Caching by input hash",
    },
    {
      kind: "p",
      text: "Determinism makes content-addressed caching safe. Hash the canonical JSON of `{ model, state, questions }` and cache the response — the same input will never silently return a different answer on the same model profile.",
    },
    {
      kind: "code",
      lang: "ts",
      code: `import { createHash } from "node:crypto";
import type { SystemOneRequest, SystemOneResponse } from "@caelum/typesafe";

const cache = new Map<string, SystemOneResponse>();

function cacheKey(req: SystemOneRequest): string {
  return createHash("sha256")
    .update(JSON.stringify({ model: req.model ?? "system-one", state: req.state, questions: req.questions }))
    .digest("hex");
}

async function cachedDecide(req: SystemOneRequest): Promise<SystemOneResponse> {
  const key = cacheKey(req);
  if (cache.has(key)) return cache.get(key)!;
  const out = await client.systemOne(req);
  cache.set(key, out);
  return out;
}`,
    },
    {
      kind: "h2",
      text: "Determinism boundaries",
    },
    {
      kind: "table",
      head: ["Scope", "Deterministic?", "Notes"],
      rows: [
        ["Same model profile, same input", "Yes", "The scoring function is pure. Identical input → identical output."],
        ["Different local model profiles (system-one vs decisive)", "No", "Same kernel, different scalar weights; expect different confidence/distributions (same argmax on the gold suite)."],
        ["laya vs native vs local", "No", "Different backends use different weights or algorithms."],
        ["Any-LLM escalation backend", "No", "Hosted LLMs have sampling; temperature-0 helps but does not guarantee exact reproducibility."],
        ["Across model version bumps", "Intentional change", "Treat a version bump as a schema migration — run your golden test suite before promoting."],
      ],
    },
    {
      kind: "h2",
      text: "Reasoning about drift",
    },
    {
      kind: "p",
      text: "The only thing that changes a deterministic answer is a change to the model profile, the state, or the questions. If your classifier's output changes between deploys, one of those three changed. A golden-test suite makes the change visible as a test diff before it reaches production.",
    },
    {
      kind: "list",
      items: [
        "Run golden tests on every model profile bump — see model-versioning for the migration procedure.",
        "Store the model ID that produced each cached answer alongside the cached value so a profile bump invalidates the right entries.",
        "For any-LLM escalation calls, set temperature=0 in the provider config to minimize sampling noise, but do not rely on it for golden tests.",
      ],
    },
    {
      kind: "note",
      text: "Determinism is per-backend, not cross-backend. If you switch from the local engine to laya-onnx, your golden tests will surface distribution changes — run them and update the fixtures to the new baseline.",
    },
  ],
};

const modelVersioning: DocPage = {
  slug: "model-versioning",
  title: "Model versioning: IDs, pinning, and deprecation",
  nav: "Model versioning",
  summary:
    "How OpenJev model IDs work, how to pin to a specific version, the alias system, and what to do when a profile is deprecated.",
  blocks: [
    {
      kind: "p",
      text: "Model IDs in OpenJev identify the scoring profile that evaluates your questions. Every response carries the model ID that answered it, so you always know which profile produced a given distribution. There are stable version IDs, mutable aliases, and a deprecation lifecycle — this page explains all three.",
    },
    {
      kind: "h2",
      text: "ID taxonomy",
    },
    {
      kind: "table",
      head: ["ID", "Kind", "Behavior"],
      rows: [
        ["system-one", "Stable alias", "Always resolves to the current flagship profile. The default when `model` is omitted."],
        ["openjev-latest", "Stable alias", "Alias for system-one. Use this when you want the canonical latest."],
        ["system-one-2026-09", "Versioned ID", "A specific monthly release of system-one. Pinned — never changes."],
        ["jev-v13", "Stable profile", "'Sharp' tuning — a hair more peaked than Balanced. A compatibility pin, not a separate model version."],
        ["decisive", "Stable profile", "Coldest-temperature tuning on the local engine (most confident argmax). Legacy alias: `rlhf`. No versioned release cadence."],
        ["contrastive", "Stable profile", "Distinctive-token + not_for re-weighting on the local engine. Legacy alias: `rlcd`."],
        ["laya-mlx", "Hardware profile", "Routes to the Laya MLX sidecar. Not versioned — follows the sidecar weights."],
        ["laya-onnx", "Hardware profile", "Routes to the Laya ONNX sidecar."],
        ["openjev-grok", "Escalation alias", "Routes to the configured hosted LLM. Never cached."],
      ],
    },
    {
      kind: "h2",
      text: "Checking the live model list",
    },
    {
      kind: "code",
      lang: "bash",
      code: `# List all available model profiles and their current aliases.
curl http://localhost:3000/api/v1/models \\
  -H "Authorization: Bearer $OPENJEV_API_KEY"`,
    },
    {
      kind: "code",
      lang: "json",
      code: `{
  "models": [
    { "id": "system-one",          "aliases": ["openjev-latest"], "status": "active",     "deprecated_at": null },
    { "id": "system-one-2026-09",  "aliases": [],                     "status": "active",     "deprecated_at": null },
    { "id": "jev-v13",             "aliases": [],                     "status": "active",     "deprecated_at": null },
    { "id": "system-one-2026-06",  "aliases": [],                     "status": "deprecated", "deprecated_at": "2026-12-01" }
  ]
}`,
    },
    {
      kind: "h2",
      text: "Pinning to a versioned ID",
    },
    {
      kind: "p",
      text: "If your golden test suite or production SLA requires exact reproducibility across deploys, pin the `model` field to a versioned ID. The versioned ID's scoring profile is frozen — bumping `system-one` to a new monthly release will not change the output of a pinned call.",
    },
    {
      kind: "code",
      lang: "ts",
      code: `// Unpinned (follows the rolling alias — may change on a profile bump):
const out = await client.systemOne({ state, questions });

// Pinned to September 2026 release (never changes):
const out = await client.systemOne({
  model: "system-one-2026-09",
  state,
  questions,
});`,
    },
    {
      kind: "code",
      lang: "json",
      code: `// HTTP — pin by setting the model field.
{
  "model": "system-one-2026-09",
  "state": "...",
  "questions": { ... }
}`,
    },
    {
      kind: "h2",
      text: "When to pin vs when to follow the alias",
    },
    {
      kind: "table",
      head: ["Situation", "Recommendation"],
      rows: [
        ["Production classifier with a golden test suite", "Pin to a versioned ID. Promote to a new version only after golden tests pass."],
        ["Prototype / development", "Follow the alias (system-one). You want the latest improvements automatically."],
        ["Data enrichment backfill", "Pin to the ID you ran the first batch on. Re-running must produce the same labels."],
        ["Agent skill (SKILL.md)", "Follow the alias — agents should use the current best profile."],
        ["Compliance audit trail", "Store the versioned ID on every decision record so the audit log is reproducible."],
      ],
    },
    {
      kind: "h2",
      text: "Deprecation lifecycle",
    },
    {
      kind: "list",
      ordered: true,
      items: [
        "A profile moves to `status: deprecated` with a `deprecated_at` date at least 90 days in the future.",
        "The service starts emitting a `Deprecation` response header on calls to the deprecated ID.",
        "At `deprecated_at`, calls to the deprecated ID return a `410 Gone` with `type: model_deprecated` and a `successor` field.",
        "Migrate before the date: swap the model ID and run your golden test suite. Treat distribution changes as a schema migration.",
      ],
    },
    {
      kind: "code",
      lang: "json",
      code: `// Response when calling a deprecated model after its sunset date:
HTTP/1.1 410 Gone
{
  "error": {
    "type": "model_deprecated",
    "message": "system-one-2026-06 was deprecated on 2026-12-01. Use system-one-2026-09 or system-one.",
    "successor": "system-one-2026-09"
  }
}`,
    },
    {
      kind: "h2",
      text: "Storing the model ID on decision records",
    },
    {
      kind: "p",
      text: "Every `systemOne` response includes the `model` field with the exact ID that answered the request. Store it on every decision record. This gives you a reproducibility handle — you can re-run any historical decision with the same model ID and get the same answer — and it is essential for audit trails in regulated systems.",
    },
    {
      kind: "code",
      lang: "ts",
      code: `const out = await client.systemOne({ model: "system-one-2026-09", state, questions });

// Store the answered model ID alongside the decision.
await db.insert("decisions").values({
  id: crypto.randomUUID(),
  state_hash: hash(state),
  model:      out.model,                  // "system-one-2026-09"
  answers:    JSON.stringify(out.answers),
  created_at: new Date(),
});`,
    },
    {
      kind: "note",
      text: "The alias `system-one` is stable across sessions but not across model releases. If you need exact reproducibility for an audit, always store and replay with the versioned ID returned in the response, not the alias you sent.",
    },
  ],
};

export const DOC_PAGES: DocPage[] = [
  quickstart,
  primitives,
  apiReference,
  sdk,
  backends,
  selfHosting,
  skill,
  // New pages
  errors,
  authentication,
  rateLimits,
  webhooks,
  batching,
  streaming,
  determinism,
  modelVersioning,
];

export const DOC_NAV: DocNavGroup[] = [
  { group: "Getting started", slugs: ["quickstart"] },
  { group: "Core concepts", slugs: ["primitives", "backends"] },
  { group: "Reference", slugs: ["api-reference", "sdk", "errors", "authentication", "model-versioning"] },
  { group: "Operations", slugs: ["self-hosting", "skill", "webhooks", "rate-limits"] },
  { group: "Advanced", slugs: ["batching", "streaming", "determinism"] },
];

/** Footer links for the docs hub and pages. */
export const DOC_FOOTER: ReadonlyArray<{ label: string; slug: string }> = [
  { label: "Quickstart", slug: "quickstart" },
  { label: "API reference", slug: "api-reference" },
  { label: "Client SDK", slug: "sdk" },
  { label: "Self-hosting", slug: "self-hosting" },
];

export function getDocPage(slug: string): DocPage | undefined {
  return DOC_PAGES.find((p) => p.slug === slug);
}

export function docNeighbors(slug: string): {
  prev: DocPage | null;
  next: DocPage | null;
} {
  const i = DOC_PAGES.findIndex((p) => p.slug === slug);
  if (i === -1) return { prev: null, next: null };
  return {
    prev: i > 0 ? DOC_PAGES[i - 1] : null,
    next: i < DOC_PAGES.length - 1 ? DOC_PAGES[i + 1] : null,
  };
}
