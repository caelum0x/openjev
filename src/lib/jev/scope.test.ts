import assert from "node:assert/strict";
import { test } from "node:test";
import { runLocal } from "./engine.ts";
import { GOLD } from "./gold.ts";
import { OOD_CASES } from "./gold/ood.ts";
import {
  abstainAnswer,
  applyScope,
  decisionConfidence,
  NONE_OPTION,
  OOD_THRESHOLD,
  relevance,
} from "./scope.ts";
import { validateRequest } from "./validate.ts";
import type { Answer, Question, SystemOneRequest } from "./types.ts";

const DEPT: Question = {
  type: "choice",
  instructions: "Which team should handle this?",
  criteria: {
    returns: "Exchanges, refunds, wrong or damaged items",
    shipping: "Delivery status, delays, lost packages",
    billing: "Charges, invoices, payment problems",
  },
};

test("out-of-scope probes come back with low confidence, not 0.99", () => {
  let flagged = 0;
  let pairs = 0;
  for (const c of OOD_CASES) {
    const out = runLocal({ state: c.state, questions: c.questions });
    for (const a of Object.values(out.answers)) {
      pairs += 1;
      if (decisionConfidence(a) < 0.5) flagged += 1;
    }
  }
  assert.ok(flagged / pairs >= 0.9, `only ${flagged}/${pairs} OOD answers were low-confidence`);
});

test("in-scope gold answers are almost never scored out of scope", () => {
  let scored = 0;
  let ood = 0;
  for (const g of GOLD) {
    if (!String(g.state).trim()) continue; // empty inputs are out of scope by definition
    const out = runLocal({ state: g.state, questions: g.questions });
    for (const a of Object.values(out.answers)) {
      scored += 1;
      if ((a.ood ?? 0) >= OOD_THRESHOLD) ood += 1;
    }
  }
  assert.ok(ood / scored <= 0.06, `${ood}/${scored} in-scope answers flagged out of scope`);
});

test("relevance separates on-topic from off-topic input", () => {
  assert.ok(relevance("I was charged twice on my invoice", DEPT) > 0.6);
  assert.ok(relevance("What is the capital of Australia?", DEPT) < 0.3);
});

test("abstain works for choice, score, and noul", () => {
  const req = validateRequest({
    state: "Tell me a joke about penguins.",
    abstain: true,
    questions: {
      dept: DEPT,
      sev: { type: "score", instructions: "How severe is this bug?", criteria: ["minor", "major", "outage"] },
      refund: { type: "noul", instructions: "Does this message request a refund?" },
    },
  });
  const out = runLocal(req);
  const dept = out.answers.dept!;
  assert.equal(dept.type, "choice");
  if (dept.type === "choice") {
    assert.equal(dept.abstained, true);
    assert.equal(dept.choice, NONE_OPTION);
    assert.equal(dept.abstain_reason, "out_of_scope");
    const sum = Object.values(dept.probabilities).reduce((s, v) => s + v, 0);
    assert.ok(Math.abs(sum - 1) < 0.01, `probabilities sum to ${sum}`);
  }
  assert.equal(out.answers.sev?.abstained, true);
  assert.equal(out.answers.refund?.abstained, true);
});

test("abstention is opt-in and leaves in-scope answers alone", () => {
  const plain = runLocal(
    validateRequest({ state: "Tell me a joke.", questions: { dept: DEPT } }),
  ).answers.dept!;
  assert.equal(plain.abstained, undefined);
  const inScope = runLocal(
    validateRequest({
      state: "My shoes arrived in the wrong size, I want to exchange them.",
      abstain: true,
      questions: { dept: DEPT },
    }),
  ).answers.dept!;
  assert.equal(inScope.abstained, undefined);
  assert.equal(inScope.type === "choice" ? inScope.choice : "", "returns");
});

test("the reserved __none__ key is rejected in criteria", () => {
  assert.throws(() =>
    validateRequest({
      state: "x",
      questions: { q: { type: "choice", instructions: "pick", criteria: { a: "a", __none__: "b" } } },
    }),
  );
});

test("abstain_below and escalate_below are validated as 0-1 numbers", () => {
  assert.throws(() => validateRequest({ state: "x", abstain_below: 2, questions: { q: DEPT } }));
  assert.throws(() =>
    validateRequest({ state: "x", questions: { q: { ...DEPT, escalate_below: "high" } } }),
  );
  const ok = validateRequest({ state: "x", abstain_below: 0.4, questions: { q: { ...DEPT, abstain: true } } });
  assert.equal(ok.abstain_below, 0.4);
  assert.equal(ok.questions.q?.abstain, true);
});

test("applyScope never mutates its input and marks every answer with ood", () => {
  const req = validateRequest({ state: "Where is my package?", questions: { dept: DEPT } });
  const raw = { dept: { type: "choice" as const, choice: "shipping", probabilities: { returns: 0.1, shipping: 0.8, billing: 0.1 }, confidence: 0.8 } };
  const frozen = JSON.stringify(raw);
  const out = applyScope(req, raw, { damp: true });
  assert.equal(JSON.stringify(raw), frozen);
  assert.equal(typeof out.dept?.ood, "number");
});

test("abstainAnswer keeps a choice distribution normalised", () => {
  const a = abstainAnswer(
    { type: "choice", choice: "x", probabilities: { x: 0.7, y: 0.3 }, confidence: 0.7 },
    "low_confidence",
    0.4,
  );
  assert.equal(a.type === "choice" ? a.choice : "", NONE_OPTION);
  if (a.type === "choice") {
    const sum = Object.values(a.probabilities).reduce((s, v) => s + v, 0);
    assert.ok(Math.abs(sum - 1) < 0.001);
  }
});

test("backend-supplied ood scores replace the lexical distance signal", () => {
  const req: SystemOneRequest = {
    state: "refund my duplicate charge",
    questions: {
      q: { type: "choice", instructions: "Team?", criteria: { billing: "charges", shipping: "delivery" }, abstain: true },
    },
  };
  const answers: Record<string, Answer> = {
    q: { type: "choice", choice: "billing", probabilities: { billing: 0.9, shipping: 0.1 }, confidence: 0.9 },
  };
  const flagged = applyScope(req, answers, { damp: true, ood: { q: 0.95 } });
  assert.equal(flagged.q!.ood, 0.95);
  assert.equal(flagged.q!.abstained, true);
  const kept = applyScope(req, answers, { damp: true, ood: { q: 0.01 } });
  assert.equal(kept.q!.ood, 0.01);
  assert.equal(kept.q!.abstained, undefined);
  assert.equal(kept.q!.type === "choice" && kept.q!.confidence, 0.9);
});
