/**
 * SOLUTIONS — content behind /solutions and /solutions/$slug.
 *
 * Eight per-industry solution pages: fintech, healthcare, legal, customer-support,
 * ecommerce, content-moderation, insurance, and developer-tools.
 *
 * Each page covers the industry's decision problems, a real System One example
 * for that vertical, the primitives used, compliance and latency notes, FAQ,
 * and cross-links to use-cases, guides, and benchmarks.
 *
 * Data only — no JSX. Both the hub grid and the detail page render from here.
 */

import { MEASURED_LATENCY as ML } from "@/lib/content/benchmarks";

export type SolutionPrimitive = "choice" | "score" | "noul" | "mixed";

export interface SolutionSection {
  readonly heading: string;
  readonly body: string;
  readonly bullets?: readonly string[];
  readonly code?: { readonly lang?: string; readonly code: string };
}

export interface SolutionFAQ {
  readonly q: string;
  readonly a: string;
}

export interface SolutionRelated {
  readonly kind: "guide" | "use-case" | "compare" | "benchmark";
  /** Empty string for kind="benchmark" (links to /benchmarks directly). */
  readonly slug: string;
  readonly label: string;
}

export interface Solution {
  readonly slug: string;
  readonly title: string;
  readonly navLabel: string;
  /** Short domain label shown mono-uppercase, e.g. "Fintech". */
  readonly industry: string;
  readonly description: string;
  readonly keywords: readonly string[];
  readonly intro: string;
  readonly takeaways: readonly string[];
  /** The dominant primitive (or "mixed" for all three). */
  readonly primitive: SolutionPrimitive;
  readonly primitiveLabel: string;
  readonly sections: readonly SolutionSection[];
  readonly faqs: readonly SolutionFAQ[];
  readonly related: readonly SolutionRelated[];
  readonly updated: string;
}

const UPDATED = "2026-09-23";

export const SOLUTIONS: readonly Solution[] = [
  // ── Fintech ───────────────────────────────────────────────────────────────
  {
    slug: "fintech",
    title: "Typed decisions for fintech: fraud, risk, and compliance gates",
    navLabel: "Fintech",
    industry: "Fintech",
    description:
      "How fintech teams use Choice, Score, and Noul to classify transactions, score risk, and gate on fraud signals — with self-hosted data residency and no generation step on the authorization path.",
    keywords: [
      "fintech llm decisions",
      "fraud detection llm",
      "transaction risk scoring",
      "aml kyc classification",
      "typed decision fintech",
    ],
    intro:
      "Financial decisions carry legal and financial consequences, so they cannot be guesses from a generative model. OpenJev replaces ad-hoc LLM calls with typed decisions — a Noul for fraud probability, a Score for risk level, a Choice for disposition — backed by calibrated confidence you can audit and threshold. Self-hosting keeps card data and account details inside your compliance boundary.",
    takeaways: [
      "A Noul returns a calibrated fraud probability you threshold at your operating point — not a generated 'yes' you parse.",
      "Score risk on 0–5 rubric levels, Choice the disposition, and Noul the fraud signal in one call over the same transaction state.",
      "Self-host with laya-onnx to meet PCI-DSS data residency requirements: no card data leaves your boundary.",
      "Deterministic per input means every decision has a replayable audit record — the same transaction always scores the same way.",
    ],
    primitive: "mixed",
    primitiveLabel: "Choice + Score + Noul",
    sections: [
      {
        heading: "Decision problems in fintech",
        body: "Financial services run on a dense stack of closed-set judgments. Each is a prime candidate for a typed decision rather than a generative call:",
        bullets: [
          "Real-time fraud scoring: given transaction attributes and account history, how likely is this fraud?",
          "AML/KYC flagging: does this profile or transaction match a pattern that requires a SAR?",
          "Credit risk triage: which risk bucket does this applicant belong to, and with what confidence?",
          "Authorization disposition: approve, review, or decline — based on risk score and fraud probability.",
          "Compliance checklist: does this record satisfy required data fields before origination?",
        ],
      },
      {
        heading: "System One in fintech",
        body: "One request scores the fraud signal, assigns a risk level, and chooses a disposition — all over the same transaction state, with calibrated confidence on each judgment.",
        code: {
          lang: "ts",
          code: `import { choice, noul, score } from "@caelum/typesafe";

const { answers } = await client.systemOne({
  state: { transaction, account, history },
  questions: {
    fraud_signal: noul("Does \\\`transaction\\\` show fraud patterns given \\\`history\\\`?"),
    risk_level:   score("Transaction risk level (0=safe, 5=block)?", 0, 5),
    action:       choice("Correct action for this transaction?", {
      approve: "Allow the transaction to proceed.",
      review:  "Hold for manual review before approving.",
      decline: "Reject immediately.",
    }),
  },
});

if (answers.fraud_signal.noul > 0.6 || answers.risk_level.score >= 4) {
  decline(transaction);
} else if (answers.action.confidence < 0.75) {
  queueForReview(transaction, answers.action.probabilities);
} else {
  execute(answers.action.choice);
}`,
        },
      },
      {
        heading: "Compliance and latency",
        body: "PCI-DSS requires that cardholder data not be transmitted to third-party services beyond the approved scope. Running OpenJev self-hosted keeps transaction data entirely inside your infrastructure — no card number, account detail, or fraud feature ever leaves your boundary. Decisions are deterministic per input, so every outcome is reproducible for audit: the same transaction always scores the same way. On the default embedding engine a single-question decision measured " + ML.embedding1 + " (engine time on " + ML.machine + ", excluding network); measure end-to-end against your own authorization timeout.",
      },
    ],
    faqs: [
      {
        q: "Can I use this for real-time payment authorization?",
        a: "Yes. With a local engine there is no generation step: the default embedding engine measured " + ML.embedding1 + " per single-question decision (" + ML.source + "). Check that against your authorization-path budget end-to-end. There is no generation, so there is no variable-latency token-sampling step.",
      },
      {
        q: "How do I meet PCI-DSS data residency for the LLM step?",
        a: "Self-host the Docker image inside your cardholder data environment and point the SDK at it. No transaction data leaves your boundary, and the decision path has no third-party dependency.",
      },
      {
        q: "What threshold should I use for the fraud Noul?",
        a: "Start conservatively — review above 0.5, block above 0.75 — then adjust based on your observed false-positive and false-negative rates. Because the confidence is calibrated, the threshold means the same thing across all calls.",
      },
    ],
    related: [
      { kind: "use-case", slug: "fraud-triage", label: "Fraud triage pattern" },
      { kind: "use-case", slug: "lead-scoring", label: "Lead scoring pattern" },
      { kind: "guide", slug: "noul-primitive", label: "Noul, in depth" },
      { kind: "guide", slug: "confidence-calibration", label: "Calibrated confidence" },
      { kind: "benchmark", slug: "", label: "Latency benchmarks" },
    ],
    updated: UPDATED,
  },
  // ── Healthcare ────────────────────────────────────────────────────────────
  {
    slug: "healthcare",
    title: "Typed decisions for healthcare: triage, routing, and care escalation",
    navLabel: "Healthcare",
    industry: "Healthcare",
    description:
      "How healthcare teams use Score, Choice, and Noul for symptom urgency triage, department routing, and escalation triggers — with self-hosting inside your own HIPAA boundary and reproducible audit trails.",
    keywords: [
      "healthcare llm decisions",
      "clinical triage llm",
      "self-hosted llm classification for healthcare",
      "symptom urgency scoring",
      "patient routing typed decision",
    ],
    intro:
      "Clinical decisions are high-stakes and heavily regulated. OpenJev brings typed, calibrated judgments to the healthcare workflow: an urgency Score for triage, a department Choice for routing, and a Noul for escalation triggers — all self-hostable so protected health information never leaves your HIPAA-covered infrastructure.",
    takeaways: [
      "Score symptom urgency on a 1–5 rubric so downstream logic gates on a number, not on parsing 'high urgency' from prose.",
      "Choice routes patients to the right care setting without a generative call that might invent a specialty you do not staff.",
      "Self-host inside your HIPAA boundary so PHI never touches an external LLM endpoint.",
      "Deterministic per input: the same presentation scores the same way every time — a requirement for clinical audit trails.",
    ],
    primitive: "mixed",
    primitiveLabel: "Score + Choice + Noul",
    sections: [
      {
        heading: "Decision problems in healthcare",
        body: "Clinical workflows are dense with closed-set judgments that today get made by prose extraction or keyword rules:",
        bullets: [
          "Symptom urgency triage: is this routine, urgent, or immediate — and how confident is the system?",
          "Department routing: which care setting (emergency, urgent care, primary, specialist) fits this presentation?",
          "Care escalation: does this patient need a senior clinician or attending right now?",
          "Pre-authorization eligibility: does the clinical note support the requested procedure under this payer's criteria?",
          "Discharge readiness: does the patient meet the documented criteria for safe discharge?",
        ],
      },
      {
        heading: "System One in healthcare",
        body: "Triage, routing, and escalation in one call over the same patient state. Each judgment is independent, calibrated, and actionable without parsing prose.",
        code: {
          lang: "ts",
          code: `import { choice, noul, score } from "@caelum/typesafe";

const { answers } = await client.systemOne({
  state: { symptoms, vitals, history },
  questions: {
    urgency:    score("Clinical urgency of \\\`symptoms\\\` (1=routine, 5=immediate)?", 1, 5),
    department: choice("Best care setting for this presentation?", {
      emergency:    "Requires immediate intervention.",
      urgent_care:  "Needs same-day care.",
      primary_care: "Routine appointment is appropriate.",
      specialist:   "Needs subspecialty evaluation.",
    }),
    escalate:   noul("Does this patient need senior clinician review now?"),
  },
});

if (answers.urgency.score >= 4 || answers.escalate.noul > 0.7) {
  alertSenior(answers.urgency.score, answers.escalate.noul);
}
route(answers.department.choice, answers.urgency.score);`,
        },
      },
      {
        heading: "Compliance and latency",
        body: "HIPAA requires that protected health information be processed inside a covered entity's or business associate's compliant infrastructure. Running OpenJev self-hosted keeps every note, vital sign, and history record inside your HIPAA boundary — no PHI is sent to a third-party API. Decisions are deterministic per input, which supports your audit-trail obligations: every routing or escalation decision is reproducible from the original state. Triage operates in real time on a local backend; bulk clinical note processing runs as a parallelized batch job on the same engine.",
      },
    ],
    faqs: [
      {
        q: "Can OpenJev be used in a HIPAA-covered workflow?",
        a: "Yes, when self-hosted. Running the Docker image inside your covered infrastructure means no PHI is transmitted externally. Sign a BAA with your infrastructure provider as you normally would.",
      },
      {
        q: "How do I handle low-confidence triage scores?",
        a: "Gate on confidence: if the urgency Score's confidence falls below your threshold, escalate to a clinician regardless of the level. Low confidence is a signal the system is uncertain, not a signal to ignore.",
      },
      {
        q: "Is this a diagnostic tool?",
        a: "No. OpenJev makes typed routing and triage decisions — which queue, how urgent, does this need review. It is not a diagnostic or treatment system, and every output is a signal for a human clinician to act on.",
      },
    ],
    related: [
      { kind: "use-case", slug: "regulatory-briefing", label: "Compliance checklist pattern" },
      { kind: "use-case", slug: "document-tagging", label: "Document tagging pattern" },
      { kind: "guide", slug: "score-primitive", label: "Score, in depth" },
      { kind: "guide", slug: "for-backends", label: "openjev for backend engineers" },
      { kind: "benchmark", slug: "", label: "Latency benchmarks" },
    ],
    updated: UPDATED,
  },
  // ── Legal ─────────────────────────────────────────────────────────────────
  {
    slug: "legal",
    title: "Typed decisions for legal: contract risk, matter routing, and doc review",
    navLabel: "Legal",
    industry: "Legal",
    description:
      "How legal teams use Choice, Score, and Noul to classify contract clauses, score risk, and prioritize doc review — with attorney-client privilege preserved through self-hosting.",
    keywords: [
      "legal llm decisions",
      "contract review llm",
      "matter routing classification",
      "contract clause risk scoring",
      "attorney client privilege llm",
    ],
    intro:
      "Legal work is full of closed-set judgments on privileged content — clause type, risk level, whether counsel must review. OpenJev makes those judgments typed and calibrated, so the triage pipeline gives attorneys a decision with a confidence, not a hallucinated summary. Self-hosting is mandatory: privileged documents must not transit a third-party API.",
    takeaways: [
      "Classify contract clauses into a known taxonomy with a calibrated confidence — no generative summary to manually verify.",
      "Score legal risk on a 1–5 rubric so the review workflow gates on a number, not on a prose adjective.",
      "Self-host so privileged content never leaves your firm's infrastructure.",
      "Deterministic outputs make the review queue reproducible: the same clause scores the same risk every run.",
    ],
    primitive: "mixed",
    primitiveLabel: "Choice + Score + Noul",
    sections: [
      {
        heading: "Decision problems in legal",
        body: "Law firms and in-house teams face high-volume triage problems that are well-defined enough to be typed decisions:",
        bullets: [
          "Clause classification: identify the type (liability cap, indemnification, IP, termination) with a confidence.",
          "Risk scoring: how legally risky is this clause for our side on a 1–5 rubric?",
          "Counsel review trigger: does this clause require attorney sign-off before signing?",
          "Matter routing: which practice group should receive this incoming matter?",
          "Privilege log tagging: is this document attorney-client privileged?",
        ],
      },
      {
        heading: "System One in legal",
        body: "Clause type, risk level, and review trigger in one call. No generative output to verify; each answer is a typed value the workflow acts on directly.",
        code: {
          lang: "ts",
          code: `import { choice, noul, score } from "@caelum/typesafe";

const { answers } = await client.systemOne({
  state: { clause, contract, counterparty },
  questions: {
    clause_type:      choice("Type of clause in \\\`clause\\\`?", {
      liability_cap:   "Limits one party's financial liability.",
      indemnification: "Allocates responsibility for losses.",
      termination:     "Specifies conditions for ending the agreement.",
      ip_assignment:   "Transfers intellectual property rights.",
      other:           "None of the above.",
    }),
    risk:             score("Legal risk of \\\`clause\\\` for our side (1=low, 5=high)?", 1, 5),
    requires_counsel: noul("Does \\\`clause\\\` require attorney review before signing?"),
  },
});

if (answers.requires_counsel.noul > 0.5 || answers.risk.score >= 4) {
  flagForAttorneyReview(answers.clause_type.choice, answers.risk.score);
} else {
  autoApprove(answers.clause_type.choice, answers.risk.score);
}`,
        },
      },
      {
        heading: "Compliance and latency",
        body: "Attorney-client privilege and work-product doctrine require that legal documents not be disclosed to unauthorized third parties. Transmitting a contract clause to an external LLM API may constitute disclosure — self-hosting is not optional for most legal workflows. Run the Docker image inside your firm's infrastructure and no privileged content ever leaves the boundary. Deterministic outputs mean the doc-review queue is reproducible: re-running triage after updating questions re-scores the same documents identically, an auditable property. Clause-level triage runs in milliseconds on a local backend; bulk e-discovery review runs as a parallelized batch job.",
      },
    ],
    faqs: [
      {
        q: "Does sending content to an LLM break attorney-client privilege?",
        a: "That is a jurisdiction-specific question your ethics counsel must answer. The safest posture is to self-host: no content leaves your infrastructure, so there is no transmission to a third party to analyze.",
      },
      {
        q: "Can this classify clauses accurately enough for production review queues?",
        a: "For closed-set classification — clause type, risk bucket, review trigger — typed decisions perform well because the answer space is explicit. Calibrated confidence lets you route borderline clauses to a human, so the error cost concentrates on a small, surfaced subset.",
      },
      {
        q: "How do I handle a clause that belongs to multiple types?",
        a: "Add an 'other' or 'compound' option and gate on confidence. A low-confidence result or a close runner-up in the distribution is a signal the clause is genuinely mixed — route it to a reviewer who sees the top-two probabilities.",
      },
    ],
    related: [
      { kind: "use-case", slug: "regulatory-briefing", label: "Compliance checklist pattern" },
      { kind: "use-case", slug: "document-tagging", label: "Document tagging pattern" },
      { kind: "guide", slug: "score-primitive", label: "Score, in depth" },
      { kind: "guide", slug: "cheap-deterministic-classification", label: "Deterministic classification" },
      { kind: "benchmark", slug: "", label: "Latency benchmarks" },
    ],
    updated: UPDATED,
  },
  // ── Customer support ──────────────────────────────────────────────────────
  {
    slug: "customer-support",
    title: "Typed decisions for customer support: routing, escalation, and SLA gating",
    navLabel: "Customer support",
    industry: "Customer support",
    description:
      "How support teams use Choice, Score, and Noul to route tickets, score severity, and trigger escalations — with calibrated confidence instead of brittle keyword rules.",
    keywords: [
      "customer support llm routing",
      "ticket classification llm",
      "support escalation ai",
      "sla scoring typed decision",
      "sentiment gating support",
    ],
    intro:
      "Support queues are high-volume triage problems: which team, how urgent, does this need a senior agent. Keyword rules break on novel phrasing; generative summaries are expensive and inconsistent. OpenJev makes each step a typed decision: a Choice for the queue, a Score for severity, a Noul for escalation — all in one call, all with calibrated confidence.",
    takeaways: [
      "One call routes the ticket, scores its severity, and triggers escalation — no separate LLM calls per decision.",
      "Calibrated confidence surfaces the borderline tickets for review instead of misrouting them silently.",
      "Deterministic routing means the same ticket lands in the same queue on every run — reproducible, auditable.",
      "Self-host to keep PII in your GDPR-compliant boundary; no customer content leaves your infrastructure.",
    ],
    primitive: "mixed",
    primitiveLabel: "Choice + Score + Noul",
    sections: [
      {
        heading: "Decision problems in customer support",
        body: "Support operations run on a handful of well-defined triage questions that today get answered by keyword rules or costly generative summaries:",
        bullets: [
          "Queue routing: which team (billing, technical, account, general) should own this ticket?",
          "Severity scoring: how urgent is this on a 1–5 scale — SLA breach risk, customer impact?",
          "Escalation trigger: should this go to a senior agent or specialist?",
          "Sentiment gating: is the customer expressing anger that changes the handling priority?",
          "First-contact resolution eligibility: can this be auto-resolved without a human agent?",
        ],
      },
      {
        heading: "System One in customer support",
        body: "Routing, severity, and escalation in one request over the ticket and its account context. The same call handles the full triage — no separate passes, no parsing.",
        code: {
          lang: "ts",
          code: `import { choice, noul, score } from "@caelum/typesafe";

const { answers } = await client.systemOne({
  state: { ticket, account, history },
  questions: {
    queue:    choice("Which support queue for \\\`ticket\\\`?", {
      billing:   "Payment, refund, or invoice issues.",
      technical: "Product bugs or outages.",
      account:   "Login, access, or account management.",
      general:   "All other inquiries.",
    }),
    severity: score("Ticket severity (1=low, 5=critical)?", 1, 5),
    escalate: noul("Should \\\`ticket\\\` be escalated to a senior agent?"),
  },
});

if (answers.escalate.noul > 0.65 || answers.severity.score >= 4) {
  escalateToSenior(answers.queue.choice);
} else {
  assignToQueue(answers.queue.choice, answers.severity.score);
}`,
        },
      },
      {
        heading: "Compliance and latency",
        body: "GDPR requires that personal data be processed under a defined lawful basis and not transmitted beyond the approved scope. Self-hosting keeps customer names, email addresses, and account details inside your infrastructure — no PII transits an external API. Decisions are deterministic per input, so every routing decision is auditable: the same ticket always produces the same routing outcome, which is required for SLA reporting. On a local engine, triage can run inline as the ticket is created: a single-question decision on the default embedding engine measured " + ML.embedding1 + " (" + ML.source + ").",
      },
    ],
    faqs: [
      {
        q: "Can I replace my keyword routing rules with this?",
        a: "Yes. A Choice with well-described options handles the long tail of phrasing that keyword rules miss, and calibrated confidence routes the ambiguous ones to a human instead of misrouting them. You keep your queue taxonomy; you swap the rule engine for a typed decision.",
      },
      {
        q: "How do I handle a ticket that fits two queues?",
        a: "Inspect the distribution: a close top-two split is a genuinely mixed ticket. Show the probabilities to the routing agent, or create a multi-team ticket. Low confidence is a signal to confirm, not to guess.",
      },
      {
        q: "Is this fast enough for inline triage at scale?",
        a: "Yes. There is no generation step; a single-question decision on the default embedding engine measured " + ML.embedding1 + " (" + ML.source + "). A million-ticket backfill runs as a local batch job at negligible marginal cost.",
      },
    ],
    related: [
      { kind: "use-case", slug: "support-ticket-routing", label: "Ticket routing pattern" },
      { kind: "use-case", slug: "sentiment-gating", label: "Sentiment gating pattern" },
      { kind: "guide", slug: "choice-primitive", label: "Choice, in depth" },
      { kind: "guide", slug: "for-backends", label: "openjev for backends" },
      { kind: "benchmark", slug: "", label: "Latency benchmarks" },
    ],
    updated: UPDATED,
  },
  // ── Ecommerce ─────────────────────────────────────────────────────────────
  {
    slug: "ecommerce",
    title: "Typed decisions for ecommerce: return fraud, review spam, and catalog gating",
    navLabel: "Ecommerce",
    industry: "Ecommerce",
    description:
      "How ecommerce teams use Noul, Choice, and Score to detect return fraud, filter review spam, classify catalog items, and gate promotions — inline on the purchase path.",
    keywords: [
      "ecommerce llm decisions",
      "return fraud detection llm",
      "review spam classification",
      "product categorization llm",
      "typed decision ecommerce",
    ],
    intro:
      "Ecommerce runs on judgment calls at volume: is this return fraudulent, is this review authentic, does this product belong in this category. Generative LLMs are too slow and too expensive for the purchase path; keyword rules miss the long tail. OpenJev makes each decision a typed, calibrated judgment that runs inline without generation.",
    takeaways: [
      "A Noul returns a fraud probability you threshold per your tolerable false-positive rate — not a generated verdict to parse.",
      "One call handles fraud signal, resolution type, and handling priority over the same return state.",
      "No generative output means no hallucinated refund decisions — the resolution is one label from a closed set you defined.",
      "Local backend keeps p99 latency well under the post-purchase response time budget.",
    ],
    primitive: "mixed",
    primitiveLabel: "Noul + Choice + Score",
    sections: [
      {
        heading: "Decision problems in ecommerce",
        body: "High-volume ecommerce judgment calls are ideal for typed decisions — the answer space is well-defined and the volume makes accuracy and cost both matter:",
        bullets: [
          "Return fraud: does this return request show policy-abuse signals given the account's order history?",
          "Review authenticity: is this product review genuine, incentivized, or spam?",
          "Catalog classification: which product category does this listing belong to?",
          "Promotion eligibility: does this account qualify for this offer based on history and risk?",
          "Dispute routing: which team should own this customer dispute — fulfillment, billing, or fraud?",
        ],
      },
      {
        heading: "System One in ecommerce",
        body: "Fraud signal, resolution, and priority scored in one request over the return and order context. No generative output on the financial decision path.",
        code: {
          lang: "ts",
          code: `import { choice, noul, score } from "@caelum/typesafe";

const { answers } = await client.systemOne({
  state: { returnRequest, orderHistory, account },
  questions: {
    fraud_signal: noul(
      "Does \\\`returnRequest\\\` show return-fraud indicators given \\\`orderHistory\\\`?"
    ),
    resolution:   choice("Best resolution for this return?", {
      approve: "Issue a full refund.",
      partial: "Issue a partial refund or store credit.",
      deny:    "Decline the return request.",
      review:  "Hold for manual review.",
    }),
    priority:     score("Handling priority (1=standard, 5=urgent)?", 1, 5),
  },
});

if (answers.fraud_signal.noul > 0.55) {
  holdForFraudReview(returnRequest);
} else if (answers.resolution.confidence >= 0.8) {
  autoResolve(answers.resolution.choice);
} else {
  queueManual(answers.resolution.probabilities, answers.priority.score);
}`,
        },
      },
      {
        heading: "Compliance and latency",
        body: "Refund and return decisions are financial actions: they must be auditable and not based on hallucinated reasoning. Because every typed decision is deterministic per input, each resolution has a reproducible basis — the same return request always produces the same fraud score and resolution choice, which satisfies audit and chargeback documentation requirements. No generative text is produced, so there is no risk of a model fabricating a policy justification. On a local engine, triage can run inline at the end of the return flow: a single-question decision on the default embedding engine measured " + ML.embedding1 + " (" + ML.source + ").",
      },
    ],
    faqs: [
      {
        q: "How do I set the fraud threshold without too many false positives?",
        a: "Start conservative (hold above 0.55, block above 0.8) and track the false-positive rate on what you held. Lower the bar as you gain confidence in the calibration, or tune the hold and block thresholds independently.",
      },
      {
        q: "Can I use this for real-time catalog classification at upload?",
        a: "Yes. A Choice with your category taxonomy answers in milliseconds on a local backend. Classification runs as items are ingested at near-zero marginal cost per item.",
      },
      {
        q: "Does determinism mean I can cache fraud scores?",
        a: "Yes, per input. A return request with the same state will always produce the same fraud score, so you can safely cache by an input hash to avoid re-scoring identical requests.",
      },
    ],
    related: [
      { kind: "use-case", slug: "fraud-triage", label: "Fraud triage pattern" },
      { kind: "use-case", slug: "spam-detection", label: "Spam detection pattern" },
      { kind: "guide", slug: "confidence-calibration", label: "Calibrated confidence" },
      { kind: "guide", slug: "closed-set-choice-vs-free-text", label: "Closed-set vs free text" },
      { kind: "benchmark", slug: "", label: "Latency benchmarks" },
    ],
    updated: UPDATED,
  },
  // ── Content moderation ────────────────────────────────────────────────────
  {
    slug: "content-moderation",
    title: "Typed decisions for content moderation: policy classification and severity scoring",
    navLabel: "Content moderation",
    industry: "Content moderation",
    description:
      "How trust and safety teams use Choice, Score, and Noul to classify policy violations, score severity, and gate human review — with a deterministic audit log on every decision.",
    keywords: [
      "content moderation llm",
      "policy violation classification",
      "trust safety typed decision",
      "severity scoring moderation",
      "ai content moderation audit trail",
    ],
    intro:
      "Content moderation is a high-volume, high-stakes classification problem: which policy, how severe, does a human need to see this. Generative calls are expensive, stochastic, and hard to audit. OpenJev makes each step a typed decision with calibrated confidence and a deterministic, reproducible record — exactly what a trust and safety audit trail requires.",
    takeaways: [
      "A Choice over your policy taxonomy returns the violation class with a distribution — surfaces borderline content for review instead of silently misclassifying it.",
      "Score severity 0–5 so the enforcement action gates on a number, not on parsing 'high severity' from a prose output.",
      "Deterministic per input: the same post gets the same classification every run — reproducible, auditable, defensible.",
      "Batch dozens of policy checks over one content state in a single call to minimize latency and cost at pre-publish volume.",
    ],
    primitive: "mixed",
    primitiveLabel: "Choice + Score + Noul",
    sections: [
      {
        heading: "Decision problems in content moderation",
        body: "Trust and safety teams face a stack of closed-set judgments on every piece of user content:",
        bullets: [
          "Policy classification: which policy does this content violate — hate speech, harassment, spam, misinformation, none?",
          "Severity scoring: how severe is this violation on a 0–5 scale?",
          "Human review gate: is this borderline enough to require a human reviewer before action?",
          "Enforcement action: warn, restrict, remove, or escalate to legal?",
          "Appeal triage: is this appeal likely to succeed based on the original content and stated reason?",
        ],
      },
      {
        heading: "System One in content moderation",
        body: "Policy class, severity, and review gate in one pre-publish call. Each answer is typed and calibrated so enforcement logic branches on values, not on parsed text.",
        code: {
          lang: "ts",
          code: `import { choice, noul, score } from "@caelum/typesafe";

const { answers } = await client.systemOne({
  state: { content, context, authorHistory },
  questions: {
    policy_class: choice("Which policy does \\\`content\\\` violate, if any?", {
      hate_speech:    "Promotes hatred against a protected group.",
      harassment:     "Targets an individual with abusive intent.",
      spam:           "Unsolicited bulk or promotional content.",
      misinformation: "Demonstrably false factual claims.",
      none:           "No policy violation detected.",
    }),
    severity:    score("Severity of the violation (0=none, 5=severe)?", 0, 5),
    needs_human: noul("Does \\\`content\\\` require human review before action?"),
  },
});

if (answers.severity.score >= 4 && answers.needs_human.noul < 0.3) {
  autoRemove(content);
} else if (answers.needs_human.noul > 0.5) {
  queueForHumanReview(answers.policy_class.choice, answers.policy_class.probabilities);
} else if (answers.policy_class.choice !== "none") {
  issueWarning(answers.policy_class.choice, answers.severity.score);
}`,
        },
      },
      {
        heading: "Compliance and latency",
        body: "Moderation decisions at scale must be defensible: if a user appeals or a regulator audits, you need to show the same content would have been handled the same way. Typed decisions are deterministic per input, so every action has a reproducible basis — no sampling variance, no prompt drift. For categories where the legal standard is high (CSAM, incitement), set a strict threshold on the severity Score and require a Noul confirmation before auto-action; low-confidence results automatically surface for human review. Pre-publish moderation runs on a local engine with no generation step (" + ML.embedding1 + " per single-question decision on the default embedding engine; " + ML.source + ").",
      },
    ],
    faqs: [
      {
        q: "Can I run this at the scale of a large social platform?",
        a: "Yes. With no generation, a single-question decision on the default embedding engine measured " + ML.embedding1 + " (" + ML.source + "), with no per-call fee. Scale horizontally by running more instances of the Docker image.",
      },
      {
        q: "How do I keep the policy taxonomy up to date?",
        a: "Update the option descriptions in the Choice — no model retraining needed. Because decisions are deterministic, you can re-score a historical corpus with the new taxonomy to see exactly what changes.",
      },
      {
        q: "What about context-dependent violations — the same text that is fine in one context but harmful in another?",
        a: "Include the context in the state (content type, author history, surrounding thread). OpenJev evaluates each question against the full state, so context-dependent judgments work as long as the relevant context is passed in.",
      },
    ],
    related: [
      { kind: "use-case", slug: "content-moderation", label: "Content moderation pattern" },
      { kind: "use-case", slug: "spam-detection", label: "Spam detection pattern" },
      { kind: "guide", slug: "noul-primitive", label: "Noul, in depth" },
      { kind: "guide", slug: "score-primitive", label: "Score, in depth" },
      { kind: "benchmark", slug: "", label: "Latency benchmarks" },
    ],
    updated: UPDATED,
  },
  // ── Insurance ─────────────────────────────────────────────────────────────
  {
    slug: "insurance",
    title: "Typed decisions for insurance: adjudication, risk scoring, and fraud detection",
    navLabel: "Insurance",
    industry: "Insurance",
    description:
      "How insurance teams use Score, Choice, and Noul for claim adjudication, underwriting risk scoring, and fraud signal detection — with self-hosting inside your own compliance boundary and reproducible audit records.",
    keywords: [
      "insurance llm decisions",
      "claim adjudication ai",
      "underwriting risk scoring llm",
      "insurance fraud detection ai",
      "typed decision insurance compliance",
    ],
    intro:
      "Insurance decisions are regulated, audited, and consequential: a claim disposition, an underwriting risk score, a fraud referral. OpenJev makes each step typed and calibrated — a Score for risk, a Choice for disposition, a Noul for fraud signals — so every decision has a reproducible basis and no generative hallucination on the adjudication path.",
    takeaways: [
      "Score claim risk on a 0–5 rubric so the triage workflow gates on a number that means something.",
      "Choice the disposition — approve, partial, deny, investigate — with a calibrated confidence you can route borderline cases on.",
      "Self-host so policy documents and claimant history never leave your own infrastructure.",
      "Every decision is deterministic and reproducible — required for state insurance department audit trails.",
    ],
    primitive: "mixed",
    primitiveLabel: "Score + Choice + Noul",
    sections: [
      {
        heading: "Decision problems in insurance",
        body: "Insurance operations run on a series of closed-set judgments that today rely on rules engines or manual adjudicator review:",
        bullets: [
          "Claim risk scoring: how risky is this claim on a 0–5 scale based on policy and claimant history?",
          "Claim disposition: approve, approve partial, deny, or refer to the Special Investigations Unit?",
          "Fraud signal detection: does this claim show indicators of fraud that warrant investigation?",
          "Underwriting eligibility: does this applicant's profile fall within appetite at this premium tier?",
          "Coverage eligibility: does the documented loss event meet the criteria for this policy clause?",
        ],
      },
      {
        heading: "System One in insurance",
        body: "Risk score, disposition, and fraud signal in one call over the claim and policy state. Each is typed and calibrated — no generative reasoning on the adjudication path.",
        code: {
          lang: "ts",
          code: `import { choice, noul, score } from "@caelum/typesafe";

const { answers } = await client.systemOne({
  state: { claim, policy, claimantHistory },
  questions: {
    risk_score:   score("Claim risk level (0=low, 5=high)?", 0, 5),
    disposition:  choice("Recommended claim disposition?", {
      approve:     "Approve and pay out in full.",
      partial:     "Approve a partial payout pending documentation.",
      deny:        "Deny the claim as outside policy coverage.",
      investigate: "Refer to SIU for investigation.",
    }),
    fraud_signal: noul("Does \\\`claim\\\` show fraud indicators given \\\`claimantHistory\\\`?"),
  },
});

if (answers.fraud_signal.noul > 0.5 || answers.risk_score.score >= 4) {
  referToSIU(claim, answers.fraud_signal.noul);
} else {
  processDisposition(answers.disposition.choice, answers.disposition.confidence);
}`,
        },
      },
      {
        heading: "Compliance and latency",
        body: "State insurance regulations require that claim decisions be documentable and non-discriminatory. Typed decisions give you both: every adjudication is deterministic per input — same claim, same decision, every time — and based on a defined set of typed questions, not a model's unexaminable internal reasoning. If your SOC 2 scope requires that claimant data stay inside your boundary, self-hosting the Docker image keeps it there; OpenJev itself is not a SOC 2 audited service. HIPAA applies to health lines — run on-prem. Underwriting batch jobs run against a self-hosted backend at near-zero marginal cost per applicant; real-time claims triage runs with no generation step (" + ML.embedding1 + " per single-question decision on the default embedding engine; " + ML.source + ").",
      },
    ],
    faqs: [
      {
        q: "How do I satisfy state regulators that this decision process is explainable?",
        a: "Every decision comes from a defined set of typed questions against a documented state. The questions are your rubric, and the calibrated confidence shows how certain the system was. That is a more auditable basis than a generative model's prose output.",
      },
      {
        q: "Can fraud signals from OpenJev be used as sole grounds for denial?",
        a: "No — and a Noul is designed not to be a sole ground. It is a calibrated probability that triggers escalation to SIU, not an automatic denial. The SIU investigation is the evidence-based step; the Noul is the prioritization signal.",
      },
      {
        q: "Does this work for health insurance claims under HIPAA?",
        a: "Yes, when self-hosted. Run the Docker image inside your HIPAA-covered infrastructure so PHI never leaves your boundary. Sign a BAA with your infrastructure provider as usual.",
      },
    ],
    related: [
      { kind: "use-case", slug: "insurance-adjudication", label: "Adjudication pattern" },
      { kind: "use-case", slug: "regulatory-briefing", label: "Compliance checklist pattern" },
      { kind: "guide", slug: "score-primitive", label: "Score, in depth" },
      { kind: "guide", slug: "confidence-calibration", label: "Calibrated confidence" },
      { kind: "benchmark", slug: "", label: "Latency benchmarks" },
    ],
    updated: UPDATED,
  },
  // ── Developer tools ───────────────────────────────────────────────────────
  {
    slug: "developer-tools",
    title: "Typed decisions for developer tools: PR gates, issue routing, and code quality",
    navLabel: "Developer tools",
    industry: "Developer tools",
    description:
      "How developer tool teams use Noul, Choice, and Score to gate pull requests, route issues, score code quality, and classify errors — with proprietary code staying on-prem.",
    keywords: [
      "developer tools llm decisions",
      "pr review gate llm",
      "issue routing classification ci",
      "code quality scoring llm",
      "ci gate typed decision",
    ],
    intro:
      "CI pipelines and code review tools need fast, deterministic judgments: is this PR safe to merge, which team should review it, how risky is this change. OpenJev makes those judgments typed and testable — a Noul for the safety gate, a Choice for routing, a Score for quality — all in a single call that runs inline in CI.",
    takeaways: [
      "A Noul safety gate on the PR gives CI a calibrated merge-readiness signal, not a parsed 'LGTM' from generated text.",
      "Choice routes the PR to the right team with a probability distribution — surfaces multi-team changes by showing the top two.",
      "Score code quality 1–5 so review automation gates on a rubric, not on keyword scanning.",
      "Self-host so proprietary source code never leaves your infrastructure.",
    ],
    primitive: "mixed",
    primitiveLabel: "Noul + Choice + Score",
    sections: [
      {
        heading: "Decision problems in developer tools",
        body: "Developer tools run well-defined judgment calls on every pull request, issue, and build artifact:",
        bullets: [
          "PR safety gate: is this change safe to merge given the diff, CI results, and changed-file risk profile?",
          "Reviewer routing: which team or individual should review this PR based on what changed?",
          "Code quality scoring: how good is this change on a 1–5 rubric — maintainability, test coverage, API hygiene?",
          "Issue routing: which team owns this bug or feature request — backend, frontend, infra, security?",
          "Error classification: which category of error is this — regression, performance, flaky test, new failure?",
        ],
      },
      {
        heading: "System One in developer tools",
        body: "Safety gate, reviewer routing, and code quality in one CI call over the diff and metadata. Blocks the merge, requests the right review, and scores quality without generation.",
        code: {
          lang: "ts",
          code: `import { choice, noul, score } from "@caelum/typesafe";

const { answers } = await client.systemOne({
  state: { diff, prMeta, ciResults },
  questions: {
    safe_to_merge:  noul("Is this PR safe to merge given \\\`diff\\\` and \\\`ciResults\\\`?"),
    reviewer_group: choice("Which team should review this PR?", {
      backend:  "Changes to server-side logic or APIs.",
      frontend: "Changes to UI components or styling.",
      infra:    "Changes to infrastructure, CI, or deployment.",
      security: "Changes to auth, secrets, or data handling.",
    }),
    code_quality:   score("Code quality of \\\`diff\\\` (1=poor, 5=excellent)?", 1, 5),
  },
});

if (answers.safe_to_merge.noul < 0.7) {
  blockMerge(answers.safe_to_merge.noul, answers.code_quality.score);
} else {
  requestReview(answers.reviewer_group.choice, answers.code_quality.score);
}`,
        },
      },
      {
        heading: "Compliance and latency",
        body: "Proprietary source code must not leave your infrastructure. Running OpenJev self-hosted inside your CI environment means no diff, file content, or metadata is transmitted externally. Decisions are deterministic per input, so the same PR state always produces the same safety gate outcome — you can write golden tests over your review pipeline and catch regressions in the gate logic itself. On a local engine each decision is engine time only (" + ML.embedding1 + " per single question on the default embedding engine; " + ML.source + "), small next to a typical CI step.",
      },
    ],
    faqs: [
      {
        q: "Can this replace code review entirely?",
        a: "No — typed decisions are the routing and gating layer. The Noul safety gate decides whether to block the merge or request review; the actual review is still done by humans or specialized static-analysis tools. OpenJev is the triage step, not the reviewer.",
      },
      {
        q: "How do I keep proprietary code private?",
        a: "Self-host the Docker image inside your CI environment. The diff and any code content in the state never leave your infrastructure.",
      },
      {
        q: "Is 0.7 the right safety threshold for my team?",
        a: "It depends on your merge risk tolerance. Start at 0.7, track the false-block rate and the rate of merged PRs that later caused incidents, and adjust the threshold to balance velocity against stability.",
      },
    ],
    related: [
      { kind: "use-case", slug: "pr-review-gate", label: "PR review gate pattern" },
      { kind: "use-case", slug: "email-classification", label: "Issue classification pattern" },
      { kind: "guide", slug: "for-agents", label: "openjev for agents" },
      { kind: "guide", slug: "noul-primitive", label: "Noul, in depth" },
      { kind: "benchmark", slug: "", label: "Latency benchmarks" },
    ],
    updated: UPDATED,
  },
];

export function solutionBySlug(slug: string): Solution | undefined {
  return SOLUTIONS.find((s) => s.slug === slug);
}

export const SOLUTION_SLUGS: readonly string[] = SOLUTIONS.map((s) => s.slug);
