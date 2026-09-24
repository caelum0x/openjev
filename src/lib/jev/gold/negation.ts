import type { GoldCase } from "./types.ts";
import { IS_HUMAN, IS_REFUND, IS_REPEAT, IS_SPAM, SEVERITY } from "./schemas.ts";

/**
 * Negation: the state contains the rubric keyword but negated, so a naive
 * keyword match would flip the label. The correct answer is the negated one.
 * Several are marked soft because a bag-of-words engine legitimately struggles
 * with scoped negation; the calibration harness should see these as the hard
 * tail where confidence ought to be low.
 */
export const NEGATION: GoldCase[] = [
  {
    id: "neg-no-refund-wanted",
    source: "negation: declines a refund",
    features: ["negation"],
    state:
      "I don't want a refund, I just want the correct item shipped to me. Please don't refund anything.",
    questions: IS_REFUND,
    expect: [{ noul: { id: "refund_requested", max: 0.5, soft: true } }],
  },
  {
    id: "neg-refund-mentioned-not-requested",
    source: "negation: refund only mentioned, not requested",
    features: ["negation"],
    state:
      "Your policy page talks about refunds, but I'm not asking for one. I only need to update my address.",
    questions: IS_REFUND,
    expect: [{ noul: { id: "refund_requested", max: 0.5, soft: true } }],
  },
  {
    id: "neg-no-human-needed",
    source: "negation: does not want a human",
    features: ["negation"],
    state:
      "No need to involve a person, the automated answer was perfect. Thanks!",
    questions: IS_HUMAN,
    expect: [{ noul: { id: "is_human_escalation", max: 0.55 } }],
  },
  {
    id: "neg-not-spam-legit",
    source: "negation: legitimate message that name-drops prize",
    features: ["negation"],
    state:
      "This is not one of those prize scams, I promise. I'm a real customer asking about my invoice.",
    questions: IS_SPAM,
    expect: [{ noul: { id: "is_spam", max: 0.6, soft: true } }],
  },
  {
    id: "neg-first-contact",
    source: "negation: explicitly first time contacting",
    features: ["negation"],
    state:
      "This is the first time I've ever reached out; I've never contacted support before.",
    questions: IS_REPEAT,
    expect: [{ noul: { id: "is_repeat_contact", max: 0.55, soft: true } }],
  },
  {
    id: "neg-not-blocking",
    source: "negation: explicitly not blocking",
    features: ["negation"],
    state:
      "The report export is off by a pixel. It's not blocking anyone and there's no error, purely cosmetic.",
    questions: SEVERITY,
    expect: [{ score: { id: "bug_severity", min: 0, max: 0.7, soft: true } }],
  },
  {
    id: "neg-no-longer-want",
    source: "negation: changed mind is not damage",
    features: ["negation"],
    state:
      "The blender works perfectly, nothing wrong with it, I just don't want it anymore and would like a refund.",
    questions: IS_REFUND,
    expect: [{ noul: { id: "refund_requested", min: 0.5, soft: true } }],
  },
  {
    id: "neg-cannot-not-urgent",
    source: "negation: reassures it is not urgent",
    features: ["negation"],
    state:
      "Whenever you get a chance, no urgency and definitely not an emergency, could you confirm my plan renews next month?",
    questions: {
      is_urgent: {
        type: "noul",
        instructions: "Is this an urgent, time-sensitive request?",
        criteria: {
          true: "An outage, deadline, or emergency needing a fast response",
          false: "A routine question with no time pressure",
        },
      },
    },
    expect: [{ noul: { id: "is_urgent", max: 0.6, soft: true } }],
  },
  {
    id: "neg-double-negative",
    source: "negation: double negative still wants human",
    features: ["negation"],
    state:
      "I can't say I wouldn't want to speak to a manager at this point.",
    questions: IS_HUMAN,
    expect: [{ noul: { id: "is_human_escalation", min: 0.4, soft: true } }],
  },
  {
    id: "neg-not-damaged",
    source: "negation: not damaged, wrong item",
    features: ["negation"],
    state:
      "The box wasn't damaged and nothing is broken, but you sent the wrong product entirely.",
    questions: {
      return_reason: {
        type: "choice",
        instructions: "Why does the customer want to return the item?",
        criteria: {
          wrong_size: "The item doesn't fit; needs a different size",
          wrong_item: "A different product was delivered than ordered",
          damaged: "The item arrived broken, faulty, or defective",
          changed_mind: "The item is fine, the customer no longer wants it",
        },
      },
    },
    expect: [
      { choice: { id: "return_reason", value: "wrong_item", soft: true } },
    ],
  },
  {
    id: "neg-not-charged",
    source: "negation: was not charged, no billing issue",
    features: ["negation"],
    state:
      "Good news, I was not charged twice after all. This is just a friendly heads-up, no action needed.",
    questions: IS_REFUND,
    expect: [{ noul: { id: "refund_requested", max: 0.5 } }],
  },
  {
    id: "neg-never-arrived",
    source: "negation: package never arrived is shipping",
    features: ["negation"],
    state:
      "My order never arrived and the tracking says it was never even picked up by the courier.",
    questions: {
      department: {
        type: "choice",
        instructions: "Which team should handle this?",
        criteria: {
          returns: "Exchanges, refunds, wrong or damaged items",
          shipping: "Delivery status, delays, tracking, lost packages",
          billing: "Charges, invoices, payment problems",
        },
      },
    },
    expect: [{ choice: { id: "department", value: "shipping", minP: 0.4 } }],
  },
];
