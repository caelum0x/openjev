import type { GoldCase } from "./types.ts";
import {
  DEPARTMENT,
  IS_HUMAN,
  IS_REFUND,
  IS_SPAM,
  PRIORITY,
  SEVERITY,
  TONE,
} from "./schemas.ts";

/**
 * Adversarial paraphrases: the intent is unchanged but the surface wording
 * avoids the literal rubric keywords, leaning on synonyms, idiom, and rephrasing.
 * These stress the lexicon expansion + fuzzy matching rather than exact overlap.
 */
export const PARAPHRASE: GoldCase[] = [
  {
    id: "para-billing-idiom",
    source: "paraphrase: billing without the word billing",
    features: ["paraphrase"],
    state:
      "You folks dinged my card twice for the same order. I want the extra one reversed.",
    questions: DEPARTMENT,
    expect: [{ choice: { id: "department", value: "billing", minP: 0.4 } }],
  },
  {
    id: "para-shipping-idiom",
    source: "paraphrase: shipping without the word shipping",
    features: ["paraphrase"],
    state:
      "The tracking hasn't moved in a week and my package is nowhere to be seen.",
    questions: DEPARTMENT,
    expect: [{ choice: { id: "department", value: "shipping", minP: 0.4 } }],
  },
  {
    id: "para-account-idiom",
    source: "paraphrase: account lockout",
    features: ["paraphrase"],
    state:
      "It keeps rejecting my password and now it says my login is locked. I can't get in.",
    questions: DEPARTMENT,
    expect: [{ choice: { id: "department", value: "account", minP: 0.4 } }],
  },
  {
    id: "para-sales-idiom",
    source: "paraphrase: pre-sales interest",
    features: ["paraphrase"],
    state:
      "We're a 40-person team weighing an upgrade to the enterprise plan. Could someone walk us through a demo and pricing?",
    questions: DEPARTMENT,
    expect: [{ choice: { id: "department", value: "sales", minP: 0.4 } }],
  },
  {
    id: "para-returns-idiom",
    source: "paraphrase: return without the word return",
    features: ["paraphrase"],
    state:
      "This jacket doesn't fit at all. How do I send it back and swap it for a larger size?",
    questions: DEPARTMENT,
    expect: [{ choice: { id: "department", value: "returns", minP: 0.4 } }],
  },
  {
    id: "para-refund-euphemism",
    source: "paraphrase: refund via euphemism",
    features: ["paraphrase"],
    state:
      "Given how this went, I'd like my money back on the whole order, please.",
    questions: IS_REFUND,
    expect: [{ noul: { id: "refund_requested", min: 0.6 } }],
  },
  {
    id: "para-refund-reimburse",
    source: "paraphrase: reimburse wording",
    features: ["paraphrase"],
    state:
      "Can you reimburse me for the duplicate payment? I never wanted two subscriptions.",
    questions: IS_REFUND,
    expect: [{ noul: { id: "refund_requested", min: 0.55 } }],
  },
  {
    id: "para-human-euphemism",
    source: "paraphrase: reach a human indirectly",
    features: ["paraphrase"],
    state:
      "This bot isn't helping. Is there any way to get an actual representative on the line?",
    questions: IS_HUMAN,
    expect: [{ noul: { id: "is_human_escalation", min: 0.6 } }],
  },
  {
    id: "para-angry-paraphrase",
    source: "paraphrase: anger without slurs",
    features: ["paraphrase"],
    state:
      "This is absolutely unacceptable. Third time this week and still broken. I'm furious.",
    questions: TONE,
    expect: [{ choice: { id: "tone", value: "angry", minP: 0.4 } }],
  },
  {
    id: "para-calm-paraphrase",
    source: "paraphrase: calm gratitude",
    features: ["paraphrase"],
    state:
      "No rush at all, just wanted to say thanks and confirm you received my note. Appreciate it.",
    questions: TONE,
    expect: [{ choice: { id: "tone", value: "calm", minP: 0.4 } }],
  },
  {
    id: "para-severity-blocking",
    source: "paraphrase: outage phrased softly",
    features: ["paraphrase"],
    state:
      "None of our staff can get past the sign-in screen this morning; the whole thing is down.",
    questions: SEVERITY,
    expect: [{ score: { id: "bug_severity", min: 1.2, max: 2 } }],
  },
  {
    id: "para-severity-cosmetic",
    source: "paraphrase: cosmetic nit",
    features: ["paraphrase"],
    state:
      "Tiny thing: the icon label has a typo. Not a big deal, everything works fine.",
    questions: SEVERITY,
    expect: [{ score: { id: "bug_severity", min: 0, max: 0.6 } }],
  },
  {
    id: "para-priority-urgent",
    source: "paraphrase: urgency without urgent",
    features: ["paraphrase"],
    state:
      "We have a launch tonight and the API is timing out. We're completely blocked and out of time.",
    questions: PRIORITY,
    expect: [{ score: { id: "priority", min: 2, max: 3 } }],
  },
  {
    id: "para-spam-softsell",
    source: "paraphrase: disguised spam",
    features: ["paraphrase"],
    state:
      "Hey friend, exclusive limited offer just for you: claim your free crypto bonus before it expires, click now.",
    questions: IS_SPAM,
    expect: [{ noul: { id: "is_spam", min: 0.6 } }],
  },
];
