import type { GoldCase } from "./types.ts";
import { SEVERITY } from "./schemas.ts";

/**
 * The original documentation showcase cases: the exact examples used to market
 * TypeSafe Choice / Score / Noul. These are the highest-signal regression cases
 * and are all hard-gated.
 */
export const SHOWCASE: GoldCase[] = [
  {
    id: "shoes-returns",
    source: "TypeSafe Choice docs",
    features: ["showcase"],
    state:
      "My running shoes arrived in the wrong size. Can I swap them for a size 10?",
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
    },
    expect: [{ choice: { id: "department", value: "returns", minP: 0.55 } }],
  },
  {
    id: "shoes-multi",
    source: "TypeSafe Choice docs",
    features: ["showcase"],
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
      return_reason: {
        type: "choice",
        instructions: "If the customer wants to return something, why?",
        criteria: {
          wrong_size: "The item doesn't fit",
          wrong_item: "A different product was delivered",
          damaged: "The item arrived broken or faulty",
          changed_mind: "The item is fine, the customer no longer wants it",
          other: "A return reason that fits none of the above",
        },
      },
      tone: {
        type: "choice",
        instructions: "What is the customer's tone?",
        criteria: { calm: null, frustrated: null, angry: null },
      },
    },
    expect: [
      { choice: { id: "department", value: "returns" } },
      { choice: { id: "return_reason", value: "wrong_size", minP: 0.5 } },
      { choice: { id: "tone", value: "frustrated" } },
    ],
  },
  {
    id: "return-status-structured",
    source: "TypeSafe Choice structured criteria",
    features: ["showcase", "structured"],
    state: "I sent the shoes back a week ago. When do I get my money?",
    questions: {
      return_topic: {
        type: "choice",
        instructions: {
          question: "Which returns topic is the customer asking about?",
          focus: "Classify the information the customer wants.",
        },
        criteria: {
          return_policy: {
            what: "Whether and how an item can be returned",
            not_for: "Progress of a return already sent",
            examples: [
              "Can I return shoes I've worn once?",
              "How long do I have to return an order?",
            ],
          },
          return_status: {
            what: "Progress of a return already sent",
            not_for: "Whether and how an item can be returned",
            examples: [
              "Has my return arrived yet?",
              "When will my refund be paid?",
            ],
          },
        },
      },
    },
    expect: [
      { choice: { id: "return_topic", value: "return_status", minP: 0.55 } },
    ],
  },
  {
    id: "bug-cosmetic",
    source: "TypeSafe Score docs",
    features: ["showcase"],
    state:
      "The export button is misaligned by a few pixels. Everything still works.",
    questions: SEVERITY,
    expect: [{ score: { id: "bug_severity", min: 0, max: 0.45 } }],
  },
  {
    id: "bug-workaround",
    source: "TypeSafe Score docs",
    features: ["showcase"],
    state:
      "The PDF export button does nothing in Safari. There is a workaround via CSV export.",
    questions: SEVERITY,
    expect: [{ score: { id: "bug_severity", min: 0.7, max: 1.4 } }],
  },
  {
    id: "bug-blocking",
    source: "TypeSafe Score docs",
    features: ["showcase"],
    state: "Nobody can log in. Every attempt returns a 500 error.",
    questions: SEVERITY,
    expect: [{ score: { id: "bug_severity", min: 1.35, max: 2 } }],
  },
  {
    id: "human-escalation",
    source: "TypeSafe Noul docs",
    features: ["showcase"],
    state:
      "I have asked three times now. Can I please just talk to a real person?",
    questions: {
      is_human_escalation: {
        type: "noul",
        instructions: "Is the customer asking for a human agent?",
      },
      is_repeat_contact: {
        type: "noul",
        instructions: "Has the customer contacted support about this before?",
        criteria: {
          true: "Mentions a prior attempt, ticket, or that they have asked before",
          false: "No sign of any previous contact",
        },
      },
    },
    expect: [
      { noul: { id: "is_human_escalation", min: 0.75 } },
      { noul: { id: "is_repeat_contact", min: 0.62 } },
    ],
  },
  {
    id: "refund-requested",
    source: "TypeSafe System One docs",
    features: ["showcase", "structured"],
    state: {
      ticket_message: "My flight was cancelled. Can I get a refund?",
      refund_policy: "Cancelled flights are eligible for a full refund.",
    },
    questions: {
      refund_requested: {
        type: "noul",
        instructions: "Does `ticket_message` request a refund?",
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
    },
    expect: [
      { noul: { id: "refund_requested", min: 0.7 } },
      { choice: { id: "request_type", value: "refund", minP: 0.5 } },
    ],
  },
  {
    id: "not-refund",
    source: "OpenJev calibration",
    features: ["showcase", "negation"],
    state: "Thanks, just confirming the order shipped. No action needed.",
    questions: {
      refund_requested: {
        type: "noul",
        instructions: "Does this message request a refund?",
      },
    },
    expect: [{ noul: { id: "refund_requested", max: 0.4 } }],
  },
  {
    id: "spam",
    source: "OpenJev calibration",
    features: ["showcase"],
    state:
      "Congratulations! You have been selected as a winner of a $2,500 crypto prize. Click here to claim within 24 hours.",
    questions: {
      is_spam: {
        type: "noul",
        instructions: "Is this unsolicited spam or a scam?",
        criteria: {
          true: "Prize, crypto, phishing, unsubscribe bait, fake urgency",
          false: "A legitimate customer or coworker message",
        },
      },
    },
    expect: [{ noul: { id: "is_spam", min: 0.75 } }],
  },
];
