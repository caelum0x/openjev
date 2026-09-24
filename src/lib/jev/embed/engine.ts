/**
 * Embedding engine for System One (the default local engine when the sentence
 * encoder is installed; see encoder.server.ts).
 *
 *  - Choice / Score: nearest prototype. Each option (or score level) becomes a
 *    prototype embedding of its key + description; when an option carries
 *    `examples`, a few-shot kNN term (mean of the top-k example similarities)
 *    is mixed in. Logits are similarity gaps scaled by a per-question
 *    temperature: the base scale is divided by the spread of that question's
 *    similarities (raised to `spreadAdapt`), so a question whose options are
 *    all near-equidistant is not reported as confident.
 *  - Noul: calibrated logistic over the similarity gap between the "yes" side
 *    (instructions + `criteria.true`) and the "no" side (`criteria.false`),
 *    blended with the lexical engine's log-odds.
 *  - Out of scope: logistic over max similarity, similarity to the question's
 *    domain centroid, a diagonal Mahalanobis distance to the option
 *    prototypes (shrunk toward isotropic), and a soft-max energy. Coefficients
 *    were fit on held-out data (see EMBED_PARAMS / scripts/embed-fit.ts).
 *
 * Pure: the encoder and the lexical answers are injected, so the math is unit
 * tested without model weights.
 */
import { flattenEntry, getByPath, stripTicks } from "../entry.ts";
import {
  legendLabel,
  stateProse,
  type State,
  type Answer,
  type ChoiceAnswer,
  type EntryType,
  type NoulAnswer,
  type Question,
  type ScoreAnswer,
} from "../types.ts";
import { EMBED_PARAMS, type EmbedParams } from "./params.ts";

export type Vec = Float32Array;
export type EmbedFn = (texts: readonly string[], kind: "query" | "doc") => Promise<Vec[]>;

export { EMBED_PARAMS, type EmbedParams };

const round4 = (x: number): number => Math.round(x * 1e4) / 1e4;
const clamp01 = (x: number): number => (Number.isNaN(x) ? 0 : Math.min(1, Math.max(0, x)));
const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));
const logit = (p: number): number => {
  const q = Math.min(1 - 1e-4, Math.max(1e-4, p));
  return Math.log(q / (1 - q));
};

export function dot(a: Vec, b: Vec): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

function normalized(v: Vec): Vec {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i]! * v[i]!;
  n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
}

function mean(xs: readonly number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function std(xs: readonly number[]): number {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

export function softmax(z: readonly number[]): number[] {
  const m = Math.max(...z);
  const e = z.map((x) => Math.exp(x - m));
  const s = e.reduce((a, b) => a + b, 0) || 1;
  return e.map((x) => x / s);
}

// ---------------------------------------------------------------------------
// State text
// ---------------------------------------------------------------------------

/**
 * The text a question is judged on, as the encoder should see it: the values
 * of the state paths the question names in backticks (a single path gives the
 * bare value, no "key:" prefix), else a single-field object's value, else the
 * whole state as prose.
 */
export function embedStateText(state: State, q: Question): string {
  const paths = [flattenEntry(q.instructions).paths];
  if (q.type === "noul" && q.criteria) {
    paths.push(
      flattenEntry(q.criteria.true ?? null).paths,
      flattenEntry(q.criteria.false ?? null).paths,
    );
  }
  const unique = [...new Set(paths.flat().map(stripTicks).filter(Boolean))];
  const found = unique
    .map((p) => ({ p, v: getByPath(state, p) }))
    .filter((x) => x.v !== undefined && x.v !== null);
  if (found.length === 1) return stateProse(found[0]!.v).trim();
  if (found.length > 1) {
    return found
      .map((x) => `${x.p.replace(/[._]/g, " ")}: ${stateProse(x.v)}`)
      .join("\n")
      .trim();
  }
  if (state && typeof state === "object" && !Array.isArray(state)) {
    const vals = Object.values(state as Record<string, unknown>);
    if (vals.length === 1) return stateProse(vals[0]).trim();
  }
  return stateProse(state).trim();
}

// ---------------------------------------------------------------------------
// Option texts
// ---------------------------------------------------------------------------

export type OptionText = { key: string; text: string; examples: string[] };

/** "card_arrival" + "Card arrival: when will my card come" -> prototype text. */
export function optionText(key: string, desc: EntryType | undefined): OptionText {
  const flat = flattenEntry(desc ?? null);
  const name = key.replace(/[_-]+/g, " ").trim();
  const body = flat.positive.trim();
  const text =
    !body || body.toLowerCase() === name.toLowerCase()
      ? name
      : body.toLowerCase().startsWith(name.toLowerCase())
        ? body
        : `${name}: ${body}`;
  return { key, text, examples: flat.examples.filter((e) => e.trim().length > 0) };
}

// ---------------------------------------------------------------------------
// Similarity features
// ---------------------------------------------------------------------------

/**
 * Out-of-scope features. All are comparable across option counts: `energy`
 * is a log-MEAN-exp (a soft maximum that does not grow with K) and `logK`
 * lets the detector learn how much similarity to expect from K prototypes.
 */
export type OodFeatures = {
  maxSim: number;
  domainSim: number;
  maha: number;
  energy: number;
  logK: number;
  /** log(1 + words in the state): long inputs sit farther from short labels. */
  logLen: number;
  /** maxSim x logK: lets the expected similarity depend on the option count. */
  maxSimK: number;
};

/** Nearest-prototype similarity per option, with the few-shot kNN term. */
export function optionSims(
  x: Vec,
  protos: readonly Vec[],
  examples: readonly (readonly Vec[])[],
  p: EmbedParams,
): number[] {
  return protos.map((proto, i) => {
    const s = dot(x, proto);
    const ex = examples[i] ?? [];
    if (ex.length === 0) return s;
    const top = ex
      .map((e) => dot(x, e))
      .sort((a, b) => b - a)
      .slice(0, Math.max(1, p.knnK));
    const knn = mean(top);
    return (1 - p.exampleWeight) * s + p.exampleWeight * Math.max(s, knn);
  });
}

/**
 * Diagonal Mahalanobis distance from x to the prototype cloud: per-dimension
 * variance of the prototypes, shrunk toward their average variance (few
 * prototypes cannot estimate 384 variances). Scaled so an isotropic cloud
 * gives the RMS distance in units of prototype spread.
 */
export function mahalanobis(
  x: Vec,
  protos: readonly Vec[],
  shrink: number,
  minVar: number,
): number {
  const d = x.length;
  const k = protos.length;
  if (k === 0) return 0;
  const mu = new Float64Array(d);
  for (const p of protos) for (let i = 0; i < d; i++) mu[i]! += p[i]! / k;
  const v = new Float64Array(d);
  for (const p of protos) for (let i = 0; i < d; i++) v[i]! += (p[i]! - mu[i]!) ** 2 / k;
  let vbar = 0;
  for (let i = 0; i < d; i++) vbar += v[i]! / d;
  vbar = Math.max(vbar, minVar);
  let acc = 0;
  for (let i = 0; i < d; i++) {
    const vi = (k * v[i]! + shrink * vbar) / (k + shrink);
    acc += (x[i]! - mu[i]!) ** 2 / Math.max(vi, 1e-8);
  }
  return Math.sqrt(acc / d);
}

export function oodFeatures(
  x: Vec,
  protos: readonly Vec[],
  sims: readonly number[],
  domain: Vec,
  p: EmbedParams,
  stateText = "",
): OodFeatures {
  const maxSim = Math.max(...sims);
  const t = p.ood.energyTemp;
  const energy =
    t * Math.log(sims.reduce((a, s) => a + Math.exp((s - maxSim) / t), 0) / sims.length) + maxSim;
  return {
    maxSim,
    domainSim: dot(x, domain),
    maha: mahalanobis(x, protos, p.ood.shrink, p.ood.minVar),
    energy,
    logK: Math.log(Math.max(1, sims.length)),
    logLen: Math.log(1 + stateText.split(/\s+/).filter(Boolean).length),
    maxSimK: maxSim * Math.log(Math.max(1, sims.length)),
  };
}

export const OOD_FEATURES = [
  "maxSim",
  "domainSim",
  "maha",
  "energy",
  "logK",
  "logLen",
  "maxSimK",
] as const;

/** Out-of-scope probability in [0,1] from the fitted logistic. */
export function oodScore(f: OodFeatures, p: EmbedParams): number {
  const w = p.ood.weights;
  let z = p.ood.bias;
  for (const k of OOD_FEATURES) z += (w[k] ?? 0) * f[k];
  return sigmoid(z);
}

/** Per-question temperature: logits = scale * (s - max) / (spread / ref)^adapt. */
export function choiceProbs(
  sims: readonly number[],
  p: EmbedParams,
  lexProbs?: readonly number[],
): number[] {
  const m = Math.max(...sims);
  const spread = Math.max(std(sims), 1e-4);
  const scale = p.choice.scale / Math.pow(spread / p.choice.spreadRef, p.choice.spreadAdapt);
  const z = sims.map((s, i) => {
    const lex = lexProbs ? p.choice.lexWeight * Math.log(Math.max(1e-6, lexProbs[i] ?? 0)) : 0;
    return scale * (s - m) + lex;
  });
  return softmax(z);
}

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

export type EmbedAnswer = { answer: Answer; ood: number; features: OodFeatures };

function smoothOrdered(p: number[]): number[] {
  if (p.length <= 2) return p;
  const out = p.map((x, i) => 0.8 * x + 0.1 * (p[i - 1] ?? 0) + 0.1 * (p[i + 1] ?? 0));
  const s = out.reduce((a, b) => a + b, 0) || 1;
  return out.map((x) => x / s);
}

function roundedDistribution(
  keys: readonly string[],
  probs: readonly number[],
): Record<string, number> {
  const out: Record<string, number> = {};
  keys.forEach((k, i) => {
    out[k] = round4(probs[i] ?? 0);
  });
  return out;
}

function argmax(xs: readonly number[]): number {
  let best = 0;
  for (let i = 1; i < xs.length; i++) if (xs[i]! > xs[best]!) best = i;
  return best;
}

/** Lexical probabilities aligned to `keys` (undefined when absent). */
function alignedLex(lex: Answer | undefined, keys: readonly string[]): number[] | undefined {
  if (!lex || lex.type === "noul") return undefined;
  return keys.map((k) => lex.probabilities[k] ?? 0);
}

export type QuestionContext = {
  x: Vec;
  /** The text `x` embeds (for the length feature). */
  stateText?: string;
  embed: EmbedFn;
  params: EmbedParams;
  /** The lexical engine's answer to the same question (blend input), if any. */
  lexical?: Answer;
};

async function embedOptions(opts: readonly OptionText[], embed: EmbedFn) {
  const protos = await embed(
    opts.map((o) => o.text),
    "doc",
  );
  const examples = await Promise.all(
    opts.map((o) => (o.examples.length ? embed(o.examples, "doc") : Promise.resolve([] as Vec[]))),
  );
  return { protos, examples };
}

function centroid(protos: readonly Vec[], extra?: Vec): Vec {
  const d = protos[0]?.length ?? extra?.length ?? 0;
  const c = new Float32Array(d);
  const all = extra ? [...protos, extra] : protos;
  for (const p of all) for (let i = 0; i < d; i++) c[i]! += p[i]!;
  return normalized(c);
}

async function instructionVec(q: Question, embed: EmbedFn): Promise<Vec | undefined> {
  const text = flattenEntry(q.instructions).positive.trim();
  if (!text) return undefined;
  const [v] = await embed([text], "doc");
  return v;
}

export type Geometry = { keys: string[]; sims: number[]; features: OodFeatures };

/**
 * Similarities of the state embedding to each option (choice) or level
 * (score) prototype, plus the out-of-scope features. Shared by the answer
 * functions and scripts/embed-fit.ts so fitting sees exactly what serving does.
 */
export async function geometry(
  q: Extract<Question, { type: "choice" | "score" }>,
  x: Vec,
  embed: EmbedFn,
  params: EmbedParams,
  stateText = "",
): Promise<Geometry> {
  const isChoice = q.type === "choice";
  const keys = isChoice ? Object.keys(q.criteria) : q.criteria.map((_, i) => String(i));
  const opts = isChoice
    ? keys.map((k) => optionText(k, q.criteria[k]))
    : q.criteria.map((c, i) => {
        const o = optionText(`level ${i}`, c);
        return { ...o, text: legendLabel(c) || o.text };
      });
  const { protos, examples } = await embedOptions(opts, embed);
  const sims = optionSims(x, protos, examples, params);
  const features = oodFeatures(
    x,
    protos,
    sims,
    centroid(protos, await instructionVec(q, embed)),
    params,
    stateText,
  );
  return { keys, sims, features };
}

export async function answerChoice(
  q: Extract<Question, { type: "choice" }>,
  ctx: QuestionContext,
): Promise<EmbedAnswer> {
  const { keys, sims, features } = await geometry(q, ctx.x, ctx.embed, ctx.params, ctx.stateText);
  const probs = choiceProbs(sims, ctx.params, alignedLex(ctx.lexical, keys));
  const best = argmax(probs);
  const answer: ChoiceAnswer = {
    type: "choice",
    choice: keys[best] ?? "",
    probabilities: roundedDistribution(keys, probs),
    confidence: round4(probs[best] ?? 0),
  };
  return { answer, ood: round4(oodScore(features, ctx.params)), features };
}

export async function answerScore(
  q: Extract<Question, { type: "score" }>,
  ctx: QuestionContext,
): Promise<EmbedAnswer> {
  const { keys, sims, features } = await geometry(q, ctx.x, ctx.embed, ctx.params, ctx.stateText);
  const probs = smoothOrdered(choiceProbs(sims, ctx.params, alignedLex(ctx.lexical, keys)));
  const legend: Record<string, EntryType> = {};
  let expected = 0;
  q.criteria.forEach((c, i) => {
    legend[String(i)] = c;
    expected += i * (probs[i] ?? 0);
  });
  const answer: ScoreAnswer = {
    type: "score",
    score: round4(expected),
    legend,
    probabilities: roundedDistribution(keys, probs),
    confidence: round4(Math.max(...probs)),
  };
  return { answer, ood: round4(oodScore(features, ctx.params)), features };
}

export async function answerNoul(
  q: Extract<Question, { type: "noul" }>,
  ctx: QuestionContext,
): Promise<EmbedAnswer> {
  const inst = flattenEntry(q.instructions);
  const yes = flattenEntry(q.criteria?.true ?? null);
  const no = flattenEntry(q.criteria?.false ?? null);
  const yesText = [inst.question || inst.positive, yes.positive].filter(Boolean).join(" ");
  const texts = [yesText || "yes", no.positive || ""];
  const [yesV, noV] = await ctx.embed(
    texts.map((t) => t || " "),
    "doc",
  );
  const sYes = dot(ctx.x, yesV!);
  // Without a `false` description the "no" side is the average relevance of an
  // unrelated input, a constant learned with the other coefficients.
  const sNo = no.positive ? dot(ctx.x, noV!) : ctx.params.noul.noBaseline;
  const lexP = ctx.lexical?.type === "noul" ? ctx.lexical.noul : 0.5;
  const z =
    ctx.params.noul.bias +
    ctx.params.noul.simWeight * (sYes - sNo) +
    ctx.params.noul.lexWeight * logit(lexP);
  const answer: NoulAnswer = { type: "noul", noul: round4(clamp01(sigmoid(z))) };
  const features = oodFeatures(ctx.x, [yesV!], [sYes], yesV!, ctx.params, ctx.stateText);
  return { answer, ood: round4(oodScore(features, ctx.params)), features };
}

const EMPTY_FEATURES: OodFeatures = {
  maxSim: 0,
  domainSim: 0,
  maha: 0,
  energy: 0,
  logK: 0,
  logLen: 0,
  maxSimK: 0,
};

/** No input to judge: a uniform answer that is fully out of scope. */
export function emptyStateAnswer(q: Question): EmbedAnswer {
  if (q.type === "noul") {
    return { answer: { type: "noul", noul: 0.5 }, ood: 1, features: EMPTY_FEATURES };
  }
  const keys = q.type === "choice" ? Object.keys(q.criteria) : q.criteria.map((_, i) => String(i));
  const u = keys.map(() => 1 / Math.max(1, keys.length));
  const probabilities = roundedDistribution(keys, u);
  const confidence = round4(u[0] ?? 0);
  if (q.type === "choice") {
    return {
      answer: { type: "choice", choice: keys[0] ?? "", probabilities, confidence },
      ood: 1,
      features: EMPTY_FEATURES,
    };
  }
  const legend: Record<string, EntryType> = {};
  q.criteria.forEach((c, i) => {
    legend[String(i)] = c;
  });
  const score = round4(keys.reduce((a, _k, i) => a + i * (u[i] ?? 0), 0));
  return {
    answer: { type: "score", score, legend, probabilities, confidence },
    ood: 1,
    features: EMPTY_FEATURES,
  };
}

export function answerQuestion(q: Question, ctx: QuestionContext): Promise<EmbedAnswer> {
  if (ctx.stateText !== undefined && !ctx.stateText.trim()) {
    return Promise.resolve(emptyStateAnswer(q));
  }
  if (q.type === "choice") return answerChoice(q, ctx);
  if (q.type === "score") return answerScore(q, ctx);
  return answerNoul(q, ctx);
}
