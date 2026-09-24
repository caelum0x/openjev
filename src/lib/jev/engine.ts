import { flattenEntry, focusedState } from "./entry.ts";
import { expandTokens } from "./lexicon.ts";
import { resolveModel } from "./models.ts";
import {
  approxTokens,
  LOCAL_MODEL,
  stateProse,
  type Answer,
  type ChoiceAnswer,
  type EngineWeights,
  type EntryType,
  type NoulAnswer,
  type Question,
  type ScoreAnswer,
  type SystemOneRequest,
  type SystemOneResponse,
} from "./types.ts";
import {
  applyIdf,
  bag,
  bigramOverlap,
  calibratedConfidence,
  charNgrams,
  clamp01,
  containsPhrase,
  cosine,
  distinctive,
  idfWeight,
  peakedConfidence,
  round4,
  softmax,
  tokenize,
  type SparseVec,
} from "./vector.ts";

import { applyScope } from "./scope.ts";

export { isLlmModel } from "./models.ts";

type OptionDoc = {
  key: string;
  text: string;
  tokens: string[];
  bag: SparseVec;
  ngrams: SparseVec;
  examples: string[];
  negative: string;
  negTokens: string[];
};

function optionDocs(
  options: Array<{
    key: string;
    desc: EntryType | undefined;
  }>,
): OptionDoc[] {
  return options.map((o) => {
    const flat = flattenEntry(o.desc ?? o.key);
    const keyText = o.key.replace(/_/g, " ");
    const text = [keyText, o.key, flat.positive].filter(Boolean).join(" \n ");
    const tokens = tokenize(text);
    return {
      key: o.key,
      text,
      tokens,
      bag: bag(tokens),
      ngrams: charNgrams(text),
      examples: flat.examples,
      negative: flat.negative,
      negTokens: tokenize(flat.negative),
    };
  });
}

type Feat = {
  lex: number;
  fuzzy: number;
  dist: number;
  keyHit: number;
  descHit: number;
  syn: number;
  bigram: number;
  ex: number;
  neg: number;
};

function scoreOptions(stateText: string, docs: OptionDoc[]): Feat[] {
  const stateTokens = tokenize(stateText);
  const stateBag = bag(stateTokens);
  const stateNgrams = charNgrams(stateText);
  const allBags = [stateBag, ...docs.map((d) => d.bag)];
  const idf = idfWeight(allBags);
  const stateW = applyIdf(stateBag, idf);
  const dist = distinctive(docs.map((d) => d.tokens));
  const stateSet = new Set(stateTokens);
  const lower = stateText.toLowerCase();

  return docs.map((d, i) => {
    const dw = applyIdf(d.bag, idf);
    const lex = cosine(stateW, dw);
    const fuzzy = cosine(stateNgrams, d.ngrams);
    let distHit = 0;
    const dset = dist[i] ?? new Set();
    if (dset.size > 0) {
      let n = 0;
      for (const t of dset) {
        if (!stateSet.has(t)) continue;
        const idx = stateTokens.indexOf(t);
        const pos = idx < 0 ? 1 : idx / Math.max(1, stateTokens.length);
        n += 1.15 - 0.35 * pos;
      }
      distHit = n / Math.sqrt(dset.size);
    }
    const key = d.key.replace(/_/g, " ");
    const keyHit = containsPhrase(lower, key) ? 1 : 0;
    let descHit = 0;
    for (const t of d.tokens) {
      if (stateSet.has(t) && dset.has(t)) descHit += 0.2;
    }
    let synHit = 0;
    const optExp = new Set(expandTokens(d.tokens));
    for (const t of stateTokens) if (optExp.has(t)) synHit += 1;
    const synScore = stateTokens.length
      ? synHit / Math.sqrt(stateTokens.length)
      : 0;
    const bigram = bigramOverlap(stateTokens, d.tokens);

    let ex = 0;
    for (const example of d.examples) {
      const et = tokenize(example);
      const eb = bag(et);
      const en = charNgrams(example);
      const s = 0.65 * cosine(stateBag, eb) + 0.35 * cosine(stateNgrams, en);
      if (s > ex) ex = s;
      ex = Math.max(ex, bigramOverlap(stateTokens, et));
    }

    let neg = 0;
    if (d.negative) {
      const nb = bag(d.negTokens);
      const nn = charNgrams(d.negative);
      neg = 0.7 * cosine(stateBag, nb) + 0.3 * cosine(stateNgrams, nn);
      let nHit = 0;
      for (const t of d.negTokens) if (stateSet.has(t)) nHit += 1;
      if (d.negTokens.length) neg += nHit / Math.sqrt(d.negTokens.length);
    }
    neg += negationClash(lower, d.text);

    return {
      lex,
      fuzzy,
      dist: distHit,
      keyHit,
      descHit,
      syn: synScore,
      bigram,
      ex,
      neg,
    };
  });
}

function combine(f: Feat, w: EngineWeights): number {
  return (
    w.lex * f.lex +
    w.fuzzy * f.fuzzy +
    w.dist * f.dist +
    w.keyHit * f.keyHit +
    w.descHit * f.descHit +
    w.syn * f.syn +
    w.bigram * f.bigram +
    w.ex * f.ex -
    w.neg * f.neg
  );
}

function negationClash(stateLower: string, docText: string): number {
  const doc = docText.toLowerCase();
  const re = /\b(no|not|never|without)\s+([a-z][a-z0-9]+)/g;
  let clash = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(doc))) {
    const phrase = m[2] ?? "";
    if (!phrase || phrase.length < 3) continue;
    if (["the", "this", "that", "hold", "evidence"].includes(phrase)) continue;
    const stated = stateLower.includes(phrase);
    const statedNeg = stateLower.includes(`${m[1]} ${phrase}`);
    if (stated && !statedNeg) clash += 1.2;
  }
  return clash;
}

/**
 * Softmax temperature schedule as a function of the raw-score spread (max-min).
 *
 * A small spread means the options scored near-identically, so the logits carry
 * little signal and must be softened (high temp) to avoid a spuriously peaked —
 * and therefore mis-calibrated — distribution; a large spread is trustworthy and
 * gets a low temp. The four values below are NOT hand-tuned: they were chosen by
 * grid-searching the schedule that minimizes the raw (pre-calibration) Expected
 * Calibration Error over the gold suite. Refit with:
 *   OTS_CALIBRATION=identity node --experimental-strip-types scripts/fit-temp.ts
 * and paste the winning `TEMP_SCHEDULE` (it prints the ECE each candidate hits).
 *
 * Chosen 2026-09-23 by scripts/fit-temp.ts: raw overall ECE 0.173 -> 0.159 vs.
 * the prior ad-hoc [0.12,0.35,0.8]->[0.7,0.48,0.36,0.28] schedule. `base` is the
 * len<=1 fallback. Every value below is the grid-search winner, not hand-picked.
 */
type TempSchedule = {
  base: number;
  bands: ReadonlyArray<readonly [maxSpread: number, temp: number]>;
};

const TEMP_SCHEDULE: TempSchedule = {
  base: 0.35,
  bands: [
    [0.12, 0.55],
    [0.35, 0.4],
    [0.8, 0.32],
    [Infinity, 0.22],
  ],
};

function tempSchedule(): TempSchedule {
  const override =
    typeof process !== "undefined" ? process.env?.OTS_TEMP_SCHEDULE : undefined;
  if (override) {
    try {
      const parsed = JSON.parse(override) as TempSchedule;
      if (parsed && Array.isArray(parsed.bands)) return parsed;
    } catch {
      // fall through to the baked schedule on malformed override
    }
  }
  return TEMP_SCHEDULE;
}

function adaptiveTemp(raw: number[], scale: number): number {
  const sched = tempSchedule();
  if (raw.length <= 1) return sched.base * scale;
  const spread = Math.max(...raw) - Math.min(...raw);
  for (const [maxSpread, temp] of sched.bands) {
    if (spread < maxSpread) return temp * scale;
  }
  const last = sched.bands[sched.bands.length - 1];
  return (last ? last[1] : 0.26) * scale;
}

function asProbs(raw: number[], scale: number): number[] {
  const temp = adaptiveTemp(raw, scale);
  const p = softmax(raw, temp);
  const sum = p.reduce((a, b) => a + b, 0) || 1;
  return p.map((x) => round4(x / sum));
}

/** The state text one question is judged on (focused on the paths it names). */
export function questionState(state: SystemOneRequest["state"], q: Question): string {
  const inst = flattenEntry(q.instructions);
  const extra: string[] = [...inst.paths];
  if (q.type === "noul" && q.criteria) {
    extra.push(...flattenEntry(q.criteria.true ?? null).paths);
    extra.push(...flattenEntry(q.criteria.false ?? null).paths);
  }
  return focusedState(state, extra);
}

function evalChoice(
  stateText: string,
  q: Extract<Question, { type: "choice" }>,
  w: EngineWeights,
): ChoiceAnswer {
  const keys = Object.keys(q.criteria);
  const docs = optionDocs(keys.map((k) => ({ key: k, desc: q.criteria[k] })));
  const feats = scoreOptions(stateText, docs);
  const raw = feats.map((f) => combine(f, w));
  const p = asProbs(raw, w.tempScale);
  let best = 0;
  for (let i = 1; i < p.length; i++) if ((p[i] ?? 0) > (p[best] ?? 0)) best = i;
  const probabilities: Record<string, number> = {};
  keys.forEach((k, i) => {
    probabilities[k] = p[i] ?? 0;
  });
  renormalize(probabilities);
  return {
    type: "choice",
    choice: keys[best] ?? keys[0] ?? "",
    probabilities,
    // Report the calibrated (accuracy-grounded) confidence, not raw peakedness.
    confidence: round4(
      calibratedConfidence(peakedConfidence(p, w.peakedBlend), "choice"),
    ),
  };
}

function evalScore(
  stateText: string,
  q: Extract<Question, { type: "score" }>,
  w: EngineWeights,
): ScoreAnswer {
  const docs = optionDocs(
    q.criteria.map((c, i) => ({ key: `level_${i}`, desc: c })),
  );
  const feats = scoreOptions(stateText, docs);
  const raw = feats.map((f) => combine(f, w));
  const p0 = asProbs(raw, w.tempScale);
  const p = smoothOrdered(p0);
  const legend: Record<string, EntryType> = {};
  const probabilities: Record<string, number> = {};
  let expected = 0;
  q.criteria.forEach((c, i) => {
    legend[String(i)] = c;
    probabilities[String(i)] = p[i] ?? 0;
    expected += i * (p[i] ?? 0);
  });
  renormalize(probabilities);
  return {
    type: "score",
    score: round4(expected),
    legend,
    probabilities,
    // Report the calibrated (accuracy-grounded) confidence, not raw peakedness.
    confidence: round4(
      calibratedConfidence(peakedConfidence(p, w.peakedBlend), "score"),
    ),
  };
}

function smoothOrdered(p: number[]): number[] {
  if (p.length <= 2) return p;
  const out = p.map((x, i) => {
    const l = p[i - 1] ?? 0;
    const r = p[i + 1] ?? 0;
    return 0.78 * x + 0.11 * l + 0.11 * r;
  });
  const s = out.reduce((a, b) => a + b, 0) || 1;
  return out.map((x) => x / s);
}

function evalNoul(
  stateText: string,
  q: Extract<Question, { type: "noul" }>,
  w: EngineWeights,
): NoulAnswer {
  const inst = flattenEntry(q.instructions);
  const yesFlat = flattenEntry(q.criteria?.true ?? null);
  const noFlat = flattenEntry(q.criteria?.false ?? null);
  const yesDesc: EntryType = {
    what: [inst.question || inst.positive, yesFlat.positive].filter(Boolean).join(" "),
    examples: yesFlat.examples,
    not_for: yesFlat.negative || noFlat.positive,
  };
  const noDesc: EntryType = {
    what:
      noFlat.positive ||
      "the condition does not hold; no evidence in the state; the opposite is true",
    examples: noFlat.examples,
    not_for: noFlat.negative,
  };
  const docs = optionDocs([
    { key: "yes", desc: yesDesc },
    { key: "no", desc: noDesc },
  ]);
  const feats = scoreOptions(stateText, docs);
  const yesRaw = combine(feats[0] ?? zeroFeat(), w);
  const noW: EngineWeights = { ...w, syn: w.syn * 0.7, dist: w.dist * 0.6 };
  const noRaw = combine(feats[1] ?? zeroFeat(), noW);
  const p = softmax(
    [yesRaw, noRaw],
    Math.max(w.noulTempFloor, adaptiveTemp([yesRaw, noRaw], w.tempScale)),
  );
  let yes = p[0] ?? 0.5;
  const lower = stateText.toLowerCase();
  if (/\b(not|never|no|isn't|isnt|don't|dont|won't|cannot)\b/.test(lower)) {
    const instToks = tokenize(inst.question || inst.positive);
    const stateToks = new Set(tokenize(stateText));
    const hit = instToks.some((t) => stateToks.has(t));
    if (hit) yes = clamp01(yes * 0.85);
  }
  return { type: "noul", noul: round4(clamp01(yes)) };
}

function zeroFeat(): Feat {
  return {
    lex: 0,
    fuzzy: 0,
    dist: 0,
    keyHit: 0,
    descHit: 0,
    syn: 0,
    bigram: 0,
    ex: 0,
    neg: 0,
  };
}

function renormalize(prob: Record<string, number>) {
  const keys = Object.keys(prob);
  let sum = 0;
  for (const k of keys) sum += prob[k] ?? 0;
  if (sum <= 0) {
    const u = round4(1 / Math.max(1, keys.length));
    for (const k of keys) prob[k] = u;
    return;
  }
  for (const k of keys) prob[k] = round4((prob[k] ?? 0) / sum);
  let s2 = 0;
  let maxK = keys[0] ?? "";
  for (const k of keys) {
    s2 += prob[k] ?? 0;
    if ((prob[k] ?? 0) >= (prob[maxK] ?? 0)) maxK = k;
  }
  const drift = round4(1 - s2);
  if (maxK) prob[maxK] = round4((prob[maxK] ?? 0) + drift);
}

function evalQuestion(
  stateText: string,
  q: Question,
  w: EngineWeights,
): Answer {
  if (q.type === "choice") return evalChoice(stateText, q, w);
  if (q.type === "score") return evalScore(stateText, q, w);
  return evalNoul(stateText, q, w);
}

function countOutputTokens(answers: Record<string, Answer>): number {
  try {
    return approxTokens(JSON.stringify(answers));
  } catch {
    return Object.keys(answers).length * 12;
  }
}

/**
 * The lexical engine's raw answers (no out-of-scope scoring or damping). The
 * embedding engine blends these in; `runLocal` scopes them.
 */
export function lexicalAnswers(
  req: SystemOneRequest,
  model = LOCAL_MODEL,
): Record<string, Answer> {
  const w = resolveModel(model).weights;
  const answers: Record<string, Answer> = {};
  for (const [id, q] of Object.entries(req.questions)) {
    answers[id] = evalQuestion(questionState(req.state, q), q, w);
  }
  return answers;
}

export function runLocal(
  req: SystemOneRequest,
  model = LOCAL_MODEL,
): SystemOneResponse {
  const resolved = resolveModel(model);
  const t0 =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  const answers = lexicalAnswers(req, model);
  // Out-of-scope detection + opt-in abstention (see scope.ts). The engine
  // damps off-topic answers so an unrelated input cannot come back at 0.99.
  const scoped = applyScope(req, answers, { damp: true });
  const t1 =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  const qText = Object.values(req.questions)
    .map((q) => flattenEntry(q.instructions).text)
    .join(" ");
  return {
    model: resolved.id,
    answers: scoped,
    usage: {
      input_tokens: approxTokens(stateProse(req.state) + " " + qText),
      output_tokens: countOutputTokens(scoped),
    },
    latency_ms: Math.max(0, Math.round((t1 - t0) * 10) / 10),
  };
}
