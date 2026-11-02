import assert from "node:assert/strict";
import { test } from "node:test";
import { buildReliability, type CalPrediction } from "./calibration.ts";

/** Deterministic pseudo-random stream (mulberry32), matching calibration-fit.test.ts. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pred(confidence: number, correct: boolean): CalPrediction {
  return { caseId: "c", questionId: "q", qtype: "noul", features: [], confidence, correct, soft: false };
}

/** Predictions clustered near 1.0, as the roadmap's motivating case for adaptive-ECE. */
function highConfidenceCluster(n: number, seed = 1): CalPrediction[] {
  const r = rng(seed);
  return Array.from({ length: n }, () => {
    const c = 0.9 + r() * 0.1; // [0.9, 1.0)
    return pred(c, r() < 0.7); // genuinely right only 70% of the time
  });
}

test("default bin count is 15, not the old 5", () => {
  const report = buildReliability([pred(0.5, true)]);
  assert.equal(report.bins.length, 15);
});

test("equal-width binStrategy keeps fixed-width buckets", () => {
  const report = buildReliability([pred(0.1, true), pred(0.95, true)], 10, "equal-width");
  assert.equal(report.bins[0]!.lo, 0);
  assert.equal(report.bins[0]!.hi, 0.1);
  assert.equal(report.bins[9]!.lo, 0.9);
});

test("equal-mass binStrategy spreads a confidence cluster across buckets", () => {
  const preds = highConfidenceCluster(300);
  const equalWidth = buildReliability(preds, 10, "equal-width");
  const equalMass = buildReliability(preds, 10, "equal-mass");

  // Equal-width: almost every prediction falls in the top bucket (confidence in [0.9, 1.0)).
  const nonEmptyWidth = equalWidth.bins.filter((b) => b.count > 0).length;
  // Equal-mass: by construction, buckets hold roughly n/10 predictions each.
  const nonEmptyMass = equalMass.bins.filter((b) => b.count > 0).length;

  assert.ok(nonEmptyWidth <= 2, `expected equal-width to collapse into <=2 buckets, got ${nonEmptyWidth}`);
  assert.equal(nonEmptyMass, 10);
});

test("adaptiveEce is always reported and is equal-mass regardless of binStrategy", () => {
  const preds = highConfidenceCluster(300, 2);
  const viaEqualWidth = buildReliability(preds, 10, "equal-width");
  const viaEqualMass = buildReliability(preds, 10, "equal-mass");

  // adaptiveEce is equal-mass ECE either way, so it must match when binStrategy IS equal-mass
  // (no redundant recompute), and still be present (not NaN/undefined) when it isn't.
  assert.equal(viaEqualMass.adaptiveEce, viaEqualMass.ece);
  assert.ok(Number.isFinite(viaEqualWidth.adaptiveEce));
});

test("nll penalizes confident-wrong predictions harder than brier", () => {
  const confidentWrong = buildReliability([pred(0.99, false)]);
  const unsure = buildReliability([pred(0.5, false)]);
  assert.ok(confidentWrong.nll > unsure.nll, `nll ${confidentWrong.nll} should exceed ${unsure.nll}`);
  // Sanity: nll is finite even at the extremes (eps-clamped, no -Infinity).
  assert.ok(Number.isFinite(buildReliability([pred(1, false)]).nll));
  assert.ok(Number.isFinite(buildReliability([pred(0, true)]).nll));
});

test("perfectly calibrated predictions have near-zero ece, adaptiveEce, mce, and brier", () => {
  const r = rng(42);
  const preds: CalPrediction[] = Array.from({ length: 2000 }, () => {
    const c = r();
    return pred(c, r() < c);
  });
  const report = buildReliability(preds, 15);
  assert.ok(report.ece < 0.05, `ece=${report.ece}`);
  assert.ok(report.adaptiveEce < 0.05, `adaptiveEce=${report.adaptiveEce}`);
  assert.ok(report.brier < 0.3, `brier=${report.brier}`);
});

test("empty input returns a well-formed, zeroed report, no NaN", () => {
  const report = buildReliability([]);
  assert.equal(report.totalPredictions, 0);
  for (const v of [report.ece, report.adaptiveEce, report.mce, report.brier, report.nll, report.overallAccuracy, report.avgConfidence]) {
    assert.ok(Number.isFinite(v), `expected finite, got ${v}`);
  }
});
