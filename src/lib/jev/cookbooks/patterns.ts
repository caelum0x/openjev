import type { Answer, ChoiceAnswer, NoulAnswer, Questions, State } from "../types.ts";

export type PatternCookbook = {
  id: "fan-out" | "confidence" | "composite" | "intent";
  title: string;
  blurb: string;
  stat: string;
  href: string;
  state: State;
  questions: Questions;
  combine: (answers: Record<string, Answer>) => { label: string; detail: string };
};

export const FAN_OUT: PatternCookbook = {
  id: "fan-out",
  title: "Speculative fan-out",
  blurb:
    "Ask every question you might need in one call — including the ones you will throw away. Extra questions barely move latency.",
  stat: "1 call, many questions",
  href: "/cookbooks/fan-out",
  state: {
    ticket_message:
      "My flight was cancelled. Can I get a refund? This is the second time this month.",
    refund_policy: "Cancelled flights are eligible for a full refund.",
    order: { charges: [{ amount: 240, status: "captured" }] },
  },
  questions: {
    refund_requested: {
      type: "noul",
      instructions: "Does `ticket_message` request a refund?",
    },
    duplicate_charge: {
      type: "noul",
      instructions: "Does the evidence indicate a duplicate charge?",
    },
    policy_supports: {
      type: "noul",
      instructions:
        "Does `refund_policy` support a refund for this `ticket_message`?",
    },
    request_type: {
      type: "choice",
      instructions: "What is the main request in `ticket_message`?",
      criteria: {
        refund: "The customer wants money returned.",
        rebooking: "The customer wants a replacement flight.",
        information: "The customer is asking for information only.",
      },
    },
    frustration: {
      type: "score",
      instructions: "How frustrated does the customer appear in `ticket_message`?",
      criteria: [
        "Calm and neutral.",
        "Concerned but civil.",
        "Very angry or using strong language.",
      ],
    },
    needs_human: {
      type: "noul",
      instructions: "Does this need a human before any automated refund?",
    },
  },
  combine: (a) => {
    const refund = (a.refund_requested as NoulAnswer).noul;
    const policy = (a.policy_supports as NoulAnswer).noul;
    const human = (a.needs_human as NoulAnswer).noul;
    if (human > 0.6) return { label: "escalate", detail: "needs_human is high — do not auto-refund" };
    if (refund >= 0.7 && policy >= 0.6)
      return { label: "refund", detail: "requested + policy both clear — act in code" };
    return { label: "review", detail: "signals mixed — keep a human in the loop" };
  },
};

export const CONFIDENCE: PatternCookbook = {
  id: "confidence",
  title: "Confidence-gated routing",
  blurb:
    "The answer tells you what. Confidence tells you whether to act. Under 0.5 escalate. 0.85+ before anything irreversible.",
  stat: "threshold on confidence",
  href: "/cookbooks/confidence",
  state:
    "Shoes arrived two weeks late and in the wrong size. Also I see two charges on my card. What are you going to do about this?",
  questions: {
    department: {
      type: "choice",
      instructions: "Which team should handle this?",
      criteria: {
        returns: "Exchanges, refunds, wrong or damaged items",
        shipping: "Delivery status, delays, lost packages",
        billing: "Charges, invoices, payment problems",
      },
    },
    tone: {
      type: "choice",
      instructions: "What is the customer's tone?",
      criteria: { calm: null, frustrated: null, angry: null },
    },
  },
  combine: (a) => {
    const d = a.department as ChoiceAnswer;
    if (d.confidence < 0.5)
      return {
        label: "human review",
        detail: `department=${d.choice} but confidence ${d.confidence.toFixed(2)} < 0.5`,
      };
    if (d.confidence < 0.85)
      return {
        label: `route to ${d.choice} with confirm`,
        detail: `medium confidence ${d.confidence.toFixed(2)} — proceed, flag for review`,
      };
    return {
      label: `auto-route ${d.choice}`,
      detail: `confidence ${d.confidence.toFixed(2)} — safe to act`,
    };
  },
};

export const COMPOSITE: PatternCookbook = {
  id: "composite",
  title: "Composite scoring",
  blurb:
    "Break a complex judgment into atomic scores, then combine with weights you control in code.",
  stat: "weighted sum in code",
  href: "/cookbooks/composite",
  state:
    "Congratulations! You have been selected as a winner of a $2,500 crypto prize. Click here to claim within 24 hours. Reply with your password to verify the account.",
  questions: {
    requests_credentials: {
      type: "noul",
      instructions:
        "Does the message ask the recipient to disclose a password or other login credential?",
    },
    unexpected_reward: {
      type: "noul",
      instructions:
        "Does the message claim the recipient received an unexpected prize, payment, or reward?",
    },
    fake_urgency: {
      type: "noul",
      instructions: "Does the message use fake urgency to force a click?",
    },
  },
  combine: (a) => {
    const risk =
      0.45 * (a.requests_credentials as NoulAnswer).noul +
      0.3 * (a.unexpected_reward as NoulAnswer).noul +
      0.25 * (a.fake_urgency as NoulAnswer).noul;
    if (risk >= 0.6) return { label: "quarantine", detail: `spam_risk ${risk.toFixed(2)} ≥ 0.6` };
    if (risk >= 0.35) return { label: "review", detail: `spam_risk ${risk.toFixed(2)}` };
    return { label: "deliver", detail: `spam_risk ${risk.toFixed(2)}` };
  },
};

export const INTENT: PatternCookbook = {
  id: "intent",
  title: "Intent routing",
  blurb:
    "Classify incoming requests and route each to deterministic logic, a specialist, or a human. Never invent the option list.",
  stat: "candidates from code",
  href: "/cookbooks/intent",
  state: "Help! My payouts have been failing for 3 days and I was charged twice.",
  questions: {
    topic: {
      type: "choice",
      instructions: {
        question: "Which team should handle this message?",
        focus: "Classify the customer's primary request, not every topic mentioned.",
      },
      criteria: {
        billing: {
          what: "Charges, invoices, refunds, or subscriptions",
          not_for: "Bugs or account access",
          examples: ["I was charged twice", "Where is my refund?"],
        },
        technical: {
          what: "Bugs, outages, integrations, API failures",
          not_for: "Charges or pricing",
          examples: ["The API returns 500", "Payouts are failing"],
        },
        account: {
          what: "Login, password, profile, or security",
          not_for: "Charges or delivery",
          examples: ["I can't log in", "Change my email"],
        },
      },
    },
    urgency: {
      type: "noul",
      instructions: "Does this message express urgency?",
    },
  },
  combine: (a) => {
    const topic = a.topic as ChoiceAnswer;
    const urgent = (a.urgency as NoulAnswer).noul;
    if (topic.confidence < 0.5)
      return { label: "human", detail: "topic confidence too low to auto-route" };
    const sla = urgent >= 0.7 ? "P1" : "P2";
    return {
      label: `${sla} → ${topic.choice}`,
      detail: `confidence ${topic.confidence.toFixed(2)} · urgency ${urgent.toFixed(2)}`,
    };
  },
};

export const PATTERN_COOKBOOKS = [FAN_OUT, CONFIDENCE, COMPOSITE, INTENT] as const;

export const PATTERN_IDS = new Set<string>(PATTERN_COOKBOOKS.map((p) => p.id));

export function patternById(id: string): PatternCookbook | undefined {
  return PATTERN_COOKBOOKS.find((p) => p.id === id);
}
