import type { GoldCase } from "./types.ts";
import { DEPARTMENT, IS_HUMAN, IS_REPEAT, PRIORITY, SEVERITY } from "./schemas.ts";

/**
 * Long-form state: multi-sentence, rambling messages where the decisive signal
 * is buried in noise. Tests that IDF weighting and distinctive-term matching
 * still surface the right label when most of the text is filler.
 */
export const LONGFORM: GoldCase[] = [
  {
    id: "long-billing-buried",
    source: "longform: billing signal buried in a story",
    features: ["longform"],
    state:
      "Hi team, hope you're having a good week. I've been a happy customer for about three years now and generally everything has been smooth. I moved apartments last month which was chaotic, and around the same time I switched to the annual plan. Anyway, the reason I'm writing is that when I checked my statement this morning I noticed I was charged twice for the same invoice, once on the 3rd and again on the 5th. Could you please look into the duplicate charge and refund the extra one? Thanks so much.",
    questions: DEPARTMENT,
    expect: [{ choice: { id: "department", value: "billing", minP: 0.35 } }],
  },
  {
    id: "long-shipping-buried",
    source: "longform: shipping signal buried",
    features: ["longform"],
    state:
      "So I ordered a gift for my sister's birthday which is this weekend, and I paid for expedited delivery specifically so it would arrive in time. I've been refreshing the tracking page obsessively. The tracking number hasn't updated in six days and still says the package is in transit at a facility two states away. The delivery estimate keeps slipping. I'm worried the package is lost. Can someone find out where it actually is?",
    questions: DEPARTMENT,
    expect: [{ choice: { id: "department", value: "shipping", minP: 0.35 } }],
  },
  {
    id: "long-severity-blocking",
    source: "longform: blocking outage in a wall of text",
    features: ["longform"],
    state:
      "Not sure if this is the right channel but I'll try to explain everything. This morning our entire team came in and none of us could access the dashboard. We tried different browsers, cleared caches, restarted machines, the whole routine. Every single login attempt returns a 500 error page. Our whole operations team is completely blocked, nobody can work, and this is costing us real money by the hour. We need this fixed now.",
    questions: SEVERITY,
    expect: [{ score: { id: "bug_severity", min: 1.2, max: 2 } }],
  },
  {
    id: "long-priority-urgent",
    source: "longform: urgency buried in context",
    features: ["longform"],
    state:
      "Background: we're a fintech and we have a compliance audit that starts first thing tomorrow morning. I know your SLA is 48 hours normally and I usually wouldn't push, but the export feature we rely on to generate the audit report is throwing errors and timing out. Without it we cannot produce the documents the auditors need. This is genuinely time-critical for us tonight.",
    questions: PRIORITY,
    expect: [{ score: { id: "priority", min: 2, max: 3 } }],
  },
  {
    id: "long-repeat-contact",
    source: "longform: repeat-contact signal buried",
    features: ["longform"],
    state:
      "I'll keep this civil but I'm at the end of my rope. I first emailed about this on the 2nd, opened ticket 44821. Then I followed up on the 7th, and again last Tuesday. Each time I was told someone would get back to me within 24 hours and nobody has. So here I am, contacting you yet again about the exact same unresolved issue.",
    questions: IS_REPEAT,
    expect: [{ noul: { id: "is_repeat_contact", min: 0.55, soft: true } }],
  },
  {
    id: "long-human-escalation",
    source: "longform: buried request for a human",
    features: ["longform"],
    state:
      "I've read the help articles, I've tried the chatbot twice, and I've followed every troubleshooting step in your documentation. None of it addresses my specific situation because my account was migrated from the legacy system. At this point I really think I just need to speak with an actual human being who can look at my account directly. Can you connect me with a real representative?",
    questions: IS_HUMAN,
    expect: [{ noul: { id: "is_human_escalation", min: 0.55 } }],
  },
  {
    id: "long-returns-buried",
    source: "longform: return reason buried",
    features: ["longform"],
    state:
      "Thanks for the quick shipping, the box arrived a day early which was great. Packaging was lovely too. Unfortunately when I tried on the boots they're clearly too small, my usual size runs large in this brand it seems. Everything else about the order was perfect. I'd like to send these back and exchange them for the next size up if that's possible.",
    questions: {
      return_reason: {
        type: "choice",
        instructions: "Why does the customer want to return the item?",
        criteria: {
          wrong_size: "The item doesn't fit; needs a different size",
          wrong_item: "A different product was delivered than ordered",
          damaged: "The item arrived broken or faulty",
          changed_mind: "The item is fine, the customer no longer wants it",
        },
      },
    },
    expect: [{ choice: { id: "return_reason", value: "wrong_size", minP: 0.35 } }],
  },
  {
    id: "long-calm-despite-length",
    source: "longform: genuinely calm long message",
    features: ["longform"],
    state:
      "Just wanted to drop a note to say the new update is working nicely on my end. I had a small question about the reporting tab but I figured it out on my own from the docs, so no action needed. Really appreciate the work your team puts in, and thanks again for the great support last month. Have a good one.",
    questions: {
      tone: {
        type: "choice",
        instructions: "What is the customer's tone?",
        criteria: { calm: null, frustrated: null, angry: null },
      },
    },
    expect: [{ choice: { id: "tone", value: "calm", minP: 0.35 } }],
  },
];
