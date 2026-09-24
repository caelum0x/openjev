/**
 * Calibration + coverage utilities.
 *
 * Pure, dependency-free helpers that turn a list of labelled predictions into a
 * reliability report (per-confidence-bucket accuracy, ECE/MCE/Brier) and a
 * coverage report (which question types and feature axes the suite exercises).
 *
 * These are engine-agnostic on purpose: `gold.ts` feeds them predictions from
 * the System One engine, but the same helpers could bin predictions from any
 * backend, or be reused by `vector.ts` experiments, without importing the suite.
 */

/** One graded prediction: a confidence in [0,1] and whether it was correct. */
export type CalPrediction = {
  caseId: string;
  questionId: string;
  qtype: "choice" | "noul" | "score";
  features: string[];
  /** Model-reported confidence in [0,1]. */
  confidence: number;
  /** Did the top prediction match the ground-truth label / band? */
  correct: boolean;
  /** Tracking-only (excluded from the pass/fail gate). */
  soft: boolean;
};

/** One reliability bucket: accuracy vs. average confidence within a band. */
export type ReliabilityBin = {
  lo: number;
  hi: number;
  label: string;
  count: number;
  correct: number;
  /** Empirical accuracy in this bucket, or null when the bucket is empty. */
  accuracy: number | null;
  /** Mean model confidence in this bucket, or null when empty. */
  avgConfidence: number | null;
  /** accuracy - avgConfidence (positive = under-confident), or null. */
  gap: number | null;
};

export type CalibrationReport = {
  bins: ReliabilityBin[];
  totalPredictions: number;
  overallAccuracy: number;
  avgConfidence: number;
  /** Expected Calibration Error: weighted mean |accuracy - confidence|. */
  ece: number;
  /** Maximum Calibration Error across non-empty buckets. */
  mce: number;
  /** Brier score: mean (confidence - correct)^2. Lower is better. */
  brier: number;
};

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

function round(x: number, dp = 4): number {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
}

/**
 * Bin predictions by confidence into `binCount` equal-width buckets and compute
 * per-bucket reliability plus aggregate calibration error metrics.
 */
export function buildReliability(
  preds: readonly CalPrediction[],
  binCount = 5,
): CalibrationReport {
  const n = Math.max(1, Math.floor(binCount));
  const bins: ReliabilityBin[] = [];
  for (let i = 0; i < n; i++) {
    const lo = i / n;
    const hi = (i + 1) / n;
    bins.push({
      lo: round(lo, 2),
      hi: round(hi, 2),
      label: `${lo.toFixed(2)}-${hi.toFixed(2)}`,
      count: 0,
      correct: 0,
      accuracy: null,
      avgConfidence: null,
      gap: null,
    });
  }

  const confSum = new Array<number>(n).fill(0);
  let correctTotal = 0;
  let confTotal = 0;
  let brierSum = 0;

  for (const p of preds) {
    const c = clamp01(p.confidence);
    let idx = Math.floor(c * n);
    if (idx >= n) idx = n - 1;
    const bin = bins[idx];
    if (!bin) continue;
    bin.count += 1;
    if (p.correct) {
      bin.correct += 1;
      correctTotal += 1;
    }
    confSum[idx] = (confSum[idx] ?? 0) + c;
    confTotal += c;
    brierSum += (c - (p.correct ? 1 : 0)) ** 2;
  }

  const total = preds.length;
  let ece = 0;
  let mce = 0;
  for (let i = 0; i < n; i++) {
    const bin = bins[i];
    if (!bin || bin.count === 0) continue;
    const acc = bin.correct / bin.count;
    const avgConf = (confSum[i] ?? 0) / bin.count;
    bin.accuracy = round(acc);
    bin.avgConfidence = round(avgConf);
    bin.gap = round(acc - avgConf);
    const err = Math.abs(acc - avgConf);
    ece += (bin.count / Math.max(1, total)) * err;
    if (err > mce) mce = err;
  }

  return {
    bins,
    totalPredictions: total,
    overallAccuracy: round(total ? correctTotal / total : 0),
    avgConfidence: round(total ? confTotal / total : 0),
    ece: round(ece),
    mce: round(mce),
    brier: round(total ? brierSum / total : 0),
  };
}

/** A case's shape for coverage accounting. */
export type CoverageInput = {
  features: string[];
  questionTypes: string[];
};

export type CoverageReport = {
  totalCases: number;
  totalPredictions: number;
  byQuestionType: Record<string, number>;
  byFeature: Record<string, number>;
  exercisedFeatures: string[];
  missingFeatures: string[];
};

/**
 * Report how many cases exercise each feature axis and how many predictions hit
 * each question type, and flag any expected feature axis with zero coverage.
 */
export function buildCoverage(
  cases: readonly CoverageInput[],
  expectedFeatures: readonly string[] = [],
): CoverageReport {
  const byFeature: Record<string, number> = {};
  const byQuestionType: Record<string, number> = {};
  let totalPredictions = 0;

  for (const f of expectedFeatures) byFeature[f] = 0;

  for (const c of cases) {
    for (const f of new Set(c.features)) {
      byFeature[f] = (byFeature[f] ?? 0) + 1;
    }
    for (const t of c.questionTypes) {
      byQuestionType[t] = (byQuestionType[t] ?? 0) + 1;
      totalPredictions += 1;
    }
  }

  const exercisedFeatures = Object.keys(byFeature).filter(
    (f) => (byFeature[f] ?? 0) > 0,
  );
  const missingFeatures = expectedFeatures.filter(
    (f) => (byFeature[f] ?? 0) === 0,
  );

  return {
    totalCases: cases.length,
    totalPredictions,
    byQuestionType,
    byFeature,
    exercisedFeatures,
    missingFeatures,
  };
}
