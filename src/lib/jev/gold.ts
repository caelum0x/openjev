import { runLocal } from "./engine.ts";
import { calibratedConfidence } from "./vector.ts";
import type {
  Answer,
  ChoiceAnswer,
  NoulAnswer,
  ScoreAnswer,
  SystemOneRequest,
  SystemOneResponse,
} from "./types.ts";
import {
  buildCoverage,
  buildReliability,
  type CalPrediction,
  type CalibrationReport,
  type CoverageReport,
} from "./calibration.ts";
import {
  buildMeasuredProfiles,
  MEASURED_PROFILES,
  TUNING_PROFILES,
  type MeasuredProfile,
  type ProfileByType,
  type QuestionType,
  type RawProfileMeasurement,
} from "./model-cards.ts";
import { ALL_FEATURES, type GoldCase, type GoldExpect } from "./gold/types.ts";
import { SHOWCASE } from "./gold/showcase.ts";
import { PARAPHRASE } from "./gold/paraphrase.ts";
import { NEGATION } from "./gold/negation.ts";
import { DOMAIN_SHIFT } from "./gold/domain-shift.ts";
import { AMBIGUOUS } from "./gold/ambiguous.ts";
import { MINIMAL } from "./gold/minimal.ts";
import { LONGFORM } from "./gold/longform.ts";
import { STRUCTURED } from "./gold/structured.ts";
import { MULTILINGUAL } from "./gold/multilingual.ts";

export type { GoldCase, GoldExpect, Feature } from "./gold/types.ts";
export type {
  CalPrediction,
  CalibrationReport,
  CoverageReport,
  ReliabilityBin,
} from "./calibration.ts";

/**
 * The shipped gold calibration suite. It aggregates the feature-tagged modules
 * under `./gold/*` into one labelled array. Each case carries `expect`
 * assertions (the regression gate) and `features` tags (the coverage axes).
 * Consumers (evals.server.ts, the `gold` npm script) import `GOLD` and
 * `evalGold` from here; the module layout below keeps any single file small.
 */
export const GOLD: GoldCase[] = [
  ...SHOWCASE,
  ...PARAPHRASE,
  ...NEGATION,
  ...DOMAIN_SHIFT,
  ...AMBIGUOUS,
  ...MINIMAL,
  ...LONGFORM,
  ...STRUCTURED,
  ...MULTILINGUAL,
];

export type GoldHit = {
  id: string;
  ok: boolean;
  /** Tracking-only assertion: scored for calibration, excluded from the gate. */
  soft: boolean;
  detail: string;
};

/** The richer report returned by `evalGold`, a superset of the legacy shape. */
export type GoldReport = {
  /** Non-soft (gated) assertions that held. */
  passed: number;
  /** Non-soft (gated) assertions that failed. The `gold` script exits on this. */
  failed: number;
  /** Every assertion outcome, soft and strict alike. */
  hits: GoldHit[];
  /** Per-prediction labelled records the calibration agent can consume. */
  predictions: CalPrediction[];
  /** Reliability bins + ECE/MCE/Brier over all predictions. */
  calibration: CalibrationReport;
  /** Reliability over the strict (gated) subset only. */
  calibrationStrict: CalibrationReport;
  /** Feature-axis and question-type coverage of the suite. */
  coverage: CoverageReport;
  /** Total number of labelled cases in the suite. */
  caseCount: number;
};

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

function inBand(v: number, band?: [number, number]): boolean {
  if (!band) return true;
  return v >= band[0] && v <= band[1];
}

/**
 * Confidence proxy for a noul answer: distance from the 0.5 decision boundary,
 * routed through the same isotonic calibration map as Choice/Score so the
 * reliability report scores noul on calibrated (accuracy-grounded) confidence
 * rather than raw peakedness. The noul ANSWER itself only emits a probability;
 * this proxy exists solely for calibration accounting.
 */
function noulConfidence(v: number): number {
  return calibratedConfidence(clamp01(Math.abs(v - 0.5) * 2), "noul");
}

export type Graded = {
  hit: GoldHit;
  prediction: CalPrediction;
};

function gradeChoice(
  caseId: string,
  features: string[],
  a: ChoiceAnswer | undefined,
  exp: NonNullable<GoldExpect["choice"]>,
): Graded {
  const soft = Boolean(exp.soft);
  const p = a ? a.probabilities[exp.value] ?? 0 : 0;
  const identityMatch = a?.type === "choice" && a.choice === exp.value;
  const ok =
    identityMatch &&
    (exp.minP == null || p >= exp.minP) &&
    inBand(a?.confidence ?? 0, exp.confBand);
  return {
    hit: {
      id: `${caseId}:${exp.id}`,
      ok: Boolean(ok),
      soft,
      detail: a
        ? `choice=${a.choice} p(${exp.value})=${p.toFixed(2)} conf=${a.confidence.toFixed(2)}`
        : "missing",
    },
    prediction: {
      caseId,
      questionId: exp.id,
      qtype: "choice",
      features,
      confidence: a?.confidence ?? 0,
      correct: Boolean(identityMatch),
      soft,
    },
  };
}

function gradeNoul(
  caseId: string,
  features: string[],
  a: NoulAnswer | undefined,
  exp: NonNullable<GoldExpect["noul"]>,
): Graded {
  const soft = Boolean(exp.soft);
  const v = a?.type === "noul" ? a.noul : -1;
  const inRange =
    a?.type === "noul" &&
    (exp.min == null || v >= exp.min) &&
    (exp.max == null || v <= exp.max);
  return {
    hit: {
      id: `${caseId}:${exp.id}`,
      ok: Boolean(inRange),
      soft,
      detail: a ? `noul=${v.toFixed(2)}` : "missing",
    },
    prediction: {
      caseId,
      questionId: exp.id,
      qtype: "noul",
      features,
      confidence: a ? noulConfidence(v) : 0,
      correct: Boolean(inRange),
      soft,
    },
  };
}

function gradeScore(
  caseId: string,
  features: string[],
  a: ScoreAnswer | undefined,
  exp: NonNullable<GoldExpect["score"]>,
): Graded {
  const soft = Boolean(exp.soft);
  const v = a?.type === "score" ? a.score : -1;
  const ok = a?.type === "score" && v >= exp.min && v <= exp.max;
  return {
    hit: {
      id: `${caseId}:${exp.id}`,
      ok: Boolean(ok),
      soft,
      detail: a ? `score=${v.toFixed(2)} conf=${a.confidence.toFixed(2)}` : "missing",
    },
    prediction: {
      caseId,
      questionId: exp.id,
      qtype: "score",
      features,
      confidence: a?.confidence ?? 0,
      correct: Boolean(ok),
      soft,
    },
  };
}

function questionTypes(g: GoldCase): string[] {
  return g.expect.flatMap((e) => {
    if (e.choice) return ["choice"];
    if (e.noul) return ["noul"];
    if (e.score) return ["score"];
    return [];
  });
}

/**
 * Run the whole gold suite against the engine and return the full report.
 *
 * Backward compatible: the legacy `{ passed, failed, hits }` shape is preserved
 * (evals.server.ts and the `gold` script depend on it) and extended with
 * `predictions`, `calibration`, `calibrationStrict`, `coverage`, and
 * `caseCount`. `passed`/`failed` count only strict (non-soft) assertions, so the
 * regression gate is not moved by tracking-only calibration cases.
 */
export function evalGold(model = "system-one"): GoldReport {
  const graded: Graded[] = [];
  for (const g of GOLD) {
    const out = runLocal({ model, state: g.state, questions: g.questions }, model);
    graded.push(...gradeCase(g, out.answers));
  }
  return buildGoldReport(graded);
}

/** Grade one gold case's answers against its expectations. */
export function gradeCase(g: GoldCase, answers: Record<string, Answer>): Graded[] {
  const out: Graded[] = [];
  for (const exp of g.expect) {
    if (exp.choice) {
      out.push(
        gradeChoice(g.id, g.features, answers[exp.choice.id] as ChoiceAnswer | undefined, exp.choice),
      );
    } else if (exp.noul) {
      out.push(gradeNoul(g.id, g.features, answers[exp.noul.id] as NoulAnswer | undefined, exp.noul));
    } else if (exp.score) {
      out.push(
        gradeScore(g.id, g.features, answers[exp.score.id] as ScoreAnswer | undefined, exp.score),
      );
    }
  }
  return out;
}

/**
 * Run the gold suite through ANY backend (sidecar, cloud, LLM, cascade) via an
 * async runner. Same grading and report as `evalGold`; used by the public
 * leaderboard harness (scripts/leaderboard.mjs). A runner that returns null for
 * a case (backend failed) scores that case's assertions as misses.
 */
export async function evalGoldWith(
  runner: (req: SystemOneRequest) => Promise<SystemOneResponse | null>,
): Promise<GoldReport> {
  const graded: Graded[] = [];
  for (const g of GOLD) {
    const out = await runner({ state: g.state, questions: g.questions });
    graded.push(...gradeCase(g, out?.answers ?? {}));
  }
  return buildGoldReport(graded);
}

function buildGoldReport(graded: readonly Graded[]): GoldReport {
  const hits = graded.map((x) => x.hit);
  const predictions = graded.map((x) => x.prediction);
  const strict = hits.filter((h) => !h.soft);
  const strictPreds = predictions.filter((p) => !p.soft);

  return {
    passed: strict.filter((h) => h.ok).length,
    failed: strict.filter((h) => !h.ok).length,
    hits,
    predictions,
    calibration: buildReliability(predictions),
    calibrationStrict: buildReliability(strictPreds),
    coverage: buildCoverage(
      GOLD.map((g) => ({
        features: g.features,
        questionTypes: questionTypes(g),
      })),
      ALL_FEATURES,
    ),
    caseCount: GOLD.length,
  };
}

/**
 * Run the gold suite once per tuning profile and return the raw measurement
 * used to build the model cards. This is the live source of truth behind the
 * baked `MEASURED_PROFILES` snapshot in model-cards.ts — rerun it to regenerate.
 * Deterministic: the engine uses no runtime randomness, so numbers reproduce.
 */
export function measureProfile(id: string, label: string): RawProfileMeasurement {
  const r = evalGold(id);
  const buckets = new Map<QuestionType, { n: number; correct: number; conf: number }>();
  for (const p of r.predictions) {
    const b = buckets.get(p.qtype) ?? { n: 0, correct: 0, conf: 0 };
    b.n += 1;
    if (p.correct) b.correct += 1;
    b.conf += p.confidence;
    buckets.set(p.qtype, b);
  }
  const order: QuestionType[] = ["choice", "score", "noul"];
  const byType: ProfileByType[] = order
    .filter((q) => buckets.has(q))
    .map((q) => {
      const b = buckets.get(q)!;
      return {
        qtype: q,
        accuracy: round4(b.correct / b.n),
        avgConfidence: round4(b.conf / b.n),
        n: b.n,
      };
    });
  return {
    id,
    label,
    strictPassed: r.passed,
    strictTotal: r.passed + r.failed,
    accuracy: r.calibration.overallAccuracy,
    avgConfidence: r.calibration.avgConfidence,
    ece: r.calibration.ece,
    mce: r.calibration.mce,
    brier: r.calibration.brier,
    byType,
  };
}

/** The tuning-profile ids measured for the model cards, baseline first. */
export const PROFILE_MODEL_IDS: readonly string[] = TUNING_PROFILES.map(
  (p) => p.id,
);

/**
 * Measure every tuning profile and attach deltas vs the Balanced baseline.
 * The output matches `MEASURED_PROFILES`; paste it back to refresh the snapshot.
 */
export function evalProfiles(): MeasuredProfile[] {
  const raw = TUNING_PROFILES.map((p) => measureProfile(p.id, p.label));
  return buildMeasuredProfiles(raw);
}

function round4(x: number): number {
  return Math.round(x * 1e4) / 1e4;
}

/**
 * Largest absolute difference between the baked `MEASURED_PROFILES` snapshot in
 * model-cards.ts and a fresh live run. Zero when the snapshot is current. The
 * engine is tuned over time (calibration work), so an integrator can call this
 * to decide whether the model-card numbers need regenerating; drives no gate.
 */
export function profilesSnapshotDrift(): { maxAbsDiff: number; stale: boolean } {
  const live = evalProfiles();
  const byId = new Map(MEASURED_PROFILES.map((m) => [m.id, m]));
  let maxAbsDiff = 0;
  for (const l of live) {
    const b = byId.get(l.id);
    if (!b) {
      maxAbsDiff = 1;
      continue;
    }
    for (const k of ["accuracy", "avgConfidence", "ece", "mce", "brier"] as const) {
      maxAbsDiff = Math.max(maxAbsDiff, Math.abs(l[k] - b[k]));
    }
  }
  return { maxAbsDiff: round4(maxAbsDiff), stale: maxAbsDiff > 0.005 };
}

/** Human-readable one-screen summary of a gold report (for CLI / logs). */
export function formatReport(r: GoldReport): string {
  const lines: string[] = [];
  lines.push(
    `gold: ${r.passed} passed, ${r.failed} failed (strict) over ${r.caseCount} cases`,
  );
  lines.push(
    `calibration: acc=${r.calibration.overallAccuracy} conf=${r.calibration.avgConfidence} ece=${r.calibration.ece} mce=${r.calibration.mce} brier=${r.calibration.brier}`,
  );
  lines.push("reliability bins (confidence -> accuracy | n):");
  for (const b of r.calibration.bins) {
    const acc = b.accuracy == null ? "  -  " : b.accuracy.toFixed(2);
    const conf = b.avgConfidence == null ? "  -  " : b.avgConfidence.toFixed(2);
    lines.push(`  ${b.label}: acc=${acc} conf=${conf} n=${b.count}`);
  }
  lines.push(
    `coverage: ${r.coverage.totalCases} cases, types=${JSON.stringify(r.coverage.byQuestionType)}`,
  );
  lines.push(`  features=${JSON.stringify(r.coverage.byFeature)}`);
  if (r.coverage.missingFeatures.length) {
    lines.push(`  MISSING features: ${r.coverage.missingFeatures.join(", ")}`);
  }
  return lines.join("\n");
}
