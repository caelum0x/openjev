import assert from "node:assert/strict";
import { test } from "node:test";
import { buildEvalImport } from "./eval-import.ts";
import { parseExamples } from "./label-import.ts";
import type { Questions } from "./types.ts";

const questions: Questions = {
  intent: { type: "choice", instructions: "Intent?", criteria: { refund: "money back", status: "where is it" } },
  urgent: { type: "noul", instructions: "Urgent?" },
  severity: { type: "score", instructions: "How bad?", criteria: ["low", "mid", "high"] },
};

test("valid CSV rows become cases with typed expectations", () => {
  const rows = parseExamples("state,intent,urgent,severity\nrefund me,refund,yes,2\nwhere is my box,status,no,\n");
  const r = buildEvalImport(rows, questions);
  assert.equal(r.valid, 2);
  assert.equal(r.invalid, 0);
  assert.deepEqual(r.perQuestion, { intent: 2, urgent: 2, severity: 1 });
  const first = r.cases[0]!;
  assert.deepEqual(first.expect[0], { choice: { id: "intent", value: "refund" } });
  assert.deepEqual(first.expect[1], { noul: { id: "urgent", min: 0.5 } });
  assert.equal(first.expect[2]!.score!.min, 1.5);
  assert.ok(first.expect[2]!.score!.max < 2.5);
  assert.ok(r.cases[1]!.expect[1]!.noul!.max! < 0.5);
});

test("invalid rows are reported and excluded", () => {
  const rows = parseExamples("state,intent,other\nrefund me,refund,\nhi,nope,\nhey,,x\n");
  const r = buildEvalImport(rows, questions);
  assert.equal(r.valid, 1);
  assert.equal(r.invalid, 2);
  assert.match(r.rows[1]!.error!, /must be one of/);
  assert.match(r.rows[2]!.error!, /not a question/);
});

test("rows without labels are rejected", () => {
  const r = buildEvalImport([{ state: "x", labels: {} }], questions);
  assert.equal(r.valid, 0);
  assert.equal(r.rows[0]!.error, "no labels on this row");
});
