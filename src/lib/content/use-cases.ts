/**
 * USE_CASES — the content behind /use-cases and /use-cases/$slug.
 *
 * Each entry is a real, openjev-accurate pattern: a problem statement,
 * how the three System One primitives (Choice / Score / Noul) solve it, which
 * primitive carries the weight, and a runnable code snippet against the
 * @caelum/typesafe-compatible client SDK (POST /api/v1/systemone).
 *
 * These are data only — no JSX — so both the index grid and the dynamic page
 * render from one source of truth.
 */

export type Primitive = "choice" | "score" | "noul" | "mixed";

export interface UseCaseSection {
  readonly heading: string;
  readonly body: string;
}

export interface UseCase {
  /** URL slug — /use-cases/$slug */
  readonly slug: string;
  readonly title: string;
  /** One-line summary for the grid card. */
  readonly summary: string;
  /** Short domain label, e.g. "Compliance". */
  readonly category: string;
  /** Compact stat shown mono-uppercase on the card, e.g. "13 questions, 1 call". */
  readonly stat: string;
  /** The primitive that carries the decision. */
  readonly primitive: Primitive;
  /** Human label for the primitive badge. */
  readonly primitiveLabel: string;
  /** The problem, stated plainly. */
  readonly problem: string;
  /** How OpenJev solves it, and why this primitive. */
  readonly solution: string;
  /** Why the code stays deterministic around the judgment. */
  readonly why: readonly UseCaseSection[];
  /** A runnable snippet against the client SDK. */
  readonly code: string;
  /** Backends this pattern runs well on (subset of the 5). */
  readonly backends: readonly string[];
  /** Related cookbook, when one exists — links to /cookbooks/$id. */
  readonly cookbook?: { readonly label: string; readonly id: string };
}

/** All five OpenJev backends, for reference on each page. */
export const BACKENDS = [
  { id: "laya-mlx", note: "Apple-silicon local, MLX — fastest on a Mac" },
  { id: "laya-onnx", note: "CPU/Linux local, ONNX Runtime — the prod default" },
  { id: "native", note: "Built-in lexical/contrastive scorer, zero model download" },
  { id: "local", note: "Any local server on the OpenAI-shaped route" },
  { id: "any-LLM", note: "Hosted fallback — OpenAI, Anthropic, or compatible" },
] as const;

export const USE_CASES: readonly UseCase[] = [
  {
    slug: "regulatory-briefing",
    title: "Regulatory briefing",
    summary:
      "Batch a 13-question compliance review over a GDPR excerpt into one call — cheaper and faster than 13 prompts.",
    category: "Compliance",
    stat: "13 questions, 1 call",
    primitive: "noul",
    primitiveLabel: "Noul (+ Choice)",
    problem:
      "A compliance checklist over a policy document is a dozen small yes/no questions: does this text define personal data, is consent a lawful basis, is the 72-hour breach-notification duty stated, does it cover extra-territorial scope? Run them as thirteen separate LLM calls and you pay thirteen round-trips of latency and thirteen prompts of tokens, and the answers arrive as prose you still have to parse.",
    solution:
      "Send the document once as state and attach all thirteen questions to a single POST /api/v1/systemone call. Each question is a Noul — a calibrated probability in [0,1], not a coin flip — so a threshold in your code turns the briefing into a pass/fail table. Extra questions are nearly free; only the state is re-read. One call, one latency, thirteen typed judgments.",
    why: [
      {
        heading: "Batching is the whole trick",
        body: "System One evaluates every question against the same state independently. Adding a 14th question costs a few output tokens, not another network hop — the opposite of prompt-per-question fan-out.",
      },
      {
        heading: "Threshold, don't read",
        body: "A Noul is P(yes). Gate at 0.5 for a first-pass table, raise to 0.85 for anything you'll file. The distribution stays available if a reviewer wants to see the borderline items.",
      },
    ],
    code: `import { TypeSafeClient, noul, choice } from "@caelum/typesafe";

const client = new TypeSafeClient({ apiKey: process.env.OPENJEV_API_KEY });

const out = await client.systemOne({
  state: gdprExcerpt, // the full policy text, sent once
  questions: {
    defines_personal_data: noul(
      "Does this text define personal data as information relating to an identifiable person?",
    ),
    consent_is_a_lawful_basis: noul("Is consent listed as a lawful basis for processing?"),
    breach_72h_duty: noul("Is the 72-hour breach-notification duty stated?"),
    extra_territorial: noul("Is the extra-territorial offering/monitoring test stated?"),
    child_consent_age: choice("Default age a child can consent to information-society services?", {
      "13": "Default 13",
      "16": "Default 16, member states may lower to 13",
    }),
    // ...eight more, all in the same call
  },
});

// One call, thirteen typed answers. Threshold in code.
const briefing = Object.entries(out.answers).map(([id, a]) => ({
  id,
  pass: a.type === "noul" ? a.noul >= 0.85 : a.choice === "16",
}));`,
    backends: ["laya-onnx", "laya-mlx", "native"],
    cookbook: { label: "Parallel questions cookbook", id: "parallel" },
  },
  {
    slug: "insurance-adjudication",
    title: "Insurance adjudication",
    summary:
      "Score a claim against a 15-point rubric that returns the same numbers run-to-run, where a raw LLM drifts.",
    category: "Claims",
    stat: "15-question rubric",
    primitive: "score",
    primitiveLabel: "Score (+ Noul gates)",
    problem:
      "Adjudicating a claim means applying a rubric: is the policy in force, is the loss covered, is the documentation complete, is there any fraud signal? Ask an LLM to rate each factor 0–5 and the numbers wander between runs — the same claim scores 3 one minute and 4 the next. You cannot build a pay/deny gate on a number that will not sit still.",
    solution:
      "Model each rubric line as a Score with ordered criteria, and each hard gate (policy in force, fraud flag) as a Noul. System One returns a calibrated score plus the full probability distribution, and it returns the same distribution for the same state — the judgment is stable, so your pay / deny / human-review thresholds mean something. Combine the scores with a deterministic weighted sum in code; the AI never sees the payout math.",
    why: [
      {
        heading: "Stable vs. run-to-run drift",
        body: "A System One model is contrastive and calibrated rather than sampled token-by-token. The same claim state yields the same score, so a fixed threshold is a real gate, not a dice roll.",
      },
      {
        heading: "The money stays in code",
        body: "Scores and Nouls come back typed; the weighted sum, the coverage limits, and the payout ceiling are plain deterministic code. Auditors read the arithmetic, not a prompt.",
      },
    ],
    code: `import { TypeSafeClient, score, noul } from "@caelum/typesafe";

const client = new TypeSafeClient({ apiKey: process.env.OPENJEV_API_KEY });

const out = await client.systemOne({
  state: { claim, policy, evidence },
  questions: {
    documentation_completeness: score("How complete is the supporting documentation?", [
      "Missing core documents",
      "Partial — key items absent",
      "Adequate for a decision",
      "Thorough and consistent",
    ]),
    loss_severity: score("How severe is the described loss?", [
      "Negligible",
      "Minor",
      "Material",
      "Total",
    ]),
    policy_in_force: noul("Was the policy in force on the date of loss?"),
    fraud_signal: noul("Are there indicators of misrepresentation or fraud?"),
  },
});

// Deterministic gate — the AI never sees the payout math.
const s = out.answers;
const decision =
  (s.fraud_signal.type === "noul" && s.fraud_signal.noul > 0.6) ? "deny"
  : (s.policy_in_force.type === "noul" && s.policy_in_force.noul < 0.5) ? "human_review"
  : (s.documentation_completeness.type === "score" && s.documentation_completeness.score >= 2)
    ? "pay" : "human_review";`,
    backends: ["laya-onnx", "native", "laya-mlx"],
    cookbook: { label: "Consistency cookbook", id: "consistency" },
  },
  {
    slug: "function-calling",
    title: "Function calling",
    summary:
      "Turn a natural-language command into a typed function call with per-argument confidence — no JSON-mode parsing.",
    category: "Agents",
    stat: "NL → typed call",
    primitive: "choice",
    primitiveLabel: "Choice (+ Score args)",
    problem:
      "Letting a user say \"dim the kitchen lights to 20% and start the coffee\" and dispatching it to real functions usually means an LLM in JSON mode, a schema, and a parser that breaks when the model hallucinates an argument or returns malformed JSON. You get a call, but no honest signal about which arguments were guessed.",
    solution:
      "Resolve the function name with a Choice over your registered functions, and resolve each argument with its own typed question — a Choice for enums, a Score for magnitudes, a Noul for flags. Every answer arrives with a probability, so you know the confidence of the whole call and its weakest argument. Batch them into one request; keep the dispatch and the defaults in code.",
    why: [
      {
        heading: "Candidates come from code",
        body: "You pass the function registry as Choice options, so the model can only pick a function that exists. No hallucinated names, no invalid enum values — the answer space is closed.",
      },
      {
        heading: "Confidence per argument",
        body: "Each argument is its own primitive with its own probability. Omit low-probability arguments and fall back to a default; confirm with the user only when the weakest argument is genuinely uncertain.",
      },
    ],
    code: `import { TypeSafeClient, choice, score, noul } from "@caelum/typesafe";

const client = new TypeSafeClient({ apiKey: process.env.OPENJEV_API_KEY });

const out = await client.systemOne({
  state: { command: "dim the kitchen lights to 20% and start the coffee" },
  questions: {
    fn: choice("Which function does this command invoke?", {
      set_brightness: "Change a light's brightness level",
      start_appliance: "Turn on a named appliance",
      set_temperature: "Change a thermostat setpoint",
    }),
    room: choice("Which room?", { kitchen: "The kitchen", bedroom: "The bedroom", any: "Unspecified" }),
    brightness: score("Target brightness if a light is mentioned?", [
      "Off", "Dim (~20%)", "Medium (~50%)", "Bright (~80%)", "Full",
    ]),
  },
});

// Closed answer space + per-answer confidence.
const call = out.answers.fn;
if (call.type === "choice" && call.confidence >= 0.7) {
  dispatch(call.choice, argsFrom(out.answers)); // your code, your registry
}`,
    backends: ["laya-mlx", "laya-onnx", "native", "local"],
    cookbook: { label: "Function-calling cookbook", id: "function-calling" },
  },
  {
    slug: "content-moderation",
    title: "Content moderation",
    summary:
      "Gate user content through calibrated Noul safety checks instead of an unpredictable free-text classifier.",
    category: "Trust & Safety",
    stat: "Noul safety gates",
    primitive: "noul",
    primitiveLabel: "Noul",
    problem:
      "Moderation asks a stack of narrow safety questions — is this harassment, does it contain personal data, is it spam, is it off-topic? A free-text classifier answers with a label you have to trust wholesale, and a single blanket 'unsafe/safe' verdict throws away the nuance you need to route borderline items to a human instead of hard-blocking them.",
    solution:
      "Ask each safety dimension as its own Noul against the content state. Each returns a calibrated P(violation), so you set a hard-block threshold high (0.9), a human-review band in the middle, and let clearly-safe content through. Because every gate is independent and typed, you can tune one dimension without touching the others, and you keep an auditable per-dimension score for every decision.",
    why: [
      {
        heading: "Nouls are gates, not verdicts",
        body: "A Noul is P(yes) in [0,1]. Threshold it: high for auto-block, a band for human review, low for pass. You control the strictness per dimension instead of accepting one opaque label.",
      },
      {
        heading: "Independent, tunable dimensions",
        body: "Harassment, PII, and spam are separate questions in the same call. Raise the spam threshold without loosening harassment — the code owns the policy, the model owns the judgment.",
      },
    ],
    code: `import { TypeSafeClient, noul } from "@caelum/typesafe";

const client = new TypeSafeClient({ apiKey: process.env.OPENJEV_API_KEY });

const out = await client.systemOne({
  state: { content: submission.body, context: submission.threadTitle },
  questions: {
    harassment: noul("Does the content target a person with harassment or a threat?"),
    contains_pii: noul("Does the content expose someone's private personal data?"),
    spam: noul("Is the content unsolicited promotional spam?"),
    off_topic: noul("Is the content unrelated to the thread topic?"),
  },
});

// Per-dimension gates — policy in code, judgment in the model.
const n = (k: string) => (out.answers[k]?.type === "noul" ? out.answers[k].noul : 0);
const verdict =
  n("harassment") > 0.9 || n("contains_pii") > 0.9 ? "block"
  : n("harassment") > 0.5 || n("spam") > 0.7 ? "human_review"
  : "allow";`,
    backends: ["laya-onnx", "native", "laya-mlx"],
  },
  {
    slug: "llm-routing",
    title: "LLM routing",
    summary:
      "Pick the right model per request with a Choice over your model roster — a cheap, fast judge in front of expensive models.",
    category: "Infrastructure",
    stat: "Choice over models",
    primitive: "choice",
    primitiveLabel: "Choice",
    problem:
      "Sending every request to your most capable model is slow and expensive; sending everything to the cheapest one drops quality on the hard requests. You want to route — trivial queries to a small model, reasoning-heavy ones to a large model — but writing that router as a prompt to yet another LLM just adds a full generation of latency to every request.",
    solution:
      "Make the router a single Choice over your model roster, evaluated by a System One backend that runs locally in milliseconds. Pass the request as state and the models as options with short rubrics; act on the argmax, and use the confidence to fall back to the safe (larger) model when the router is unsure. The judgment is cheap enough to sit in front of every request.",
    why: [
      {
        heading: "A judge, not a generator",
        body: "System One returns a Choice and a distribution, not prose. On laya-mlx or laya-onnx that is a local, sub-second call — orders of magnitude cheaper than prompting an LLM to route.",
      },
      {
        heading: "Confidence-gated fallback",
        body: "Route on argmax when confident; when confidence is low, default to the larger model. The uncertainty signal is built in, so 'route to the safe option when unsure' is one comparison.",
      },
    ],
    code: `import { TypeSafeClient, choice } from "@caelum/typesafe";

const client = new TypeSafeClient({ apiKey: process.env.OPENJEV_API_KEY });

async function pickModel(userPrompt: string) {
  const out = await client.systemOne({
    state: { request: userPrompt },
    questions: {
      tier: choice("Which model tier fits this request?", {
        small: "Short, factual, or formulaic — a small fast model suffices",
        medium: "Some reasoning or drafting, moderate length",
        large: "Multi-step reasoning, code, or high-stakes output",
      }),
    },
  });
  const t = out.answers.tier;
  if (t.type !== "choice") return "large";
  // Low confidence → fall back to the safe (larger) model.
  return t.confidence < 0.6 ? "large" : t.choice;
}`,
    backends: ["laya-mlx", "laya-onnx", "native"],
    cookbook: { label: "Confidence-gated routing cookbook", id: "confidence" },
  },
  {
    slug: "data-extraction",
    title: "Data extraction",
    summary:
      "A mini → verify → reason cascade: cheap extraction, a Noul verifier that catches errors, escalation only when needed.",
    category: "Documents",
    stat: "SDE cascade",
    primitive: "mixed",
    primitiveLabel: "Noul verify + Choice/Score",
    problem:
      "Extracting structured fields from a document — invoice total, IBAN, buyer, line items — with a single big model is expensive if you run the big model on every document, and unreliable if you run only a small one. You need cheap extraction most of the time, but you cannot ship a wrong total or a wrong IBAN.",
    solution:
      "Run a Structured Data Extraction (SDE) cascade. Stage one: a cheap mini extract pulls candidate fields. Stage two: a Noul verifier asks, for each field, 'does this extracted value match the document?' — a calibrated P(wrong) per field. Stage three: only if any field's P(wrong) crosses the fire threshold does the expensive reasoner run, and only on the flagged fields. Clean documents never touch the big model; the verifier is the gate.",
    why: [
      {
        heading: "The verifier is the gate",
        body: "Each field gets a Noul: P(this value is wrong). Max across fields against a fire threshold decides escalation. You pay for the reasoner only when the cheap path is genuinely at risk.",
      },
      {
        heading: "Escalate fields, not documents",
        body: "When the verifier fires, the reasoner re-extracts just the flagged fields. Correct fields from the mini extract are kept, so escalation cost scales with the number of suspect fields, not the whole document.",
      },
    ],
    code: `import { TypeSafeClient, noul } from "@caelum/typesafe";

const client = new TypeSafeClient({ apiKey: process.env.OPENJEV_API_KEY });

// Stage 1: cheap mini extract (your small model / native backend)
const record = await miniExtract(invoiceText);

// Stage 2: Noul verifier — P(wrong) per field, one call
const out = await client.systemOne({
  state: { document: invoiceText, extracted: record },
  questions: Object.fromEntries(
    Object.entries(record).map(([field, value]) => [
      field,
      noul(\`Is the extracted \${field} = \${JSON.stringify(value)} WRONG for this document?\`),
    ]),
  ),
});

// Stage 3: escalate only the fields that fired
const FIRE = 0.35;
const suspect = Object.entries(out.answers)
  .filter(([, a]) => a.type === "noul" && a.noul > FIRE)
  .map(([field]) => field);

const final = suspect.length ? await reasonerReExtract(invoiceText, suspect, record) : record;`,
    backends: ["native", "laya-onnx", "laya-mlx", "any-LLM"],
    cookbook: { label: "Cascade cookbook", id: "cascade" },
  },

  // ─── 10 new use-cases ─────────────────────────────────────────────────────

  {
    slug: "fraud-triage",
    title: "Fraud triage",
    summary:
      "Score a payment event across four risk dimensions in one typed call — fast enough to sit inline on the authorisation path.",
    category: "Financial Crime",
    stat: "4 typed answers, one call",
    primitive: "mixed",
    primitiveLabel: "Noul + Score + Choice",
    problem:
      "Real-time fraud triage on a payment event must complete in tens of milliseconds. Handing the transaction to a generative model for a prose analysis is too slow, returns unstructured text you still have to parse, and has no honest confidence signal. Rules engines coded by hand are brittle when account-takeover patterns shift week to week.",
    solution:
      "Send the transaction event — amount, merchant category, device fingerprint, velocity window — as state in one System One call. Ask a Noul for account-takeover signal, a Score for velocity (how anomalous is the request rate?), a Noul for identity mismatch, and a Choice over your action set. All four answers arrive in the same response; the action Choice gives your gateway a direct dispatch target with no post-processing.",
    why: [
      {
        heading: "Typed answers slot directly into your gateway",
        body: "The Choice returns one of your closed action slugs — 'pass', 'flag', 'block', '3ds_challenge'. No regex over prose, no switch on a string the model may have hallucinated. The answer space is defined by your code.",
      },
      {
        heading: "Independent dimensions, independent thresholds",
        body: "Nouls for account-takeover and identity-mismatch are separate. Raise the account-takeover threshold after a fraud wave without touching identity-mismatch — the policy lives in your code, not in a rewritten prompt.",
      },
    ],
    code: `import { TypeSafeClient, noul, score, choice } from "@caelum/typesafe";

const client = new TypeSafeClient({ apiKey: process.env.OPENJEV_API_KEY });

const out = await client.systemOne({
  state: {
    amount_usd: txn.amount,
    merchant_category: txn.mcc,
    device_new: txn.deviceFirstSeen,
    velocity_1h: txn.countLast1h,
    billing_country: txn.billingCountry,
    ip_country: txn.ipCountry,
  },
  questions: {
    account_takeover: noul(
      "Does the pattern — new device, mismatched countries, unusual amount — suggest an account-takeover?",
    ),
    velocity_anomaly: score(
      "How anomalous is the transaction rate for this account in the past hour?",
      ["Normal", "Slightly elevated", "Elevated", "High", "Extreme"],
    ),
    identity_mismatch: noul(
      "Does the billing country differ from the IP country in a way consistent with fraud rather than travel?",
    ),
    action: choice("Recommended action for this transaction?", {
      pass: "Approve normally",
      flag: "Approve and flag for review",
      "3ds_challenge": "Require 3-D Secure step-up",
      block: "Decline the transaction",
    }),
  },
});

const a = out.answers;
const finalAction =
  a.account_takeover.type === "noul" && a.account_takeover.noul > 0.85
    ? "block"
    : a.action.type === "choice"
      ? a.action.choice
      : "flag";`,
    backends: ["laya-onnx", "native", "laya-mlx"],
    cookbook: { label: "Confidence-gated routing cookbook", id: "confidence" },
  },

  {
    slug: "lead-scoring",
    title: "Lead scoring",
    summary:
      "Produce a three-axis lead profile — intent, ICP fit, buying authority — in one typed call before an SDR ever opens a record.",
    category: "CRM / Sales",
    stat: "3-axis profile, 1 call",
    primitive: "score",
    primitiveLabel: "Score + Noul + Choice",
    problem:
      "Sales wants every inbound lead ranked before an SDR touches it. Firmographic rules miss the signal in free-text fields like job title and company description. Asking a generative model for a prose ranking is expensive per lead, and the output — '7 out of 10' — is not a typed number your CRM can sort on without parsing.",
    solution:
      "Pass the enriched lead record as state. Ask a Score for intent intensity, a Score for ICP fit against your ideal-customer profile, a Noul for whether the contact has budget or buying authority, and a Choice for the right outreach sequence. One call gives your CRM three sortable dimensions plus a routing decision — all typed, no parsing, no separate scoring service.",
    why: [
      {
        heading: "Scores are typed numbers, not prose",
        body: "A Score returns an integer index and a full probability distribution over the criteria. Your CRM stores the index; your SDR sees the distribution if they want to understand the borderline cases.",
      },
      {
        heading: "Routing is a Choice, not a downstream rule",
        body: "The outreach sequence is a closed Choice over your registered sequence IDs. The model can only return a sequence that exists in your CRM, so the routing decision is immediately actionable.",
      },
    ],
    code: `import { TypeSafeClient, score, noul, choice } from "@caelum/typesafe";

const client = new TypeSafeClient({ apiKey: process.env.OPENJEV_API_KEY });

const out = await client.systemOne({
  state: {
    company_name: lead.company,
    job_title: lead.title,
    company_size: lead.employeeCount,
    industry: lead.industry,
    form_message: lead.message,
    icp_criteria: ICP_DEFINITION, // your ideal-customer profile text
  },
  questions: {
    intent_intensity: score(
      "How strong is the intent signal in the form message and title?",
      ["No signal", "Weak curiosity", "Active evaluation", "Ready to buy"],
    ),
    icp_fit: score(
      "How well does this company match the ICP?",
      ["Poor fit", "Partial fit", "Good fit", "Ideal fit"],
    ),
    has_authority: noul(
      "Does the job title suggest budget ownership or buying authority?",
    ),
    sequence: choice("Which outreach sequence fits this lead?", {
      enterprise_inbound: "Large company, strong ICP fit",
      smb_nurture: "Small company, weaker fit, long nurture",
      champion_fast: "Budget owner at a good-fit company — move fast",
      low_intent: "Low intent — drip only",
    }),
  },
});

// Write typed scores back to CRM.
const a = out.answers;
await crm.updateLead(lead.id, {
  intentScore: a.intent_intensity.type === "score" ? a.intent_intensity.score : 0,
  icpScore:    a.icp_fit.type === "score"          ? a.icp_fit.score          : 0,
  hasAuthority: a.has_authority.type === "noul"    ? a.has_authority.noul > 0.6 : false,
  sequence:    a.sequence.type === "choice"         ? a.sequence.choice        : "low_intent",
});`,
    backends: ["laya-onnx", "laya-mlx", "any-LLM"],
  },

  {
    slug: "sentiment-gating",
    title: "Sentiment gating",
    summary:
      "Gate a customer message across frustration, urgency, and escalation dimensions before routing — calibrated Nouls, not a coarse positive/negative label.",
    category: "Customer Experience",
    stat: "4 Nouls, 1 routing call",
    primitive: "noul",
    primitiveLabel: "Noul",
    problem:
      "Before routing a customer message to an automated response or a human agent, you need more than a positive/negative label. A frustrated but non-urgent message should go to a priority bot; an urgent escalation should go to a human. A coarse sentiment classifier collapses all that nuance into one label and gives you no way to tune the thresholds independently.",
    solution:
      "Ask four Nouls against the message: P(frustrated), P(urgent), P(escalation language), P(policy complaint). Each is a calibrated probability in [0,1]. A threshold matrix in your routing code decides the destination — high frustration + high urgency to a human, urgency without escalation to a priority queue, both low to the standard bot. Because the four dimensions are independent, changing the urgency threshold does not affect how frustration is evaluated.",
    why: [
      {
        heading: "Calibrated probability, not a coin flip",
        body: "A Noul is not a token-sampled 'yes'. It is a contrastive probability that stays stable across runs, so a threshold of 0.7 means the same thing on Monday as it does on Friday. Your routing policy is reproducible.",
      },
      {
        heading: "Four independent dials",
        body: "Frustration, urgency, escalation, and policy complaints are separate questions. Raise the escalation threshold during peak season without touching the frustration gate — the thresholds live in code, not in a rewritten prompt.",
      },
    ],
    code: `import { TypeSafeClient, noul } from "@caelum/typesafe";

const client = new TypeSafeClient({ apiKey: process.env.OPENJEV_API_KEY });

const out = await client.systemOne({
  state: {
    message: inbound.body,
    subject: inbound.subject,
    channel: inbound.channel, // "email" | "chat" | "sms"
    history_summary: inbound.lastThreeMessages,
  },
  questions: {
    frustrated: noul(
      "Does the message express frustration, disappointment, or strong dissatisfaction?",
    ),
    urgent: noul(
      "Does the customer indicate time sensitivity or a blocking problem?",
    ),
    escalation: noul(
      "Does the message explicitly request escalation, a manager, or formal complaint handling?",
    ),
    policy_complaint: noul(
      "Is the complaint directed at a company policy rather than a one-off experience?",
    ),
  },
});

const n = (k: string): number =>
  out.answers[k]?.type === "noul" ? (out.answers[k] as { noul: number }).noul : 0;

const route =
  n("escalation") > 0.75 || (n("frustrated") > 0.8 && n("urgent") > 0.7)
    ? "human_agent"
    : n("urgent") > 0.65
      ? "priority_queue"
      : n("policy_complaint") > 0.6
        ? "policy_bot"
        : "standard_bot";`,
    backends: ["laya-onnx", "native", "laya-mlx"],
    cookbook: { label: "Parallel questions cookbook", id: "parallel" },
  },

  {
    slug: "pr-review-gate",
    title: "PR review gate",
    summary:
      "A CI step that gates a pull request on four typed Noul risk dimensions — auditable thresholds you commit to the repo.",
    category: "DevOps / CI",
    stat: "4-dimension typed gate",
    primitive: "noul",
    primitiveLabel: "Noul",
    problem:
      "A CI gate that should block risky pull requests needs to be deterministic and auditable. A prose-output LLM code review returns unstructured text; extracting a pass/fail from that text is fragile and introduces a second prompt to parse the first. You cannot commit a prose parser as your merge policy.",
    solution:
      "Send the diff as state and ask a Noul for each risk dimension: security-sensitive change, breaking public API change, missing test coverage for new code, risky database migration. The CI step compares four floats to thresholds declared in your repo. If any fires, the gate blocks with a specific reason message derived from which Noul crossed the line — not from parsing prose.",
    why: [
      {
        heading: "Thresholds are config, not prose",
        body: "The gate is four numeric comparisons. Adjust the security threshold to 0.6 in a config file; commit the change; the new policy is in effect. No prompt engineering required, no re-deployment of a custom model.",
      },
      {
        heading: "Each dimension is independent",
        body: "A refactor that touches auth code fires the security Noul without necessarily triggering the API-breaking one. The reviewer sees exactly which dimension fired, not a vague 'review required' verdict.",
      },
    ],
    code: `import { TypeSafeClient, noul } from "@caelum/typesafe";

const client = new TypeSafeClient({ apiKey: process.env.OPENJEV_API_KEY });

// Thresholds committed to the repo — the policy lives in code, not in a prompt.
const THRESHOLDS = { security: 0.65, breaking_api: 0.7, missing_tests: 0.75, risky_migration: 0.8 };

const out = await client.systemOne({
  state: {
    diff: prDiff,
    changed_files: changedFiles,
    added_lines: addedLines,
    test_files_changed: testFilesChanged,
  },
  questions: {
    security_change: noul(
      "Does the diff modify authentication, authorisation, secrets handling, or cryptographic code?",
    ),
    breaking_api: noul(
      "Does the diff change a public API signature, remove exported symbols, or alter a shared schema in a non-backward-compatible way?",
    ),
    missing_tests: noul(
      "Does the diff add significant new logic paths without corresponding test coverage?",
    ),
    risky_migration: noul(
      "Does the diff include a database migration that drops columns, renames tables, or alters indexes on a large table?",
    ),
  },
});

const blocks = (Object.keys(THRESHOLDS) as Array<keyof typeof THRESHOLDS>).filter((dim) => {
  const a = out.answers[dim];
  return a?.type === "noul" && a.noul >= THRESHOLDS[dim];
});

if (blocks.length > 0) {
  console.error("Gate blocked on:", blocks.join(", "));
  process.exit(1);
}`,
    backends: ["laya-onnx", "native", "any-LLM"],
  },

  {
    slug: "rag-answer-grading",
    title: "RAG answer grading",
    summary:
      "Grade a generated answer on grounding, completeness, and contradiction in one typed call — without asking the generator to evaluate itself.",
    category: "RAG / Retrieval",
    stat: "3 Nouls post-generation",
    primitive: "noul",
    primitiveLabel: "Noul",
    problem:
      "A RAG pipeline needs to know whether a generated answer is faithfully grounded in the retrieved passages, complete enough to publish, and free of contradictions. Self-evaluation — asking the same model to grade its own output — is circular. A separate grading prompt adds a full generation of latency and returns prose you have to parse to extract a pass/fail.",
    solution:
      "After generation, send the {question, passages, answer} triple as state and ask three Nouls: P(answer is grounded in the passages), P(answer is complete given the question), P(answer contradicts any passage). A low grounding score routes the question back to the retriever for a second pass; a high contradiction score blocks publication; a low completeness score surfaces a 'partial answer' flag in the UI. Three calibrated floats, one short call, no prose parser.",
    why: [
      {
        heading: "Grounding without circular self-eval",
        body: "The grader runs as a separate System One call with a different prompt structure from the generator. It is not asking the generator 'was that good?'; it is applying a contrastive model to the (passages, answer) pair.",
      },
      {
        heading: "Three distinct axes, three distinct actions",
        body: "Low grounding means retrieve more context. High contradiction means discard the answer. Low completeness means show a partial-result label. Each action is driven by a single float comparison — no branch on a parsed string.",
      },
    ],
    code: `import { TypeSafeClient, noul } from "@caelum/typesafe";

const client = new TypeSafeClient({ apiKey: process.env.OPENJEV_API_KEY });

// After your RAG generator returns \`answer\`:
const out = await client.systemOne({
  state: {
    question,
    passages, // the retrieved chunks, as text or structured array
    answer,   // the generated answer
  },
  questions: {
    grounded: noul(
      "Is every factual claim in the answer supported by at least one of the retrieved passages?",
    ),
    complete: noul(
      "Does the answer address all the distinct sub-questions implied by the original question?",
    ),
    contradicts: noul(
      "Does the answer make any claim that directly contradicts a statement in the retrieved passages?",
    ),
  },
});

const g = out.answers;
const groundingScore  = g.grounded.type   === "noul" ? g.grounded.noul   : 0;
const complete        = g.complete.type   === "noul" ? g.complete.noul   : 0;
const contradicts     = g.contradicts.type === "noul" ? g.contradicts.noul : 0;

if (contradicts > 0.6) {
  return { status: "blocked", reason: "contradiction" };
} else if (groundingScore < 0.5) {
  return { status: "rerank", reason: "low_grounding" };
} else {
  return { status: "publish", partial: complete < 0.6, answer };
}`,
    backends: ["laya-onnx", "native", "laya-mlx", "any-LLM"],
    cookbook: { label: "Cascade cookbook", id: "cascade" },
  },

  {
    slug: "agent-tool-selection",
    title: "Agent tool selection",
    summary:
      "Let a lightweight System One Choice — not a generation step — pick the next tool in an agentic loop, with a confidence signal for stuck detection.",
    category: "Agents",
    stat: "Choice + stuck detection",
    primitive: "choice",
    primitiveLabel: "Choice",
    problem:
      "In an agentic loop, the orchestrator must pick a tool at each step. Asking the orchestrator LLM to choose via prose generation adds a full generation step per turn, can return a hallucinated tool name, and gives no confidence signal — so the loop has no way to detect that it is stuck or confused short of counting repeated calls.",
    solution:
      "At each step, send the agent's working memory (goal, last observation, step count) as state and the tool registry as a Choice question. The call is local and sub-second on laya-onnx or laya-mlx. The answer is a valid tool slug from your registry — hallucination of a non-existent tool is structurally impossible. The confidence value drives stuck detection: below a threshold, prompt the user for clarification rather than guessing.",
    why: [
      {
        heading: "Closed registry, no hallucinated tool names",
        body: "Choice options come from your code. The model can only return a tool that exists in your registry. Invalid function names, mismatched capitalisation, and invented APIs are impossible by construction.",
      },
      {
        heading: "Confidence is a built-in stuck detector",
        body: "When confidence drops below your threshold across two consecutive steps, the agent surfaces a disambiguation question to the user rather than spinning. The signal is a single float comparison — no separate classifier, no heuristic over repeated calls.",
      },
    ],
    code: `import { TypeSafeClient, choice, noul } from "@caelum/typesafe";

const client = new TypeSafeClient({ apiKey: process.env.OPENJEV_API_KEY });

async function pickNextTool(memory: AgentMemory): Promise<ToolCall | "clarify"> {
  const toolOptions = Object.fromEntries(
    TOOL_REGISTRY.map((t) => [t.id, t.description]),
  ) as Record<string, string>;

  const out = await client.systemOne({
    state: {
      goal: memory.goal,
      last_observation: memory.lastObservation,
      step: memory.stepCount,
      completed_steps: memory.completedSteps,
    },
    questions: {
      tool: choice("Which registered tool should be called next to make progress toward the goal?", toolOptions),
      needs_clarification: noul(
        "Is the goal or the current state ambiguous enough that a human clarification would help?",
      ),
    },
  });

  const toolAnswer = out.answers.tool;
  const needsClarify = out.answers.needs_clarification;

  // Stuck signal: low confidence or explicit ambiguity
  if (
    needsClarify.type === "noul" && needsClarify.noul > 0.65
    || toolAnswer.type !== "choice" || toolAnswer.confidence < 0.55
  ) {
    return "clarify";
  }

  return { toolId: toolAnswer.choice, confidence: toolAnswer.confidence };
}`,
    backends: ["laya-mlx", "laya-onnx", "native"],
    cookbook: { label: "Function-calling cookbook", id: "function-calling" },
  },

  {
    slug: "email-classification",
    title: "Email classification",
    summary:
      "Route every inbound email to an action bucket and a priority level before the inbox layer ever calls an LLM — typed, parseable, closed-set.",
    category: "Operations",
    stat: "Action + priority, 1 call",
    primitive: "choice",
    primitiveLabel: "Choice + Score",
    problem:
      "An inbox management layer needs to classify every incoming email into an action bucket and a priority level before routing it to the right workflow. A generative classifier writes prose ('This looks like a sales inquiry, probably high priority') that still has to be parsed. A keyword filter misses the intent in nuanced professional language like 'circling back' or 'as per our last call'.",
    solution:
      "Send the email headers, subject, and body as state. Ask a Choice for the action bucket (closed over your workflow slugs), a Score for urgency, and — if a response is expected — a Choice for the reply tone. Three questions, one call, three typed answers: the routing dispatch, the SLA tier, and the drafting hint arrive together with no post-processing.",
    why: [
      {
        heading: "Action bucket is your slug, not a parsed string",
        body: "The Choice options are your actual workflow identifiers. The answer plugs directly into your routing code without a normalisation step. If you add a new bucket, you add an option; old emails are unaffected.",
      },
      {
        heading: "Score drives the SLA tier",
        body: "Urgency is a Score over ordered criteria rather than a sampled '1–5' number. The same email produces the same score, so your SLA buckets are stable thresholds, not moving targets.",
      },
    ],
    code: `import { TypeSafeClient, choice, score } from "@caelum/typesafe";

const client = new TypeSafeClient({ apiKey: process.env.OPENJEV_API_KEY });

const out = await client.systemOne({
  state: {
    from: email.from,
    subject: email.subject,
    body: email.body.slice(0, 2000), // trim to context budget
    thread_length: email.threadLength,
    sender_domain: email.senderDomain,
  },
  questions: {
    action: choice("Which inbox action does this email require?", {
      respond: "A direct reply is expected",
      triage: "Needs a human decision before acting",
      archive: "Informational — no reply needed",
      escalate: "Requires immediate executive attention",
      forward: "Should be forwarded to another team",
      unsubscribe: "Automated or bulk mail to unsubscribe",
    }),
    urgency: score("How urgent is a response?", [
      "No urgency — respond in days",
      "Normal — respond today",
      "Elevated — respond within an hour",
      "Immediate — respond now",
    ]),
    reply_tone: choice("If a reply is needed, what tone fits?", {
      formal: "Professional / external stakeholder",
      friendly: "Internal or known contact",
      concise: "Busy executive — bullet points only",
      none: "No reply needed",
    }),
  },
});

const a = out.answers;
await inbox.route(email.id, {
  action:  a.action.type    === "choice" ? a.action.choice    : "triage",
  urgency: a.urgency.type   === "score"  ? a.urgency.score    : 1,
  tone:    a.reply_tone.type === "choice" ? a.reply_tone.choice : "none",
});`,
    backends: ["laya-onnx", "laya-mlx", "native"],
  },

  {
    slug: "support-ticket-routing",
    title: "Support ticket routing",
    summary:
      "Assign a ticket to the right team slug, SLA tier, and churn-risk flag in one call — closed answer space, no keyword rules.",
    category: "Support",
    stat: "Team + SLA + churn signal",
    primitive: "mixed",
    primitiveLabel: "Choice + Score + Noul",
    problem:
      "A helpdesk routes incoming tickets to the right team and assigns an SLA tier. A keyword-rules engine misroutes too often when customers describe technical billing problems using customer-service language, or vice versa. An LLM asked to route free-text returns a team name that may not match your internal slugs — you still need a normalisation step.",
    solution:
      "Send the ticket text as state. Ask a Choice over your closed set of team slugs, a Score for severity, and a Noul for churn risk. The Choice can only return a valid team slug; the Score drives the SLA bucket; the churn Noul flags the ticket for account management. All three typed answers are immediately actionable — no normalisation, no parsing, no separate risk classifier.",
    why: [
      {
        heading: "Team slug is always valid",
        body: "You pass your team registry as Choice options. The model cannot return a team that does not exist in your helpdesk. Renaming a team means updating the options, not tuning a prompt.",
      },
      {
        heading: "Churn risk is a Noul, not a label",
        body: "A probability threshold for churn escalation can be adjusted without touching the routing logic or the severity scoring. The three questions are independent — change one threshold without moving the others.",
      },
    ],
    code: `import { TypeSafeClient, choice, score, noul } from "@caelum/typesafe";

const client = new TypeSafeClient({ apiKey: process.env.OPENJEV_API_KEY });

const out = await client.systemOne({
  state: {
    subject: ticket.subject,
    body: ticket.body,
    plan: customer.plan,       // e.g. "enterprise"
    tenure_days: customer.tenureDays,
    open_tickets_30d: customer.openTickets30d,
  },
  questions: {
    team: choice("Which team should own this ticket?", {
      billing:          "Payment, invoice, or subscription issues",
      technical:        "Product bugs, API errors, or integration failures",
      account:          "Upgrades, downgrades, cancellations, or SLA questions",
      product_feedback: "Feature requests or UX suggestions",
      security:         "Potential data or security incidents",
    }),
    severity: score("How severe is the impact on the customer?", [
      "Inconvenience — workaround exists",
      "Degraded — partial functionality lost",
      "Blocking — key workflow stopped",
      "Critical — data loss or security risk",
    ]),
    churn_risk: noul(
      "Does the combination of message tone, plan tier, and ticket history suggest a meaningful risk of cancellation?",
    ),
  },
});

const a = out.answers;
await helpdesk.assign(ticket.id, {
  team:      a.team.type       === "choice" ? a.team.choice            : "technical",
  severity:  a.severity.type   === "score"  ? a.severity.score         : 0,
  sla_hours: SLA_MAP[a.severity.type === "score" ? a.severity.score : 0],
  escalate:  a.churn_risk.type === "noul"   && a.churn_risk.noul > 0.7,
});`,
    backends: ["laya-onnx", "native", "laya-mlx"],
    cookbook: { label: "Parallel questions cookbook", id: "parallel" },
  },

  {
    slug: "document-tagging",
    title: "Document tagging",
    summary:
      "Tag every uploaded document with a category, retention policy, and sensitivity level from closed taxonomies — no invalid tags possible.",
    category: "Documents",
    stat: "3 taxonomy fields, 1 call",
    primitive: "choice",
    primitiveLabel: "Choice",
    problem:
      "A document management system needs to tag every uploaded file with a category, a retention policy, and an access-sensitivity level so downstream search indices and access controls are populated automatically. Letting a generative model output a JSON object means the field values can drift from your closed taxonomy — you still need a validation step that rejects or normalises invalid tags.",
    solution:
      "Send the document text or a summary as state. Ask a Choice for each of the three taxonomy fields, with your exact taxonomy entries as options. The model can only return a value that exists in your taxonomy; invalid tags do not exist in the answer space. One call, three Choice answers, three valid index fields — the document is tagged before the upload handler returns.",
    why: [
      {
        heading: "The taxonomy is the option set",
        body: "Choice options are your actual taxonomy strings. The model cannot invent a new tag or return a near-synonym. Adding a new taxonomy entry is a code change, not a prompt engineering exercise.",
      },
      {
        heading: "All three fields in one call",
        body: "Category, retention, and sensitivity are three separate questions in the same System One call. Each has its own probability distribution — the full distribution is available for borderline items that a reviewer might want to inspect.",
      },
    ],
    code: `import { TypeSafeClient, choice } from "@caelum/typesafe";

const client = new TypeSafeClient({ apiKey: process.env.OPENJEV_API_KEY });

// Your closed taxonomies — defined once, used as Choice options.
const CATEGORIES = {
  contract:      "Legal contract or agreement",
  invoice:       "Invoice or financial record",
  policy:        "Internal policy or procedure",
  report:        "Business or technical report",
  correspondence:"Email or letter correspondence",
  technical_spec:"Engineering or product specification",
  other:         "Does not fit another category",
};

const RETENTION = {
  "1y":  "Keep for 1 year",
  "3y":  "Keep for 3 years",
  "7y":  "Keep for 7 years — financial / legal",
  "10y": "Keep for 10 years — regulatory",
  perm:  "Permanent — company records",
};

const SENSITIVITY = {
  public:       "Can be shared publicly",
  internal:     "Internal use only",
  confidential: "Restricted to need-to-know",
  secret:       "Highly restricted — executive / legal",
};

const out = await client.systemOne({
  state: { text: documentText.slice(0, 3000) },
  questions: {
    category:   choice("What category best describes this document?", CATEGORIES),
    retention:  choice("Which retention policy applies to this document?", RETENTION),
    sensitivity: choice("What is the access-sensitivity level of this document?", SENSITIVITY),
  },
});

const a = out.answers;
await dms.setMetadata(doc.id, {
  category:    a.category.type    === "choice" ? a.category.choice    : "other",
  retention:   a.retention.type   === "choice" ? a.retention.choice   : "3y",
  sensitivity: a.sensitivity.type === "choice" ? a.sensitivity.choice : "internal",
});`,
    backends: ["laya-onnx", "native", "laya-mlx"],
    cookbook: { label: "Function-calling cookbook", id: "function-calling" },
  },

  {
    slug: "spam-detection",
    title: "Spam detection",
    summary:
      "Separate unsolicited commercial mail, auto-generated filler, and coordinated inauthentic behaviour into three independent Noul axes instead of one coarse label.",
    category: "Trust & Safety",
    stat: "3 independent Noul axes",
    primitive: "noul",
    primitiveLabel: "Noul",
    problem:
      "Spam detection needs to distinguish unsolicited commercial email from legitimate mass communication, auto-generated low-quality filler from genuine posts, and coordinated inauthentic behaviour from normal high-volume activity — three axes that a single 'spam / not spam' classifier collapses into one label, making it impossible to tune one without disrupting the others.",
    solution:
      "Ask three Nouls against the content: P(unsolicited commercial), P(auto-generated low-quality), P(coordinated inauthentic). Each is a calibrated probability from a separate question in a single call. Threshold the commercial axis for a bulk-mail filter, the auto-generated axis for a content-quality gate, and the coordinated axis for a trust-and-safety action. Each threshold is adjusted independently in code; reviewers see a three-number audit trail for every decision.",
    why: [
      {
        heading: "Three dials, not one verdict",
        body: "A legitimate marketing campaign scores high on commercial but low on coordinated and low on auto-generated. A bot farm scores high on coordinated and auto-generated but low on commercial. The separate axes tell the platform what kind of intervention is appropriate.",
      },
      {
        heading: "Calibrated for a threshold, not for a label",
        body: "Each Noul is contrastively calibrated — the same content returns the same float. A commercial-spam threshold of 0.8 means the same thing across every request, so false positive rates are stable and measurable.",
      },
    ],
    code: `import { TypeSafeClient, noul } from "@caelum/typesafe";

const client = new TypeSafeClient({ apiKey: process.env.OPENJEV_API_KEY });

const out = await client.systemOne({
  state: {
    content: submission.body,
    sender_domain: submission.senderDomain,
    submission_rate_per_hour: submission.ratePerHour,
    account_age_days: submission.accountAgeDays,
    identical_submissions: submission.identicalCount,
  },
  questions: {
    unsolicited_commercial: noul(
      "Is this content unsolicited commercial promotion sent to an audience that did not request it?",
    ),
    auto_generated: noul(
      "Does the content appear to be algorithmically or template-generated rather than authored by a human?",
    ),
    coordinated_inauthentic: noul(
      "Are the behavioural signals — submission rate, identical count, account age — consistent with coordinated inauthentic activity?",
    ),
  },
});

const n = (k: string): number =>
  out.answers[k]?.type === "noul" ? (out.answers[k] as { noul: number }).noul : 0;

// Independent thresholds per axis — tune one without touching the others.
const THRESHOLDS = { unsolicited_commercial: 0.8, auto_generated: 0.75, coordinated_inauthentic: 0.7 };

const actions: string[] = [];
if (n("unsolicited_commercial")   >= THRESHOLDS.unsolicited_commercial)   actions.push("bulk_filter");
if (n("auto_generated")           >= THRESHOLDS.auto_generated)           actions.push("quality_hold");
if (n("coordinated_inauthentic")  >= THRESHOLDS.coordinated_inauthentic)  actions.push("trust_safety_review");

await moderation.record(submission.id, {
  scores: {
    commercial:    n("unsolicited_commercial"),
    auto_generated: n("auto_generated"),
    coordinated:   n("coordinated_inauthentic"),
  },
  actions: actions.length > 0 ? actions : ["allow"],
});`,
    backends: ["laya-onnx", "native", "laya-mlx"],
    cookbook: { label: "Parallel questions cookbook", id: "parallel" },
  },
] as const;

export function useCaseBySlug(slug: string): UseCase | undefined {
  return USE_CASES.find((u) => u.slug === slug);
}
