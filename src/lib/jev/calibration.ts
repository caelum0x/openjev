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
  /** Expected Calibration Error: weighted mean |accuracy - confidence|, over `bins`. */
  ece: number;
  /**
   * Adaptive ECE: the same weighted-mean-|accuracy - confidence| error, but always
   * computed over equal-mass (quantile) buckets regardless of `binStrategy` — fairer
   * than equal-width when predictions cluster near 1.0, reported alongside `ece` so
   * the two can be compared directly.
   */
  adaptiveEce: number;
  /** Maximum Calibration Error across non-empty buckets. */
  mce: number;
  /** Brier score: mean (confidence - correct)^2. Lower is better. */
  brier: number;
  /** Mean negative log-likelihood, treating confidence as P(correct). Strictly proper, like Brier. */
  nll: number;
};

/** How `bins` are laid out: fixed-width ranges, or ranges holding equal prediction counts. */
export type BinStrategy = "equal-width" | "equal-mass";

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

function round(x: number, dp = 4): number {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
}

/** Negative log-likelihood of `correct` under stated probability `confidence`. */
function nllTerm(confidence: number, correct: boolean): number {
  const eps = 1e-6;
  const p = Math.min(1 - eps, Math.max(eps, confidence));
  return correct ? -Math.log(p) : -Math.log(1 - p);
}

type BinAccumulator = {
  bins: ReliabilityBin[];
  /** Which bin index each input prediction landed in, same order as the input array. */
  assignment: number[];
};

/** Lay out `n` fixed-width `[i/n, (i+1)/n)` buckets and assign each prediction by confidence. */
function equalWidthBins(preds: readonly CalPrediction[], n: number): BinAccumulator {
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
  const assignment = preds.map((p) => {
    const c = clamp01(p.confidence);
    return Math.min(n - 1, Math.floor(c * n));
  });
  return { bins, assignment };
}

/**
 * Split predictions into `n` buckets of (as close to) equal size, ordered by
 * confidence — quantile bins, so no bucket is starved just because confidence
 * clusters near one end of [0,1].
 */
function equalMassBins(preds: readonly CalPrediction[], n: number): BinAccumulator {
  const order = preds
    .map((p, i) => ({ i, c: clamp01(p.confidence) }))
    .sort((a, b) => a.c - b.c);
  const total = order.length;
  const assignment = new Array<number>(total);
  const bins: ReliabilityBin[] = [];
  for (let b = 0; b < n; b++) {
    const start = Math.floor((b * total) / n);
    const end = Math.floor(((b + 1) * total) / n);
    for (let k = start; k < end; k++) {
      const entry = order[k];
      if (entry) assignment[entry.i] = b;
    }
    const lo = order[start] ? order[start]!.c : b / n;
    const hi = end > 0 && order[end - 1] ? order[end - 1]!.c : (b + 1) / n;
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
  return { bins, assignment };
}

/** Fill in count/correct/accuracy/gap on `bins` from predictions + their bin assignment. */
function fillBins(
  preds: readonly CalPrediction[],
  bins: ReliabilityBin[],
  assignment: readonly number[],
): { ece: number; mce: number } {
  const n = bins.length;
  const confSum = new Array<number>(n).fill(0);

  preds.forEach((p, i) => {
    const idx = assignment[i];
    const bin = idx === undefined ? undefined : bins[idx];
    if (bin === undefined || idx === undefined) return;
    const c = clamp01(p.confidence);
    bin.count += 1;
    if (p.correct) bin.correct += 1;
    confSum[idx] = (confSum[idx] ?? 0) + c;
  });

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
  return { ece, mce };
}

/**
 * Bin predictions by confidence into `binCount` buckets (equal-width by default, or
 * equal-mass/quantile via `binStrategy`) and compute per-bucket reliability plus
 * aggregate calibration error metrics (ECE, adaptive-ECE, MCE, Brier, NLL).
 */
export function buildReliability(
  preds: readonly CalPrediction[],
  binCount = 15,
  binStrategy: BinStrategy = "equal-width",
): CalibrationReport {
  const n = Math.max(1, Math.floor(binCount));
  const total = preds.length;

  const primary = binStrategy === "equal-mass" ? equalMassBins(preds, n) : equalWidthBins(preds, n);
  const { ece, mce } = fillBins(preds, primary.bins, primary.assignment);

  // Adaptive ECE is always equal-mass, regardless of `binStrategy`, so the two are
  // directly comparable (skip recomputing when the primary strategy already is one).
  const adaptive =
    binStrategy === "equal-mass"
      ? { ece }
      : (() => {
          const acc = equalMassBins(preds, n);
          return fillBins(preds, acc.bins, acc.assignment);
        })();

  let correctTotal = 0;
  let confTotal = 0;
  let brierSum = 0;
  let nllSum = 0;
  for (const p of preds) {
    const c = clamp01(p.confidence);
    if (p.correct) correctTotal += 1;
    confTotal += c;
    brierSum += (c - (p.correct ? 1 : 0)) ** 2;
    nllSum += nllTerm(c, p.correct);
  }

  return {
    bins: primary.bins,
    totalPredictions: total,
    overallAccuracy: round(total ? correctTotal / total : 0),
    avgConfidence: round(total ? confTotal / total : 0),
    ece: round(ece),
    adaptiveEce: round(adaptive.ece),
    mce: round(mce),
    brier: round(total ? brierSum / total : 0),
    nll: round(total ? nllSum / total : 0),
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
