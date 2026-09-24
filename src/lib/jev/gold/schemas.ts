import type { Questions } from "../types.ts";

/**
 * Reusable question schemas shared across the gold suite modules. Keeping the
 * rubrics in one place means a paraphrase case and a negation case are graded
 * against the *same* criteria the showcase cases use, so the suite measures the
 * engine and not accidental rubric drift.
 */

/** Support-desk routing across the common product surfaces. */
export const DEPARTMENT: Questions = {
  department: {
    type: "choice",
    instructions: "Which team should handle this?",
    criteria: {
      returns: "Exchanges, refunds, wrong, damaged, or unwanted items",
      shipping: "Delivery status, delays, tracking, lost packages",
      billing: "Charges, invoices, duplicate payments, subscriptions",
      account: "Login, password, access, locked or hacked accounts",
      sales: "Pricing, plans, upgrades, demos, new purchases",
    },
  },
};

/** Return-reason sub-classification. */
export const RETURN_REASON: Questions = {
  return_reason: {
    type: "choice",
    instructions: "If the customer wants to return something, why?",
    criteria: {
      wrong_size: "The item doesn't fit; needs a different size",
      wrong_item: "A different product was delivered than ordered",
      damaged: "The item arrived broken, faulty, or defective",
      changed_mind: "The item is fine, the customer no longer wants it",
      other: "A return reason that fits none of the above",
    },
  },
};

/** Customer tone. Intentionally sparse (null) criteria to lean on the lexicon. */
export const TONE: Questions = {
  tone: {
    type: "choice",
    instructions: "What is the customer's tone?",
    criteria: { calm: null, frustrated: null, angry: null },
  },
};

/** Bug severity as an ordered 3-level score (0 cosmetic .. 2 blocking). */
export const SEVERITY: Questions = {
  bug_severity: {
    type: "score",
    instructions: "How severe is the reported issue?",
    criteria: [
      "Cosmetic; no impact to functionality",
      "Broken or degraded feature, but a workaround exists",
      "Blocking issue; no workaround exists",
    ],
  },
};

/** Priority as a 4-level ordered score (0 none .. 3 urgent). */
export const PRIORITY: Questions = {
  priority: {
    type: "score",
    instructions: "How urgent is this request?",
    criteria: [
      "No urgency; a routine question or FYI",
      "Mild; the user would like it handled soon",
      "High; the user is blocked or waiting on this",
      "Critical; an outage or time-sensitive emergency",
    ],
  },
};

/** Yes/no: does the message ask for money back? */
export const IS_REFUND: Questions = {
  refund_requested: {
    type: "noul",
    instructions: "Does the message request a refund or money back?",
    criteria: {
      true: "Asks for money back, a refund, reimbursement, or chargeback reversal",
      false: "No money is requested; a question, thanks, or status check",
    },
  },
};

/** Yes/no: is the sender asking for a human? */
export const IS_HUMAN: Questions = {
  is_human_escalation: {
    type: "noul",
    instructions: "Is the customer asking to be handed to a human agent?",
    criteria: {
      true: "Wants a real person, representative, manager, or supervisor",
      false: "Happy with self-service or an automated answer",
    },
  },
};

/** Yes/no: is this spam or a scam? */
export const IS_SPAM: Questions = {
  is_spam: {
    type: "noul",
    instructions: "Is this unsolicited spam or a scam?",
    criteria: {
      true: "Prize, crypto, phishing, unsubscribe bait, fake urgency, lottery",
      false: "A legitimate customer or coworker message",
    },
  },
};

/** Yes/no: has the person contacted support before? */
export const IS_REPEAT: Questions = {
  is_repeat_contact: {
    type: "noul",
    instructions: "Has the customer contacted support about this before?",
    criteria: {
      true: "Mentions a prior attempt, ticket, or that they have asked before",
      false: "No sign of any previous contact",
    },
  },
};
