import assert from "node:assert/strict";
import { test } from "node:test";
import { ImportError, parseCsv, parseExamples } from "./label-import.ts";
import { answerValue, normalizeLabel } from "./labels.ts";

test("CSV with quotes, commas and empty labels", () => {
  const rows = parseExamples('state,intent,urgent\n"Hi, where is ""my"" order?",status,yes\nrefund me,,no\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.state, 'Hi, where is "my" order?');
  assert.deepEqual(rows[0]!.labels, { intent: "status", urgent: "yes" });
  assert.deepEqual(rows[1]!.labels, { urgent: "no" });
});

test("JSONL and JSON array are accepted", () => {
  assert.equal(parseExamples('{"state":"a","labels":{"q":"x"}}\n{"state":"b","labels":{"q":"y"}}').length, 2);
  assert.equal(parseExamples('[{"state":"a","labels":{"q":"x"}}]').length, 1);
});

test("bad input fails with a clear message", () => {
  assert.throws(() => parseExamples(""), ImportError);
  assert.throws(() => parseExamples("text,label\na,b"), /state/);
  assert.throws(() => parseCsv('state\n"unterminated'), ImportError);
});

test("labels normalise per question type", () => {
  const choice = { type: "choice" as const, instructions: "x", criteria: { a: "a", b: "b" } };
  const score = { type: "score" as const, instructions: "x", criteria: ["lo", "mid", "hi"] };
  const noul = { type: "noul" as const, instructions: "x" };
  assert.equal(normalizeLabel("q", choice, "a"), "a");
  assert.throws(() => normalizeLabel("q", choice, "c"));
  assert.equal(normalizeLabel("q", score, "2"), 2);
  assert.throws(() => normalizeLabel("q", score, 3));
  assert.equal(normalizeLabel("q", noul, "yes"), true);
  assert.equal(normalizeLabel("q", noul, 0), false);
  assert.equal(answerValue({ type: "noul", noul: 0.7 }), true);
  assert.equal(answerValue({ type: "score", score: 1.6, legend: {}, probabilities: {}, confidence: 1 }), 2);
});
