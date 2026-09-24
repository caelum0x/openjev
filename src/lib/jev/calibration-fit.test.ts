import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyCalibrationMap,
  applyCalibrationToAnswers,
  calibrationDelta,
  fitIsotonic,
  fitQuestion,
  fitTemperature,
  pickThreshold,
  POOLED_KEY,
  thresholdCurve,
  type CalSample,
} from "./calibration-fit.ts";

/** Deterministic pseudo-random stream (mulberry32). */
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

/** An over-confident model: reports c, but is right only with prob 0.5 + (c - 0.5) * 0.4. */
function overconfident(n: number, seed = 7): CalSample[] {
  const r = rng(seed);
  return Array.from({ length: n }, () => {
    const c = 0.5 + r() * 0.5;
    const pTrue = 0.5 + (c - 0.5) * 0.4;
    return { confidence: c, correct: r() < pTrue };
  });
}

test("temperature scaling cools an over-confident model", () => {
  const s = overconfident(600);
  const map = fitTemperature(s);
  assert.ok(map.temperature > 1, `T=${map.temperature}`);
  const { before, after } = calibrationDelta("q", s, map);
  assert.ok(after.ece < before.ece, `ECE ${before.ece} -> ${after.ece}`);
});

test("isotonic map is monotone and reduces ECE", () => {
  const s = overconfident(800, 11);
  const map = fitIsotonic(s);
  for (let i = 1; i < map.knots.length; i++) {
    assert.ok(map.knots[i]![1] >= map.knots[i - 1]![1]);
    assert.ok(map.knots[i]![0] >= map.knots[i - 1]![0]);
  }
  const { before, after } = calibrationDelta("q", s, map);
  assert.ok(after.ece < before.ece, `ECE ${before.ece} -> ${after.ece}`);
  assert.ok(applyCalibrationMap(map, 0.99) <= 1);
});

test("auto picks temperature for few labels and isotonic for many", () => {
  assert.equal(fitQuestion(overconfident(20), "auto").method, "temperature");
  assert.equal(fitQuestion(overconfident(200), "auto").method, "isotonic");
});

test("threshold curve trades coverage for precision", () => {
  const s: CalSample[] = [
    { confidence: 0.95, correct: true },
    { confidence: 0.9, correct: true },
    { confidence: 0.8, correct: true },
    { confidence: 0.6, correct: false },
    { confidence: 0.4, correct: false },
  ];
  const curve = thresholdCurve(s);
  assert.equal(curve[0]!.coverage, 1);
  const pick = pickThreshold(curve, 1);
  assert.ok(pick);
  assert.equal(pick!.precision, 1);
  assert.equal(pick!.coverage, 0.6);
  assert.equal(pickThreshold(thresholdCurve([{ confidence: 0.9, correct: false }]), 0.95), null);
});

test("calibration rewrites answers and falls back to the pooled map", () => {
  const maps = { [POOLED_KEY]: { method: "temperature" as const, temperature: 3 } };
  const { answers, applied } = applyCalibrationToAnswers(
    {
      a: { type: "choice", choice: "x", probabilities: { x: 0.9, y: 0.1 }, confidence: 0.9 },
      b: { type: "noul", noul: 0.95 },
    },
    maps,
  );
  assert.deepEqual(applied.sort(), ["a", "b"]);
  const a = answers.a as { confidence: number; calibrated?: boolean };
  assert.ok(a.confidence < 0.9 && a.confidence > 0.5);
  assert.equal(a.calibrated, true);
  const b = answers.b as { noul: number };
  assert.ok(b.noul < 0.95 && b.noul > 0.5, `noul ${b.noul}`);
});

test("a perfectly accurate model maps near 1, not to a shrunken 0.75", () => {
  const s: CalSample[] = Array.from({ length: 60 }, (_, i) => ({ confidence: 0.6 + (i % 10) * 0.03, correct: true }));
  const map = fitIsotonic(s);
  assert.ok(applyCalibrationMap(map, 0.8) > 0.95, `mapped to ${applyCalibrationMap(map, 0.8)}`);
});

test("held-out split is deterministic, stratified and disjoint", async () => {
  const { splitTrainHeldout, HELDOUT_FRACTION } = await import("./calibration-fit.ts");
  const samples = overconfident(200, 3);
  const a = splitTrainHeldout(samples, "cal_x:intent");
  const b = splitTrainHeldout(samples, "cal_x:intent");
  assert.equal(a.evaluation, "held_out");
  assert.deepEqual(a.heldout, b.heldout);
  assert.equal(a.heldout.length, Math.floor(200 * HELDOUT_FRACTION));
  assert.equal(a.train.length + a.heldout.length, 200);
  const rate = (s: CalSample[]) => s.filter((x) => x.correct).length / s.length;
  assert.ok(Math.abs(rate(a.heldout) - rate(samples)) < 0.03);
  const small = splitTrainHeldout(samples.slice(0, 12), "s");
  assert.equal(small.evaluation, "in_sample");
  assert.equal(small.train.length, 12);
});
