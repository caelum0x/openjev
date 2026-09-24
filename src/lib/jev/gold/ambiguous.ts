import type { GoldCase } from "./types.ts";
import { DEPARTMENT, IS_REFUND, SEVERITY, TONE } from "./schemas.ts";

/**
 * Ambiguous-between-two-valid: cases where two labels genuinely both apply and
 * a well-calibrated model should report *low* confidence. The ground-truth label
 * is the marginally better-supported reading, but every assertion is soft — the
 * point of these cases is the confidence band (they should NOT be confident),
 * which is what the calibration reliability curve is built to detect. When the
 * engine is spuriously confident here, that is a real mis-calibration signal.
 */
export const AMBIGUOUS: GoldCase[] = [
  {
    id: "amb-refund-vs-shipping",
    source: "ambiguous: late package AND refund",
    features: ["ambiguous"],
    state:
      "My package is three weeks late. At this point should I just get a refund or is it still coming?",
    questions: DEPARTMENT,
    expect: [
      {
        choice: {
          id: "department",
          value: "shipping",
          confBand: [0, 0.75],
          soft: true,
        },
      },
    ],
  },
  {
    id: "amb-billing-vs-account",
    source: "ambiguous: charged after cancelling, locked out",
    features: ["ambiguous"],
    state:
      "I was charged after cancelling, and now I can't log in to check my invoices at all.",
    questions: DEPARTMENT,
    expect: [
      {
        choice: {
          id: "department",
          value: "billing",
          confBand: [0, 0.75],
          soft: true,
        },
      },
    ],
  },
  {
    id: "amb-returns-vs-billing",
    source: "ambiguous: wrong item and a double charge",
    features: ["ambiguous"],
    state:
      "You sent the wrong item and also charged me twice. I want this sorted out.",
    questions: DEPARTMENT,
    expect: [
      {
        choice: {
          id: "department",
          value: "returns",
          confBand: [0, 0.8],
          soft: true,
        },
      },
    ],
  },
  {
    id: "amb-tone-frustrated-vs-angry",
    source: "ambiguous: between frustrated and angry",
    features: ["ambiguous"],
    state:
      "Okay, this is getting really old. I've been patient but I'm losing it here.",
    questions: TONE,
    expect: [
      {
        choice: {
          id: "tone",
          value: "frustrated",
          confBand: [0, 0.8],
          soft: true,
        },
      },
    ],
  },
  {
    id: "amb-tone-calm-vs-frustrated",
    source: "ambiguous: polite but disappointed",
    features: ["ambiguous"],
    state:
      "I appreciate the help so far, though I'll admit this has been a bit disappointing.",
    questions: TONE,
    expect: [
      {
        choice: {
          id: "tone",
          value: "frustrated",
          confBand: [0, 0.8],
          soft: true,
        },
      },
    ],
  },
  {
    id: "amb-severity-mid",
    source: "ambiguous: degraded with partial workaround",
    features: ["ambiguous"],
    state:
      "Checkout fails about half the time. Some users get through on a retry, others give up.",
    questions: SEVERITY,
    expect: [
      { score: { id: "bug_severity", min: 0.6, max: 1.7, soft: true } },
    ],
  },
  {
    id: "amb-refund-maybe",
    source: "ambiguous: exploring a refund without asking",
    features: ["ambiguous"],
    state:
      "If this can't be fixed soon I might ask for my money back, but let's see.",
    questions: IS_REFUND,
    expect: [{ noul: { id: "refund_requested", min: 0.25, max: 0.8, soft: true } }],
  },
  {
    id: "amb-reason-size-or-changed",
    source: "ambiguous: size wrong but also unsure",
    features: ["ambiguous"],
    state:
      "It's a bit tight, though honestly I'm not sure the style is for me either.",
    questions: {
      return_reason: {
        type: "choice",
        instructions: "Why does the customer want to return the item?",
        criteria: {
          wrong_size: "The item doesn't fit; needs a different size",
          changed_mind: "The item is fine, the customer no longer wants it",
          damaged: "The item arrived broken or faulty",
        },
      },
    },
    expect: [
      {
        choice: {
          id: "return_reason",
          value: "wrong_size",
          confBand: [0, 0.85],
          soft: true,
        },
      },
    ],
  },
  {
    id: "amb-sales-vs-account",
    source: "ambiguous: upgrade blocked by login",
    features: ["ambiguous"],
    state:
      "I want to upgrade to the pro plan but the account page won't let me sign in to do it.",
    questions: DEPARTMENT,
    expect: [
      {
        choice: {
          id: "department",
          value: "account",
          confBand: [0, 0.8],
          soft: true,
        },
      },
    ],
  },
  {
    id: "amb-urgent-or-not",
    source: "ambiguous: soon but no hard deadline",
    features: ["ambiguous"],
    state:
      "It'd be great to have this resolved soon-ish, no firm deadline but I don't want it dragging on.",
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
    expect: [{ noul: { id: "is_urgent", min: 0.2, max: 0.8, soft: true } }],
  },
];
