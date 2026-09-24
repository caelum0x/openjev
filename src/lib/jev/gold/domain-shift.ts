import type { GoldCase } from "./types.ts";

/**
 * Domain shift: the same three primitives (Choice / Score / Noul) applied far
 * from the support-desk domain the showcase lives in — GDPR triage, insurance
 * claims, market data, smart-home commands, ad-creative ranking, coding-agent
 * tool routing, and destructive-migration risk. Proves the engine is a general
 * classifier, not a support-desk lookup table.
 */
export const DOMAIN_SHIFT: GoldCase[] = [
  {
    id: "gdpr-erasure",
    source: "domain-shift: GDPR request routing",
    features: ["domain-shift"],
    state:
      "Under GDPR I request erasure of all my personal data and to be forgotten across your systems.",
    questions: {
      gdpr_request: {
        type: "choice",
        instructions: "Which data-subject right is being exercised?",
        criteria: {
          access: "Wants a copy of the personal data held about them",
          erasure: "Wants their personal data deleted or forgotten",
          rectification: "Wants inaccurate personal data corrected",
          portability: "Wants their data exported to another controller",
        },
      },
    },
    expect: [{ choice: { id: "gdpr_request", value: "erasure", minP: 0.4 } }],
  },
  {
    id: "gdpr-breach-severity",
    source: "domain-shift: breach severity",
    features: ["domain-shift"],
    state:
      "We discovered a data breach exposing personal data of thousands of users, including passwords.",
    questions: {
      breach_severity: {
        type: "score",
        instructions: "How severe is this privacy incident?",
        criteria: [
          "No personal data exposed; a near-miss",
          "Limited exposure of low-sensitivity data",
          "Large-scale exposure of sensitive personal data",
        ],
      },
    },
    expect: [{ score: { id: "breach_severity", min: 1.0, max: 2 } }],
  },
  {
    id: "insurance-fault",
    source: "domain-shift: auto claim liability",
    features: ["domain-shift"],
    state:
      "The other driver rear-ended my bumper at a red light. I have photos and the police report says they were at fault.",
    questions: {
      liability: {
        type: "choice",
        instructions: "Who appears to be at fault in this collision?",
        criteria: {
          insured_at_fault: "Our policyholder caused the collision",
          third_party_at_fault: "The other driver caused the collision",
          shared: "Both parties share fault",
          unclear: "Not enough evidence to assign fault",
        },
      },
    },
    expect: [
      {
        choice: {
          id: "liability",
          value: "third_party_at_fault",
          minP: 0.35,
          soft: true,
        },
      },
    ],
  },
  {
    id: "insurance-claimable",
    source: "domain-shift: is this a claim",
    features: ["domain-shift"],
    state:
      "My car was hit in a collision and the bumper is wrecked. Deductible is 500. I want to file a claim.",
    questions: {
      is_claim: {
        type: "noul",
        instructions: "Is the customer filing an insurance claim?",
        criteria: {
          true: "Reports damage or loss and wants it covered or paid out",
          false: "A general policy question with no incident",
        },
      },
    },
    expect: [{ noul: { id: "is_claim", min: 0.55 } }],
  },
  {
    id: "stocks-correlation",
    source: "domain-shift: market analytics intent",
    features: ["domain-shift"],
    state:
      "Compute the correlation of NVDA daily returns against the SPY benchmark over the last 90 candles.",
    questions: {
      analysis_type: {
        type: "choice",
        instructions: "What kind of market analysis is requested?",
        criteria: {
          correlation: "Relationship between two tickers' returns",
          volume_profile: "Distribution of traded volume by price",
          volatility: "Dispersion or risk of a single ticker",
          forecast: "A prediction of future price",
        },
      },
    },
    expect: [
      { choice: { id: "analysis_type", value: "correlation", minP: 0.4 } },
    ],
  },
  {
    id: "smart-home-lights",
    source: "domain-shift: smart-home command",
    features: ["domain-shift"],
    state: "Dim the kitchen lights to 20 percent and turn off the bedroom lamp.",
    questions: {
      device: {
        type: "choice",
        instructions: "Which device group does this command target?",
        criteria: {
          lights: "Lamps, ceiling lights, dimmers, bulbs",
          thermostat: "Heating, cooling, temperature",
          lock: "Door locks and access",
          speaker: "Audio playback and volume",
        },
      },
    },
    expect: [{ choice: { id: "device", value: "lights", minP: 0.45 } }],
  },
  {
    id: "smart-home-not-lights",
    source: "domain-shift: thermostat command",
    features: ["domain-shift"],
    state: "Set the temperature to 68 degrees, it's freezing in here.",
    questions: {
      device: {
        type: "choice",
        instructions: "Which device group does this command target?",
        criteria: {
          lights: "Lamps, ceiling lights, dimmers, bulbs",
          thermostat: "Heating, cooling, temperature, degrees",
          lock: "Door locks and access",
          speaker: "Audio playback and volume",
        },
      },
    },
    expect: [
      { choice: { id: "device", value: "thermostat", minP: 0.4, soft: true } },
    ],
  },
  {
    id: "meta-ads-winner",
    source: "domain-shift: ad creative performance",
    features: ["domain-shift"],
    state:
      "This hook is a clear winner: CTR is up, CPA is down, and ROAS beat every other creative in the set.",
    questions: {
      creative_verdict: {
        type: "choice",
        instructions: "How is this ad creative performing?",
        criteria: {
          winning: "Strong metrics; scale it up",
          fatigued: "Was good but performance is now decaying",
          losing: "Weak metrics; turn it off",
        },
      },
    },
    expect: [
      { choice: { id: "creative_verdict", value: "winning", minP: 0.4 } },
    ],
  },
  {
    id: "meta-ads-fatigue",
    source: "domain-shift: ad fatigue score",
    features: ["domain-shift"],
    state:
      "Frequency is climbing, CTR has been sliding for two weeks, and CPA keeps creeping up on this ad.",
    questions: {
      fatigue_level: {
        type: "score",
        instructions: "How fatigued is this ad creative?",
        criteria: [
          "Fresh; metrics stable or improving",
          "Early signs of fatigue; watch it",
          "Heavily fatigued; performance decaying fast",
        ],
      },
    },
    expect: [{ score: { id: "fatigue_level", min: 1, max: 2 } }],
  },
  {
    id: "code-agent-run-tests",
    source: "domain-shift: coding-agent tool routing",
    features: ["domain-shift"],
    state:
      "Compilation is already green; now I want to run the unit tests before we commit this diff.",
    questions: {
      tool: {
        type: "choice",
        instructions: "Which tool should the coding agent invoke next?",
        criteria: {
          run_tests: "Execute the unit test suite",
          compile: "Compile or build the project",
          lint: "Run the linter",
          commit: "Create a git commit",
        },
      },
    },
    expect: [{ choice: { id: "tool", value: "run_tests", minP: 0.3 } }],
  },
  {
    id: "code-agent-search",
    source: "domain-shift: search vs write",
    features: ["domain-shift"],
    state:
      "Before changing anything, grep the codebase to find every caller of this function.",
    questions: {
      tool: {
        type: "choice",
        instructions: "Which tool should the coding agent invoke next?",
        criteria: {
          search: "Grep or read to locate code",
          write: "Modify or create a file",
          run: "Execute a command or test",
          commit: "Create a git commit",
        },
      },
    },
    expect: [{ choice: { id: "tool", value: "search", minP: 0.35 } }],
  },
  {
    id: "migration-risk",
    source: "domain-shift: destructive migration gate",
    features: ["domain-shift"],
    state:
      "This migration will DROP the payments table in production and it is irreversible.",
    questions: {
      is_risky: {
        type: "noul",
        instructions: "Is this a risky, destructive, or irreversible action?",
        criteria: {
          true: "Deletes, drops, or migrates production data irreversibly",
          false: "A safe, reversible, or read-only change",
        },
      },
    },
    expect: [{ noul: { id: "is_risky", min: 0.6 } }],
  },
  {
    id: "escalate-legal",
    source: "domain-shift: legal/compliance escalation",
    features: ["domain-shift"],
    state:
      "This involves PII and a possible compliance breach; legal and the DPO need to review before we respond.",
    questions: {
      needs_human: {
        type: "noul",
        instructions: "Does this require escalation to a human reviewer?",
        criteria: {
          true: "Legal, compliance, PII, or policy risk needing human review",
          false: "Routine request an automated agent can safely handle",
        },
      },
    },
    expect: [{ noul: { id: "needs_human", min: 0.55 } }],
  },
];
