/**
 * TUTORIALS — the content behind /tutorials and /tutorials/$slug.
 *
 * Six end-to-end, numbered step-by-step build tutorials, each showing a real
 * mini-application that uses Choice, Score, and/or Noul via the OpenJev
 * API (POST /v1/systemone) and the @caelum/typesafe SDK.
 *
 * Every tutorial has: goal, prerequisites, numbered steps with real runnable
 * code, expected JSON output, next steps, a per-tutorial FAQ, and curated
 * cross-links to related guides/docs/use-cases.
 *
 * API shape used throughout:
 *   POST /v1/systemone
 *   { state: {...}, questions: { name: { type, instructions, options? } } }
 *   → { answers: { name: { type, choice?, score?, noul?, probabilities?, confidence } } }
 *
 * SDK shape:
 *   import { choice, score, noul } from "@caelum/typesafe"
 *   client.systemOne({ state, questions })
 */

export interface TutorialStep {
  readonly n: number;
  readonly heading: string;
  readonly body: string;
  readonly code?: { readonly lang?: string; readonly code: string };
}

export interface TutorialFAQ {
  readonly q: string;
  readonly a: string;
}

export interface TutorialRelated {
  readonly kind: "guide" | "compare" | "use-case" | "doc" | "tutorial";
  readonly slug: string;
  readonly label: string;
}

export interface Tutorial {
  /** URL slug — /tutorials/$slug */
  readonly slug: string;
  /** H1 / page title. */
  readonly title: string;
  /** Short label for cards and nav. */
  readonly navLabel: string;
  /** Domain label shown mono-uppercase, e.g. "Tutorial". */
  readonly category: string;
  /** ~150-char meta description. */
  readonly description: string;
  /** Target search keywords for JSON-LD + internal relevance. */
  readonly keywords: readonly string[];
  /** 2–3 sentence intro under the H1. */
  readonly intro: string;
  /** One-sentence statement of what you will have built when done. */
  readonly goal: string;
  /** Bulleted prerequisites before starting. */
  readonly prerequisites: readonly string[];
  /** Estimated reading + coding time, in minutes. */
  readonly readingTime: number;
  /** Numbered build steps, each with body and optional code block. */
  readonly steps: readonly TutorialStep[];
  /** Description of what a successful run produces. */
  readonly expectedOutput: string;
  /** Short pointers to what to build next after completing the tutorial. */
  readonly nextSteps: readonly string[];
  /** Page-specific FAQ (drives FAQPage JSON-LD). */
  readonly faqs: readonly TutorialFAQ[];
  /** Curated cross-links. */
  readonly related: readonly TutorialRelated[];
  /** ISO date for Article dateModified. */
  readonly updated: string;
}

const UPDATED = "2026-09-23";

export const TUTORIALS: readonly Tutorial[] = [
  // ── 1 ─────────────────────────────────────────────────────────────────────
  {
    slug: "build-a-support-ticket-router",
    title: "Build a support ticket router",
    navLabel: "Support ticket router",
    category: "Tutorial",
    description:
      "Step-by-step tutorial: classify inbound support tickets with Choice, score urgency with Score, and detect anger with Noul — all in one typed call, then gate routing on calibrated confidence.",
    keywords: [
      "support ticket routing",
      "ticket classification llm",
      "typed decision routing",
      "choice score noul tutorial",
      "openjev tutorial",
    ],
    intro:
      "Support teams drown in tickets that land in the wrong queue. Regex rules break on new phrasing; a generative LLM-per-ticket is expensive and hard to test. In this tutorial you build a router that reads a ticket once, classifies the queue, scores urgency, checks for anger, and gates the routing decision on calibrated confidence — all in a single POST to /v1/systemone.",
    goal:
      "A working HTTP handler that accepts a support ticket and returns a routing decision (queue, urgency, confidence) with an escalation path for uncertain or high-urgency tickets.",
    prerequisites: [
      "Node.js 18+ and npm or pnpm",
      "An OpenJev API key (or a self-hosted engine on localhost:3000)",
      "Basic familiarity with TypeScript async/await",
    ],
    readingTime: 8,
    steps: [
      {
        n: 1,
        heading: "Install the SDK and create the client",
        body: "Install the @caelum/typesafe package and create a shared client module. The client wraps the single POST /v1/systemone endpoint; every decision call goes through it.",
        code: {
          lang: "bash",
          code: `npm install @caelum/typesafe`,
        },
      },
      {
        n: 2,
        heading: "Create the shared client",
        body: "Export a single client instance configured from environment variables. The baseUrl defaults to the hosted endpoint; swap it to http://localhost:3000 when running a self-hosted engine.",
        code: {
          lang: "ts",
          code: `// src/client.ts
import { OpenJev } from "@caelum/typesafe";

export const client = new OpenJev({
  baseUrl: process.env.OPENJEV_BASE_URL ?? "http://localhost:3000",
  apiKey: process.env.OPENJEV_API_KEY,
});`,
        },
      },
      {
        n: 3,
        heading: "Define the ticket type and decision questions",
        body: "Model the ticket state and declare three typed questions: a Choice for the support queue, a Score for urgency, and a Noul for anger detection. All three are evaluated in one call over the same shared state.",
        code: {
          lang: "ts",
          code: `// src/classify.ts
import { choice, noul, score } from "@caelum/typesafe";
import { client } from "./client";

export interface Ticket {
  subject: string;
  body: string;
}

export async function classifyTicket(ticket: Ticket) {
  return client.systemOne({
    state: { subject: ticket.subject, body: ticket.body },
    questions: {
      queue: choice("Which support queue does this ticket belong to?", {
        billing: "Payment, invoice, refund, or subscription issues.",
        technical: "Bug reports, errors, or integration failures.",
        account: "Login, password reset, or account settings.",
        general: "Feedback, general questions, or anything else.",
      }),
      urgency: score(
        "How urgent is this ticket? 1 = can wait days, 5 = blocking now.",
        1,
        5,
      ),
      is_angry: noul("Does the ticket express anger or serious frustration?"),
    },
  });
}`,
        },
      },
      {
        n: 4,
        heading: "Build the routing function with a confidence gate",
        body: "Read the typed answers and apply three rules: low confidence sends the ticket to human review, high urgency or anger triggers escalation, otherwise route to the classified queue. The confidence gate is the key step — a 0.75 threshold means you only auto-route the cases where the model is genuinely sure.",
        code: {
          lang: "ts",
          code: `// src/router.ts
import { classifyTicket, type Ticket } from "./classify";

const CONFIDENCE_THRESHOLD = 0.75;
const URGENCY_ESCALATE = 4;
const ANGER_THRESHOLD = 0.65;

export async function routeTicket(ticket: Ticket) {
  const { answers } = await classifyTicket(ticket);

  const queue = answers.queue.choice;           // "billing" | "technical" | ...
  const urgency = answers.urgency.score;        // 1 – 5
  const isAngry = answers.is_angry.noul > ANGER_THRESHOLD;
  const confident = answers.queue.confidence >= CONFIDENCE_THRESHOLD;

  if (!confident) {
    return { action: "review", reason: "low_confidence", queue, answers };
  }
  if (urgency >= URGENCY_ESCALATE || isAngry) {
    return { action: "escalate", queue, urgency, answers };
  }
  return { action: "route", queue, urgency, answers };
}`,
        },
      },
      {
        n: 5,
        heading: "Wire into an HTTP handler",
        body: "Expose the router as a POST endpoint. The handler accepts a ticket object, calls routeTicket, and returns the routing decision as JSON. Error handling wraps the decision call so a backend failure returns a safe fallback.",
        code: {
          lang: "ts",
          code: `// src/server.ts  (Hono example — swap for Express, Fastify, etc.)
import { Hono } from "hono";
import { routeTicket } from "./router";

const app = new Hono();

app.post("/tickets/route", async (c) => {
  const ticket = await c.req.json<{ subject: string; body: string }>();
  if (!ticket.subject || !ticket.body) {
    return c.json({ error: "subject and body are required" }, 400);
  }
  try {
    const result = await routeTicket(ticket);
    return c.json(result);
  } catch {
    // Fallback: send unclassified tickets to general queue.
    return c.json({ action: "review", reason: "engine_error", queue: "general" }, 502);
  }
});

export default app;`,
        },
      },
      {
        n: 6,
        heading: "Test with sample tickets and verify the output",
        body: "Try three representative tickets — a clear billing question, an angry urgent bug report, and an ambiguous one — to confirm routing, escalation, and review paths all fire correctly.",
        code: {
          lang: "ts",
          code: `// src/router.test.ts
import { routeTicket } from "./router";

const cases = [
  { subject: "Double charge on my account", body: "My card was billed twice this month." },
  { subject: "PRODUCTION DOWN", body: "Our integration is throwing 500s for all users. Fix this NOW." },
  { subject: "Hello", body: "Hi." },
] as const;

for (const ticket of cases) {
  const result = await routeTicket(ticket);
  console.log(ticket.subject, "→", result.action, result.queue ?? "");
}
// "Double charge on my account" → route billing
// "PRODUCTION DOWN"             → escalate technical
// "Hello"                       → review low_confidence`,
        },
      },
    ],
    expectedOutput:
      'For the billing ticket: { "action": "route", "queue": "billing", "answers": { "queue": { "type": "choice", "choice": "billing", "confidence": 0.93 }, "urgency": { "type": "score", "score": 2 }, "is_angry": { "type": "noul", "noul": 0.08 } } }. The angry production ticket returns action "escalate" with urgency 5; the "Hello" ticket returns action "review" with reason "low_confidence".',
    nextSteps: [
      "Add a Score for account tier (free/pro/enterprise) to prioritise enterprise tickets in the escalation logic.",
      "Cache routing decisions by a hash of (subject + body) — deterministic answers make this safe and fast.",
      "Emit confidence as a metric and track escalation rate over time to tune the confidence threshold.",
      "Swap the hosted endpoint for a self-hosted laya-onnx engine to keep ticket content off third-party infrastructure.",
    ],
    faqs: [
      {
        q: "Why use a Noul for anger instead of a third Choice option?",
        a: "Choice returns one label for the whole ticket; Noul returns a probability for a specific proposition independently. You can threshold the anger check separately (e.g. > 0.65) and combine it with the queue Choice and urgency Score without any of them polluting the others.",
      },
      {
        q: "What happens if the confidence is low for most tickets?",
        a: "Lower the threshold or add better option descriptions. Low confidence often means two options are too similar — sharpen their descriptions with a contrast (e.g. 'billing, NOT general usage questions') to spread the distribution.",
      },
      {
        q: "Can I add more queues without rewriting the routing logic?",
        a: "Yes. Add a key to the Choice options map and redeploy. The routing logic reads queue from answers.queue.choice by name, so it picks up the new option automatically.",
      },
      {
        q: "Is it safe to cache routing decisions?",
        a: "Yes. Typed decisions are deterministic per state and questions, so the same ticket body produces the same answer. Cache by a hash of the input to avoid re-evaluating tickets you have already routed.",
      },
    ],
    related: [
      { kind: "guide", slug: "choice-primitive", label: "Choice, in depth" },
      { kind: "guide", slug: "confidence-calibration", label: "How calibrated confidence works" },
      { kind: "use-case", slug: "llm-routing", label: "Routing pattern" },
      { kind: "tutorial", slug: "build-a-content-moderator", label: "Next: Build a content moderator" },
    ],
    updated: UPDATED,
  },

  // ── 2 ─────────────────────────────────────────────────────────────────────
  {
    slug: "build-a-content-moderator",
    title: "Build a content moderator",
    navLabel: "Content moderator",
    category: "Tutorial",
    description:
      "Step-by-step tutorial: check user-generated content against four moderation policies — hate speech, PII, spam, and explicit material — with Noul in a single typed call, then label the primary violation with Choice.",
    keywords: [
      "content moderation llm",
      "noul policy check",
      "typed moderation pipeline",
      "hate speech detection api",
      "pii detection tutorial",
    ],
    intro:
      "Rule-based content filters break on paraphrase; generative classifiers fire a round trip per policy check. This tutorial builds a moderator that evaluates four Noul policy checks in a single call, aggregates the results into a pass/block decision, and labels the primary violation with a Choice — all from one POST to /v1/systemone.",
    goal:
      "A moderation function that accepts a content string and returns { verdict: 'allow' | 'block', violations: string[], primaryReason?: string } with per-policy probability scores.",
    prerequisites: [
      "Node.js 18+ and npm or pnpm",
      "An OpenJev API key (or self-hosted engine)",
      "@caelum/typesafe installed (from Tutorial 1 or fresh install)",
    ],
    readingTime: 8,
    steps: [
      {
        n: 1,
        heading: "Define the policy checks as Noul questions",
        body: "Declare each policy as a named Noul question. Names become the keys in the answers object, so the aggregation loop does not need to know the check list at compile time. Keep each proposition narrow and precise — ambiguous checks produce unreliable probabilities.",
        code: {
          lang: "ts",
          code: `// src/policies.ts
import { noul } from "@caelum/typesafe";

export const POLICY_CHECKS = {
  hate_speech: noul(
    "Does the content contain hate speech, slurs, or targeted harassment of an individual or group?",
  ),
  pii_leak: noul(
    "Does the content contain personally identifiable information such as an email address, phone number, physical address, or government ID?",
  ),
  spam: noul(
    "Is the content unsolicited promotional material, repetitive filler, or entirely off-topic for the platform?",
  ),
  explicit: noul(
    "Does the content contain sexually explicit material or graphic depictions of violence?",
  ),
} as const;

export type PolicyKey = keyof typeof POLICY_CHECKS;`,
        },
      },
      {
        n: 2,
        heading: "Write the moderation function",
        body: "Pass the content as the shared state and attach all four Noul checks in one request. Every check is evaluated independently against the same content string, so the marginal cost of the fourth check is a few tokens, not another network call.",
        code: {
          lang: "ts",
          code: `// src/moderate.ts
import { client } from "./client";
import { POLICY_CHECKS } from "./policies";

export async function moderateContent(content: string) {
  return client.systemOne({
    state: { content },
    questions: POLICY_CHECKS,
  });
}`,
        },
      },
      {
        n: 3,
        heading: "Aggregate into a pass/block decision",
        body: "Apply per-policy thresholds to the Noul probabilities. Hate speech and explicit content use a low threshold (0.30) because the cost of a false negative is high; spam uses a higher bar (0.60) to avoid over-blocking marginal promotional posts.",
        code: {
          lang: "ts",
          code: `// src/decision.ts
import { type PolicyKey } from "./policies";
import { moderateContent } from "./moderate";

const THRESHOLDS: Record<PolicyKey, number> = {
  hate_speech: 0.30,
  pii_leak: 0.40,
  spam: 0.60,
  explicit: 0.30,
};

export async function moderateAndDecide(content: string) {
  const { answers } = await moderateContent(content);

  const violations = (Object.keys(THRESHOLDS) as PolicyKey[]).filter(
    (k) => answers[k].noul >= THRESHOLDS[k],
  );

  const scores = Object.fromEntries(
    (Object.keys(THRESHOLDS) as PolicyKey[]).map((k) => [k, answers[k].noul]),
  );

  return {
    verdict: violations.length > 0 ? "block" : "allow",
    violations,
    scores,
  } as const;
}`,
        },
      },
      {
        n: 4,
        heading: "Label the primary violation with a Choice",
        body: "When content is blocked, fire a second call to label the primary reason. This Choice runs only on blocks, so it never adds latency to the allow path. The label is used downstream for moderation dashboards and appeal workflows.",
        code: {
          lang: "ts",
          code: `// src/label.ts
import { choice } from "@caelum/typesafe";
import { client } from "./client";

export async function labelViolation(content: string, violations: readonly string[]) {
  const { answers } = await client.systemOne({
    state: { content, violations: violations.join(", ") },
    questions: {
      reason: choice("Primary reason this content violates policy?", {
        hate: "Contains hate speech, slurs, or targeted harassment.",
        privacy: "Leaks personally identifiable or sensitive information.",
        spam: "Is unsolicited promotional or repetitive filler content.",
        explicit: "Contains sexually explicit material or graphic violence.",
        other: "Violates policy for another reason not listed above.",
      }),
    },
  });
  return answers.reason.choice;
}`,
        },
      },
      {
        n: 5,
        heading: "Compose the full moderator",
        body: "Chain the pass/block decision and the optional violation label into a single exported function. Callers receive a uniform result shape regardless of whether the content was allowed or blocked.",
        code: {
          lang: "ts",
          code: `// src/moderator.ts
import { moderateAndDecide } from "./decision";
import { labelViolation } from "./label";

export async function moderate(content: string) {
  const decision = await moderateAndDecide(content);

  if (decision.verdict === "block" && decision.violations.length > 0) {
    const primaryReason = await labelViolation(content, decision.violations);
    return { ...decision, primaryReason };
  }

  return { ...decision, primaryReason: undefined };
}`,
        },
      },
      {
        n: 6,
        heading: "Expose as an HTTP endpoint and test edge cases",
        body: "Wire the moderator into a route handler and verify the three key paths: a clean post is allowed, a hate-speech post is blocked with the correct label, and a borderline spam post lands on the right side of the threshold.",
        code: {
          lang: "ts",
          code: `// src/server.ts
import { Hono } from "hono";
import { moderate } from "./moderator";

const app = new Hono();

app.post("/moderate", async (c) => {
  const { content } = await c.req.json<{ content: string }>();
  if (!content || content.length > 8000) {
    return c.json({ error: "content required, max 8000 chars" }, 400);
  }
  const result = await moderate(content);
  const status = result.verdict === "block" ? 422 : 200;
  return c.json(result, status);
});

export default app;

// Quick test:
// POST { "content": "I hate [group]" }
// → { "verdict": "block", "violations": ["hate_speech"], "primaryReason": "hate", "scores": {...} }`,
        },
      },
    ],
    expectedOutput:
      'For a hate-speech input: { "verdict": "block", "violations": ["hate_speech"], "primaryReason": "hate", "scores": { "hate_speech": 0.87, "pii_leak": 0.03, "spam": 0.09, "explicit": 0.04 } }. For a clean post: { "verdict": "allow", "violations": [], "scores": { ... all below threshold } }.',
    nextSteps: [
      "Add a Score for severity (1–5) to power moderation dashboards that sort by harm level.",
      "Swap THRESHOLDS from constants to a config loaded at startup so you can tune per-community without redeploying.",
      "Add a Noul check for off-topic content specific to your platform as a fifth policy.",
      "Cache moderation results by content hash — same post, same result, no redundant calls.",
    ],
    faqs: [
      {
        q: "Why separate the violation label into a second call?",
        a: "The label Choice only needs to run on blocked content, which is a fraction of all posts. Separating it keeps the hot-path (most posts are allowed) to one call; the second call adds latency only when content is actually blocked.",
      },
      {
        q: "How do I handle false positives without lowering the threshold globally?",
        a: "Track false-positive rate per policy and tune thresholds independently. You can also add a human-review tier between allow and block — route the 0.3–0.6 band to a queue instead of auto-blocking.",
      },
      {
        q: "Can I add more policies without rewriting the aggregation?",
        a: "Yes. Add a new Noul to POLICY_CHECKS and a threshold to THRESHOLDS. The aggregation loop iterates Object.keys(THRESHOLDS), so it picks up the new check automatically.",
      },
      {
        q: "What language is the content expected to be in?",
        a: "The decision engine evaluates content in the language it is written in. You do not need to translate before moderating, though very low-resource languages may get lower confidence scores — review those with a human.",
      },
    ],
    related: [
      { kind: "guide", slug: "noul-primitive", label: "Noul, in depth" },
      { kind: "use-case", slug: "content-moderation", label: "Content moderation pattern" },
      { kind: "guide", slug: "confidence-calibration", label: "How calibrated confidence works" },
      { kind: "tutorial", slug: "build-an-insurance-adjudicator", label: "Next: Build an insurance adjudicator" },
    ],
    updated: UPDATED,
  },

  // ── 3 ─────────────────────────────────────────────────────────────────────
  {
    slug: "build-an-insurance-adjudicator",
    title: "Build an insurance claim adjudicator",
    navLabel: "Insurance adjudicator",
    category: "Tutorial",
    description:
      "Step-by-step tutorial: adjudicate first-notice-of-loss insurance claims by scoring damage severity, choosing coverage type, scoring cost band, and checking three fraud indicators — all in one typed call with tiered escalation.",
    keywords: [
      "insurance adjudication llm",
      "claim scoring tutorial",
      "fraud detection typed decision",
      "fnol automation",
      "openjev insurance",
    ],
    intro:
      "Manual FNOL adjudication is slow and inconsistent. Generative LLMs produce plausible-sounding decisions with no calibrated confidence, making them difficult to audit. This tutorial builds an adjudicator that scores damage severity, classifies coverage type, scores the cost band, and checks three fraud signals — all over one shared claim state — returning a tiered decision (auto_approve / senior_review / siu_review / deny) with confidence on every judgment.",
    goal:
      "An adjudicateClaim function that accepts a claim record and returns { tier, fraudScore, answers } where tier determines the handling path and each answer carries a calibrated confidence.",
    prerequisites: [
      "Node.js 18+ and npm or pnpm",
      "An OpenJev API key (or self-hosted engine)",
      "@caelum/typesafe installed",
    ],
    readingTime: 10,
    steps: [
      {
        n: 1,
        heading: "Model the claim state",
        body: "Define the Claim interface. Every field you put here becomes available to all questions as shared state, so the damage description, policy history, and repair quote are all visible to every typed question without passing them separately.",
        code: {
          lang: "ts",
          code: `// src/types.ts
export interface Claim {
  policyNumber: string;
  incidentDate: string;     // ISO date
  description: string;      // claimant's narrative
  photosProvided: boolean;
  claimantHistory: string;  // e.g. "clean" | "1 prior claim" | "3+ prior claims"
  repairQuoteUsd: number;
}`,
        },
      },
      {
        n: 2,
        heading: "Score damage severity",
        body: "A Score on a 0–5 rubric anchors the decision on a defined scale rather than relying on the model to invent a number. Define the rubric in the question text so the same narrative lands the same way on every run.",
        code: {
          lang: "ts",
          code: `// src/questions.ts
import { choice, noul, score } from "@caelum/typesafe";

export const damageQ = score(
  "Structural damage severity described in the claim. " +
  "0 = cosmetic only, 1 = minor functional, 2 = moderate, " +
  "3 = significant, 4 = severe, 5 = total loss or uninhabitable.",
  0,
  5,
);`,
        },
      },
      {
        n: 3,
        heading: "Choose the coverage classification",
        body: "A Choice over coverage types returns one label and a confidence. Low confidence on coverage type is itself a signal — it usually means the claim description is vague or spans multiple categories, both of which warrant senior review.",
        code: {
          lang: "ts",
          code: `export const coverageQ = choice(
  "Which coverage type best describes this claim?",
  {
    collision: "Vehicle collision, regardless of fault.",
    comprehensive: "Non-collision event: fire, theft, weather, vandalism.",
    liability: "Damage caused by the insured to a third party.",
    property: "Residential or commercial property damage.",
    out_of_scope: "Does not appear to fall within any covered peril, or information is insufficient.",
  },
);`,
        },
      },
      {
        n: 4,
        heading: "Score the repair cost band",
        body: "Score the cost band so the adjudicator can apply different approval limits per tier without hard-coding dollar amounts into the routing logic. The question incorporates the repairQuoteUsd from state so the model interprets the quote in the context of the described damage.",
        code: {
          lang: "ts",
          code: `export const costBandQ = score(
  "Repair cost band for this claim, considering both the description and the quoted amount. " +
  "1 = minor (<$500), 2 = moderate ($500–$2 000), 3 = significant ($2 000–$10 000), " +
  "4 = major ($10 000–$25 000), 5 = potential total loss (>$25 000).",
  1,
  5,
);`,
        },
      },
      {
        n: 5,
        heading: "Add three Noul fraud indicator checks",
        body: "Run three independent fraud checks in the same call. Each returns a calibrated probability rather than a binary flag, so you can combine them into a fraud score and route claims above a threshold to SIU review without treating any single signal as conclusive.",
        code: {
          lang: "ts",
          code: `export const fraudChecks = {
  recent_policy: noul(
    "Was this policy purchased within 30 days of the incident date, suggesting opportunistic coverage?",
  ),
  inconsistent_damage: noul(
    "Are the damages described inconsistent with the stated incident type or implausible in scope?",
  ),
  inflated_quote: noul(
    "Does the repair quote appear disproportionately high relative to the damage described in the narrative?",
  ),
};`,
        },
      },
      {
        n: 6,
        heading: "Combine into an adjudication decision with tiered escalation",
        body: "Fire one systemOne call with all six questions over the shared claim state. Compute a fraud score by averaging the three Noul probabilities and apply four escalation tiers: auto_approve for clean low-value claims, senior_review for uncertain or high-value cases, siu_review for fraud signals, and deny for out-of-scope coverage.",
        code: {
          lang: "ts",
          code: `// src/adjudicator.ts
import { client } from "./client";
import { damageQ, coverageQ, costBandQ, fraudChecks } from "./questions";
import type { Claim } from "./types";

type Tier = "auto_approve" | "senior_review" | "siu_review" | "deny";

export async function adjudicateClaim(claim: Claim) {
  const { answers } = await client.systemOne({
    state: claim,
    questions: {
      damage: damageQ,
      coverage: coverageQ,
      costBand: costBandQ,
      ...fraudChecks,
    },
  });

  const fraudScore =
    (answers.recent_policy.noul +
      answers.inconsistent_damage.noul +
      answers.inflated_quote.noul) /
    3;

  const tier: Tier =
    fraudScore > 0.45
      ? "siu_review"
      : answers.coverage.choice === "out_of_scope"
        ? "deny"
        : answers.damage.score >= 4 ||
            answers.costBand.score >= 4 ||
            answers.coverage.confidence < 0.65
          ? "senior_review"
          : "auto_approve";

  return { tier, fraudScore: +fraudScore.toFixed(3), answers };
}`,
        },
      },
    ],
    expectedOutput:
      'A clean moderate collision claim returns { "tier": "auto_approve", "fraudScore": 0.08, "answers": { "damage": { "score": 2 }, "coverage": { "choice": "collision", "confidence": 0.89 }, "costBand": { "score": 2 } } }. A claim with an implausibly large quote and recent policy purchase returns tier "siu_review" with fraudScore above 0.45.',
    nextSteps: [
      "Add a Noul check for whether photos corroborate the described damage — use the photosProvided field in state.",
      "Emit tier and fraudScore as structured logs and build a dashboard that tracks SIU referral rate by coverage type.",
      "Run the adjudicator on a historical claims backfill locally (laya-onnx on CPU) to validate tier distribution before going live.",
      "Add a Score for completeness of the claim filing to route incomplete submissions before they reach the adjudicator.",
    ],
    faqs: [
      {
        q: "Why average the three fraud Nouls instead of using any-above-threshold logic?",
        a: "Averaging gives a fraud score you can tune continuously — a 0.45 cutoff is easy to adjust after you see the SIU referral rate in production. Any-above-threshold logic is all-or-nothing and harder to calibrate to your false-positive tolerance.",
      },
      {
        q: "Is low coverage confidence a reliable signal for senior review?",
        a: "Yes. A calibrated confidence below 0.65 on the coverage Choice means the model genuinely cannot distinguish between two coverage types from the description — which usually means the narrative is ambiguous, inconsistent, or cross-coverage, all of which a senior adjudicator should see.",
      },
      {
        q: "Can I run this adjudicator on a large backfill of historical claims?",
        a: "Yes. Self-host a local backend (laya-onnx or the native scorer), point the SDK at it, and run the backfill as a parallel batch job. Decisions are deterministic per claim, so the same claim always lands in the same tier.",
      },
      {
        q: "How do I handle claims in languages other than English?",
        a: "Pass the claim description as-is in the state object. The decision engine handles multilingual input; you do not need to translate the description before adjudicating.",
      },
    ],
    related: [
      { kind: "guide", slug: "score-primitive", label: "Score, in depth" },
      { kind: "use-case", slug: "insurance-adjudication", label: "Adjudication pattern" },
      { kind: "guide", slug: "noul-primitive", label: "Noul for fraud checks" },
      { kind: "tutorial", slug: "build-an-llm-router", label: "Next: Build an LLM router" },
    ],
    updated: UPDATED,
  },

  // ── 4 ─────────────────────────────────────────────────────────────────────
  {
    slug: "build-an-llm-router",
    title: "Build an LLM router",
    navLabel: "LLM router",
    category: "Tutorial",
    description:
      "Step-by-step tutorial: route prompts to the right LLM backend (haiku / sonnet / opus) based on typed decisions — complexity Score, code Noul, and live-data Noul — with a cost-aware upgrade rule.",
    keywords: [
      "llm router tutorial",
      "prompt routing typed decision",
      "model selection llm",
      "cheap llm routing",
      "openjev llm router",
    ],
    intro:
      "Sending every prompt to the most capable model is wasteful; guessing which model to use from prompt length or keywords misroutes frequently. This tutorial builds an LLM router that makes three typed decisions per prompt — complexity, code requirement, live-data requirement — and maps the result to the cheapest capable backend, with a cost-aware upgrade rule for borderline cases.",
    goal:
      "A routePrompt function that accepts a user message and returns { model: string, reason: string } with the cheapest backend capable of answering that prompt correctly.",
    prerequisites: [
      "Node.js 18+ and npm or pnpm",
      "An OpenJev API key (or self-hosted engine)",
      "@caelum/typesafe installed",
      "API keys for at least two LLM backends (e.g. Anthropic Haiku and Sonnet)",
    ],
    readingTime: 8,
    steps: [
      {
        n: 1,
        heading: "Define the model roster as a Choice",
        body: "Declare each LLM backend as a Choice option with a description that captures its strengths. Precise descriptions help the model assign mass to the correct option — vague descriptions produce wide distributions and lower confidence.",
        code: {
          lang: "ts",
          code: `// src/roster.ts
import { choice } from "@caelum/typesafe";

export const MODEL_ROSTER = {
  haiku: "Best for short summaries, simple Q&A, data formatting, and classification under 500 tokens.",
  sonnet: "Best for most coding tasks, analysis, structured extraction, and conversations up to 4 000 tokens.",
  opus: "Best for complex multi-step reasoning, architecture decisions, and research requiring deep synthesis.",
} as const;

export type ModelKey = keyof typeof MODEL_ROSTER;

export const modelChoiceQ = choice(
  "Which model is best suited to answer this prompt accurately and completely?",
  MODEL_ROSTER,
);`,
        },
      },
      {
        n: 2,
        heading: "Score query complexity",
        body: "A complexity Score on a 1–5 rubric lets the routing logic detect when a prompt routed to Haiku actually needs Sonnet. Define the rubric so levels map cleanly to model tiers — that way the upgrade rule is a simple numeric threshold.",
        code: {
          lang: "ts",
          code: `// src/questions.ts
import { noul, score } from "@caelum/typesafe";

export const complexityQ = score(
  "How complex is this prompt? " +
  "1 = single fact or reformat, 2 = short explanation, 3 = multi-step but straightforward, " +
  "4 = requires reasoning across several concepts, 5 = research-level or architectural.",
  1,
  5,
);`,
        },
      },
      {
        n: 3,
        heading: "Noul-check for code generation requirement",
        body: "A Noul for code detection runs independently from the model Choice, so you can promote to Sonnet when the prompt needs code even if the Choice returned Haiku for other reasons. The two signals compose in the routing logic without interfering.",
        code: {
          lang: "ts",
          code: `export const needsCodeQ = noul(
  "Does this prompt ask for code generation, debugging, code review, or technical implementation details?",
);`,
        },
      },
      {
        n: 4,
        heading: "Noul-check for live data requirement",
        body: "Route prompts that need real-time information to a model connected to a retrieval tool rather than a base LLM. The Noul flags these prompts before they reach the backend, so the router can attach a search tool or return an error rather than returning a stale answer confidently.",
        code: {
          lang: "ts",
          code: `export const needsLiveQ = noul(
  "Does this prompt require information that may have changed since a model training cutoff, " +
  "such as current prices, today's news, live API status, or recent events?",
);`,
        },
      },
      {
        n: 5,
        heading: "Compose the routing function",
        body: "Fire one call with all four questions. Apply two upgrade rules on top of the base Choice: if complexity >= 4 and the base choice was Haiku, promote to Sonnet; if the code Noul fires and the base is Haiku, promote to Sonnet. Log the raw signals in the reason field so you can audit routing decisions.",
        code: {
          lang: "ts",
          code: `// src/router.ts
import { client } from "./client";
import { modelChoiceQ, type ModelKey } from "./roster";
import { complexityQ, needsCodeQ, needsLiveQ } from "./questions";

export async function routePrompt(userMessage: string) {
  const { answers } = await client.systemOne({
    state: { prompt: userMessage },
    questions: {
      model: modelChoiceQ,
      complexity: complexityQ,
      needs_code: needsCodeQ,
      needs_live: needsLiveQ,
    },
  });

  const base = answers.model.choice as ModelKey;
  const complexity = answers.complexity.score;
  const code = answers.needs_code.noul;
  const live = answers.needs_live.noul;

  // Upgrade rule: Haiku is not strong enough for complex or code-heavy prompts.
  const upgraded: ModelKey =
    base === "haiku" && (complexity >= 4 || code >= 0.6) ? "sonnet" : base;

  return {
    model: upgraded,
    needsLiveData: live >= 0.55,
    reason: \`base=\${base} complexity=\${complexity} code=\${code.toFixed(2)} live=\${live.toFixed(2)}\`,
  };
}`,
        },
      },
      {
        n: 6,
        heading: "Wrap in an HTTP proxy and test with diverse prompts",
        body: "Expose the router as a transparent proxy endpoint. For production, attach your LLM provider clients behind each model key. Test with four archetypal prompts to confirm Haiku, Sonnet, and Opus paths all fire correctly.",
        code: {
          lang: "ts",
          code: `// src/proxy.ts
import { Hono } from "hono";
import { routePrompt } from "./router";

const app = new Hono();

app.post("/v1/chat", async (c) => {
  const { messages } = await c.req.json<{ messages: { role: string; content: string }[] }>();
  const lastUserMessage = messages.filter((m) => m.role === "user").at(-1)?.content ?? "";
  const { model, needsLiveData, reason } = await routePrompt(lastUserMessage);

  if (needsLiveData) {
    return c.json({ error: "live_data_required", model, reason }, 400);
  }

  // Forward to the chosen backend here — replace with your provider client:
  // const reply = await anthropic.messages.create({ model: MODEL_IDS[model], messages });
  return c.json({ routed_to: model, reason });
});

export default app;

// Test prompts and expected routes:
// "What is 2+2?"                       → haiku
// "Debug this TypeScript async race"   → sonnet (code upgrade)
// "Design a distributed cache system"  → opus
// "What is the Bitcoin price today?"   → needsLiveData: true`,
        },
      },
    ],
    expectedOutput:
      '"What is 2+2?" → { model: "haiku", reason: "base=haiku complexity=1 code=0.04 live=0.02" }. "Write a Redis client in TypeScript" → { model: "sonnet", reason: "base=haiku complexity=3 code=0.95 live=0.05" } (code upgrade fired). "Design a multi-region database architecture" → { model: "opus", reason: "base=opus complexity=5 code=0.61 live=0.03" }.',
    nextSteps: [
      "Track model routing distribution in production and measure cost-per-query by tier to validate the upgrade rules.",
      "Add a Score for expected token length (1–5) to route long-context prompts to a model with a large context window.",
      "Cache routing decisions by prompt hash — the same message routes the same way, so a cache hit avoids the routing call entirely.",
      "Add a Noul for safety-critical content to route prompts that need guardrails to a model with built-in safety tools.",
    ],
    faqs: [
      {
        q: "Why score complexity instead of using prompt length?",
        a: "Length is a weak proxy — a one-sentence architecture question is short but requires Opus, while a 2 000-token data-cleaning task is long but straightforward for Haiku. The complexity Score evaluates what the prompt needs, not how many words it contains.",
      },
      {
        q: "What threshold should I use for the code Noul upgrade?",
        a: "Start at 0.6 and watch the Sonnet usage rate. If it is too high (routing generic chat to Sonnet), raise the threshold; if you are seeing code tasks go to Haiku, lower it.",
      },
      {
        q: "Can I add more model tiers without rewriting the routing logic?",
        a: "Yes. Add a new key to MODEL_ROSTER and update the upgrade rules. The Choice distributes mass across the full roster, so a new entry is weighted fairly without manual scoring.",
      },
      {
        q: "How do I handle the live-data case in production?",
        a: "The simplest approach is to attach a search tool to the Sonnet backend and route live-data prompts there. Alternatively return a 400 to the client with instructions to use a retrieval-augmented endpoint.",
      },
    ],
    related: [
      { kind: "guide", slug: "for-agents", label: "openjev for agents" },
      { kind: "use-case", slug: "llm-routing", label: "LLM routing pattern" },
      { kind: "guide", slug: "choice-primitive", label: "Choice, in depth" },
      { kind: "tutorial", slug: "build-a-rag-answer-grader", label: "Next: Build a RAG answer grader" },
    ],
    updated: UPDATED,
  },

  // ── 5 ─────────────────────────────────────────────────────────────────────
  {
    slug: "build-a-rag-answer-grader",
    title: "Build a RAG answer grader",
    navLabel: "RAG answer grader",
    category: "Tutorial",
    description:
      "Step-by-step tutorial: grade retrieved-augmented-generation answers for context relevance and answer faithfulness using Score, detect hallucination signals with Noul, and decide whether to use, re-retrieve, or re-generate.",
    keywords: [
      "rag answer grading",
      "faithfulness score llm",
      "hallucination detection noul",
      "rag evaluation tutorial",
      "openjev rag",
    ],
    intro:
      "RAG pipelines fail in two places: the retriever pulls irrelevant context, and the generator fabricates facts not in that context. Detecting both problems with a prose LLM judge is expensive and subjective. This tutorial builds a typed grader that Scores context relevance and answer faithfulness, Noul-checks for hallucination, and returns a structured grade with a retry instruction — all in one call.",
    goal:
      "A gradeAnswer function that accepts { question, context, answer } and returns { pass: boolean, grade: { relevance, faithfulness, hallucination, incomplete }, action: 'use' | 're_retrieve' | 're_generate' }.",
    prerequisites: [
      "Node.js 18+ and npm or pnpm",
      "An OpenJev API key (or self-hosted engine)",
      "@caelum/typesafe installed",
      "A RAG pipeline producing (question, context, answer) triples",
    ],
    readingTime: 9,
    steps: [
      {
        n: 1,
        heading: "Model the RAG state",
        body: "The state object carries the three inputs to the grading call. All four typed questions — relevance Score, faithfulness Score, hallucination Noul, incomplete Noul — evaluate against this shared state, so each question can refer to any of the three fields.",
        code: {
          lang: "ts",
          code: `// src/types.ts
export interface RagState {
  question: string;   // the original user question
  context: string;    // retrieved chunks, joined with newlines
  answer: string;     // the generated answer to grade
}`,
        },
      },
      {
        n: 2,
        heading: "Score context relevance",
        body: "Define a 1–5 rubric anchored to what 'relevant' means for your retrieval pipeline. A score of 1 means the retrieved chunks are entirely unrelated to the question; 5 means they directly contain the answer. Scores below 3 trigger a re-retrieval action, not a re-generation.",
        code: {
          lang: "ts",
          code: `// src/questions.ts
import { noul, score } from "@caelum/typesafe";

export const relevanceQ = score(
  "How relevant is the retrieved context to answering the question? " +
  "1 = completely unrelated, 2 = tangentially related, 3 = partially relevant, " +
  "4 = mostly addresses the question, 5 = directly contains the answer.",
  1,
  5,
);`,
        },
      },
      {
        n: 3,
        heading: "Score answer faithfulness",
        body: "Faithfulness measures whether every claim in the answer is grounded in the retrieved context. A 1 means the answer contradicts or ignores the context; 4 means every statement in the answer can be traced to a passage. Low faithfulness triggers re-generation against the same context, not re-retrieval.",
        code: {
          lang: "ts",
          code: `export const faithfulnessQ = score(
  "How faithful is the answer to the retrieved context? " +
  "1 = answer contradicts or ignores the context, 2 = mostly ignores context, " +
  "3 = partially supported, 4 = every claim is supported by the context.",
  1,
  4,
);`,
        },
      },
      {
        n: 4,
        heading: "Noul-check for hallucination signals",
        body: "The hallucination Noul checks for a specific pattern: specific facts (numbers, names, dates, URLs) that appear in the answer but are absent from the context. A high probability here is a stronger signal than low faithfulness alone because it points to invented specifics rather than vague unsupported claims.",
        code: {
          lang: "ts",
          code: `export const hallucinationQ = noul(
  "Does the answer contain specific facts — numbers, names, dates, URLs, or statistics — " +
  "that do not appear in the retrieved context?",
);`,
        },
      },
      {
        n: 5,
        heading: "Noul-check for an incomplete answer",
        body: "An answer can be faithful and still fail to address the question. The incomplete Noul catches answers that are technically grounded but miss the point — a common failure mode when the retrieved context is partially relevant.",
        code: {
          lang: "ts",
          code: `export const incompleteQ = noul(
  "Does the answer fail to address the main question, leaving the core question unanswered?",
);`,
        },
      },
      {
        n: 6,
        heading: "Build the grade record and retry logic",
        body: "Fire one call with all four questions, compute the pass/fail, and map the failure modes to retry actions. The action field tells the RAG pipeline what to do next: re_retrieve if context was poor, re_generate if context was fine but the answer was unfaithful or hallucinated, and use if everything passes.",
        code: {
          lang: "ts",
          code: `// src/grader.ts
import { client } from "./client";
import { relevanceQ, faithfulnessQ, hallucinationQ, incompleteQ } from "./questions";
import type { RagState } from "./types";

type GradeAction = "use" | "re_retrieve" | "re_generate";

export async function gradeAnswer(state: RagState) {
  const { answers } = await client.systemOne({
    state,
    questions: {
      relevance: relevanceQ,
      faithfulness: faithfulnessQ,
      hallucination: hallucinationQ,
      incomplete: incompleteQ,
    },
  });

  const grade = {
    relevance: answers.relevance.score,
    faithfulness: answers.faithfulness.score,
    hallucination: answers.hallucination.noul,
    incomplete: answers.incomplete.noul,
  };

  const pass =
    grade.relevance >= 3 &&
    grade.faithfulness >= 3 &&
    grade.hallucination < 0.40 &&
    grade.incomplete < 0.50;

  const action: GradeAction = pass
    ? "use"
    : grade.relevance < 3
      ? "re_retrieve"
      : "re_generate";

  return { pass, grade, action };
}`,
        },
      },
    ],
    expectedOutput:
      'A well-grounded answer returns { "pass": true, "grade": { "relevance": 4, "faithfulness": 4, "hallucination": 0.07, "incomplete": 0.12 }, "action": "use" }. An answer that invents a statistic returns action "re_generate" with hallucination above 0.4. An off-topic retrieval returns action "re_retrieve" with relevance 1 or 2.',
    nextSteps: [
      "Track grade distribution in production and use it as a signal to tune your retriever — low average relevance means the embedding model or chunk size needs adjustment.",
      "Add a Score for answer completeness (1–5) as a positive complement to the incomplete Noul.",
      "Use the grader as a training-data filter: only emit (question, context, answer) triples where pass is true to your fine-tuning pipeline.",
      "Self-host the grader on laya-onnx and run it on a held-out eval set to measure your RAG pipeline's quality offline.",
    ],
    faqs: [
      {
        q: "Why separate the hallucination Noul from the faithfulness Score?",
        a: "Faithfulness scores the overall extent to which the answer draws on context; hallucination detects a specific high-risk pattern — invented specifics like numbers and names. An answer can score faithfulness 3 (partially supported) while still hallucinating a specific statistic; the Noul catches that case independently.",
      },
      {
        q: "Should I re-retrieve or re-generate for a faithfulness failure?",
        a: "Re-generate first. Low faithfulness on good context usually means the generator ignored the context, which is a generation problem not a retrieval problem. If faithfulness is still low on the second generation, then consider re-retrieving with a refined query.",
      },
      {
        q: "Can I run this grader on a large eval dataset?",
        a: "Yes. Self-host a local backend and run the grader as a parallel batch job. Grading decisions are deterministic per (question, context, answer) triple, so re-running the eval produces the same grades.",
      },
      {
        q: "How do I tune the pass thresholds?",
        a: "Start with the defaults (relevance >= 3, faithfulness >= 3, hallucination < 0.4) and measure precision/recall against a manually-graded validation set. Adjust thresholds to hit your target false-positive rate for each failure mode independently.",
      },
    ],
    related: [
      { kind: "guide", slug: "score-primitive", label: "Score, in depth" },
      { kind: "guide", slug: "noul-primitive", label: "Noul, in depth" },
      { kind: "guide", slug: "for-data-teams", label: "openjev for data teams" },
      { kind: "tutorial", slug: "build-an-agent-tool-selector", label: "Next: Build an agent tool selector" },
    ],
    updated: UPDATED,
  },

  // ── 6 ─────────────────────────────────────────────────────────────────────
  {
    slug: "build-an-agent-tool-selector",
    title: "Build an agent tool selector",
    navLabel: "Agent tool selector",
    category: "Tutorial",
    description:
      "Step-by-step tutorial: build the tool-selection and verification steps of an agent loop using Choice for next-tool routing, Score for goal progress, and Noul for output verification — with confidence-gated fallback.",
    keywords: [
      "agent tool selection tutorial",
      "llm agent routing choice",
      "agent loop typed decision",
      "tool selection confidence gate",
      "openjev agent",
    ],
    intro:
      "Most agent loops fail on two narrow steps: selecting the right tool from the roster and verifying that the tool output was useful before continuing. Doing both with prose parsing produces agents that fire tools blindly and loop forever. This tutorial builds typed decision steps for both — a Choice for tool selection, a Noul for output verification, and a Score for progress — composing them into a reproducible, confidence-gated agent loop.",
    goal:
      "A runAgent function that takes a user goal and a tool roster, selects the next tool with a typed Choice, verifies output with a Noul, tracks progress with a Score, and terminates cleanly when done.",
    prerequisites: [
      "Node.js 18+ and npm or pnpm",
      "An OpenJev API key (or self-hosted engine)",
      "@caelum/typesafe installed",
      "A basic understanding of agent loops (goal + steps + stop condition)",
    ],
    readingTime: 10,
    steps: [
      {
        n: 1,
        heading: "Model the agent state",
        body: "The agent state carries the goal, the accumulated history, and the names of available tools. Every decision call sees the full state, so the tool selector can read what has already been tried before choosing the next step.",
        code: {
          lang: "ts",
          code: `// src/types.ts
export interface AgentState {
  goal: string;
  history: string;           // tool calls and their outputs, as running text
  availableTools: string;    // comma-separated list of tool names
}

export interface ToolResult {
  toolName: string;
  output: string;
  success: boolean;
}`,
        },
      },
      {
        n: 2,
        heading: "Define the tool roster as a Choice",
        body: "Each key in the roster is a tool name; each value is a description of when to invoke it. Precise, contrastive descriptions reduce ambiguity between tools — without them, the Choice distributes mass broadly and confidence falls, triggering the clarification fallback unnecessarily.",
        code: {
          lang: "ts",
          code: `// src/roster.ts
import { choice } from "@caelum/typesafe";

export function makeToolChoiceQ(availableTools: string) {
  return choice(
    "Which tool should be invoked next to advance the goal? Available: " + availableTools,
    {
      web_search: "Look up external information not in the conversation history.",
      code_exec: "Write and execute code to compute, transform, or analyse data.",
      file_read: "Read a file the user has uploaded or referenced by path.",
      respond: "Sufficient information gathered; compose and send the final response.",
    },
  );
}`,
        },
      },
      {
        n: 3,
        heading: "Build the tool-selection step with confidence gating",
        body: "Gate tool selection on calibrated confidence. If confidence is below 0.55, the selector returns a clarify action instead of firing a tool blindly — this is the single most effective guard against agents that loop without making progress because the goal is underspecified.",
        code: {
          lang: "ts",
          code: `// src/selector.ts
import { score } from "@caelum/typesafe";
import { client } from "./client";
import { makeToolChoiceQ } from "./roster";
import type { AgentState } from "./types";

const CONFIDENCE_THRESHOLD = 0.55;
const PROGRESS_RESPOND_THRESHOLD = 4;

export async function selectNextAction(state: AgentState) {
  const { answers } = await client.systemOne({
    state,
    questions: {
      tool: makeToolChoiceQ(state.availableTools),
      progress: score(
        "How close is the agent to completing the goal? " +
        "1 = just started, 3 = halfway, 5 = ready to respond.",
        1,
        5,
      ),
    },
  });

  if (answers.tool.confidence < CONFIDENCE_THRESHOLD) {
    return { action: "clarify", reason: "tool_selection_ambiguous" } as const;
  }
  if (answers.progress.score >= PROGRESS_RESPOND_THRESHOLD) {
    return { action: "respond" } as const;
  }
  return { action: "invoke", tool: answers.tool.choice } as const;
}`,
        },
      },
      {
        n: 4,
        heading: "Execute the selected tool",
        body: "A simple dispatch map routes tool names to their implementations. Keep tool functions pure where possible — they receive state, return a string output, and have no side effects on the agent state. The agent loop handles appending the output to history.",
        code: {
          lang: "ts",
          code: `// src/tools.ts
import type { AgentState } from "./types";

async function webSearch(goal: string): Promise<string> {
  // Replace with your preferred search API.
  return "search results for: " + goal;
}

async function codeExec(goal: string): Promise<string> {
  // Replace with a sandboxed code execution service.
  return "code execution result for: " + goal;
}

async function fileRead(goal: string): Promise<string> {
  // Replace with file access logic.
  return "file content for: " + goal;
}

export async function executeTool(toolName: string, state: AgentState): Promise<string> {
  switch (toolName) {
    case "web_search": return webSearch(state.goal);
    case "code_exec":  return codeExec(state.goal);
    case "file_read":  return fileRead(state.goal);
    default: return "";
  }
}`,
        },
      },
      {
        n: 5,
        heading: "Verify tool output with a Noul",
        body: "After each tool call, check whether the output materially advances the goal. A Noul below 0.60 means the output was unhelpful — log it, increment a retry counter, and give the selector a chance to choose a different tool. Without this check, a failed tool call looks like progress to the next iteration.",
        code: {
          lang: "ts",
          code: `// src/verify.ts
import { noul } from "@caelum/typesafe";
import { client } from "./client";
import type { AgentState } from "./types";

const USEFUL_THRESHOLD = 0.60;

export async function verifyToolOutput(
  state: AgentState,
  toolName: string,
  toolOutput: string,
): Promise<boolean> {
  const { answers } = await client.systemOne({
    state: { ...state, toolName, toolOutput },
    questions: {
      useful: noul(
        "Does the tool output bring the agent materially closer to completing the goal?",
      ),
    },
  });
  return answers.useful.noul >= USEFUL_THRESHOLD;
}`,
        },
      },
      {
        n: 6,
        heading: "Compose the full agent loop",
        body: "The loop calls selectNextAction, executes the tool, verifies the output, appends the result to history, and repeats. A maxSteps guard prevents runaway loops; the progress Score provides an early-exit when the goal is met before maxSteps.",
        code: {
          lang: "ts",
          code: `// src/agent.ts
import { selectNextAction } from "./selector";
import { executeTool } from "./tools";
import { verifyToolOutput } from "./verify";
import type { AgentState } from "./types";

const DEFAULT_TOOLS = "web_search,code_exec,file_read,respond";

export async function runAgent(goal: string, maxSteps = 8) {
  let history = "";

  for (let step = 0; step < maxSteps; step++) {
    const state: AgentState = { goal, history, availableTools: DEFAULT_TOOLS };
    const decision = await selectNextAction(state);

    if (decision.action === "respond" || decision.action === "clarify") {
      return { done: true, reason: decision.action, steps: step, history };
    }

    const output = await executeTool(decision.tool, state);
    const useful = await verifyToolOutput(state, decision.tool, output);

    history +=
      "\n[step " +
      (step + 1) +
      "] " +
      decision.tool +
      " -> " +
      (useful ? "success" : "failed") +
      "\n" +
      output.slice(0, 300);

    if (!useful) continue; // retry with updated history
  }

  return { done: false, reason: "max_steps", steps: maxSteps, history };
}`,
        },
      },
    ],
    expectedOutput:
      'For goal "Find the current Python version and show how to check it": { done: true, reason: "respond", steps: 2, history: "[step 1] web_search -> success\\nPython 3.13.0 released...\\n[step 2] ..." }. The loop terminates cleanly at progress >= 4 without reaching maxSteps.',
    nextSteps: [
      "Add a Choice for reasoning strategy (chain-of-thought / plan-then-act / direct) as a meta-selector before the tool loop.",
      "Track step count and tool distribution across runs to find which tools are selected most often — outliers often indicate a poorly-described tool or a goal type the roster does not cover.",
      "Write a golden test that asserts the agent completes a specific goal in N steps — deterministic decisions make this a real integration test, not a flaky one.",
      "Swap the DEFAULT_TOOLS string for a dynamic list filtered to the tools a specific user has access to.",
    ],
    faqs: [
      {
        q: "Why use a Score for progress instead of a Noul for 'are we done?'",
        a: "The Score gives you a gradient you can act on — you can prompt the selector to choose 'respond' when progress >= 4 rather than waiting for a binary 'yes'. It also lets you track how quickly different goal types converge, which is useful for capacity planning.",
      },
      {
        q: "What happens when the clarify action fires?",
        a: "Return the clarify response to the caller with the reason field. In a chat interface, this means asking the user a follow-up question. In an automated pipeline, it means logging the underspecified goal and escalating it to a human.",
      },
      {
        q: "Is the agent loop reproducible across runs?",
        a: "Yes, for deterministic tool implementations. The typed decision calls are deterministic per state, so the same goal and history produce the same tool selection and verification result — which means you can write regression tests over full agent trajectories.",
      },
      {
        q: "Can I add more tools without changing the selector?",
        a: "Add the tool to DEFAULT_TOOLS and to the roster map in makeToolChoiceQ, and add a case to executeTool. The selector's Choice distributes mass across whatever tools are declared, so a new entry is automatically weighted against the existing ones.",
      },
    ],
    related: [
      { kind: "guide", slug: "for-agents", label: "openjev for agents" },
      { kind: "use-case", slug: "function-calling", label: "Tool selection pattern" },
      { kind: "guide", slug: "noul-primitive", label: "Noul for step verification" },
      { kind: "tutorial", slug: "build-a-support-ticket-router", label: "Back to start: Support ticket router" },
    ],
    updated: UPDATED,
  },
];

export function tutorialBySlug(slug: string): Tutorial | undefined {
  return TUTORIALS.find((t) => t.slug === slug);
}

export const TUTORIAL_SLUGS: readonly string[] = TUTORIALS.map((t) => t.slug);
