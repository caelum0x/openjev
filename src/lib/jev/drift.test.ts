import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_DRIFT_THRESHOLDS,
  detectDrift,
  driftFingerprint,
  parseDriftThresholds,
  type DriftObservation,
} from "./drift.ts";

function obs(qid: string, n: number, confidence: number, accuracy: number, reference: "label" | "llm" = "llm"): DriftObservation[] {
  const right = Math.round(n * accuracy);
  return Array.from({ length: n }, (_, i) => ({ question_id: qid, confidence, correct: i < right, reference }));
}

const baselines = { intent: { accuracy: 0.9, avgConfidence: 0.88, n: 200 } };

test("stable traffic reports ok", () => {
  const r = detectDrift(baselines, obs("intent", 60, 0.87, 0.9), DEFAULT_DRIFT_THRESHOLDS);
  assert.equal(r.status, "ok");
  assert.deepEqual(r.drifted, []);
  assert.equal(r.questions[0]!.signals.length, 0);
});

test("accuracy drop and overconfidence are flagged", () => {
  const r = detectDrift(baselines, obs("intent", 60, 0.88, 0.6, "label"), DEFAULT_DRIFT_THRESHOLDS);
  assert.equal(r.status, "drift");
  const kinds = r.questions[0]!.signals.map((s) => s.kind).sort();
  assert.deepEqual(kinds, ["accuracy_drop", "overconfidence"]);
  assert.equal(r.questions[0]!.label_share, 1);
  assert.equal(driftFingerprint(r), "intent:accuracy_drop+overconfidence");
});

test("confidence shift alone is flagged", () => {
  const r = detectDrift(baselines, obs("intent", 60, 0.6, 0.62), DEFAULT_DRIFT_THRESHOLDS);
  assert.deepEqual(r.questions[0]!.signals.map((s) => s.kind), ["accuracy_drop", "confidence_shift"]);
});

test("too few observations never alert; pooled baseline covers other questions", () => {
  const few = detectDrift(baselines, obs("intent", 10, 0.9, 0.1), DEFAULT_DRIFT_THRESHOLDS);
  assert.equal(few.status, "insufficient");
  const pooled = detectDrift({ "*": { accuracy: 0.9, avgConfidence: 0.9, n: 50 } }, obs("urgent", 40, 0.9, 0.5), DEFAULT_DRIFT_THRESHOLDS);
  assert.equal(pooled.status, "drift");
  assert.equal(pooled.drifted[0], "urgent");
});

test("threshold parsing validates input", () => {
  assert.deepEqual(parseDriftThresholds(undefined), DEFAULT_DRIFT_THRESHOLDS);
  assert.equal(parseDriftThresholds({ min_samples: 50, accuracy_drop: 0.05 }).accuracy_drop, 0.05);
  assert.throws(() => parseDriftThresholds({ min_samples: 2 }), RangeError);
  assert.throws(() => parseDriftThresholds({ calibration_gap: 1.5 }), RangeError);
  assert.throws(() => parseDriftThresholds({ confidence_shift: 0 }), RangeError);
});
