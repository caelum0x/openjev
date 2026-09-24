import type { Questions } from "../types.ts";
import { lexicalEvaluator, type Evaluator } from "./evaluator.ts";
import type { NoulAnswer } from "../types.ts";
import {
  thresholdInfo,
  thresholdsFor,
  type ConsistencyGates,
} from "./thresholds.ts";

/** The pay / deny / human-review decision from the three gate nouls. */
export function consistencyDecision(
  gates: { pay: number; deny: number; human_review: number },
  t: ConsistencyGates,
): "pay" | "deny" | "human_review" {
  const { pay, deny, human_review } = gates;
  if (deny > t.deny_min && deny > pay) return "deny";
  if (pay > t.pay_min && deny < t.pay_max_deny && human_review < t.pay_max_human) return "pay";
  return "human_review";
}

export const CLAIM_STATE = {
  claim_id: "CL-20441",
  line: "personal auto",
  narrative:
    "Insured rear-ended the other vehicle at about 20 mph in stop-and-go traffic. No injuries reported by either driver. Bumper cover cracked, photos attached of both vehicles and the scene. Other driver admitted fault at the scene and shared insurance. Insured is asking $2,400 for bumper replacement. No police report. Policy is in force, collision deductible $500, no prior at-fault claims this term.",
  coverage: {
    collision: true,
    comprehensive: true,
    liability: true,
    deductible_usd: 500,
    in_force: true,
  },
  ask_usd: 2400,
  injuries: "none reported",
  police_report: false,
  photos: true,
  other_driver_admits_fault: true,
};

export const CONSISTENCY_QUESTIONS: Questions = {
  collision_applies: {
    type: "noul",
    instructions: "Does collision coverage apply to this loss?",
    criteria: {
      true: "In-force collision, at-fault or not, vehicle damage from a crash",
      false: "No collision coverage, or the loss is not a crash",
    },
  },
  liability_not_needed: {
    type: "noul",
    instructions: "Is this first-party collision rather than a third-party liability payout?",
    criteria: {
      true: "Insured's own vehicle is being repaired under collision",
      false: "We would be paying the other driver's damages under liability",
    },
  },
  insured_at_fault: {
    type: "noul",
    instructions: "Is the insured at fault for the crash?",
    criteria: {
      true: "Rear-end in stop-and-go typically at-fault for the following driver",
      false: "The other party caused it",
    },
  },
  other_admits: {
    type: "noul",
    instructions: "Did the other driver admit fault?",
    criteria: {
      true: "The narrative says the other driver admitted fault",
      false: "No admission",
    },
  },
  injuries: {
    type: "noul",
    instructions: "Were injuries reported?",
    criteria: {
      true: "Bodily injury is claimed or mentioned",
      false: "Explicitly no injuries",
    },
  },
  photos: {
    type: "noul",
    instructions: "Are photos of the damage available?",
    criteria: { true: "Photos attached", false: "No photos" },
  },
  police: {
    type: "noul",
    instructions: "Is there a police report?",
    criteria: { true: "A police report exists", false: "No police report" },
  },
  amount_plausible: {
    type: "noul",
    instructions: "Is $2,400 a plausible bumper-cover replacement on a passenger car?",
    criteria: {
      true: "Within a normal bumper replacement range",
      false: "Outrageous or clearly padded",
    },
  },
  deductible_applies: {
    type: "noul",
    instructions: "Should the $500 collision deductible be applied?",
    criteria: {
      true: "First-party collision with a stated deductible",
      false: "No deductible on this loss",
    },
  },
  in_force: {
    type: "noul",
    instructions: "Is the policy in force at the date of loss?",
    criteria: { true: "Policy in force", false: "Lapsed or cancelled" },
  },
  prior_claims: {
    type: "noul",
    instructions: "Does the file show prior at-fault claims this term?",
    criteria: { true: "Prior at-fault claims exist", false: "None this term" },
  },
  fraud_flags: {
    type: "noul",
    instructions: "Are there fraud red flags (inconsistent story, no photos, inflated ask, injuries invented)?",
    criteria: {
      true: "Multiple fraud indicators",
      false: "Ordinary low-speed rear-end with photos and a modest ask",
    },
  },
  pay: {
    type: "noul",
    instructions: "Should the claim be paid (less deductible) without human review?",
    criteria: {
      true: "In-force collision, photos of the bumper, modest ask, no injuries reported",
      false: "Send to a human or refuse — injuries, fraud flags, or missing documents",
    },
  },
  deny: {
    type: "noul",
    instructions: "Should the claim be denied outright?",
    criteria: {
      true: "Lapsed policy, excluded peril, or a demonstrated lie",
      false: "Covered crash with photos and a normal repair ask",
    },
  },
  human_review: {
    type: "noul",
    instructions: "Does this need a human examiner before money moves?",
    criteria: {
      true: "Injuries, disputed fault, fraud indicators, or no photos",
      false: "Routine documented low-speed rear-end with an in-force policy",
    },
  },
};

function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

function llmJitter(base: number, run: number, id: string): number {
  const u = hash01(`${id}:${run}:a`);
  const v = hash01(`${id}:${run}:b`);
  const noise = (u - 0.5) * 0.55 + (v - 0.5) * 0.25;
  const flipped = hash01(`${id}:${run}:flip`) > 0.88 ? (1 - base) * 0.7 + 0.15 : base;
  const x = flipped + noise;
  return Math.min(0.99, Math.max(0.01, Math.round(x * 100) / 100));
}

export async function runConsistency(
  model = "system-one",
  evaluate: Evaluator = lexicalEvaluator,
  /** Claim to adjudicate (defaults to the demo claim). */
  claim: Record<string, unknown> = CLAIM_STATE,
  /** Override the engine's gates (the threshold tuner sweeps these). */
  gatesOverride?: ConsistencyGates,
) {
  const ts = await evaluate({ model, state: claim, questions: CONSISTENCY_QUESTIONS });
  const set = thresholdsFor(ts.engine);
  const t = gatesOverride ?? set.values.consistency;
  const ids = Object.keys(CONSISTENCY_QUESTIONS);
  const runs = 8;
  const llm: Record<string, number[]> = {};
  for (const id of ids) {
    const base = (ts.answers[id] as NoulAnswer | undefined)?.noul ?? 0.5;
    llm[id] = Array.from({ length: runs }, (_, i) => llmJitter(base, i, id));
  }

  const rows = ids.map((id) => {
    const noul = (ts.answers[id] as NoulAnswer).noul;
    const samples = llm[id] ?? [];
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const variance =
      samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length;
    const min = Math.min(...samples);
    const max = Math.max(...samples);
    return {
      id,
      typesafe: noul,
      llm_mean: Math.round(mean * 1000) / 1000,
      llm_std: Math.round(Math.sqrt(variance) * 1000) / 1000,
      llm_range: [min, max] as [number, number],
      llm_samples: samples,
    };
  });

  const pay = (ts.answers.pay as NoulAnswer).noul;
  const deny = (ts.answers.deny as NoulAnswer).noul;
  const human = (ts.answers.human_review as NoulAnswer).noul;
  const decision = consistencyDecision({ pay, deny, human_review: human }, t);

  return {
    model: ts.model,
    engine: ts.engine ?? null,
    usage: ts.usage,
    latency_ms: ts.latency_ms,
    decision,
    gates: { pay, deny, human_review: human },
    thresholds: gatesOverride
      ? { set: "override" as const, fitted_on: null, values: gatesOverride }
      : thresholdInfo(set, "consistency"),
    rows,
    note: "TypeSafe is one calibrated pass. The LLM column is 8 simulated writer-model runs of the same yes/no questions — they flip. Threshold the noul, not the prose.",
  };
}

export const CONSISTENCY_META = {
  id: "consistency",
  title: "Self-consistency",
  blurb:
    "Score an auto claim against a 15-question adjudication rubric. Writer-model answers wander run to run. TypeSafe returns stable noul probabilities in one pass.",
  stat: "15 nouls, 1 pass",
  href: "/cookbooks/consistency",
};
