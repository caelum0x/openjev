import assert from "node:assert/strict";
import { test } from "node:test";
import { escalationRequest, mergeEscalated, planEscalation } from "./cascade.ts";
import { validateRequest } from "./validate.ts";
import type { Answer } from "./types.ts";

const req = validateRequest({
  state: "refund please",
  escalate_below: 0.7,
  questions: {
    sure: { type: "choice", instructions: "a or b", criteria: { a: "a", b: "b" } },
    unsure: { type: "choice", instructions: "a or b", criteria: { a: "a", b: "b" } },
    strict: { type: "noul", instructions: "yes?", escalate_below: 0.99 },
    offtopic: { type: "choice", instructions: "a or b", criteria: { a: "a", b: "b" } },
  },
});

const local: Record<string, Answer> = {
  sure: { type: "choice", choice: "a", probabilities: { a: 0.9, b: 0.1 }, confidence: 0.9 },
  unsure: { type: "choice", choice: "a", probabilities: { a: 0.55, b: 0.45 }, confidence: 0.55 },
  strict: { type: "noul", noul: 0.9 },
  offtopic: { type: "choice", choice: "a", probabilities: { a: 0.9, b: 0.1 }, confidence: 0.9, ood: 0.95 },
};

test("low-confidence, per-question-strict, and out-of-scope questions escalate", () => {
  const plan = planEscalation(req, local, 0.5);
  assert.equal(plan.threshold, 0.7);
  assert.deepEqual(plan.keep, ["sure"]);
  assert.deepEqual(plan.escalate.sort(), ["offtopic", "strict", "unsure"]);
});

test("escalation request carries only the escalated questions", () => {
  const sub = escalationRequest(req, ["unsure"]);
  assert.deepEqual(Object.keys(sub.questions), ["unsure"]);
  assert.equal(sub.state, req.state);
});

test("merge marks escalated answers and keeps local ones", () => {
  const llm: Record<string, Answer> = {
    unsure: { type: "choice", choice: "b", probabilities: { a: 0.2, b: 0.8 }, confidence: 0.8 },
  };
  const merged = mergeEscalated(local, llm, ["unsure"]);
  assert.equal(merged.unsure?.escalated, true);
  assert.equal(merged.unsure?.type === "choice" ? merged.unsure.choice : "", "b");
  assert.equal(merged.sure?.escalated, undefined);
  assert.equal(local.unsure?.escalated, undefined, "input not mutated");
});
