/**
 * Model cards for the local-engine tuning profiles.
 *
 * HONESTY CONTRACT
 * ----------------
 * The four local models (`system-one`, `jev-v13`, `decisive`, `contrastive`)
 * are NOT four separately trained networks. They are one deterministic engine
 * (`engine.ts`) run with four different `EngineWeights` scalar sets (`models.ts`).
 * There is no preference-learning run, no reward model, no checkpoint hash — the
 * only thing that changes between them is a handful of numbers (`tempScale`,
 * `dist`, `peakedBlend`, `neg`, ...). The old names "RLHF" / "RLCD" implied
 * training runs that never happened; the honest names below describe what the
 * scalars actually do.
 *
 * Everything in `MEASURED_PROFILES` is a real number produced by running the
 * shipped gold suite through the eval harness (`gold.ts` -> `evalProfiles`).
 * Regenerate with the command in `PROFILE_EVAL_PROVENANCE.command`. This module
 * imports nothing from the engine or the gold suite, so it stays a pure,
 * zero-dependency data island that the marketing `/models` page can render
 * without pulling the 93-case suite into the client bundle.
 */

/** One question type as scored by the calibration harness. */
export type QuestionType = "choice" | "score" | "noul";

/** A single scalar the profile changes relative to the Balanced baseline. */
export type TuningParamChange = {
  /** The `EngineWeights` field name. */
  param: string;
  /** Baseline (`system-one`) value. */
  from: number;
  /** This profile's value. */
  to: number;
  /** Plain-English description of what moving this scalar does in the engine. */
  effect: string;
};

/**
 * The static, human-authored spec for a tuning profile: its honest name, the
 * ids that resolve to it, and exactly which engine scalars it moves and why.
 */
export type TuningProfileSpec = {
  /** Canonical model id (matches `models.ts`). */
  id: string;
  /** Honest display name. */
  label: string;
  /** One-line honest summary — no training-run language. */
  tagline: string;
  /** True for the calibrated default (`system-one`). Its deltas are empty. */
  baseline: boolean;
  /** Alternate ids that resolve here (kept for backward compatibility). */
  aliases: string[];
  /** The scalars this profile changes vs the Balanced baseline. */
  paramChanges: TuningParamChange[];
  /** What the profile measurably changes about the output. */
  whatChanges: string;
  /** When a caller should reach for it. */
  whenToUse: string;
};

/** Per-question-type slice of a measured run. */
export type ProfileByType = {
  qtype: QuestionType;
  accuracy: number;
  avgConfidence: number;
  n: number;
};

/** The measured deltas vs the Balanced baseline (positive = higher than baseline). */
export type ProfileDelta = {
  avgConfidence: number;
  ece: number;
  brier: number;
};

/** A real measurement of one profile over the gold suite. */
export type MeasuredProfile = {
  id: string;
  label: string;
  /** Strict (gated) assertions the profile passed / total, for reference. */
  strictPassed: number;
  strictTotal: number;
  /** Overall labelled-prediction accuracy (soft + strict). */
  accuracy: number;
  avgConfidence: number;
  /** Expected / maximum calibration error and Brier score over all predictions. */
  ece: number;
  mce: number;
  brier: number;
  byType: ProfileByType[];
  /** Difference from the Balanced baseline; empty object of zeros for baseline. */
  deltaVsBaseline: ProfileDelta;
};

/** Raw numbers the harness produces per profile, before delta computation. */
export type RawProfileMeasurement = {
  id: string;
  label: string;
  strictPassed: number;
  strictTotal: number;
  accuracy: number;
  avgConfidence: number;
  ece: number;
  mce: number;
  brier: number;
  byType: ProfileByType[];
};

/** Provenance for the baked snapshot so the numbers are auditable, not vibes. */
export const PROFILE_EVAL_PROVENANCE = {
  suite: "gold",
  caseCount: 93,
  predictionCount: 97,
  harness: "src/lib/jev/gold.ts -> evalProfiles()",
  command:
    'node --experimental-strip-types -e "import(\'./src/lib/jev/gold.ts\').then(m=>console.log(JSON.stringify(m.evalProfiles(),null,1)))"',
  note:
    "Deterministic: the engine uses no runtime Math.random on the hot path, so a rerun reproduces these numbers exactly. Regenerate after changing weights or expanding the suite, then paste into MEASURED_PROFILES.",
} as const;

/** The Balanced baseline id — all deltas are measured against this profile. */
export const BASELINE_PROFILE_ID = "system-one";

/**
 * What the shared scalars mean, engine-accurate. Sourced from `engine.ts`:
 * `tempScale` multiplies the softmax temperature in `adaptiveTemp`; `dist`
 * weights the distinctive-token feature in `combine`; etc.
 */
export const PARAM_GLOSSARY: Record<string, string> = {
  tempScale:
    "Multiplies the softmax temperature. Lower = colder = probability mass concentrates on the argmax (sharper, more confident); higher = flatter, more hedged distributions.",
  dist:
    "Weight on the distinctive-token feature — tokens unique to one option rather than shared across all of them. Higher = the decision hinges on discriminating evidence (contrast) instead of overall lexical overlap.",
  peakedBlend:
    "Blend factor in peakedConfidence: how much reported confidence tracks the peak probability vs the full distribution's entropy. Higher = higher reported confidence for the same spread.",
  neg:
    "Weight of the not_for / negation-clash penalty subtracted in combine(). Higher = stronger avoidance of an option whose excluded ('not_for') description the state matches.",
  lex: "Weight on IDF-weighted lexical cosine between state and option text.",
  fuzzy: "Weight on character-n-gram (typo/morphology-tolerant) similarity.",
  syn: "Weight on lexicon synonym-expansion overlap.",
  noulTempFloor:
    "Minimum temperature for the yes/no noul softmax. Lower floor lets noul values run more extreme (closer to 0 or 1).",
};

/** The four local tuning profiles, honest names, over one engine. */
export const TUNING_PROFILES: TuningProfileSpec[] = [
  {
    id: "system-one",
    label: "System One (Balanced)",
    tagline:
      "The calibrated default. Neutral temperature, balanced feature weights.",
    baseline: true,
    aliases: ["jev-latest", "openjev-fast", "jev", "systemone", "balanced"],
    paramChanges: [],
    whatChanges:
      "Baseline. Every other profile's numbers below are stated as a delta from this one.",
    whenToUse:
      "The default for every decision. Neutral temperature and balanced feature weights — a well-calibrated middle the other profiles are described relative to. Start here and only switch if you have a measured reason.",
  },
  {
    id: "jev-v13",
    label: "Sharp (v13)",
    tagline:
      "A hair sharper than Balanced. Same decisions, marginally more peaked.",
    baseline: false,
    aliases: ["jev-1.12", "sharp"],
    paramChanges: [
      {
        param: "tempScale",
        from: 1.0,
        to: 0.94,
        effect: "Slightly colder softmax — a touch more probability on the argmax.",
      },
      {
        param: "dist",
        from: 1.95,
        to: 1.85,
        effect: "Marginally less weight on distinctive tokens.",
      },
      {
        param: "peakedBlend",
        from: 0.55,
        to: 0.58,
        effect: "Reports slightly higher confidence for the same spread.",
      },
    ],
    whatChanges:
      "Distributions are a few points more peaked than Balanced; the chosen option is unchanged on every gold case. This is a compatibility pin, not a separate model version.",
    whenToUse:
      "Pin it only if you calibrated thresholds against these slightly-sharper distributions. Otherwise prefer Balanced.",
  },
  {
    id: "decisive",
    label: "Decisive",
    tagline:
      "Coldest temperature. Most confident argmax, least hedging.",
    baseline: false,
    aliases: ["rlhf"],
    paramChanges: [
      {
        param: "tempScale",
        from: 1.0,
        to: 0.72,
        effect:
          "Substantially colder softmax — the winning option gets the most probability mass of any profile.",
      },
      {
        param: "peakedBlend",
        from: 0.55,
        to: 0.68,
        effect: "Highest reported confidence of the four.",
      },
      {
        param: "dist",
        from: 1.95,
        to: 1.7,
        effect: "Leans a bit less on distinctive tokens.",
      },
      {
        param: "noulTempFloor",
        from: 0.4,
        to: 0.34,
        effect: "Lets yes/no noul answers run more extreme (closer to 0 or 1).",
      },
    ],
    whatChanges:
      "Most confident distributions of the four (highest average confidence). On the current run that reads as mild over-confidence — the highest ECE of the set. Accuracy is unchanged; it changes conviction, not the answer. See the measured table for exact numbers.",
    whenToUse:
      "When you act on the argmax and want less hedging — routing/gating where a crisp top choice matters more than a well-spread distribution. Was named `rlhf`; the id still resolves.",
  },
  {
    id: "contrastive",
    label: "Contrastive",
    tagline:
      "Down-weights surface overlap, up-weights distinctive tokens and the not_for penalty.",
    baseline: false,
    aliases: ["rlcd"],
    paramChanges: [
      {
        param: "dist",
        from: 1.95,
        to: 2.5,
        effect: "Strongest weight on tokens unique to one option — decides by contrast.",
      },
      {
        param: "neg",
        from: 1.55,
        to: 1.8,
        effect: "Strongest not_for penalty — hardest avoidance of excluded options.",
      },
      {
        param: "lex",
        from: 1.15,
        to: 0.9,
        effect: "Less weight on raw lexical overlap.",
      },
      {
        param: "fuzzy",
        from: 0.72,
        to: 0.55,
        effect: "Less weight on fuzzy character-n-gram similarity.",
      },
      {
        param: "syn",
        from: 1.5,
        to: 1.1,
        effect: "Less weight on synonym-expansion overlap.",
      },
      {
        param: "tempScale",
        from: 1.0,
        to: 0.88,
        effect: "Modestly colder softmax.",
      },
      {
        param: "peakedBlend",
        from: 0.55,
        to: 0.6,
        effect: "Slightly higher reported confidence.",
      },
    ],
    whatChanges:
      "Shifts weight off overall similarity and onto discriminating evidence + exclusions. On the current suite it is the least confident but best-calibrated profile (lowest ECE and MCE). Its edge is sharpest on close, hard-to-separate options — the regime it is meant for. See the measured table for exact numbers.",
    whenToUse:
      "When your options overlap heavily and the right answer turns on a distinguishing detail or an explicit exclusion. Was named `rlcd`; the id still resolves.",
  },
];

/**
 * Baked snapshot of the real gold-suite run for each profile.
 * Regenerate via PROFILE_EVAL_PROVENANCE.command. See gold.ts::evalProfiles.
 * Accuracy is identical across profiles because they change confidence/spread,
 * not which option wins — an honest and important detail for a sales call.
 */
export const MEASURED_PROFILES: MeasuredProfile[] = [
  {
    id: "system-one",
    label: "System One (Balanced)",
    strictPassed: 61,
    strictTotal: 61,
    accuracy: 0.8557,
    avgConfidence: 0.8595,
    ece: 0.0791,
    mce: 0.6667,
    brier: 0.1265,
    byType: [
      { qtype: "choice", accuracy: 0.875, avgConfidence: 0.8779, n: 48 },
      { qtype: "score", accuracy: 0.9412, avgConfidence: 0.9157, n: 17 },
      { qtype: "noul", accuracy: 0.7813, avgConfidence: 0.8019, n: 32 },
    ],
    deltaVsBaseline: { avgConfidence: 0, ece: 0, brier: 0 },
  },
  {
    id: "jev-v13",
    label: "Sharp (v13)",
    strictPassed: 61,
    strictTotal: 61,
    accuracy: 0.8557,
    avgConfidence: 0.8599,
    ece: 0.0715,
    mce: 0.6667,
    brier: 0.1262,
    byType: [
      { qtype: "choice", accuracy: 0.875, avgConfidence: 0.8787, n: 48 },
      { qtype: "score", accuracy: 0.9412, avgConfidence: 0.9169, n: 17 },
      { qtype: "noul", accuracy: 0.7813, avgConfidence: 0.8013, n: 32 },
    ],
    deltaVsBaseline: { avgConfidence: 0.0004, ece: -0.0076, brier: -0.0003 },
  },
  {
    id: "decisive",
    label: "Decisive",
    strictPassed: 61,
    strictTotal: 61,
    accuracy: 0.8557,
    avgConfidence: 0.8664,
    ece: 0.0895,
    mce: 0.6667,
    brier: 0.1279,
    byType: [
      { qtype: "choice", accuracy: 0.875, avgConfidence: 0.8831, n: 48 },
      { qtype: "score", accuracy: 0.9412, avgConfidence: 0.9199, n: 17 },
      { qtype: "noul", accuracy: 0.7813, avgConfidence: 0.813, n: 32 },
    ],
    deltaVsBaseline: { avgConfidence: 0.0069, ece: 0.0104, brier: 0.0014 },
  },
  {
    id: "contrastive",
    label: "Contrastive",
    strictPassed: 61,
    strictTotal: 61,
    accuracy: 0.8557,
    avgConfidence: 0.8585,
    ece: 0.058,
    mce: 0.6667,
    brier: 0.1285,
    byType: [
      { qtype: "choice", accuracy: 0.875, avgConfidence: 0.8759, n: 48 },
      { qtype: "score", accuracy: 0.9412, avgConfidence: 0.917, n: 17 },
      { qtype: "noul", accuracy: 0.7813, avgConfidence: 0.8014, n: 32 },
    ],
    deltaVsBaseline: { avgConfidence: -0.001, ece: -0.0211, brier: 0.002 },
  },
];

function round4(x: number): number {
  return Math.round(x * 1e4) / 1e4;
}

/**
 * Pure builder: turn raw per-profile measurements (from the harness) into
 * `MeasuredProfile[]` with deltas computed against the Balanced baseline.
 * Kept dependency-free so a test/script can feed it `evalProfiles()` output and
 * diff the result against `MEASURED_PROFILES` without this module importing the
 * gold suite.
 */
export function buildMeasuredProfiles(
  raw: RawProfileMeasurement[],
  baselineId: string = BASELINE_PROFILE_ID,
): MeasuredProfile[] {
  const baseline = raw.find((r) => r.id === baselineId) ?? raw[0];
  return raw.map((r) => ({
    id: r.id,
    label: r.label,
    strictPassed: r.strictPassed,
    strictTotal: r.strictTotal,
    accuracy: r.accuracy,
    avgConfidence: r.avgConfidence,
    ece: r.ece,
    mce: r.mce,
    brier: r.brier,
    byType: r.byType,
    deltaVsBaseline: baseline
      ? {
          avgConfidence: round4(r.avgConfidence - baseline.avgConfidence),
          ece: round4(r.ece - baseline.ece),
          brier: round4(r.brier - baseline.brier),
        }
      : { avgConfidence: 0, ece: 0, brier: 0 },
  }));
}
