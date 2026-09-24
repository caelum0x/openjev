import type { State, Questions } from "./types";

export type PlayExample = {
  id: string;
  label: string;
  blurb: string;
  state: State;
  questions: Questions;
};

export const PLAY_EXAMPLES: PlayExample[] = [
  {
    id: "refund",
    label: "Refund ticket",
    blurb: "The TypeSafe System One example. State object, three primitives, one call.",
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
      frustration: {
        type: "score",
        instructions: "How frustrated does the customer appear in `ticket_message`?",
        criteria: [
          "Calm and neutral.",
          "Concerned but civil.",
          "Very angry or using strong language.",
        ],
      },
    },
  },
  {
    id: "ticket",
    label: "Support ticket",
    blurb: "Batch a choice, a score, and a noul on one message.",
    state:
      "Help! My payouts have been failing for 3 days. I was charged twice for order A-104 and I need a refund on the duplicate. This is the third time I have written in.",
    questions: {
      department: {
        type: "choice",
        instructions: "Which team should handle this?",
        criteria: {
          billing: "Payments, invoicing, refunds, charges",
          technical: "Bugs, outages, integrations, API failures",
          sales: "Pricing, upgrades, new accounts",
          spam: "Unsolicited, irrelevant, or abusive",
        },
      },
      frustration: {
        type: "score",
        instructions: "How frustrated is the customer?",
        criteria: [
          "Calm and polite",
          "Concerned but civil",
          "Frustrated",
          "Very angry",
        ],
      },
      is_urgent: {
        type: "noul",
        instructions: "Does this convey urgency?",
        criteria: {
          true: "Explicitly time-sensitive, failing systems, or waiting days",
          false: "No urgency expressed",
        },
      },
    },
  },
  {
    id: "spam",
    label: "Spam gate",
    blurb: "A noul you can threshold. Under 0.5, escalate.",
    state:
      "Congratulations! You have been selected as a winner of a $2,500 crypto prize. Click here to claim within 24 hours. Unsubscribe at the bottom.",
    questions: {
      is_spam: {
        type: "noul",
        instructions: "Is this unsolicited spam or a scam?",
        criteria: {
          true: "Prize, crypto, phishing, unsubscribe bait, fake urgency",
          false: "A legitimate customer or coworker message",
        },
      },
      next: {
        type: "choice",
        instructions: "What should the agent do?",
        criteria: {
          drop: "Discard without a reply",
          quarantine: "Hold for a human spam review",
          reply: "Treat as a real request",
        },
      },
    },
  },
  {
    id: "router",
    label: "Tool router",
    blurb: "The cheap call that should not be a frontier model.",
    state: {
      goal: "Fix the failing login test in src/auth.test.ts",
      tools: ["read_file", "run_tests", "search_web", "commit", "deploy"],
      last_error: "Expected session cookie, received 401",
    },
    questions: {
      tool: {
        type: "choice",
        instructions: "Which tool should run next?",
        criteria: {
          read_file: "Open a source file to inspect the failure",
          run_tests: "Re-run the test suite",
          search_web: "Look up an external API or error",
          commit: "Save a finished fix",
          deploy: "Ship to production",
        },
      },
      needs_human: {
        type: "noul",
        instructions: "Does this need a human before any tool runs?",
        criteria: {
          true: "Irreversible, ambiguous, or policy-sensitive",
          false: "A routine engineering step the agent can take",
        },
      },
    },
  },
  {
    id: "ads",
    label: "Winning meta ads",
    blurb: "Score creatives against a rubric. Seconds, not a model essay.",
    state: {
      ad: {
        hook: "You met me at a very Chinese time of my life.",
        body: "OpenJev drops dead tool calls instead of summarizing them. Typed keep/drop in one batch.",
        cta: "Run the compaction demo",
        format: "15s ugc, on-screen captions, no logo until last 2s",
      },
      metrics: { ctr: 0.041, cpa: 18.2, frequency: 1.4, spend: 420 },
      account_median: { ctr: 0.018, cpa: 34.0, frequency: 2.8 },
    },
    questions: {
      winner: {
        type: "noul",
        instructions:
          "Is this a winning ad versus the account median on CTR and CPA?",
        criteria: {
          true: "CTR well above median and CPA well below median at low frequency",
          false: "At or worse than the account median, or fatigued",
        },
      },
      hook: {
        type: "choice",
        instructions: "Which hook family is this?",
        criteria: {
          pattern_interrupt: "Odd, specific, or meme-coded opening line",
          proof: "Numbers, results, or a demo",
          pain: "Calls out a problem the viewer has",
          offer: "Discount, giveaway, or time-limited deal",
        },
      },
      fatigue: {
        type: "score",
        instructions: "How fatigued is this creative?",
        criteria: [
          "Fresh, frequency under 2",
          "Warm, still converting",
          "Tired, frequency climbing",
          "Burned out, refresh now",
        ],
      },
    },
  },
  {
    id: "diff",
    label: "Diff risk",
    blurb: "Gate a tool call before it runs.",
    state: {
      diff: "DROP TABLE users; ALTER TABLE payments ADD COLUMN raw_pan text;",
      tool: "apply_migration",
    },
    questions: {
      risk: {
        type: "score",
        instructions: "How risky is this diff?",
        criteria: [
          "Safe, reversible, tests only",
          "Touches prod config but is recoverable",
          "Schema or payments change",
          "Destructive and likely irreversible",
        ],
      },
      allow: {
        type: "noul",
        instructions: "Should the gate allow this tool call to run?",
        criteria: {
          true: "Low risk, reversible, no PII or destructive SQL",
          false: "Destructive, irreversible, or handles sensitive data",
        },
      },
    },
  },
  {
    id: "rag",
    label: "Chunk relevance",
    blurb: "Filter retrieved chunks before they hit the writer.",
    state: {
      query: "How do I rotate the TypeSafe API key?",
      chunk:
        "Create an API key in the dashboard. Keys are shown once. Store them as TYPESAFE_API_KEY. Rotation: revoke the old key after the new one is in production.",
    },
    questions: {
      relevant: {
        type: "noul",
        instructions: "Does this chunk answer the query?",
        criteria: {
          true: "It explains key creation or rotation",
          false: "Off-topic or generic product copy",
        },
      },
    },
  },
];

export function exampleById(id: string): PlayExample {
  return PLAY_EXAMPLES.find((e) => e.id === id) ?? PLAY_EXAMPLES[0]!;
}
