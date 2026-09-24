import { test } from "node:test";
import assert from "node:assert/strict";
import {
  answerQuestion,
  choiceProbs,
  embedStateText,
  emptyStateAnswer,
  mahalanobis,
  oodFeatures,
  oodScore,
  optionSims,
  optionText,
  EMBED_PARAMS,
  type EmbedFn,
  type Vec,
} from "./engine.ts";
import { runEmbed } from "./run.server.ts";
import type { ChoiceQuestion, Question, SystemOneRequest } from "../types.ts";
import { embedEngineVersion } from "./params.ts";

/**
 * Deterministic stand-in encoder: hashed bag of words, unit-normalized. Texts
 * sharing words are close, unrelated texts are near-orthogonal, which is all
 * the engine's geometry needs.
 */
const DIM = 128;
function hashVec(text: string): Vec {
  const v = new Float32Array(DIM);
  for (const w of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    let h = 2166136261;
    for (const ch of w) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    v[Math.abs(h) % DIM]! += 1;
  }
  v[DIM - 1]! += 0.05; // shared component, like real sentence embeddings
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
}
const fakeEmbed: EmbedFn = async (texts) => texts.map(hashVec);
const CAP = { available: true, engine: "embedding", model: "fake", dir: "/fake" } as const;

const DEPT: ChoiceQuestion = {
  type: "choice",
  instructions: "Which team should handle `text`?",
  criteria: {
    billing: "charges invoices payments refund money",
    shipping: "delivery tracking package courier",
    account: "login password locked account",
  },
};

test("state text uses the named field's bare value, else a single field, else prose", () => {
  assert.equal(embedStateText({ text: "hello there", other: 1 }, DEPT), "hello there");
  assert.equal(
    embedStateText({ body: "just this" }, { ...DEPT, instructions: "Pick one" }),
    "just this",
  );
  assert.equal(embedStateText("plain", DEPT), "plain");
  assert.match(
    embedStateText({ a: "x", b: "y" }, { ...DEPT, instructions: "Pick one" }),
    /a: x\s+b: y/,
  );
});

test("option text joins the humanised key and its description once", () => {
  assert.equal(optionText("card_arrival", undefined).text, "card arrival");
  assert.equal(optionText("card_arrival", "card arrival").text, "card arrival");
  assert.equal(optionText("billing", "charges and invoices").text, "billing: charges and invoices");
  assert.deepEqual(optionText("x", { what: "y", examples: ["e1", "e2"] }).examples, ["e1", "e2"]);
});

test("nearest prototype wins and the distribution sums to 1", async () => {
  const req: SystemOneRequest = {
    state: { text: "my package tracking says the courier lost it" },
    questions: { dept: DEPT },
  };
  const out = await runEmbed(req, { embed: fakeEmbed, capability: CAP });
  assert.ok(out);
  const a = out.answers.dept!;
  assert.equal(a.type, "choice");
  if (a.type !== "choice") return;
  assert.equal(a.choice, "shipping");
  const sum = Object.values(a.probabilities).reduce((x, y) => x + y, 0);
  assert.ok(Math.abs(sum - 1) < 1e-3);
  assert.equal(out.model, "system-one");
  assert.deepEqual(out.engine, {
    kind: "embedding",
    encoder: "fake",
    version: embedEngineVersion("fake"),
  });
  assert.equal(typeof a.ood, "number");
});

test("few-shot examples pull the answer toward the option they belong to", async () => {
  const x = hashVec("zebra quokka");
  const protos = [hashVec("alpha"), hashVec("beta")];
  const zeroShot = optionSims(x, protos, [[], []], EMBED_PARAMS);
  const fewShot = optionSims(
    x,
    protos,
    [[], [hashVec("zebra quokka"), hashVec("quokka")]],
    EMBED_PARAMS,
  );
  assert.ok(Math.abs(zeroShot[0]! - zeroShot[1]!) < 0.05);
  assert.ok(fewShot[1]! > fewShot[0]! + 0.2);
});

test("per-question temperature: a flat similarity profile is not confident", () => {
  const flat = choiceProbs([0.8, 0.8, 0.8], EMBED_PARAMS);
  assert.ok(Math.abs(flat[0]! - 1 / 3) < 1e-6);
  const peaked = choiceProbs([0.9, 0.7, 0.7], EMBED_PARAMS);
  assert.ok(peaked[0]! > 0.9);
  const lex = choiceProbs(
    [0.8, 0.8],
    { ...EMBED_PARAMS, choice: { ...EMBED_PARAMS.choice, lexWeight: 1 } },
    [0.9, 0.1],
  );
  assert.ok(lex[0]! > lex[1]!);
});

test("Mahalanobis distance grows away from the prototype cloud", () => {
  const protos = [
    hashVec("billing invoice"),
    hashVec("shipping package"),
    hashVec("account login"),
  ];
  const near = mahalanobis(hashVec("billing invoice shipping"), protos, 8, 1e-4);
  const far = mahalanobis(hashVec("volcano penguin sonnet"), protos, 8, 1e-4);
  assert.ok(far > near);
  assert.ok(Number.isFinite(mahalanobis(hashVec("x"), [hashVec("y")], 8, 1e-4)));
});

test("the fitted detector: closer to the options means a lower ood", () => {
  const base = {
    maxSim: 0.85,
    domainSim: 0.85,
    maha: 1,
    energy: 0.8,
    logK: Math.log(10),
    logLen: 2,
    maxSimK: 0.85 * Math.log(10),
  };
  const far = {
    ...base,
    maxSim: 0.72,
    domainSim: 0.72,
    maha: 1.6,
    energy: 0.7,
    maxSimK: 0.72 * Math.log(10),
  };
  assert.ok(oodScore(far, EMBED_PARAMS) > oodScore(base, EMBED_PARAMS));
  const f = oodFeatures(
    hashVec("billing invoice"),
    [hashVec("billing invoice"), hashVec("shipping")],
    [1, 0.1],
    hashVec("billing"),
    EMBED_PARAMS,
    "billing invoice",
  );
  assert.equal(f.maxSim, 1);
  assert.ok(Math.abs(f.logK - Math.log(2)) < 1e-9);
  assert.ok(f.energy <= f.maxSim + 1e-9); // log-mean-exp never exceeds the max
});

test("empty state: uniform answer, fully out of scope, abstains when asked", async () => {
  const e = emptyStateAnswer(DEPT);
  assert.equal(e.ood, 1);
  assert.equal(e.answer.type === "choice" && e.answer.confidence, 0.3333);
  const out = await runEmbed(
    { state: { text: "" }, questions: { dept: { ...DEPT, abstain: true } } },
    { embed: fakeEmbed, capability: CAP },
  );
  const a = out!.answers.dept!;
  assert.equal(a.abstained, true);
  assert.equal(a.abstain_reason, "out_of_scope");
});

test("score and noul questions answer in range", async () => {
  const score: Question = {
    type: "score",
    instructions: "How severe?",
    criteria: ["cosmetic typo", "degraded feature workaround", "outage blocking everyone"],
  };
  const noul: Question = { type: "noul", instructions: "Does the message ask for a refund?" };
  const out = await runEmbed(
    { state: "total outage blocking everyone, please refund", questions: { s: score, n: noul } },
    { embed: fakeEmbed, capability: CAP },
  );
  const s = out!.answers.s!;
  const n = out!.answers.n!;
  assert.equal(s.type, "score");
  if (s.type === "score") assert.ok(s.score >= 0 && s.score <= 2);
  assert.equal(n.type, "noul");
  if (n.type === "noul") assert.ok(n.noul >= 0 && n.noul <= 1);
});

test("runEmbed returns null when the encoder is unavailable", async () => {
  const out = await runEmbed(
    { state: "x", questions: { dept: DEPT } },
    { capability: { available: false, engine: "lexical", reason: "no model" } },
  );
  assert.equal(out, null);
});

test("answerQuestion is deterministic", async () => {
  const ctx = {
    x: hashVec("lost package"),
    stateText: "lost package",
    embed: fakeEmbed,
    params: EMBED_PARAMS,
  };
  const a = await answerQuestion(DEPT, ctx);
  const b = await answerQuestion(DEPT, ctx);
  assert.deepEqual(a, b);
});
