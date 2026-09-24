/**
 * GUIDES — the content behind /guides and /guides/$slug.
 *
 * These are long-form, search-intent guides for the typed-decision / structured-
 * output category: what a typed LLM decision is, how calibrated confidence works,
 * closed-set choice vs free text, migrating off JSON mode, cheap deterministic
 * classification, one deep guide per primitive (Choice / Score / Noul), and one
 * per role (agents / backends / data teams).
 *
 * Data only — no JSX. Both the hub grid and the dynamic page render from this one
 * source of truth so a slug cannot exist without substantive, unique content:
 * every guide carries an intro, key takeaways, multiple body sections (several
 * with real code), an optional side-by-side table, and its own FAQ.
 *
 * Everything here is accurate to the product: the Choice / Score / Noul
 * primitives, calibrated confidence + full distributions, the five backends
 * (laya-mlx, laya-onnx, native, local, any-LLM), the @caelum/typesafe client
 * SDK, and the single POST /api/v1/systemone endpoint.
 */

import { TRUST_GUIDES } from "./guides-trust";
import type { ProofPath } from "./proof-links";

export type GuideKind = "concept" | "trust" | "migration" | "primitive" | "role";

export interface GuideSection {
  readonly heading: string;
  readonly body: string;
  /** Optional bullet list rendered under the body. */
  readonly bullets?: readonly string[];
  /** Optional code block. */
  readonly code?: { readonly lang?: string; readonly code: string };
}

export interface GuideFAQ {
  readonly q: string;
  readonly a: string;
}

export interface GuideTableRow {
  readonly label: string;
  readonly a: string;
  readonly b: string;
}

export interface GuideTable {
  readonly caption: string;
  readonly colA: string;
  readonly colB: string;
  readonly rows: readonly GuideTableRow[];
}

export type GuideRelated =
  | {
      readonly kind: "guide" | "compare" | "use-case" | "doc";
      readonly slug: string;
      readonly label: string;
    }
  | {
      /** An in-app page such as /leaderboard; `slug` is the path. */
      readonly kind: "page";
      readonly slug: ProofPath;
      readonly label: string;
    };

export interface Guide {
  /** URL slug — /guides/$slug */
  readonly slug: string;
  /** H1 / page title. */
  readonly title: string;
  /** Short label for cards and nav. */
  readonly navLabel: string;
  readonly kind: GuideKind;
  /** Domain label shown mono-uppercase, e.g. "Concept". */
  readonly category: string;
  /** ~150-char meta description. */
  readonly description: string;
  /** Target search keywords for JSON-LD + internal relevance. */
  readonly keywords: readonly string[];
  /** 2–3 sentence intro under the H1. */
  readonly intro: string;
  /** Scannable key takeaways for the TL;DR block. */
  readonly takeaways: readonly string[];
  /** The substantive body. */
  readonly sections: readonly GuideSection[];
  /** Optional comparison table. */
  readonly table?: GuideTable;
  /** Page-specific FAQ (drives FAQPage JSON-LD). */
  readonly faqs: readonly GuideFAQ[];
  /** Curated cross-links. */
  readonly related: readonly GuideRelated[];
  /** ISO date for Article dateModified. */
  readonly updated: string;
}

const UPDATED = "2026-09-23";

export const GUIDES: readonly Guide[] = [
  // ── Concept ──────────────────────────────────────────────────────────────
  {
    slug: "typed-llm-decisions",
    title: "Typed LLM decisions: structured judgments instead of text",
    navLabel: "Typed LLM decisions",
    kind: "concept",
    category: "Concept",
    description:
      "What a typed LLM decision is, why it beats prompt-and-parse for classification and gating, and how Choice, Score, and Noul return a value your code can branch on.",
    keywords: [
      "typed llm decisions",
      "structured output llm",
      "llm classification",
      "typed decision",
      "system one",
    ],
    intro:
      "A typed decision is what you actually wanted when you reached for an LLM to classify, rate, or gate something: not a paragraph you have to parse, but a value of a known type with a confidence attached. OpenJev makes that value the primitive. You declare the answer space up front; the model fills it and hands back a probability distribution your code can act on.",
    takeaways: [
      "A typed decision returns a value of a declared type — a labelled Choice, a Score level, or a Noul probability — never free-form prose.",
      "Because the answer space is closed, the output is valid by construction: no regex, no JSON.parse, no retry-until-it-parses loop.",
      "Every decision carries a calibrated confidence and the full distribution, so you can route on certainty, not just read a guess.",
      "One POST carries a shared state plus many typed questions, so a checklist is one call, not one call per question.",
    ],
    sections: [
      {
        heading: "The problem with prompt-and-parse",
        body: "The default way to get a decision out of an LLM is to ask in prose and parse the reply. It works until it doesn't: the model answers \"Yes.\" one call and \"Probably a refund request\" the next, an enum drifts to a label you never defined, and the confidence you printed was a number the model made up. You end up writing defensive parsing around a generative system whose job was never to be parseable.",
      },
      {
        heading: "Declare the answer space, get a typed value",
        body: "A typed decision inverts the contract. Instead of hoping prose is parseable, you enumerate the outcomes and the model returns one of them. A Choice is one label from a closed set; a Score is one level on a rubric; a Noul is a calibrated yes/no probability. The response is already the shape your code needs.",
        code: {
          lang: "ts",
          code: `import { choice, noul, score } from "@caelum/typesafe";

const { answers } = await client.systemOne({
  state: { ticket },
  questions: {
    category: choice("Main request in \\\`ticket\\\`?", {
      refund: "Wants money returned.",
      rebooking: "Wants a replacement flight.",
      info: "Asking for information only.",
    }),
    severity: score("How urgent is \\\`ticket\\\`?", 0, 5),
    is_angry: noul("Does \\\`ticket\\\` express anger?"),
  },
});

// Typed, valid, ready to branch on:
route(answers.category.choice);       // "refund" | "rebooking" | "info"
if (answers.severity.score >= 4) page();
if (answers.is_angry.noul > 0.7) softenTone();`,
        },
      },
      {
        heading: "Why confidence changes the control flow",
        body: "A point answer forces a binary: act on it or don't. A calibrated confidence gives you a third option — escalate the uncertain ones. That single affordance is what turns an LLM classifier from a demo into something you can put in front of real traffic: act on the confident majority, route the borderline minority to a human, and keep the false-positive rate where you need it.",
        bullets: [
          "confidence ≥ high threshold → act automatically",
          "confidence in the middle band → confirm or ask a follow-up",
          "confidence < low threshold → escalate to a human",
        ],
      },
      {
        heading: "It is not a writer, and that is the point",
        body: "openjev never generates text. If you need a written reply, a summary, or a chain of reasoning, use a generative model — that is exactly what it is for. Typed decisions are the narrow, high-volume steps: which bucket, how severe, is-this-allowed. Keeping those steps typed makes them cheap, stable, and testable, and leaves generation for the places that actually need prose.",
      },
    ],
    table: {
      caption: "Prompt-and-parse vs a typed decision",
      colA: "Prompt-and-parse",
      colB: "Typed decision",
      rows: [
        { label: "Output", a: "Free-form text you parse", b: "A value of a declared type" },
        { label: "Validity", a: "Hope it parses; retry on failure", b: "Valid by construction" },
        { label: "Confidence", a: "None, or a self-reported guess", b: "Calibrated, plus full distribution" },
        { label: "Repeatability", a: "Varies run to run", b: "Deterministic per state + questions" },
        { label: "Cost at volume", a: "Prompt + generated tokens", b: "Near-zero output tokens locally" },
      ],
    },
    faqs: [
      {
        q: "Is a typed decision just JSON mode with a schema?",
        a: "No. JSON mode guarantees the brackets parse and the field is present; it does not make the value calibrated. A typed decision returns a probability distribution over a closed set and a confidence you can threshold, not a single sampled token that merely happens to be valid.",
      },
      {
        q: "Can I get several decisions in one request?",
        a: "Yes. You attach a map of typed questions to one shared state and send a single POST /api/v1/systemone. Each question is evaluated independently against the state, so a 13-item checklist is one call, not thirteen.",
      },
      {
        q: "Do I need a specific model?",
        a: "No. The same request runs on all five backends — laya-mlx, laya-onnx, the native scorer, a local server, or any hosted LLM — because the primitive is the contract, not the model.",
      },
    ],
    related: [
      { kind: "guide", slug: "confidence-calibration", label: "How calibrated confidence works" },
      { kind: "guide", slug: "closed-set-choice-vs-free-text", label: "Closed-set choice vs free text" },
      { kind: "compare", slug: "vs-raw-llm", label: "vs a raw LLM prompt" },
      { kind: "doc", slug: "primitives", label: "The three primitives" },
    ],
    updated: UPDATED,
  },
  {
    slug: "confidence-calibration",
    title: "Confidence calibration for LLM outputs, explained",
    navLabel: "Confidence calibration",
    kind: "concept",
    category: "Concept",
    description:
      "What calibrated confidence means, why an LLM's self-reported certainty is not it, and how to gate actions on a probability you can actually trust.",
    keywords: [
      "confidence calibration",
      "llm confidence",
      "calibrated probability",
      "model confidence threshold",
      "uncertainty estimation",
    ],
    intro:
      "Calibration is the property that when a system says \"0.8\", it is right about 80% of the time across all the cases it labelled 0.8. Most LLM confidence numbers do not have it: ask a model how sure it is and you get a fluent number that tracks tone, not truth. OpenJev returns a confidence you can put a threshold on, which is the whole reason a threshold is worth setting.",
    takeaways: [
      "Calibrated means the number matches reality: among all 0.7 answers, roughly 70% are correct.",
      "A model asked to self-report certainty gives an uncalibrated number — it reflects fluency, not correctness.",
      "Calibrated confidence lets you pick an operating point: trade coverage for precision by moving one threshold.",
      "Because OpenJev returns the full distribution, you also see the runner-up, which is where most real ambiguity lives.",
    ],
    sections: [
      {
        heading: "Calibration vs accuracy",
        body: "Accuracy asks how often the top answer is right. Calibration asks whether the confidence attached to each answer is honest. A model can be accurate but wildly overconfident — right 70% of the time while claiming 0.99 everywhere — and that overconfidence is what makes a naive threshold useless. You threshold to separate the cases you should act on from the cases you should escalate; that only works if the number means what it says.",
      },
      {
        heading: "Why 'rate your confidence 1–10' fails",
        body: "Prompting a generative model for a self-reported confidence produces a token, not a measurement. It correlates with how confident the answer sounds, drifts with phrasing, and clusters at round numbers. It is not grounded in the probability of being correct, so a 0.9 from one prompt and a 0.9 from another are not comparable — and comparability is exactly what a threshold needs.",
        code: {
          lang: "ts",
          code: `// Anti-pattern: ask the model to grade its own certainty.
const res = await llm.chat({ messages: [{ role: "user", content:
  "Classify this ticket and rate your confidence 0-1.\\n" + ticket }] });
// "category: refund, confidence: 0.95" — a fluent number, not a calibrated one.`,
        },
      },
      {
        heading: "Gating on a threshold you can trust",
        body: "With a calibrated confidence, choosing an operating point is a product decision, not a guess. Set the bar where the cost of a mistake justifies it: high for irreversible actions, lower for cheap-to-undo ones. The distribution tells you the rest — a 0.55/0.45 split between two labels is genuine ambiguity you should route to a person, not a coin you should flip.",
        code: {
          lang: "ts",
          code: `const c = answers.category; // { choice, probabilities, confidence }

if (c.confidence >= 0.85) {
  autoResolve(c.choice);            // precision-first: only the sure ones
} else if (c.confidence >= 0.5) {
  askOneClarifyingQuestion(c);      // borderline: gather more state
} else {
  escalateToHuman(c.probabilities); // show the top-2 to the reviewer
}`,
        },
      },
      {
        heading: "Confidence is a dial, not a verdict",
        body: "The same decision can power a fully-automated flow and a human-in-the-loop flow — you just move the threshold. Start conservative, watch the escalation rate and the error rate on what you auto-resolved, then lower the bar as you gain trust. Because the judgment is deterministic per input, that tuning is reproducible: the same ticket lands the same way tomorrow.",
      },
    ],
    faqs: [
      {
        q: "How is openjev's confidence different from an LLM's self-reported score?",
        a: "The self-reported score is generated text — it tracks how confident the answer sounds. openjev's confidence comes from the decision engine's probability over the closed answer set, so it is comparable across calls and meaningful to threshold.",
      },
      {
        q: "What threshold should I start with?",
        a: "It depends on the cost of a wrong action. A common starting point is auto-act at 0.85, confirm between 0.5 and 0.85, and escalate below 0.5 — then adjust from the observed error and escalation rates.",
      },
      {
        q: "Do I get more than the top answer's confidence?",
        a: "Yes. Every Choice and Score returns the full probability distribution, so you can inspect the runner-up and its mass. Most real ambiguity shows up as a close top-two split.",
      },
    ],
    related: [
      { kind: "guide", slug: "typed-llm-decisions", label: "What a typed decision is" },
      { kind: "guide", slug: "noul-primitive", label: "Noul: calibrated yes/no" },
      { kind: "compare", slug: "vs-json-mode", label: "vs JSON mode" },
      { kind: "use-case", slug: "content-moderation", label: "Content moderation pattern" },
    ],
    updated: UPDATED,
  },
  {
    slug: "closed-set-choice-vs-free-text",
    title: "Closed-set choice vs free text: when to constrain the answer",
    navLabel: "Closed-set vs free text",
    kind: "concept",
    category: "Concept",
    description:
      "When to enumerate the answer space and get a closed-set Choice, and when a decision genuinely needs open-ended extraction or generated text instead.",
    keywords: [
      "closed set classification",
      "constrained decoding",
      "enum llm output",
      "free text vs classification",
      "controlled vocabulary",
    ],
    intro:
      "A surprising number of \"we need an LLM to write something\" tasks are really \"we need it to pick one of these\". Deciding which is which is the highest-leverage design call in an AI feature. Closed-set choice buys you validity, calibration, cost, and stability; open text buys you flexibility you sometimes actually need. This guide is the decision procedure.",
    takeaways: [
      "If you can enumerate the outcomes, a closed-set Choice is almost always the better primitive.",
      "Closed sets give validity, a distribution, and calibrated confidence — none of which free text gives you for free.",
      "Free text earns its place when the output is genuinely open: names, amounts, summaries, replies, reasoning.",
      "You can mix both: extract open values with a generative step, then decide over a closed set with openjev.",
    ],
    sections: [
      {
        heading: "The test: can you write the options down?",
        body: "The question that settles it: could you list every acceptable answer ahead of time? Refund / rebooking / info — yes, that is a closed set. The customer's name or the invoice total — no, those are extracted values from an open space. Severity on a 0–5 rubric — closed. A one-paragraph apology — open. If you can write the options down, constrain to them; the model's job becomes ranking a known set, which it does far more reliably than inventing and formatting one.",
      },
      {
        heading: "What a closed set buys you",
        body: "Constraining the answer space is not just tidier — it changes the guarantees. The output is valid by construction, so there is nothing to parse and no retry loop. You get a probability over the options, so you know the runner-up. You get a calibrated confidence, so you can gate. And because there is nothing to generate, local backends answer in milliseconds at near-zero token cost.",
        code: {
          lang: "ts",
          code: `import { choice } from "@caelum/typesafe";

// Closed set: the model ranks a known vocabulary, honoring exclusions.
const { answers } = await client.systemOne({
  state: { email },
  questions: {
    intent: choice("What does \\\`email\\\` want?", {
      sales: "Interested in buying or pricing.",
      support: "Has a problem with an existing account.",
      spam: "Unsolicited or irrelevant.",
      other: "None of the above.",
    }),
  },
});
const { choice: label, probabilities, confidence } = answers.intent;`,
        },
      },
      {
        heading: "When free text is the right call",
        body: "Do not force a closed set onto an open problem. If the value is content — the actual reply to send, the fields to pull from a messy document, a summary, code, a chain of reasoning — you need generation, and a Choice cannot produce it. The failure mode of over-constraining is an \"other\" bucket that swallows everything and a feature that quietly can't do its job.",
      },
      {
        heading: "The hybrid: extract open, decide closed",
        body: "The strongest pipelines use both. Let a generative or extraction step pull the open values, then hand the structured result to OpenJev for the decisions — is this valid, which queue, how risky. You get the flexibility of generation where you need it and the calibration of a typed decision where it matters, instead of asking one prose call to do both and grading it by hand.",
      },
    ],
    table: {
      caption: "Which primitive fits the output",
      colA: "Closed-set decision (OpenJev)",
      colB: "Open text (generative LLM)",
      rows: [
        { label: "Output is one of a known list", a: "Yes — Choice / Score / Noul", b: "Overkill" },
        { label: "Output is invented content", a: "Cannot produce it", b: "Yes — this is its job" },
        { label: "Need a confidence to gate", a: "Built in", b: "Only self-reported" },
        { label: "Extract unknown fields", a: "Not the job", b: "Yes" },
        { label: "Runs at volume, cost-sensitive", a: "Near-zero output tokens", b: "Pays per generated token" },
      ],
    },
    faqs: [
      {
        q: "What if my set is almost closed but has an occasional novel case?",
        a: "Add an explicit \"other\" option and gate on confidence. Novel cases surface as low-confidence or high 'other' mass, which you route to a human — instead of the model silently inventing a label you never handle.",
      },
      {
        q: "How many options can a Choice have?",
        a: "A Choice supports 2–255 labels, and a Score supports 2–10 rubric levels. Each option can carry a short description and exclusions the decision honors.",
      },
      {
        q: "Can I combine extraction and decision in one call?",
        a: "Extraction of unknown values is a generative job, so run it as a separate step. Feed its structured output back as state to OpenJev for the closed-set decisions in the same request.",
      },
    ],
    related: [
      { kind: "guide", slug: "choice-primitive", label: "Choice, in depth" },
      { kind: "guide", slug: "typed-llm-decisions", label: "What a typed decision is" },
      { kind: "compare", slug: "vs-instructor", label: "vs Instructor / Pydantic parsing" },
      { kind: "use-case", slug: "data-extraction", label: "Extraction + decision pattern" },
    ],
    updated: UPDATED,
  },
  {
    slug: "cheap-deterministic-classification",
    title: "Cheap, deterministic classification without a generative call",
    navLabel: "Deterministic classification",
    kind: "concept",
    category: "Concept",
    description:
      "How to run high-volume text classification with near-zero output tokens and repeatable results — locally, without paying for a generative LLM per label.",
    keywords: [
      "cheap llm classification",
      "deterministic classification",
      "local llm classifier",
      "low latency classification",
      "zero output tokens",
    ],
    intro:
      "Classification is the most common LLM step and the worst one to run as a generative call: you pay for output tokens to produce a single label, you eat network latency per item, and the result drifts run to run. A typed decision removes all three problems. The answer set is closed, the output is a few tokens, and the same input gives the same label — which means it can run locally, in a loop, at volume.",
    takeaways: [
      "A generative classifier pays for prompt + generated tokens to emit one word; a typed decision emits near-zero output tokens.",
      "Determinism per input makes classification testable and cacheable — the same item lands the same way every time.",
      "Local backends (laya-onnx on CPU, laya-mlx on Apple silicon, or the native scorer) answer in milliseconds with no per-call bill.",
      "Batching many questions over one state amortizes the state read across a whole checklist.",
    ],
    sections: [
      {
        heading: "Where the cost actually goes",
        body: "For a classifier, the generated output is a single label — but a generative model still runs the full decode to produce it, and you pay for those tokens plus the round trip. Multiply by volume and the bill and the latency are dominated by machinery you did not need. A typed decision skips generation entirely: it scores the closed set and returns the winner, so the marginal cost of a classification collapses toward zero on a local backend.",
      },
      {
        heading: "Determinism makes it testable",
        body: "A classifier you cannot test is a liability. Because a typed decision is deterministic for a given state and questions, you can write golden tests, cache by input hash, and reason about regressions the same way you would for any pure function. Temperature-0 on a generative model mitigates variance but does not give you this — you still get shifts across versions and prompt tweaks.",
        code: {
          lang: "ts",
          code: `// Same input → same label, so this is a real unit test, not a flaky one.
const label = (await classify(msg)).answers.topic.choice;
assert.equal(label, "billing");

// And it caches cleanly by input:
const key = hash(msg);
const cached = cache.get(key) ?? cache.set(key, await classify(msg));`,
        },
      },
      {
        heading: "Run it locally, at volume",
        body: "Because there is no generation, classification can run on hardware you already have. laya-onnx runs on CPU and is the production default; laya-mlx is fastest on a Mac; the native scorer needs no model download at all. Point the SDK at a self-hosted endpoint and a million-item backfill becomes a local batch job instead of a metered API spend.",
        code: {
          lang: "bash",
          code: `# Self-host and classify a backfill locally — no per-call token bill.
docker run -p 3000:3000 openjev/engine
export OPENJEV_BASE_URL=http://localhost:3000`,
        },
      },
      {
        heading: "Batch the checklist, not the corpus",
        body: "The cheapest shape is many typed questions over one shared state in a single call. A moderation pass with a dozen policy checks reads the content once and evaluates every check against it, so the twelfth check costs a few tokens, not another request. That is the opposite of the prompt-per-question fan-out that makes generative classification expensive.",
      },
    ],
    faqs: [
      {
        q: "Is this as accurate as a big generative model classifying in prose?",
        a: "For closed-set classification, constraining to the answer set typically helps rather than hurts, because the model ranks known options instead of inventing and formatting one. You also get a calibrated confidence to catch the genuinely hard cases.",
      },
      {
        q: "How do I keep costs at zero for a large backfill?",
        a: "Self-host a local backend (laya-onnx or the native scorer) with Docker and point the SDK at it. There is no generation and no per-call fee, so the backfill runs as a local batch job.",
      },
      {
        q: "Can I cache results safely?",
        a: "Yes. Decisions are deterministic per state and questions, so caching by a hash of the input is sound — the same item will not silently reclassify on a re-run.",
      },
    ],
    related: [
      { kind: "guide", slug: "for-data-teams", label: "openjev for data teams" },
      { kind: "guide", slug: "choice-primitive", label: "Choice, in depth" },
      { kind: "compare", slug: "vs-raw-llm", label: "vs a raw LLM prompt" },
      { kind: "use-case", slug: "llm-routing", label: "Routing pattern" },
    ],
    updated: UPDATED,
  },
  // ── Migration ────────────────────────────────────────────────────────────
  {
    slug: "replace-llm-json-mode",
    title: "Replace LLM JSON mode for decision fields",
    navLabel: "Replace JSON mode",
    kind: "migration",
    category: "Migration",
    description:
      "A step-by-step guide to moving the decision fields — enums, ratings, booleans — off JSON mode and onto typed decisions with calibrated confidence.",
    keywords: [
      "replace json mode",
      "structured outputs alternative",
      "json schema llm enum",
      "openai structured outputs",
      "migrate json mode",
    ],
    intro:
      "JSON mode and structured outputs solved a real problem: the payload parses and matches your schema. But a schema constrains structure, not meaning — an enum field is still filled by ungrounded sampling with no probability behind it. This guide walks through moving just the decision fields to OpenJev, keeping JSON mode for the extraction fields where it shines.",
    takeaways: [
      "Keep JSON mode for extraction — names, amounts, nested objects. Move the decision fields — enums, ratings, booleans.",
      "A schema enum is a valid token with no confidence; a Choice is a distribution over the same set plus a confidence to gate on.",
      "The migration is field-by-field: you do not rip out your pipeline, you replace the fields that were secretly decisions.",
      "The payload is wire-compatible with the System One v1 API, so the same request runs self-hosted or hosted.",
    ],
    sections: [
      {
        heading: "Spot the fields that were decisions",
        body: "Open your JSON schema and mark every field that is really a judgment: an enum (category, priority, sentiment), a bounded rating, or a boolean flag. Those are the fields where a valid value is not the same as a correct or confident one. The extraction fields — strings, numbers, nested records pulled from the source — stay exactly where they are.",
        code: {
          lang: "ts",
          code: `// Before: one JSON-mode call does extraction AND decisions.
{
  customer_name: "string",   // extraction — keep in JSON mode
  invoice_total: "number",   // extraction — keep in JSON mode
  category: "enum(...)",      // DECISION — move to a Choice
  priority: "1..5",          // DECISION — move to a Score
  is_fraud: "boolean",       // DECISION — move to a Noul
}`,
        },
      },
      {
        heading: "Move the decisions to typed questions",
        body: "Replace each decision field with the matching primitive: enum → Choice, rating → Score, boolean → Noul. You now get a distribution and a confidence per field instead of a lone value, and the answers come back under the same keys, so downstream code barely changes.",
        code: {
          lang: "ts",
          code: `import { choice, score, noul } from "@caelum/typesafe";

const { answers } = await client.systemOne({
  state: { doc, customer_name, invoice_total },
  questions: {
    category: choice("Type of \\\`doc\\\`?", {
      invoice: "A bill for goods or services.",
      receipt: "Proof of a completed payment.",
      quote: "A price estimate, not yet owed.",
    }),
    priority: score("How urgent is \\\`doc\\\`?", 1, 5),
    is_fraud: noul("Does \\\`doc\\\` show signs of fraud?"),
  },
});

if (answers.is_fraud.noul > 0.6) hold();
else route(answers.category.choice, answers.priority.score);`,
        },
      },
      {
        heading: "Gate on confidence instead of trusting the value",
        body: "The payoff is the gate you could never write against a bare enum. Auto-act on the confident decisions, route the uncertain ones to review, and stop treating a syntactically valid value as a correct one. Keep the extraction call for the open fields and merge the results — the two steps compose cleanly.",
      },
      {
        heading: "Keep it compatible, ship incrementally",
        body: "The request is wire-compatible with the System One v1 API, so you can point it at a hosted endpoint today and a self-hosted one later without changing the payload. Migrate one high-value field first — the enum whose mistakes cost the most — measure the escalation and error rates, then move the rest.",
      },
    ],
    table: {
      caption: "JSON-mode field → OpenJev primitive",
      colA: "JSON-mode field",
      colB: "openjev primitive",
      rows: [
        { label: "enum category", a: "Valid token, no probability", b: "Choice — distribution + confidence" },
        { label: "1–5 rating", a: "A number in range", b: "Score — level + confidence" },
        { label: "boolean flag", a: "true / false, ungrounded", b: "Noul — calibrated P(yes)" },
        { label: "extracted string / number", a: "Keep in JSON mode", b: "Not the job" },
      ],
    },
    faqs: [
      {
        q: "Do I have to stop using structured outputs entirely?",
        a: "No — that is the point of a field-by-field migration. Keep JSON mode or structured outputs for extraction fields, and move only the decision fields (enums, ratings, booleans) to typed decisions with calibrated confidence.",
      },
      {
        q: "Will my downstream code need big changes?",
        a: "Minimal. Answers come back under the same keys you named, so you mostly swap 'read the value' for 'gate on confidence, then read the value'.",
      },
      {
        q: "Is the request format locked to one vendor?",
        a: "No. The payload is wire-compatible with the System One v1 API and runs on self-hosted OpenJev or any compatible hosted endpoint without changes.",
      },
    ],
    related: [
      { kind: "compare", slug: "vs-json-mode", label: "vs JSON mode (full comparison)" },
      { kind: "guide", slug: "typed-llm-decisions", label: "What a typed decision is" },
      { kind: "guide", slug: "confidence-calibration", label: "Calibrated confidence" },
      { kind: "doc", slug: "api-reference", label: "API reference" },
    ],
    updated: UPDATED,
  },
  // ── Primitives ───────────────────────────────────────────────────────────
  {
    slug: "choice-primitive",
    title: "Choice, in depth: closed-set classification done right",
    navLabel: "Choice primitive",
    kind: "primitive",
    category: "Primitive",
    description:
      "A deep guide to the Choice primitive — labelled options, exclusions, the probability distribution, and how to gate a classifier on calibrated confidence.",
    keywords: [
      "choice primitive",
      "llm classification",
      "closed set choice",
      "contrastive classification",
      "enum with confidence",
    ],
    intro:
      "Choice is the classifier primitive: you give it a question and a labelled set of options, and it returns one label, a probability distribution over the set, and a calibrated confidence. It is the right tool whenever the answer is one of a known list — intent, category, priority bucket, routing target.",
    takeaways: [
      "Choice takes 2–255 labelled options, each with a short description the decision reads.",
      "It returns the winning label, the full probability distribution, and a calibrated confidence.",
      "Options can declare exclusions (not_for) so the decision contrasts them correctly.",
      "Gate on confidence to separate the auto-act majority from the escalate-to-human minority.",
    ],
    sections: [
      {
        heading: "Anatomy of a Choice",
        body: "A Choice is a question plus a map of option keys to descriptions. The keys are your labels; the descriptions tell the decision what each option means, which is what makes the classification contrastive rather than a keyword match. The response carries the chosen key, a probability for every option, and a confidence.",
        code: {
          lang: "ts",
          code: `import { choice } from "@caelum/typesafe";

const { answers } = await client.systemOne({
  state: { message },
  questions: {
    intent: choice("What is the sender's intent in \\\`message\\\`?", {
      complaint: "Reporting a problem or expressing dissatisfaction.",
      question: "Asking for information or help.",
      praise: "Expressing satisfaction or thanks.",
      other: "None of the above.",
    }),
  },
});

const { choice: label, probabilities, confidence } = answers.intent;
// label: "complaint" | "question" | "praise" | "other"`,
        },
      },
      {
        heading: "Descriptions and exclusions do the work",
        body: "Two things make a Choice accurate: precise option descriptions and explicit exclusions. Describe each option by what distinguishes it from its neighbours, not just what it is. When two options are easy to confuse, an exclusion (\"not for X\") tells the decision to keep them apart, which sharpens the distribution instead of smearing mass across look-alikes.",
      },
      {
        heading: "Read the distribution, not just the winner",
        body: "The winning label is only half the answer. The distribution shows you the runner-up and its mass, which is where ambiguity lives: a 0.52/0.48 split between complaint and question is a genuinely mixed message, not a confident complaint. Surfacing the top two to a reviewer turns a hard classification into a fast human confirmation.",
        code: {
          lang: "ts",
          code: `const top2 = Object.entries(answers.intent.probabilities)
  .sort(([, a], [, b]) => b - a)
  .slice(0, 2);

if (answers.intent.confidence < 0.6) {
  reviewer.show(top2); // e.g. [["complaint", 0.52], ["question", 0.48]]
}`,
        },
      },
      {
        heading: "When not to use Choice",
        body: "Choice is for closed sets. If you cannot enumerate the options, or the answer is extracted content or generated text, it is the wrong primitive — reach for a generative or extraction step. If the answer is a graded intensity on a rubric, use Score; if it is a yes/no, use Noul.",
      },
    ],
    faqs: [
      {
        q: "How many options can a Choice have?",
        a: "Between 2 and 255. Each option is a key plus a short description, and options can declare exclusions so the decision contrasts easily-confused labels correctly.",
      },
      {
        q: "What does Choice return exactly?",
        a: "The winning label, a probability for every option (the full distribution), and a calibrated confidence you can threshold to auto-act, confirm, or escalate.",
      },
      {
        q: "Choice or Score for priority?",
        a: "If priority is a graded level on a rubric (P1..P5), use Score — it understands ordering. If it is a set of unordered buckets, use Choice.",
      },
    ],
    related: [
      { kind: "guide", slug: "score-primitive", label: "Score, in depth" },
      { kind: "guide", slug: "noul-primitive", label: "Noul, in depth" },
      { kind: "guide", slug: "closed-set-choice-vs-free-text", label: "Closed-set vs free text" },
      { kind: "doc", slug: "primitives", label: "Primitives reference" },
    ],
    updated: UPDATED,
  },
  {
    slug: "score-primitive",
    title: "Score, in depth: graded ratings on a rubric",
    navLabel: "Score primitive",
    kind: "primitive",
    category: "Primitive",
    description:
      "A deep guide to the Score primitive — ordered rubric levels, when to use a scale over a Choice, and how the distribution reveals borderline ratings.",
    keywords: [
      "score primitive",
      "llm rating",
      "rubric scoring",
      "ordinal classification",
      "severity scoring",
    ],
    intro:
      "Score is the rubric primitive: it returns one level on an ordered scale — severity 0–5, quality 1–4, risk 1–3 — with a calibrated confidence and a distribution over the levels. Use it when the answer is a graded intensity, where the order between levels carries meaning that an unordered Choice would throw away.",
    takeaways: [
      "Score returns one level on an ordered scale of 2–10 levels, plus a confidence and distribution.",
      "Ordering is the point: Score understands that 4 is closer to 5 than to 1.",
      "Define each level in your rubric so the boundaries are explicit, not implied.",
      "A distribution split across adjacent levels is a borderline case worth thresholding on.",
    ],
    sections: [
      {
        heading: "When a scale beats a set of labels",
        body: "Reach for Score when the outcomes have a natural order and the distance between them matters. Severity, urgency, quality, and risk are scales: a 4 and a 5 are neighbours, and a mistake between them is cheaper than a mistake between a 1 and a 5. A Choice treats its labels as unordered, so it cannot express that a rating is 'off by one' — Score can.",
        code: {
          lang: "ts",
          code: `import { score } from "@caelum/typesafe";

const { answers } = await client.systemOne({
  state: { incident },
  questions: {
    severity: score("Operational severity of \\\`incident\\\`?", 0, 5),
    customer_impact: score("Customer impact of \\\`incident\\\`?", 1, 4),
  },
});

if (answers.severity.score >= 4) page(); // scale semantics: high = worse`,
        },
      },
      {
        heading: "Write the rubric into the question",
        body: "A bare 0–5 scale is ambiguous; a rubric is not. Anchor the ends and the meaningful middle so the levels mean the same thing every run: what makes something a 5 versus a 4, and where the actionable boundary sits. The clearer the rubric, the tighter the distribution and the more useful the confidence.",
      },
      {
        heading: "Borderline levels live in the distribution",
        body: "As with Choice, the distribution is where the nuance is — but for Score it is ordinal. Mass split between two adjacent levels (say 3 and 4) is a borderline rating near a threshold, exactly the case to route for a second look if the level controls an expensive action like paging or auto-refunding.",
        code: {
          lang: "ts",
          code: `const s = answers.severity; // { score, probabilities, confidence }
const nearThreshold = s.score === 3 && (s.probabilities[4] ?? 0) > 0.3;
if (nearThreshold && s.confidence < 0.7) escalate(s);`,
        },
      },
      {
        heading: "Score vs Choice vs Noul",
        body: "Ordered levels → Score. Unordered categories → Choice. A single yes/no → Noul. Mixing them is normal: an incident triage might Score severity, Choice the owning team, and Noul whether it is customer-facing, all in one call over the same state.",
      },
    ],
    faqs: [
      {
        q: "How many levels can a Score have?",
        a: "Between 2 and 10. Define what each level means in the question so the boundaries are explicit and the rating is reproducible.",
      },
      {
        q: "Does Score understand that levels are ordered?",
        a: "Yes — that is the difference from Choice. Score treats the levels as an ordinal scale, so adjacent levels are 'close' and the distribution reflects near-misses.",
      },
      {
        q: "Can I threshold on a Score?",
        a: "Yes. Gate on the level (e.g. severity ≥ 4) and on the confidence, and inspect the distribution to catch ratings sitting right on a boundary.",
      },
    ],
    related: [
      { kind: "guide", slug: "choice-primitive", label: "Choice, in depth" },
      { kind: "guide", slug: "noul-primitive", label: "Noul, in depth" },
      { kind: "use-case", slug: "insurance-adjudication", label: "Adjudication pattern" },
      { kind: "doc", slug: "primitives", label: "Primitives reference" },
    ],
    updated: UPDATED,
  },
  {
    slug: "noul-primitive",
    title: "Noul, in depth: calibrated yes/no probabilities",
    navLabel: "Noul primitive",
    kind: "primitive",
    category: "Primitive",
    description:
      "A deep guide to the Noul primitive — a calibrated P(yes) for a single proposition, ideal for gates, guardrail checks, and boolean flags.",
    keywords: [
      "noul primitive",
      "calibrated yes no",
      "llm boolean",
      "probability gate",
      "llm guardrail check",
    ],
    intro:
      "Noul is the yes/no primitive: for a single proposition it returns a calibrated probability in [0,1], not a coin flip. It is the workhorse for gates and checks — does this leak PII, is this on-policy, is consent a lawful basis — where you want one number you can threshold, and dozens of them cheaply in one call.",
    takeaways: [
      "A Noul is a calibrated P(yes) for one proposition, in [0,1] — threshold it, don't read it as a hard boolean.",
      "It is the ideal primitive for guardrail checks and compliance items: cheap, calibrated, deterministic.",
      "Batch many Nouls over one state to turn a checklist into a single call.",
      "Because a Noul is deterministic, a check that passed will pass again on the same input.",
    ],
    sections: [
      {
        heading: "A probability, not a boolean",
        body: "A Noul answers one yes/no question with a probability. That is deliberately more than true/false: 0.94 and 0.51 are both 'yes' to a naive cast, but only one should trigger an irreversible action. Keep the number and threshold it where the cost of a mistake justifies the bar.",
        code: {
          lang: "ts",
          code: `import { noul } from "@caelum/typesafe";

const { answers } = await client.systemOne({
  state: { reply },
  questions: {
    leaks_pii: noul("Does \\\`reply\\\` contain personal data (email, phone, address)?"),
    on_policy: noul("Does \\\`reply\\\` follow the refund policy?"),
  },
});

if (answers.leaks_pii.noul > 0.3 || answers.on_policy.noul < 0.7) block();`,
        },
      },
      {
        heading: "The calibrated check inside a guardrail",
        body: "The common anti-pattern is a guardrail whose check is another prose LLM call — 'does this leak PII, yes or no' — which inherits sampling variance, costs a full generation, and gives no confidence. Replace it with a Noul: a cheap, deterministic, calibrated judgment your code thresholds. You keep your control loop; you swap the flaky check for a typed one.",
      },
      {
        heading: "Batch the checklist",
        body: "Nouls shine in bulk. A compliance review or a moderation policy is a list of yes/no propositions; attach them all to one state and send one request. Each Noul is evaluated independently against the shared state, so the tenth check costs a few tokens, not another round trip — the whole checklist becomes a pass/fail table.",
        code: {
          lang: "ts",
          code: `const checks = {
  defines_personal_data: noul("Does \\\`policy\\\` define personal data?"),
  states_lawful_basis: noul("Does \\\`policy\\\` state a lawful basis for processing?"),
  breach_72h: noul("Does \\\`policy\\\` state the 72-hour breach-notification duty?"),
};
const { answers } = await client.systemOne({ state: { policy }, questions: checks });
const table = Object.fromEntries(
  Object.entries(answers).map(([k, v]) => [k, v.noul >= 0.5]),
);`,
        },
      },
      {
        heading: "Noul vs a Choice with two options",
        body: "A yes/no Choice would work, but Noul is the honest shape for a single proposition: one probability instead of a two-way distribution, and a threshold that reads as 'how sure that it's yes'. Use Choice when there are genuinely several outcomes; use Noul when the question is one claim being true or false.",
      },
    ],
    faqs: [
      {
        q: "Why return a probability instead of a boolean?",
        a: "Because the right cutoff depends on the cost of a mistake. A probability lets you set the threshold per use — strict for irreversible actions, loose for cheap-to-undo ones — instead of baking one boundary into the model.",
      },
      {
        q: "Is a Noul calibrated?",
        a: "It is a probability, P(yes), and it is meant to be calibrated: a 0.7 should mean roughly a 70% chance the proposition holds, which is what makes thresholding meaningful. Check that on your own labels with an eval run (ECE), and fit a calibration if it drifts; public-dataset calibration numbers are on /leaderboard.",
      },
      {
        q: "How do I run a big checklist cheaply?",
        a: "Attach every yes/no proposition as a Noul to one shared state and send a single POST. Extra Nouls cost a few output tokens because the state is read once.",
      },
    ],
    related: [
      { kind: "guide", slug: "confidence-calibration", label: "Calibrated confidence" },
      { kind: "compare", slug: "vs-guardrails", label: "vs Guardrails frameworks" },
      { kind: "use-case", slug: "regulatory-briefing", label: "Compliance checklist pattern" },
      { kind: "doc", slug: "primitives", label: "Primitives reference" },
    ],
    updated: UPDATED,
  },
  // ── Roles ────────────────────────────────────────────────────────────────
  {
    slug: "for-agents",
    title: "openjev for AI agents: typed decisions in the loop",
    navLabel: "For agents",
    kind: "role",
    category: "For agents",
    description:
      "How to use typed decisions inside an agent loop — routing, tool selection, self-verification, and stop conditions — with calibrated confidence instead of brittle prose parsing.",
    keywords: [
      "ai agent routing",
      "agent tool selection",
      "typed decision agent",
      "agent self verification",
      "llm agent control flow",
    ],
    intro:
      "Agents fall over on the small decisions between tool calls: which branch to take, whether a step succeeded, when to stop. Doing those with prose the agent parses is where loops go rogue. OpenJev makes each of those a typed decision with a confidence, so the control flow is code branching on a distribution — not a planner talking to itself.",
    takeaways: [
      "Use Choice to route between tools or branches, Noul to verify a step, Score to rate progress.",
      "Gate transitions on confidence so the agent asks for help instead of guessing at low certainty.",
      "Typed decisions are deterministic, so the same state takes the same branch — reproducible agent runs.",
      "The decision call is cheap and generation-free, so it can sit on the hot path of every loop iteration.",
    ],
    sections: [
      {
        heading: "Route with a Choice, not a parsed plan",
        body: "The classic agent bug is parsing 'the model said to use the search tool' out of prose. Replace it with a Choice over your actual tool set: the agent gets back a tool key, a distribution, and a confidence. Low confidence means the router is unsure — a signal to ask a clarifying question rather than fire a tool blindly.",
        code: {
          lang: "ts",
          code: `import { choice } from "@caelum/typesafe";

const { answers } = await client.systemOne({
  state: { userGoal, availableTools, lastResult },
  questions: {
    next_tool: choice("Which tool best advances \\\`userGoal\\\` now?", {
      search: "Look up external information.",
      calculate: "Do arithmetic or data transforms.",
      respond: "Enough is known; answer the user.",
    }),
  },
});

if (answers.next_tool.confidence < 0.5) askClarifyingQuestion();
else invoke(answers.next_tool.choice);`,
        },
      },
      {
        heading: "Verify a step with a Noul",
        body: "After a tool runs, an agent needs to know if it worked before charging ahead. A Noul over the result — 'did this return what the step needed' — is a calibrated, deterministic check, unlike a second prose call grading the first. Thresholding it gives the loop an honest success signal and a retry condition.",
        code: {
          lang: "ts",
          code: `import { noul } from "@caelum/typesafe";

const check = await client.systemOne({
  state: { step, toolOutput },
  questions: { succeeded: noul("Did \\\`toolOutput\\\` satisfy \\\`step\\\`?") },
});
if (check.answers.succeeded.noul < 0.6) retryOrReplan();`,
        },
      },
      {
        heading: "Know when to stop",
        body: "The stop rule is a decision too. Score the progress toward the goal, or Noul whether the goal is met, and end the loop on a confident yes. That replaces the two failure modes of hand-tuned agents — stopping early on a bad prose read, or looping forever — with a typed, thresholded condition you can test.",
      },
      {
        heading: "Why deterministic decisions matter in a loop",
        body: "A loop that branches on a stochastic read is unreproducible and hard to debug. Because typed decisions are deterministic per state, an agent run replays the same way, so you can write regression tests over whole trajectories and reason about why a branch was taken. The decision call is generation-free and cheap, so putting it on every iteration does not blow up latency or spend.",
      },
    ],
    faqs: [
      {
        q: "Does this replace my agent framework?",
        a: "No. OpenJev is the decision primitive inside the loop — routing, verification, stop conditions — not the orchestrator. You keep your framework and swap prose-parsing control points for typed decisions.",
      },
      {
        q: "How do I stop an agent from looping forever?",
        a: "Make the stop rule a typed decision: Noul whether the goal is met or Score the progress, and end on a confident yes. Because it is deterministic, the condition is testable across runs.",
      },
      {
        q: "Is a decision call fast enough for every iteration?",
        a: "Yes. There is no generation, so on a local backend a decision answers in milliseconds at near-zero token cost — cheap enough to sit on the hot path.",
      },
    ],
    related: [
      { kind: "guide", slug: "for-backends", label: "openjev for backends" },
      { kind: "guide", slug: "noul-primitive", label: "Noul for verification" },
      { kind: "use-case", slug: "function-calling", label: "Tool selection pattern" },
      { kind: "use-case", slug: "llm-routing", label: "Routing pattern" },
    ],
    updated: UPDATED,
  },
  {
    slug: "for-backends",
    title: "openjev for backend engineers: decisions as a typed call",
    navLabel: "For backends",
    kind: "role",
    category: "For backends",
    description:
      "How backend engineers add LLM decisions to services without the prose-parsing tax — typed responses, deterministic behavior, self-hosting, and clean testing.",
    keywords: [
      "llm in backend",
      "structured llm api",
      "self hosted llm decision",
      "deterministic llm service",
      "typed api response",
    ],
    intro:
      "Backend code wants a typed value and a testable function, not a paragraph to parse and a flaky integration test. OpenJev fits the way services are already built: one HTTP call in, a typed decision out, deterministic per input, and self-hostable so the decision path has no third-party dependency you cannot control.",
    takeaways: [
      "One POST returns typed answers under the keys you named — no parsing layer, no retry-until-valid loop.",
      "Deterministic per input means real unit tests and safe caching by input hash.",
      "Self-host with Docker so the decision path stays inside your infra and compliance boundary.",
      "The wire-compatible payload means you can start hosted and move self-hosted without code changes.",
    ],
    sections: [
      {
        heading: "A decision is just an HTTP call",
        body: "There is one endpoint — POST /api/v1/systemone — that takes a state and typed questions and returns typed answers. No SDK lock-in is required: it is an HTTP contract you can call from any service, with a thin @caelum/typesafe client for TypeScript ergonomics. The response is already structured, so it drops into your handler without a parsing step.",
        code: {
          lang: "ts",
          code: `// A route handler that classifies and routes an inbound message.
export async function handleInbound(req: Request) {
  const { text } = await req.json();
  const { answers } = await client.systemOne({
    state: { text },
    questions: {
      queue: choice("Which queue for \\\`text\\\`?", {
        billing: "Payment or invoice issues.",
        technical: "Bugs or outages.",
        general: "Everything else.",
      }),
    },
  });
  return Response.json({ queue: answers.queue.choice, confidence: answers.queue.confidence });
}`,
        },
      },
      {
        heading: "Testable because it is deterministic",
        body: "The reason LLM features are hard to test is that they are stochastic. A typed decision is deterministic for a given state and questions, so it behaves like a pure function: golden tests are stable, and you can cache by a hash of the input without fear of a silent reclassification. That turns 'AI feature' into something your CI can actually assert on.",
        code: {
          lang: "ts",
          code: `test("routes billing questions to the billing queue", async () => {
  const out = await handleInbound(req("my card was charged twice"));
  expect((await out.json()).queue).toBe("billing"); // stable, not flaky
});`,
        },
      },
      {
        heading: "Self-host inside your boundary",
        body: "For regulated or latency-sensitive services, the decision path should not leave your infrastructure. OpenJev ships as a Docker image; run laya-onnx on CPU or laya-mlx on Apple silicon and point the SDK at your own URL. No data leaves your boundary, there is no per-call token bill, and latency is a local hop.",
        code: {
          lang: "bash",
          code: `docker run -p 3000:3000 openjev/engine
export OPENJEV_BASE_URL=http://localhost:3000
# Same request payload as the hosted endpoint — wire-compatible with the System One v1 API.`,
        },
      },
      {
        heading: "Start hosted, move self-hosted later",
        body: "Because the payload is wire-compatible with the System One v1 API, the migration path is a URL change. Prototype against a hosted endpoint, then flip OPENJEV_BASE_URL to your self-hosted engine for production — no changes to the request shape, the questions, or the parsing (there is none). Your service code does not know or care which backend answered.",
      },
    ],
    faqs: [
      {
        q: "Do I need an SDK, or can I call it over HTTP?",
        a: "Either. It is a plain POST /api/v1/systemone contract you can call from any language; the @caelum/typesafe client just adds typed ergonomics for TypeScript.",
      },
      {
        q: "How do I keep LLM data inside my compliance boundary?",
        a: "Self-host the Docker image and run a local backend (laya-onnx or laya-mlx). The decision path never leaves your infrastructure and there is no third-party call on the hot path.",
      },
      {
        q: "Can I cache decisions?",
        a: "Yes. Decisions are deterministic per state and questions, so caching by an input hash is safe — the same request will not silently return a different answer.",
      },
    ],
    related: [
      { kind: "guide", slug: "for-agents", label: "openjev for agents" },
      { kind: "guide", slug: "cheap-deterministic-classification", label: "Cheap deterministic classification" },
      { kind: "doc", slug: "self-hosting", label: "Self-hosting guide" },
      { kind: "doc", slug: "api-reference", label: "API reference" },
    ],
    updated: UPDATED,
  },
  {
    slug: "for-data-teams",
    title: "openjev for data teams: labelling and enrichment at volume",
    navLabel: "For data teams",
    kind: "role",
    category: "For data teams",
    description:
      "How data and analytics teams use typed decisions for large-scale labelling, enrichment, and QA — deterministic, cheap to run locally, and reproducible.",
    keywords: [
      "data labelling llm",
      "batch classification",
      "data enrichment llm",
      "reproducible labelling",
      "llm etl classification",
    ],
    intro:
      "Data teams need to label and enrich millions of rows, and a generative LLM per row is slow, expensive, and — worst of all — irreproducible, which poisons any downstream analysis. Typed decisions fix all three: closed-set labels, near-zero output tokens on a local backend, and the same label for the same row every run, so your dataset is a stable artifact.",
    takeaways: [
      "Closed-set Choice and Score are the right shape for labelling and enrichment columns.",
      "Deterministic decisions make a labelled dataset reproducible — re-running the pipeline does not churn labels.",
      "Local backends make a large backfill a batch job with no per-row token bill.",
      "A calibrated confidence column lets you route only the uncertain rows to human review.",
    ],
    sections: [
      {
        heading: "Labelling as a typed column",
        body: "Treat each enrichment as a typed question that produces a column: topic as a Choice, quality as a Score, is-duplicate as a Noul. Batch several over one row's state and you compute a whole set of columns in one call. The output is already typed, so it lands in your warehouse without a parsing or cleaning step.",
        code: {
          lang: "ts",
          code: `for (const row of batch) {
  const { answers } = await client.systemOne({
    state: { review: row.text },
    questions: {
      topic: choice("Topic of \\\`review\\\`?", {
        shipping: "About delivery or logistics.",
        quality: "About the product itself.",
        service: "About support or staff.",
      }),
      sentiment: score("Sentiment of \\\`review\\\` (1 negative … 5 positive)?", 1, 5),
      is_spam: noul("Is \\\`review\\\` spam?"),
    },
  });
  emit({ id: row.id, topic: answers.topic.choice, sentiment: answers.sentiment.score,
         spam: answers.is_spam.noul >= 0.5, confidence: answers.topic.confidence });
}`,
        },
      },
      {
        heading: "Reproducibility is the real win",
        body: "The quiet disaster of LLM enrichment is that re-running it changes the labels, so your metrics move for no reason and you cannot bisect a regression. Deterministic decisions make the labelled dataset a stable artifact: the same row gets the same label, re-runs are idempotent, and you can version the questions instead of chasing drift.",
      },
      {
        heading: "Backfill locally at zero marginal cost",
        body: "A million-row backfill on a generative API is a budget line item. With no generation, OpenJev runs the backfill on a local backend — laya-onnx on CPU or the native scorer — as an ordinary batch job. Parallelize across workers, point them at your self-hosted engine, and the marginal cost per row collapses toward zero.",
      },
      {
        heading: "Confidence as a QA column",
        body: "Emit the confidence alongside the label and you get human-review targeting for free. Sort by confidence and review only the bottom slice; the calibrated number means that slice really is where the errors concentrate. That turns full manual QA into spot-checking the genuinely ambiguous rows.",
      },
    ],
    table: {
      caption: "Generative-per-row vs typed decisions for labelling",
      colA: "Generative LLM per row",
      colB: "Typed decisions",
      rows: [
        { label: "Output", a: "Prose to parse into a label", b: "Typed column, ready to load" },
        { label: "Re-run stability", a: "Labels churn between runs", b: "Idempotent — same row, same label" },
        { label: "Backfill cost", a: "Per-row token bill", b: "Local batch, near-zero marginal cost" },
        { label: "QA targeting", a: "No confidence to sort by", b: "Calibrated confidence column" },
      ],
    },
    faqs: [
      {
        q: "Will labels stay stable if I re-run the pipeline?",
        a: "Yes. Decisions are deterministic per input, so re-running the enrichment does not churn labels — the dataset is a reproducible artifact you can version by the questions you asked.",
      },
      {
        q: "How do I keep a large backfill affordable?",
        a: "Self-host a local backend and run the backfill as a parallel batch job. There is no generation and no per-row fee, so cost scales with your own compute, not a token meter.",
      },
      {
        q: "How do I prioritize human review?",
        a: "Emit the calibrated confidence as a column and review the lowest-confidence rows first. Because the number is calibrated, that slice concentrates the genuine errors.",
      },
    ],
    related: [
      { kind: "guide", slug: "cheap-deterministic-classification", label: "Cheap deterministic classification" },
      { kind: "guide", slug: "score-primitive", label: "Score for ratings" },
      { kind: "use-case", slug: "data-extraction", label: "Extraction + decision pattern" },
      { kind: "compare", slug: "vs-instructor", label: "vs Instructor / Pydantic parsing" },
    ],
    updated: UPDATED,
  },
  ...TRUST_GUIDES,
];

export function guideBySlug(slug: string): Guide | undefined {
  return GUIDES.find((g) => g.slug === slug);
}

export const GUIDE_SLUGS: readonly string[] = GUIDES.map((g) => g.slug);

/** Group guides by kind for the hub, preserving array order within a group. */
const GUIDE_GROUP_DEFS: ReadonlyArray<{ kind: GuideKind; label: string }> = [
  { kind: "concept", label: "Concepts" },
  { kind: "trust", label: "Trust layer" },
  { kind: "migration", label: "Migrations" },
  { kind: "primitive", label: "The primitives" },
  { kind: "role", label: "By role" },
];

export const GUIDE_GROUPS: ReadonlyArray<{
  kind: GuideKind;
  label: string;
  guides: readonly Guide[];
}> = GUIDE_GROUP_DEFS.map((g) => ({
  ...g,
  guides: GUIDES.filter((x) => x.kind === g.kind),
}));
