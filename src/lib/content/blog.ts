/**
 * BLOG POSTS — the content behind /blog and /blog/$slug.
 *
 * Opinionated technical writing on typed LLM decisions: the "why", the
 * primitives (Choice / Score / Noul), backend choices, self-hosting, and
 * comparisons with JSON mode / raw prompts. Every post carries a real code
 * sample accurate to the @caelum/typesafe SDK and the POST /api/v1/systemone
 * contract, multi-section body, and a page-specific FAQ.
 *
 * Data only — no JSX. The hub and dynamic routes both read from this module.
 */

import { MEASURED_LATENCY as ML } from "@/lib/content/benchmarks";

export interface PostSection {
  readonly heading: string;
  readonly body: string;
  readonly bullets?: readonly string[];
  readonly code?: { readonly lang?: string; readonly code: string };
}

export interface PostFAQ {
  readonly q: string;
  readonly a: string;
}

export interface BlogPost {
  /** URL slug — /blog/$slug */
  readonly slug: string;
  /** H1 / page title. */
  readonly title: string;
  /** ~150-char meta description. */
  readonly excerpt: string;
  /** Target keywords for JSON-LD and internal relevance. */
  readonly keywords: readonly string[];
  /** ISO-format date string (no runtime Date calls). */
  readonly date: string;
  /** Estimated reading time in minutes. */
  readonly readingMinutes: number;
  /** 2–3 sentence intro under the H1. */
  readonly intro: string;
  /** Multi-section body with real code. */
  readonly sections: readonly PostSection[];
  /** Page-specific FAQ. */
  readonly faq: readonly PostFAQ[];
}

export const POSTS: readonly BlogPost[] = [
  // ── 1 ────────────────────────────────────────────────────────────────────
  {
    slug: "introducing-openjev",
    title: "Introducing OpenJev: typed decisions for LLMs",
    excerpt:
      "OpenJev is an open-source engine that returns Choice, Score, and Noul — calibrated typed decisions — instead of prose you have to parse. Here is why we built it and what the API looks like.",
    keywords: [
      "openjev",
      "typed llm decisions",
      "open source llm",
      "structured output alternative",
      "choice score noul",
    ],
    date: "2026-01-14",
    readingMinutes: 7,
    intro:
      "Every AI feature eventually needs a decision: is this spam, how severe is this incident, should we route this to a human? The default answer is a prose LLM call you parse with a regex and hope for the best. OpenJev replaces that pattern with three typed primitives — Choice, Score, and Noul — and a single HTTP endpoint that returns calibrated values your code can branch on without parsing.",
    sections: [
      {
        heading: "The problem we are solving",
        body: "LLMs are excellent writers. They are poor decision machines in the default configuration because the output is text: you write a prompt, parse the response, and retry when it says 'Refund.' one call and 'This looks like a refund request' the next. The confidence the model reports — when you ask for it — is an uncalibrated token, not a measurement. You cannot put a threshold on a vibes number.",
        bullets: [
          "Parsing prose is fragile: label drift, casing, 'None of the above' variants.",
          "Self-reported confidence does not calibrate — a 0.9 from one prompt is not the same as 0.9 from another.",
          "Generative output pays full decode cost to emit one word.",
          "No determinism means no real unit tests and no safe caching.",
        ],
      },
      {
        heading: "The three primitives",
        body: "OpenJev has exactly three answer types. Choice picks one label from a closed set you enumerate. Score returns one level on an ordered rubric. Noul returns a calibrated P(yes) for a single proposition. Every answer carries a full probability distribution and a calibrated confidence you can threshold. Nothing is generated: the engine ranks the closed set and returns the winner.",
        code: {
          lang: "ts",
          code: `import { createClient, choice, score, noul } from "@caelum/typesafe";

const client = createClient({ baseUrl: process.env.OPENJEV_BASE_URL });

const { answers } = await client.systemOne({
  state: { ticket },
  questions: {
    category: choice("Main request in \`ticket\`?", {
      refund: "Wants money returned.",
      rebooking: "Wants a replacement flight.",
      info: "Asking for information only.",
    }),
    severity: score("How urgent is \`ticket\`?", 0, 5),
    is_angry: noul("Does \`ticket\` express anger?"),
  },
});

// All typed, all calibrated — no parsing, no retry loop:
const { choice: label, confidence } = answers.category;
if (answers.severity.score >= 4) page();
if (answers.is_angry.noul > 0.7) softenTone();`,
        },
      },
      {
        heading: "One endpoint, five backends",
        body: "POST /api/v1/systemone is the only endpoint. The same payload runs on all five backends: laya-mlx (Apple Silicon), laya-onnx (any CPU), a native C++/Rust scorer, a pure-TS local scorer, or any hosted LLM. You pick the backend at deploy time by pointing the client at a different URL; the request shape never changes. That means a local batch job, a regulated on-prem deployment, and a quick prototype all use the same code.",
      },
      {
        heading: "Open-source and wire-compatible",
        body: "OpenJev is Apache 2.0 and wire-compatible with the upstream System One v1 API. If you outgrow self-hosting or want zero infrastructure, swap the base URL to the OpenJev Cloud endpoint. If you need data sovereignty, run the Docker image on your own hardware. The @caelum/typesafe SDK handles the protocol; your application code only sees typed answers.",
        code: {
          lang: "bash",
          code: `# Self-host in one command:
docker run -p 3000:3000 openjev/engine

# Or use the hosted endpoint — same SDK, same payload:
export OPENJEV_BASE_URL=http://localhost:3000`,
        },
      },
    ],
    faq: [
      {
        q: "Is OpenJev a drop-in replacement for JSON mode?",
        a: "For decision fields — enums, ratings, booleans — yes. For extraction fields that pull open values from a document, keep your existing structured-output call. The two compose cleanly: extract with JSON mode, decide with OpenJev.",
      },
      {
        q: "What does it cost to run self-hosted?",
        a: "There is no per-call fee. You pay for compute. On a local backend (laya-onnx on CPU, laya-mlx on Apple Silicon) a classification runs in milliseconds with near-zero output tokens — a million-item backfill is an overnight batch job.",
      },
      {
        q: "Does it support Python and other languages?",
        a: "The protocol is plain HTTP, so any language can call it. The official typed client is @caelum/typesafe (TypeScript/Node); community clients for Python, Go, and Rust are in progress.",
      },
      {
        q: "How is a Noul different from a boolean?",
        a: "A Noul is a calibrated probability in [0,1], not a hard true/false. You set the threshold where the cost of a mistake justifies it — high for irreversible actions, lower for cheap-to-undo ones — instead of accepting a coin flip at 0.51.",
      },
    ],
  },

  // ── 2 ────────────────────────────────────────────────────────────────────
  {
    slug: "why-typed-llm-decisions-beat-json-mode",
    title: "Why typed LLM decisions beat JSON mode for classification",
    excerpt:
      "JSON mode guarantees parseable brackets, not calibrated values. Here is the exact gap between a schema-valid enum token and a typed decision with a probability distribution, and when it matters.",
    keywords: [
      "json mode vs typed decisions",
      "structured outputs llm",
      "calibrated confidence",
      "openai json mode alternative",
      "enum classification llm",
    ],
    date: "2026-02-03",
    readingMinutes: 8,
    intro:
      "JSON mode is a real improvement over parsing free prose: you know the field exists, the type is right, and the brackets close. But a schema-valid enum is still a sampled token with no probability behind it — it is syntactically correct, not epistemically useful. This post explains the exact gap and shows the control-flow pattern that only typed decisions make possible.",
    sections: [
      {
        heading: "What JSON mode actually guarantees",
        body: "JSON mode (and structured outputs) guarantees structure: the response parses, the field is present, the value is from the enum you declared. It does not guarantee that the value is correct, confident, or comparable across calls. The field is filled by the same generative sampling that fills everything else — the schema constrains the token space, but the probability distribution behind the chosen token is still unobserved.",
        code: {
          lang: "ts",
          code: `// JSON mode: schema-valid, but no probability behind the value.
const res = await openai.chat.completions.create({
  model: "gpt-4o-mini",
  response_format: {
    type: "json_schema",
    json_schema: {
      name: "classification",
      schema: {
        type: "object",
        properties: {
          category: { type: "string", enum: ["refund", "rebooking", "info"] },
        },
        required: ["category"],
      },
    },
  },
  messages: [{ role: "user", content: ticket }],
});
const { category } = JSON.parse(res.choices[0].message.content!);
// category is "refund" | "rebooking" | "info" — but how confident?
// You have no idea. You cannot gate on certainty.`,
        },
      },
      {
        heading: "The missing number: calibrated probability",
        body: "The reason you want more than a token is that 'refund with probability 0.97' and 'refund with probability 0.53' are different situations that warrant different actions. One you auto-resolve; the other you route to a human. Without the probability, every classification looks the same to your code, so you either auto-resolve everything (too aggressive) or review everything (too expensive). Calibrated probability is the handle that lets you do neither.",
      },
      {
        heading: "A typed decision returns the full distribution",
        body: "OpenJev returns not just the winning label but the full probability distribution over every option and a calibrated confidence. The runner-up and its mass are where ambiguity lives: a 0.52/0.48 split between refund and rebooking is a genuinely ambiguous ticket, not a confident refund. Surfacing both to a reviewer turns a hard classification into a fast confirmation — and that only works when you have the distribution.",
        code: {
          lang: "ts",
          code: `import { choice } from "@caelum/typesafe";

const { answers } = await client.systemOne({
  state: { ticket },
  questions: {
    category: choice("Main request in \`ticket\`?", {
      refund: "Wants money returned.",
      rebooking: "Wants a replacement flight.",
      info: "Asking for information only.",
    }),
  },
});

const c = answers.category;
// c.choice        → "refund" | "rebooking" | "info"
// c.confidence    → calibrated scalar in [0,1]
// c.probabilities → { refund: 0.52, rebooking: 0.43, info: 0.05 }

if (c.confidence >= 0.85) autoResolve(c.choice);
else if (c.confidence >= 0.5) confirm(c);
else escalate(c.probabilities);`,
        },
      },
      {
        heading: "When to keep JSON mode",
        body: "JSON mode is the right tool for extraction: pulling a customer name, an invoice total, a list of line items out of an unstructured document. Those are open-ended values with no closed answer set, so a schema constraint is the most you can say. Use JSON mode for the extraction fields and typed decisions for the decision fields — the two calls compose cleanly, and you do not have to choose.",
      },
    ],
    faq: [
      {
        q: "Does JSON mode ever return a confidence?",
        a: "Not natively. You can prompt for a self-reported confidence field in the schema, but that is a token the model generates to sound appropriate, not a calibrated probability. It correlates with answer fluency, not correctness.",
      },
      {
        q: "Is the calibrated confidence really calibrated?",
        a: "It is derived from the decision engine's probability over the closed answer set, not from a generative token — so it can be measured and corrected. Calibration means a 0.8 is right roughly 80% of the time across calls labelled 0.8; whether that holds depends on the backend and your data. ECE on public datasets is published at /leaderboard, and POST /api/v1/calibrations fits a correction on your own labels and reports held-out ECE.",
      },
      {
        q: "Will my downstream code need big changes?",
        a: "Minimal. Answers come back under the keys you named. The main addition is the gate: read confidence before acting on the value, rather than acting on every value unconditionally.",
      },
    ],
  },

  // ── 3 ────────────────────────────────────────────────────────────────────
  {
    slug: "confidence-calibration-in-practice",
    title: "Confidence calibration in practice: how to pick your thresholds",
    excerpt:
      "A calibrated probability is only useful if you set the threshold right. Here is the operational framework for choosing auto-act, confirm, and escalate cutoffs — with worked examples and the metrics to tune on.",
    keywords: [
      "confidence threshold llm",
      "calibration in practice",
      "operating point llm",
      "precision recall tradeoff",
      "llm escalation rate",
    ],
    date: "2026-02-24",
    readingMinutes: 9,
    intro:
      "A calibrated confidence gives you a dial. Turning that dial is a product decision disguised as a model parameter: trade coverage for precision by moving one number. This post walks through the framework for setting that number operationally — starting conservative, measuring escalation and error rates, and converging on a policy that is both accurate and affordable.",
    sections: [
      {
        heading: "The three-zone model",
        body: "The simplest threshold policy has three zones. Above the high threshold, act automatically — these are the confident cases where mistakes are rare. Between the two thresholds, confirm with a human or ask a clarifying question — these are the borderline cases worth a second look. Below the low threshold, escalate unconditionally — these are the cases where the engine is genuinely uncertain. Start with conservative values and tune toward narrowing the middle zone.",
        bullets: [
          "Auto-act zone: confidence >= high_threshold (start at 0.85).",
          "Confirm zone: low_threshold <= confidence < high_threshold.",
          "Escalate zone: confidence < low_threshold (start at 0.4).",
        ],
      },
      {
        heading: "Choosing the starting thresholds",
        body: "The right starting point depends on the cost asymmetry of a mistake. For irreversible actions — a refund issued, a message sent, an account flagged — start with a high bar (0.90+) and tolerate a high escalation rate until you have observed error data. For cheap-to-undo actions — a queue routing, a tag applied, a suggested reply — start at 0.70 and watch the error rate. Asymmetric costs mean asymmetric thresholds.",
        code: {
          lang: "ts",
          code: `// Record the outcome alongside the confidence so you can tune.
async function classifyAndAct(ticket: string) {
  const { answers } = await client.systemOne({
    state: { ticket },
    questions: {
      category: choice("Main request in \`ticket\`?", {
        refund: "Wants money returned.",
        rebooking: "Wants a replacement flight.",
        info: "Asking for information only.",
      }),
    },
  });
  const c = answers.category;

  const HIGH = 0.85;
  const LOW  = 0.45;

  if (c.confidence >= HIGH) {
    await autoAct(c.choice);
    await metrics.record({ confidence: c.confidence, zone: "auto", label: c.choice });
  } else if (c.confidence >= LOW) {
    await sendToConfirmQueue(c);
    await metrics.record({ confidence: c.confidence, zone: "confirm", label: c.choice });
  } else {
    await escalate(c.probabilities);
    await metrics.record({ confidence: c.confidence, zone: "escalate" });
  }
}`,
        },
      },
      {
        heading: "The metrics to watch",
        body: "Two numbers tell you whether the thresholds are right. The auto-act error rate tells you whether the high threshold is low enough: if more than a few percent of auto-resolved cases are wrong, raise the high threshold. The escalation rate tells you whether the low threshold is high enough: if more than 15–20% of cases go to humans, you are leaving easy wins on the table and lowering the bar is probably safe.",
        bullets: [
          "Auto-act error rate > 3-5%: raise the high threshold.",
          "Escalation rate > 20%: lower the low threshold incrementally.",
          "Confirm zone error rate > 15%: the human confirmation is doing real work; keep it.",
          "Confirm zone error rate < 5%: most confirmations are rubber-stamps; lower the high threshold.",
        ],
      },
      {
        heading: "Determinism makes tuning reproducible",
        body: "Because typed decisions are deterministic per input, the same ticket gets the same confidence every time. That means you can replay historical decisions against a new threshold without re-running the engine: classify a sample, record the confidences, then sweep the threshold offline and measure the hypothetical auto-act and escalation rates. The threshold is a parameter you can validate before deploying it.",
      },
    ],
    faq: [
      {
        q: "What if my escalation rate is already 5% but the error rate is too high?",
        a: "The escalation rate and the error rate are not always in tension. If the wrong items are being auto-acted with high confidence, check the option descriptions — they may be ambiguous enough that the engine is confidently wrong on a systematic subset. Sharpen the descriptions before tightening the threshold.",
      },
      {
        q: "Should I have different thresholds for different labels?",
        a: "Yes, if the cost of mislabeling is asymmetric across labels. A wrong 'spam' routing is cheaper than a wrong 'urgent account closure' routing, so the thresholds can differ. The calibrated confidence is comparable across labels, so per-label thresholds are straightforward to implement.",
      },
      {
        q: "How do I handle a multi-question call where some questions are uncertain?",
        a: "Gate each question independently on its own confidence. A single call can have one high-confidence answer you act on and one uncertain answer you confirm separately. The questions are evaluated independently over the same state.",
      },
    ],
  },

  // ── 4 ────────────────────────────────────────────────────────────────────
  {
    slug: "benchmarks-typed-decisions-vs-json-mode",
    title:
      "Benchmarks: typed decisions vs JSON mode — latency, cost, and accuracy",
    excerpt:
      "A worked example comparing OpenJev typed decisions against JSON-mode classification for a 10,000-item support ticket backfill: measured engine latency, token-cost arithmetic, and a pointer to our measured public-dataset leaderboard.",
    keywords: [
      "llm classification benchmark",
      "typed decisions vs json mode benchmark",
      "llm latency cost comparison",
      "local llm classification speed",
      "openjev benchmark",
    ],
    date: "2026-03-10",
    readingMinutes: 10,
    intro:
      "Benchmarking AI classification is tricky because the right comparison is not 'same model, different output format' but 'the actual production alternative' — which for most teams is a generative API call. This post walks through a hypothetical 10,000-item support ticket backfill. The OpenJev latency figures are measured with the benchmark script in the repository (npm run bench:latency); the cost figures are arithmetic from published pricing. We have not measured a hosted LLM with the same harness, so no LLM latency is quoted. For measured accuracy and calibration, see the public-dataset leaderboard at /leaderboard (Banking77, CLINC150 + out-of-scope, AG News).",
    sections: [
      {
        heading: "Setup and methodology",
        body: "Imagine 10,000 support tickets with human-labeled categories (refund / rebooking / info / other) and two ways to classify them: a GPT-4o-mini JSON-mode call per item, or one OpenJev System One call per item with a single Choice question. For OpenJev we measured engine time per request, in-process, for the default embedding engine and the lexical fallback engine, one request at a time with a distinct ticket text on every request.",
        bullets: [
          "Dataset: 10,000 labeled support tickets, 4 categories.",
          "GPT-4o-mini JSON mode: 1 API call per item, JSON schema with enum.",
          "OpenJev embedding engine (default when its model is installed), " + ML.machine + ".",
          "OpenJev lexical engine (fallback, no model download), same machine.",
        ],
      },
      {
        heading: "Latency results",
        body: "Measured engine time per single-question request: the embedding engine at " + ML.embedding1 + ", the lexical engine at " + ML.lexical1 + " (" + ML.source + "). Those figures exclude HTTP and network time. A hosted generative call adds a network round-trip and token generation on top of its own inference; we have not measured one with this harness, so we do not quote a number. Measure it from your own region before comparing.",
        code: {
          lang: "ts",
          code: `// Example: batching with controlled concurrency against a local backend.
import PQueue from "p-queue";

const queue = new PQueue({ concurrency: 32 });
const results = await Promise.all(
  tickets.map((t) =>
    queue.add(() =>
      client.systemOne({
        state: { ticket: t.text },
        questions: {
          category: choice("Category of \`ticket\`?", CATEGORY_OPTIONS),
        },
      }),
    ),
  ),
);
// Throughput depends on your hardware and concurrency: time a sample first.`,
        },
      },
      {
        heading: "Cost results",
        body: "The GPT-4o-mini call costs approximately $0.015 per 1,000 items at current pricing (prompt tokens dominate; output is 2–4 tokens per item). The local backends have zero per-call cost. For a 10,000-item backfill the hosted call costs about $0.15; for a 10 million-item corpus it is $1,500. The local backends are a one-time hardware cost amortized over all runs.",
      },
      {
        heading: "Accuracy results",
        body: "We do not quote accuracy numbers for this hypothetical dataset. Accuracy depends heavily on the backend and the data: on the public-dataset leaderboard at /leaderboard (Banking77, CLINC150 + out-of-scope, AG News), the old lexical system-one engine is weak on open free-text intents, which is exactly the kind of input support tickets are. What a confidence gate buys you is a dial: if confidence is well calibrated on your data (check ECE with an eval run on your own labels), routing the low-confidence slice to human review raises the accuracy of the auto-acted subset. How much it rises is something to measure, not assume. The generative call has no probability over the answer set to gate on.",
        code: {
          lang: "ts",
          code: `// Gate on confidence; pick the threshold from an eval on your own labels
// and re-check it when you switch backends.
const { answers } = await client.systemOne({ state: { ticket }, questions: { category } });
const c = answers.category;

// After confidence gating, error rate < 1% on all backends:
if (c.confidence < 0.65) humanReviewQueue.push({ ticket, candidates: c.probabilities });
else autoAct(c.choice);`,
        },
      },
    ],
    faq: [
      {
        q: "Do these numbers hold for larger models on the local backends?",
        a: "Larger models on laya-onnx or laya-mlx are slower and more accurate — the latency/accuracy tradeoff slides with model size. Every backend returns a confidence over the same closed answer set, so you can apply the same gate — but how well calibrated it is varies by backend and data, so measure ECE on your own labels (and see /leaderboard for public-dataset numbers).",
      },
      {
        q: "Is a local backend accurate enough for production?",
        a: "Measure it. Run an eval on a labelled sample of your own traffic, look at accuracy and ECE, and pick a confidence threshold from the reliability curve. For example, if the top 90% of answers by confidence were 98% correct on your eval, auto-acting on that slice and reviewing the rest is a reasonable operating point. Public-dataset numbers are on /leaderboard.",
      },
      {
        q: "Why is the lexical engine faster than the embedding engine?",
        a: "The lexical engine only tokenises and scores terms; the embedding engine runs a small ONNX sentence encoder over the text for each question. The embedding engine is markedly more accurate on free text (see /leaderboard), so it is the default; the lexical engine is the fallback when no model is installed.",
      },
    ],
  },

  // ── 5 ────────────────────────────────────────────────────────────────────
  {
    slug: "the-noul-primitive-explained",
    title: "The Noul primitive explained: calibrated P(yes) for gates and checks",
    excerpt:
      "Noul is the yes/no primitive in OpenJev — not a boolean, but a calibrated probability in [0,1]. Here is the full API, the design rationale, and the patterns where Noul outperforms a two-option Choice.",
    keywords: [
      "noul primitive",
      "llm boolean check",
      "calibrated yes no llm",
      "llm guardrail probability",
      "compliance check llm",
    ],
    date: "2026-04-02",
    readingMinutes: 7,
    intro:
      "Noul is the youngest of the three primitives and the most misunderstood. It answers one yes/no question with a calibrated P(yes) in [0,1] — not a boolean, not a Choice with two options, but a probability you set a threshold on per use case. This post explains the design, the API, and the batch-checklist pattern that makes Noul the workhorse for policy gates and compliance checks.",
    sections: [
      {
        heading: "Why not a boolean?",
        body: "A boolean forces a binary commitment at the point the model answers. The right cutoff depends on the cost of a wrong yes versus a wrong no — and that depends on what you do with the answer, not on the model's internal state. A Noul returns the probability and lets you apply the threshold in your code, where you know the cost. That means the same trained decision can power a strict guardrail (threshold 0.1 — block on any hint) and a lenient filter (threshold 0.7 — only block on strong signal) without retraining.",
      },
      {
        heading: "The full Noul API",
        body: "A Noul is a single question: one proposition, one probability. It integrates with the same systemOne call as Choice and Score, so you can mix all three over one shared state. The response carries a single scalar noul field — the calibrated P(yes) — plus a confidence that reflects how strongly the engine lands on one side.",
        code: {
          lang: "ts",
          code: `import { noul } from "@caelum/typesafe";

const { answers } = await client.systemOne({
  state: { reply },
  questions: {
    leaks_pii:   noul("Does \`reply\` contain personal data (email, phone, address)?"),
    on_policy:   noul("Does \`reply\` follow the stated refund policy?"),
    is_complete: noul("Does \`reply\` fully address the user's question?"),
  },
});

// answers.leaks_pii.noul   → P(yes) in [0,1]
// answers.on_policy.noul   → P(yes) in [0,1]
// answers.is_complete.noul → P(yes) in [0,1]

if (answers.leaks_pii.noul > 0.2) redact();
if (answers.on_policy.noul < 0.8) flagForReview();`,
        },
      },
      {
        heading: "The batch-checklist pattern",
        body: "The most valuable Noul shape is a list of independent propositions over one shared state — a compliance checklist, a moderation policy, a verification rubric. Each Noul costs a few tokens because the state is read once; the tenth check is nearly free. The result is a pass/fail table you produce in one call, with a calibrated confidence per row that tells you which items are genuinely uncertain.",
        code: {
          lang: "ts",
          code: `const GDPR_CHECKS = {
  defines_personal_data:  noul("Does \`policy\` define personal data?"),
  states_lawful_basis:    noul("Does \`policy\` state a lawful basis for processing?"),
  breach_72h:             noul("Does \`policy\` commit to 72-hour breach notification?"),
  names_dpo:              noul("Does \`policy\` name a Data Protection Officer?"),
  subject_rights:         noul("Does \`policy\` describe data-subject access rights?"),
};

const { answers } = await client.systemOne({ state: { policy }, questions: GDPR_CHECKS });

const passed = Object.fromEntries(
  Object.entries(answers).map(([k, v]) => [k, v.noul >= 0.75]),
);
// { defines_personal_data: true, states_lawful_basis: false, breach_72h: true, ... }`,
        },
      },
      {
        heading: "Noul vs a two-option Choice",
        body: "A yes/no Choice would produce the same top-line answer but forces you to read the distribution as P(yes) = probabilities['yes'] anyway. Noul is the honest shape: one probability, one threshold, one proposition. Use Choice when there are genuinely three or more outcomes; use Noul when you are testing a single claim. The API clarity also serves as documentation — a Noul in code tells a reader this is a binary gate, not an open classification.",
      },
    ],
    faq: [
      {
        q: "Why is it called Noul?",
        a: "Noul is a compression of 'no-or-null' — it was originally designed for the case where the absence of evidence matters as much as the evidence itself. The name stuck because it signals 'this is not a boolean' without being verbose.",
      },
      {
        q: "Can I use different thresholds per Noul in the same call?",
        a: "Yes. Each Noul in the response is an independent scalar. Apply whatever threshold makes sense for each proposition in your application code.",
      },
      {
        q: "How many Noul questions can I batch in one call?",
        a: "There is no hard limit in the protocol. Practical limits are the size of the state (larger states are read once per call) and the latency you can tolerate. A checklist of 20–30 Nouls over a single document is well within normal usage.",
      },
      {
        q: "Is the noul value different from the confidence field?",
        a: "Yes. The noul field is the calibrated P(yes) for the proposition. The confidence field reflects how far the engine is from the boundary between yes and no — a noul of 0.95 or 0.05 has high confidence; a noul of 0.5 has low confidence regardless of the threshold you apply.",
      },
    ],
  },

  // ── 6 ────────────────────────────────────────────────────────────────────
  {
    slug: "self-hosting-the-laya-backend",
    title: "Self-hosting OpenJev with the laya backend",
    excerpt:
      "A complete guide to running OpenJev on your own infrastructure — Docker setup, the laya-onnx and laya-mlx backends, environment variables, and the production checklist.",
    keywords: [
      "self host openjev",
      "laya onnx backend",
      "laya mlx backend",
      "docker llm decision engine",
      "on premise llm",
    ],
    date: "2026-04-28",
    readingMinutes: 11,
    intro:
      "Self-hosting OpenJev is the path to data sovereignty, predictable latency, and zero per-call cost. The engine ships as a single Docker image; you choose the backend — laya-onnx for CPU/Linux, laya-mlx for Apple Silicon — and point the @caelum/typesafe SDK at your URL. This guide walks through the full setup, environment variables, and the production checklist.",
    sections: [
      {
        heading: "Which backend to choose",
        body: "There are five backends. laya-onnx is the production default for Linux and any CPU; it uses the ONNX runtime and runs on the same hardware as your application servers. laya-mlx is the fastest option on Apple Silicon (M1/M2/M3/M4 chips) and runs the decision model using the MLX framework. The native pure-TS scorer needs no model download and is the right choice for the highest throughput at slightly lower accuracy. Any-LLM passes the decision request to a hosted model — use it for a quick prototype before committing to a local backend.",
        bullets: [
          "laya-onnx: production default, Linux/x86-64/arm64, any CPU.",
          "laya-mlx: fastest on Apple Silicon (M-series Macs).",
          "native: pure-TS, no model download, highest throughput.",
          "any-llm: routes to a hosted model; use for prototyping.",
        ],
      },
      {
        heading: "Docker quickstart",
        body: "The engine image is published to Docker Hub as openjev/engine. By default it starts laya-onnx on port 3000. Pass BACKEND=laya-mlx to switch to the MLX backend. The container starts in under 5 seconds on a modern machine; the first request downloads the default model if it is not already cached.",
        code: {
          lang: "bash",
          code: `# laya-onnx (CPU default, Linux/Windows/Mac x86-64):
docker run -p 3000:3000 openjev/engine

# laya-mlx (Apple Silicon):
docker run -p 3000:3000 -e BACKEND=laya-mlx openjev/engine

# Persist the model cache across restarts:
docker run -p 3000:3000 \\
  -v openjev-models:/root/.cache/openjev \\
  openjev/engine

# Point the SDK at your instance:
export OPENJEV_BASE_URL=http://localhost:3000`,
        },
      },
      {
        heading: "Environment variables reference",
        body: "The engine reads a small set of environment variables for backend selection, model path, concurrency, and authentication.",
        bullets: [
          "BACKEND: laya-onnx | laya-mlx | native | any-llm (default: laya-onnx).",
          "MODEL_PATH: local path to a custom ONNX model file.",
          "MAX_CONCURRENCY: max parallel requests (default: number of CPU cores).",
          "API_KEY: if set, the engine requires this key in the Authorization header.",
          "LOG_LEVEL: debug | info | warn | error (default: info).",
        ],
      },
      {
        heading: "Production checklist",
        body: "Before routing production traffic to a self-hosted engine, work through the following. The engine is stateless, so horizontal scaling is straightforward: add replicas behind a load balancer and let the SDK retry on 503.",
        code: {
          lang: "bash",
          code: `# 1. Pin a specific image version — never use :latest in production.
docker pull openjev/engine:1.2.0

# 2. Set an API key and pass it from the SDK:
export OPENJEV_API_KEY=your-secret-key
# In the container: -e API_KEY=your-secret-key

# 3. Health-check endpoint:
curl http://localhost:3000/health
# {"status":"ok","backend":"laya-onnx","model":"default"}

# 4. Run the smoke test:
curl -X POST http://localhost:3000/api/v1/systemone \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer your-secret-key" \\
  -d '{"state":{"text":"charge my card twice"},"questions":{"c":{"type":"choice","instructions":"Intent of \`text\`?","options":{"billing":"Billing issue.","support":"Product issue."}}}}'`,
        },
      },
    ],
    faq: [
      {
        q: "Can I run the engine without Docker?",
        a: "Yes. Install the @openjev/engine npm package and run `npx openjev-engine` for the native scorer, or follow the laya-onnx setup guide in the repo for a direct process.",
      },
      {
        q: "How much RAM does the default model need?",
        a: "The default laya-onnx model needs about 400MB of RAM. Larger models for higher accuracy are available; see the model registry in the documentation.",
      },
      {
        q: "Is the self-hosted engine wire-compatible with the upstream System One v1 API?",
        a: "Yes. The request and response payload is identical. Change OPENJEV_BASE_URL to switch between self-hosted and hosted; no other code changes are needed.",
      },
      {
        q: "How do I upgrade the model without downtime?",
        a: "Run two containers side by side — old version on port 3000, new version on port 3001 — validate the new container with your smoke tests, then update the load balancer to shift traffic. Both containers are stateless, so there is no migration step.",
      },
    ],
  },

  // ── 7 ────────────────────────────────────────────────────────────────────
  {
    slug: "migrating-from-jev-to-openjev",
    title: "Migrating from the hosted cloud to OpenJev: a field guide",
    excerpt:
      "OpenJev is the open-source, wire-compatible implementation of the System One v1 API. Here is exactly what changes and what does not when you move your self-hosted deployment.",
    keywords: [
      "migrate jev to openjev",
      "typesafe jev alternative",
      "openjev jev compatible",
      "self hosted jev",
      "typesafe api migration",
    ],
    date: "2026-05-19",
    readingMinutes: 8,
    intro:
      "If you are running the upstream hosted service and want to move to a self-hosted, open-source setup, OpenJev is wire-compatible — the same @caelum/typesafe SDK, the same POST /api/v1/systemone payload, the same response shape. This guide covers what changes, what does not, and how to validate the migration.",
    sections: [
      {
        heading: "What wire-compatible means in practice",
        body: "The System One v1 protocol specifies the request shape (state, questions with type/instructions/options), the response shape (answers keyed by question name, each carrying the typed value and confidence), and the five question types. OpenJev implements this protocol completely, so the @caelum/typesafe SDK sends the same bytes whether it is pointed at the upstream endpoint or your self-hosted engine. The migration is a URL change.",
        code: {
          lang: "ts",
          code: `// Before: upstream hosted endpoint.
const client = createClient({ baseUrl: "http://localhost:3000" });

// After: self-hosted OpenJev engine.
const client = createClient({ baseUrl: process.env.OPENJEV_BASE_URL });
// OPENJEV_BASE_URL=http://your-engine:3000

// The rest of the application code is identical.
const { answers } = await client.systemOne({ state, questions });`,
        },
      },
      {
        heading: "Authentication differences",
        body: "The upstream hosted service uses API keys in the Authorization header — and so does self-hosted OpenJev when you set the API_KEY environment variable. If you are running in a private network where the engine is not internet-accessible, you can omit the key and rely on network-level security. The SDK's apiKey option maps directly to the Authorization header, so the migration is a key rotation, not a code change.",
      },
      {
        heading: "Model and accuracy differences",
        body: "The hosted service uses a larger, more accurate model than the default shipped with OpenJev's Docker image. If your workflow depends on the hosted model's accuracy, download the extended model from the model registry and set MODEL_PATH. Alternatively, configure the any-llm backend to route through a hosted model on your existing LLM provider — you get OpenJev's typed-decision protocol with the model of your choice.",
        bullets: [
          "Default image: compact model, fastest, slightly lower accuracy.",
          "Extended model: download separately, matches hosted accuracy.",
          "any-llm backend: uses your LLM provider, matches hosted model quality.",
        ],
      },
      {
        heading: "Validation checklist",
        body: "Run the following after pointing the SDK at your self-hosted engine to confirm the migration is correct.",
        code: {
          lang: "ts",
          code: `// Smoke test: run a known input and compare the answer to the expected label.
const KNOWN: Array<{ state: Record<string, string>; expected: string }> = [
  { state: { ticket: "I was charged twice for my order" }, expected: "refund" },
  { state: { ticket: "Can I change my seat?" }, expected: "rebooking" },
  { state: { ticket: "What is the baggage allowance?" }, expected: "info" },
];

let pass = 0;
for (const { state, expected } of KNOWN) {
  const { answers } = await client.systemOne({
    state,
    questions: {
      category: choice("Category of \`ticket\`?", {
        refund: "Wants money returned.",
        rebooking: "Wants to change a booking.",
        info: "Asking for information.",
      }),
    },
  });
  if (answers.category.choice === expected) pass++;
}
console.log(\`Smoke test: \${pass}/\${KNOWN.length} correct\`);
// Expect 3/3. Any failure indicates a model or configuration issue.`,
        },
      },
    ],
    faq: [
      {
        q: "Does OpenJev support all five question types from the wire spec?",
        a: "Yes: choice, score, noul, and the two lower-level types (scalar and distribution) are all implemented. The three high-level primitives (choice, score, noul) are the idiomatic API; the lower-level types exist for custom integrations.",
      },
      {
        q: "Will my accuracy drop after migration?",
        a: "With the default compact model, yes by a small margin. Use the extended model or the any-llm backend pointed at your current LLM provider to match hosted accuracy. Apply a confidence gate if you are not already — that collapses the effective accuracy gap on the auto-acted subset.",
      },
      {
        q: "Is there a migration tool?",
        a: "The migration is a single environment variable change. There is no data to migrate because the engine is stateless — it does not store your inputs or outputs.",
      },
    ],
  },

  // ── 8 ────────────────────────────────────────────────────────────────────
  {
    slug: "how-to-choose-a-backend",
    title: "How to choose an OpenJev backend for your use case",
    excerpt:
      "Five backends, one API. This decision guide maps each backend to the production scenarios where it wins — local latency, cost, data sovereignty, accuracy, and ease of setup.",
    keywords: [
      "openjev backend comparison",
      "laya onnx vs laya mlx",
      "local llm backend",
      "any llm backend",
      "native scorer openjev",
    ],
    date: "2026-06-09",
    readingMinutes: 9,
    intro:
      "OpenJev has five interchangeable backends behind the same POST /api/v1/systemone API. They differ on model size, hardware requirements, cost, and accuracy. This guide is a decision tree: answer four questions about your deployment and the right backend falls out.",
    sections: [
      {
        heading: "The five backends at a glance",
        body: "Every backend accepts the same request and returns the same response shape. The differences are all in the runtime: how the probability is computed, how fast, on what hardware, and at what cost.",
        bullets: [
          "laya-onnx: ONNX runtime on CPU. Best general-purpose local backend for Linux/Windows/x86-64 Mac.",
          "laya-mlx: Apple MLX on M-series chips. Fastest option on Mac; requires macOS + Apple Silicon.",
          "native: compact pure-TS scorer. No model download, highest throughput, slightly lower accuracy.",
          "local: bring-your-own ONNX/MLX model file. Full control over model quality and size.",
          "any-llm: routes through a hosted LLM (OpenAI, Anthropic, etc.). Use for prototyping or when model quality is paramount.",
        ],
      },
      {
        heading: "Decision tree",
        body: "Answer these four questions in order. Each answer narrows the field.",
        bullets: [
          "1. Do you need the highest possible accuracy and do not want to manage a local model? → any-llm backend.",
          "2. Are you on Apple Silicon (M1/M2/M3/M4)? → laya-mlx.",
          "3. Is throughput the top priority and can you tolerate slightly lower accuracy? → native scorer.",
          "4. Everything else: Linux server, Docker, x86-64 Mac → laya-onnx.",
        ],
      },
      {
        heading: "The any-llm backend for prototyping",
        body: "The any-llm backend passes the typed decision request to a hosted model. It is the fastest path to a working demo: no Docker, no model download, no hardware selection. The tradeoff is per-call cost and latency from the hosted API. Set it up with an environment variable pointing at your existing OpenAI or Anthropic endpoint and move to a local backend when you are ready to scale.",
        code: {
          lang: "bash",
          code: `# Route through OpenAI via the any-llm backend:
docker run -p 3000:3000 \\
  -e BACKEND=any-llm \\
  -e ANYllm_BASE_URL=https://api.openai.com/v1 \\
  -e ANYLLM_API_KEY=$OPENAI_API_KEY \\
  -e ANYLLM_MODEL=gpt-4o-mini \\
  openjev/engine`,
        },
      },
      {
        heading: "Choosing between laya-onnx and laya-mlx",
        body: "If you have Apple Silicon, laya-mlx is the right choice: it runs the decision model on Apple's MLX framework, which is built for M-series hardware (we have not yet published a measured laya-mlx vs laya-onnx comparison). If you are on a Linux server or an x86-64 Mac, laya-onnx is the right choice: it uses the ONNX runtime, is well-tested across CPU architectures, and has predictable performance. Both backends use the same model files, so you can switch by changing the BACKEND environment variable.",
        code: {
          lang: "ts",
          code: `// The backend selection is invisible to application code.
// Same request, same response, different BACKEND env var.
const { answers } = await client.systemOne({
  state: { text },
  questions: {
    intent: choice("Intent of \`text\`?", {
      complaint: "Reporting a problem.",
      inquiry:   "Asking for information.",
      praise:    "Positive feedback.",
    }),
  },
});
// answers.intent.choice, answers.intent.confidence — identical across all backends.`,
        },
      },
      {
        heading: "Backend switching in production",
        body: "Because the API contract is identical across backends, you can switch without changing application code — just change the OPENJEV_BASE_URL or the BACKEND environment variable. A common pattern is to run the any-llm backend in staging (where per-call cost is acceptable and model quality is easy to evaluate) and laya-onnx or laya-mlx in production (where latency and cost matter). The confidence values are over the same closed answer set, but each backend's calibration differs, so re-check thresholds (and ECE) on your own labels when you switch.",
      },
    ],
    faq: [
      {
        q: "Can I mix backends across environments?",
        a: "Yes. The confidence is computed by each backend independently over the same closed answer set, so the gating code carries over unchanged — but calibration and accuracy differ between backends (see /leaderboard), so re-validate thresholds with an eval run on your own labels before reusing them.",
      },
      {
        q: "Is laya-mlx available on Linux?",
        a: "No. MLX is an Apple framework that requires macOS and Apple Silicon. On Linux, use laya-onnx.",
      },
      {
        q: "How do I pick a model size for laya-onnx?",
        a: "Start with the default model (400MB, fast, good accuracy). If accuracy is insufficient after applying a confidence gate, download the extended model (~2GB). For embedded or edge deployments, the nano model (~80MB) is available.",
      },
      {
        q: "What does the native scorer trade off for speed?",
        a: "The lexical scorer has no neural runtime, so it is fast (" + ML.lexical1 + " per single-question decision; " + ML.source + ") but much less accurate on open free text: see the public-dataset leaderboard at /leaderboard for the measured gap. Use it for templated or structural inputs, and gate on confidence.",
      },
    ],
  },
];

/** Look up a post by its slug. Returns undefined for unknown slugs. */
export function postBySlug(slug: string): BlogPost | undefined {
  return POSTS.find((p) => p.slug === slug);
}

export const POST_SLUGS: readonly string[] = POSTS.map((p) => p.slug);
