import assert from "node:assert/strict";
import { test } from "node:test";
import { runLocal } from "./engine.ts";
import { evalGold, evalGoldWith, GOLD } from "./gold.ts";
import {
  answersRunner,
  BenchmarkSubmissionError,
  clampTimeout,
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  MIN_TIMEOUT_MS,
  parseAnswersPayload,
  toSubmissionResult,
} from "./benchmark-scoring.ts";
import type { Answer } from "./types.ts";

// ── parseAnswersPayload ───────────────────────────────────────────────────

/** A trivially correct answers payload: every gold case gets one dummy choice
 * answer keyed "q" (content doesn't matter for these shape/validation tests). */
function dummyAnswer(): Record<string, Answer> {
  return {
    q: { type: "choice", choice: "a", probabilities: { a: 1 }, confidence: 1 },
  };
}

test("parseAnswersPayload: map shape round-trips every gold case", () => {
  const raw: Record<string, Record<string, Answer>> = {};
  for (const g of GOLD) raw[g.id] = dummyAnswer();
  const parsed = parseAnswersPayload(raw);
  assert.equal(Object.keys(parsed).length, GOLD.length);
  for (const g of GOLD) {
    assert.ok(parsed[g.id], `missing ${g.id}`);
    assert.equal(parsed[g.id]!.q!.type, "choice");
  }
});

test("parseAnswersPayload: array shape ({id, answers}[]) round-trips", () => {
  const raw = GOLD.map((g) => ({ id: g.id, answers: dummyAnswer() }));
  const parsed = parseAnswersPayload(raw);
  assert.equal(Object.keys(parsed).length, GOLD.length);
});

test("parseAnswersPayload: rejects a payload missing gold case ids", () => {
  const raw: Record<string, Record<string, Answer>> = { [GOLD[0]!.id]: dummyAnswer() };
  assert.throws(() => parseAnswersPayload(raw), (err: unknown) => {
    assert.ok(err instanceof BenchmarkSubmissionError);
    assert.match(err.message, /missing \d+ gold case id/);
    return true;
  });
});

test("parseAnswersPayload: rejects an answer with no valid type", () => {
  const raw: Record<string, unknown> = {};
  for (const g of GOLD) raw[g.id] = { q: { foo: "bar" } };
  assert.throws(() => parseAnswersPayload(raw), BenchmarkSubmissionError);
});

test("parseAnswersPayload: rejects a non-object, non-array payload", () => {
  assert.throws(() => parseAnswersPayload("not json"), BenchmarkSubmissionError);
  assert.throws(() => parseAnswersPayload(null), BenchmarkSubmissionError);
});

test("parseAnswersPayload: array entry missing id/answers is rejected", () => {
  assert.throws(() => parseAnswersPayload([{ id: GOLD[0]!.id }]), BenchmarkSubmissionError);
});

// ── clampTimeout ───────────────────────────────────────────────────────────

test("clampTimeout: defaults when unset, clamps to [min, max]", () => {
  assert.equal(clampTimeout(undefined), DEFAULT_TIMEOUT_MS);
  assert.equal(clampTimeout(0), DEFAULT_TIMEOUT_MS);
  assert.equal(clampTimeout(1), MIN_TIMEOUT_MS);
  assert.equal(clampTimeout(1_000_000), MAX_TIMEOUT_MS);
  assert.equal(clampTimeout(5_000), 5_000);
});

// ── End-to-end: replaying the REAL engine's own answers through the
//    external-submission path must reproduce the REAL internal gold report —
//    proof this is the same scoring engine, not a second implementation. ────

test("answersRunner + evalGoldWith + toSubmissionResult reproduces evalGold() exactly", async () => {
  // Build an "answers" payload identical to what system-one actually answers,
  // as if a third party had run system-one itself offline and uploaded it.
  const perCaseAnswers: Record<string, Record<string, Answer>> = {};
  for (const g of GOLD) {
    perCaseAnswers[g.id] = runLocal({ model: "system-one", state: g.state, questions: g.questions }, "system-one")
      .answers;
  }

  const internal = evalGold("system-one");
  const external = await evalGoldWith(answersRunner(perCaseAnswers));
  const result = toSubmissionResult(external);

  // Same engine, same cases, same answers -> byte-identical calibration numbers.
  assert.equal(result.case_count, internal.caseCount);
  assert.equal(result.accuracy, internal.calibration.overallAccuracy);
  assert.equal(result.ece, internal.calibration.ece);
  assert.equal(result.adaptive_ece, internal.calibration.adaptiveEce);
  assert.equal(result.mce, internal.calibration.mce);
  assert.equal(result.brier, internal.calibration.brier);
  assert.equal(result.nll, internal.calibration.nll);
  const strictTotal = internal.passed + internal.failed;
  assert.equal(result.strict_pass_rate, strictTotal ? internal.passed / strictTotal : 0);

  // Per-question-type breakdown accounts for every graded prediction exactly
  // once (no case silently dropped, no case double-counted).
  const breakdownTotal = result.by_type.reduce((sum, t) => sum + t.case_count, 0);
  assert.equal(breakdownTotal, internal.predictions.length);
});

test("answersRunner: a gold case with no matching answer key scores as a miss, not a crash", async () => {
  const perCaseAnswers: Record<string, Record<string, Answer>> = {};
  // Deliberately answer only the first case; evalGoldWith must still walk
  // every GOLD case (answersRunner returns null past the last provided id).
  perCaseAnswers[GOLD[0]!.id] = runLocal(
    { model: "system-one", state: GOLD[0]!.state, questions: GOLD[0]!.questions },
    "system-one",
  ).answers;

  const report = await evalGoldWith(answersRunner(perCaseAnswers));
  assert.equal(report.caseCount, GOLD.length);
  // At least the cases after the first produced no usable answers.
  assert.ok(report.failed > 0 || report.passed < GOLD.length);
});
