/**
 * FAQ — content behind /faq.
 *
 * 18 real questions across six categories: typed decisions, calibration,
 * self-hosting, pricing, backends, and API keys. Each answer is accurate to the
 * shipped product; no invented features or promised SLAs.
 *
 * Data only — no JSX. The FAQ route renders every item and emits FAQPage
 * JSON-LD over the full set.
 */

export type FaqCategory =
  | "typed-decisions"
  | "calibration"
  | "self-hosting"
  | "pricing"
  | "backends"
  | "keys";

export interface FaqItem {
  readonly id: string;
  readonly q: string;
  readonly a: string;
  readonly category: FaqCategory;
}

export const FAQ_CATEGORY_LABELS: Readonly<Record<FaqCategory, string>> = {
  "typed-decisions": "Typed decisions",
  calibration: "Calibration",
  "self-hosting": "Self-hosting",
  pricing: "Pricing",
  backends: "Backends",
  keys: "API keys",
};

export const FAQS: readonly FaqItem[] = [
  // ── Typed decisions ────────────────────────────────────────────────────────
  {
    id: "what-is-typed-decision",
    q: "What is a typed decision?",
    a: "A typed decision is a question whose answer space you enumerate in advance — a set of labelled options, a rubric scale, or a single proposition. The engine evaluates the question against a shared state and returns one value from that space, plus a calibrated confidence and a full probability distribution. The answer is always the right shape for your code to branch on; there is nothing to parse.",
    category: "typed-decisions",
  },
  {
    id: "three-primitives",
    q: "What are Choice, Score, and Noul?",
    a: "They are the three typed decision primitives. Choice returns one label from a named closed set (2–255 options) — ideal for routing, classification, and labelling. Score returns one level on an ordered rubric of 2–10 levels — ideal for severity, quality, and risk ratings. Noul returns a calibrated P(yes) in [0,1] for a single yes/no proposition — ideal for gates, guardrail checks, and boolean flags. Each carries the full probability distribution and a calibrated confidence.",
    category: "typed-decisions",
  },
  {
    id: "vs-json-mode",
    q: "How is this different from JSON mode or structured outputs?",
    a: "JSON mode and structured outputs guarantee the payload parses and a field is present. They do not make the value calibrated. An enum field filled by structured outputs is still a single sampled token with no probability behind it. A typed decision returns the full distribution over the closed answer set and a confidence you can threshold — which is what lets you gate on certainty, not just read a guess that happens to be syntactically valid.",
    category: "typed-decisions",
  },
  {
    id: "multiple-questions",
    q: "Can I ask several questions in one request?",
    a: "Yes. You attach a map of questions to a single shared state in one POST /api/v1/systemone call. Every question is evaluated independently against the same state. A 15-item checklist is one call; the state is read once regardless of how many questions you attach. Answers come back under the same keys you gave the questions.",
    category: "typed-decisions",
  },
  {
    id: "no-text-generation",
    q: "Can OpenJev write text or generate content?",
    a: "No. OpenJev never generates prose. If you need a written reply, a summary, extracted fields, or a chain of reasoning, use a generative model — that is exactly what it is built for. Typed decisions are the narrow, high-volume steps: which bucket, how severe, is-this-allowed. Separating the two keeps decisions cheap, stable, and testable.",
    category: "typed-decisions",
  },
  {
    id: "deterministic",
    q: "Are decisions deterministic?",
    a: "Yes. Given the same state and the same questions, the engine returns the same answers every time. This means you can write golden tests, cache results by a hash of the input, and reason about regressions the same way you would for a pure function. It also means a labelling pipeline is reproducible: re-running it does not churn labels.",
    category: "typed-decisions",
  },

  // ── Calibration ───────────────────────────────────────────────────────────
  {
    id: "what-is-calibration",
    q: "What does 'calibrated confidence' mean?",
    a: "Calibrated means the number matches reality: among all predictions labelled 0.8, roughly 80% are correct. An uncalibrated confidence — for example, a self-reported score from a generative model — reflects how confident the answer sounds, not how often it is right. openjev's confidence comes from the engine's distribution over the closed answer set, evaluated against a labelled gold suite, so the number is comparable across calls and meaningful to threshold.",
    category: "calibration",
  },
  {
    id: "threshold",
    q: "What confidence threshold should I use?",
    a: "It depends on the cost of a wrong action. A common starting point is auto-act at 0.85, confirm or ask a follow-up between 0.5 and 0.85, and escalate to a human below 0.5. Watch the error rate on what you auto-resolved and the escalation rate, then lower the threshold as you gain trust. Because decisions are deterministic, that tuning is reproducible — the same item lands the same way after you adjust the bar.",
    category: "calibration",
  },
  {
    id: "ece",
    q: "What is ECE?",
    a: "ECE stands for Expected Calibration Error. It is the weighted mean of |accuracy − confidence| across confidence buckets. A perfectly calibrated model has ECE = 0. openjev's calibration harness computes ECE (along with MCE and Brier score) when you run the gold eval suite against a backend, giving you a number you can track over time as you change tuning profiles or backends. ECE on public datasets (Banking77, CLINC150 + out-of-scope, AG News) is published on the /leaderboard page.",
    category: "calibration",
  },
  {
    id: "distribution",
    q: "What is the full distribution used for?",
    a: "The distribution shows you the runner-up and its probability mass, which is where most ambiguity lives. A 0.52 / 0.48 split between two labels is genuine uncertainty you should route to a person, not a coin you should flip. For Score, adjacent levels splitting mass means the rating is sitting right on a rubric boundary — a signal worth catching before triggering an expensive action.",
    category: "calibration",
  },

  // ── Self-hosting ──────────────────────────────────────────────────────────
  {
    id: "how-to-self-host",
    q: "How do I self-host OpenJev?",
    a: "Pull and run the openjev/engine Docker image: `docker run -p 3000:3000 openjev/engine`. Then set OPENJEV_BASE_URL=http://localhost:3000 in your environment. The SDK and any direct HTTP calls will route to your instance. The request format is wire-compatible with the upstream System One v1 API.",
    category: "self-hosting",
  },
  {
    id: "which-backend",
    q: "Which backend should I run in production?",
    a: "laya-onnx is the default and the recommended choice for Linux / CPU deployments — it runs on any server without a GPU and produces consistent results. If you are on Apple silicon (Mac or Apple-silicon cloud), laya-mlx is faster. The native scorer needs no model download at all and is fully deterministic, but it trades some accuracy for speed. All three back the same POST /api/v1/systemone contract.",
    category: "self-hosting",
  },
  {
    id: "data-boundary",
    q: "Does data leave my infrastructure when I self-host?",
    a: "No. When you run the Docker image with a local backend (laya-onnx, laya-mlx, or the native scorer), every decision call is evaluated inside your process. Nothing is sent to an external service and there is no per-call token bill. This is the recommended configuration for regulated environments or latency-sensitive deployments.",
    category: "self-hosting",
  },

  // ── Pricing ───────────────────────────────────────────────────────────────
  {
    id: "free",
    q: "Is OpenJev free?",
    a: "The open-source engine is Apache-2.0 licensed and free to self-host with no usage cap. The hosted endpoint offers a free tier (no key required in the playground, quota-metered calls for registered keys). Paid tiers with higher quotas and SLA are available for teams that want a managed endpoint without running infrastructure.",
    category: "pricing",
  },
  {
    id: "self-host-cost",
    q: "What does it cost to run a large backfill self-hosted?",
    a: "Near-zero marginal cost. Self-hosted decisions have no generation step, so there is no per-token fee. The cost is your own compute: a laya-onnx instance on a mid-range CPU server can classify thousands of items per second. For a million-row backfill, the deciding factor is how many parallel workers you spin up, not a cloud API bill.",
    category: "pricing",
  },

  // ── Backends ──────────────────────────────────────────────────────────────
  {
    id: "laya-mlx-vs-onnx",
    q: "What is the difference between laya-mlx and laya-onnx?",
    a: "Both run the same model locally and produce the same calibrated decisions. laya-mlx uses Apple's MLX framework and is optimized for Apple-silicon hardware (M-series Macs) — it is the fastest backend in that environment. laya-onnx uses the ONNX runtime and runs on any platform, including Linux / x86 CPU, with no GPU required. laya-onnx is the production default for Docker-based deployments.",
    category: "backends",
  },
  {
    id: "any-llm-backend",
    q: "Can I use a cloud LLM (OpenAI, Anthropic, etc.) as the backend?",
    a: "Yes, through the any-LLM backend. It wraps a chat LLM as a System One backend, formatting the state and questions as a structured prompt and parsing the response. This is the right choice when you want a hosted model's language understanding but still want the Choice / Score / Noul contract on the output. Latency and cost are higher than a local backend because a full generative call is made per decision.",
    category: "backends",
  },

  // ── API keys ──────────────────────────────────────────────────────────────
  {
    id: "need-key",
    q: "Do I need an API key to use the playground or the self-hosted engine?",
    a: "No. The hosted playground calls the hosted endpoint without a key (anonymous quota applies). A self-hosted engine with a local backend runs completely open — there is no key check unless you add your own auth middleware.",
    category: "keys",
  },
  {
    id: "key-quota",
    q: "How do hosted API keys and quotas work?",
    a: "Each key has a monthly call quota that resets on the billing date. The free tier gives a fixed number of calls per month; paid tiers raise the quota and add priority access. If a key exceeds its quota the endpoint returns HTTP 429 with the reset timestamp so you can back off and retry. Key management (create, revoke, rotate) is available in the console under API Keys.",
    category: "keys",
  },
];

/** Group FAQ items by category, in a stable display order. */
const CATEGORY_ORDER: readonly FaqCategory[] = [
  "typed-decisions",
  "calibration",
  "self-hosting",
  "pricing",
  "backends",
  "keys",
];

export const FAQ_GROUPS: ReadonlyArray<{
  category: FaqCategory;
  label: string;
  items: readonly FaqItem[];
}> = CATEGORY_ORDER.map((cat) => ({
  category: cat,
  label: FAQ_CATEGORY_LABELS[cat],
  items: FAQS.filter((f) => f.category === cat),
}));
