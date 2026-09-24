/**
 * Fit the embedding engine's constants (src/lib/jev/embed/params.ts) on
 * HELD-OUT data only. The leaderboard's test splits are never read here.
 *
 *   node --experimental-strip-types scripts/embed-fit.ts          # print
 *   node --experimental-strip-types scripts/embed-fit.ts --write  # rewrite params.ts
 *
 * Fitting data:
 *  - Choice temperature + lexical blend: Banking77 TRAIN and CLINC150
 *    VALIDATION (in-scope rows), plus small-option questions built from
 *    CLINC150 validation (3-12 random intents per question).
 *  - Out-of-scope logistic: CLINC150 VALIDATION (the 100 `oos` rows vs
 *    in-scope rows), plus the small-option questions, where queries of intents
 *    left out of the question (and `oos` rows) are the out-of-scope class.
 *  - Noul logistic: the even-indexed half of the in-repo gold suite.
 * AG News is not used at all, so its leaderboard row is fully out-of-sample.
 *
 * Needs the encoder (scripts/embed-download.sh) and the held-out splits, which
 * are downloaded into .cache/datasets on first run.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { lexicalAnswers } from "../src/lib/jev/engine.ts";
import { embedCapability, embedTexts } from "../src/lib/jev/embed/encoder.server.ts";
import {
  choiceProbs,
  dot,
  embedStateText,
  geometry,
  OOD_FEATURES,
  type OodFeatures,
} from "../src/lib/jev/embed/engine.ts";
import { EMBED_PARAMS, type EmbedParams } from "../src/lib/jev/embed/params.ts";
import {
  loadPublicDataset,
  PUBLIC_DATASETS,
  toRequest,
  type DatasetExample,
  type LoadedDataset,
  type PublicDatasetSpec,
} from "../src/lib/jev/public-datasets.ts";
import { GOLD } from "../src/lib/jev/gold.ts";
import { flattenEntry } from "../src/lib/jev/entry.ts";
import type { Question, SystemOneRequest } from "../src/lib/jev/types.ts";

const root = join(import.meta.dirname, "..");
const cacheDir = join(root, ".cache", "datasets");
const WRITE = process.argv.includes("--write");

const cap = await embedCapability();
if (!cap.available) {
  console.error(`embedding model unavailable: ${cap.reason}`);
  process.exit(1);
}

// Deterministic PRNG (mulberry32) so a re-fit gives the same constants.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20260924);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
function sample<T>(xs: readonly T[], n: number, seed: string): T[] {
  return xs
    .map((x, i) => ({ x, k: createHash("sha256").update(`${seed}:${i}`).digest("hex") }))
    .sort((a, b) => (a.k < b.k ? -1 : 1))
    .slice(0, n)
    .map((r) => r.x);
}

async function heldOut(
  id: string,
  split: string,
  patch: (s: PublicDatasetSpec) => PublicDatasetSpec,
) {
  const spec = PUBLIC_DATASETS.find((d) => d.id === id)!;
  return loadPublicDataset(patch({ ...spec, split }), { cacheDir });
}
const banking = await heldOut("banking77", "train", (s) => ({
  ...s,
  source: {
    ...(s.source as { kind: "csv"; url: string; textColumn: string; labelColumn: string }),
    url: (s.source as { url: string }).url.replace("test.csv", "train.csv"),
  },
}));
const clinc = await heldOut("clinc150_oos", "validation", (s) => ({
  ...s,
  source: {
    ...(s.source as Extract<PublicDatasetSpec["source"], { kind: "hf-rows" }>),
    split: "validation",
  },
}));

// ---------------------------------------------------------------------------
// Items: one choice question each, with precomputed similarity inputs.
// ---------------------------------------------------------------------------
type Item = {
  sims: number[];
  lex: number[];
  label: number; // index of the correct option, -1 when out of scope
  feats: OodFeatures;
  group: string;
};

async function item(
  req: SystemOneRequest,
  qid: string,
  gold: string | null,
  group: string,
  p: EmbedParams,
): Promise<Item> {
  const q = req.questions[qid] as Extract<Question, { type: "choice" | "score" }>;
  const text = embedStateText(req.state, q) || " ";
  const [x] = await embedTexts([text], "query");
  const { keys, sims, features } = await geometry(q, x!, embedTexts, p, text);
  const lexA = lexicalAnswers(req)[qid];
  const lex = keys.map((k) => (lexA && lexA.type !== "noul" ? (lexA.probabilities[k] ?? 0) : 0));
  return { sims, lex, label: gold === null ? -1 : keys.indexOf(gold), feats: features, group };
}

function subsetRequest(ds: LoadedDataset, classes: string[], text: string): SystemOneRequest {
  return toRequest({ ...ds, classes }, { text, label: "" });
}

const items: Item[] = [];
const p0 = EMBED_PARAMS;
const t0 = Date.now();
for (const ex of sample(banking.examples, 1200, "fit-banking")) {
  items.push(await item(toRequest(banking, ex), "label", ex.label, "banking77-train", p0));
}
const clincIn = clinc.examples.filter((e) => e.label !== "oos");
const clincOos = clinc.examples.filter((e) => e.label === "oos");
for (const ex of [...sample(clincIn, 1200, "fit-clinc"), ...clincOos]) {
  items.push(
    await item(
      toRequest(clinc, ex),
      "label",
      ex.label === "oos" ? null : ex.label,
      "clinc150-val",
      p0,
    ),
  );
}
// Small-option questions from CLINC150 validation.
const byLabel = new Map<string, DatasetExample[]>();
for (const e of clincIn) byLabel.set(e.label, [...(byLabel.get(e.label) ?? []), e]);
for (let i = 0; i < 900; i++) {
  const k = 3 + Math.floor(rand() * 10);
  const classes = sample(clinc.classes, k, `subset-${i}`);
  const r = rand();
  let ex: DatasetExample;
  let gold: string | null;
  if (r < 0.5) {
    gold = pick(classes);
    ex = pick(byLabel.get(gold)!);
  } else if (r < 0.8) {
    const other = pick(clinc.classes.filter((c) => !classes.includes(c)));
    ex = pick(byLabel.get(other)!);
    gold = null;
  } else {
    ex = pick(clincOos);
    gold = null;
  }
  items.push(
    await item(subsetRequest(clinc, classes, ex.text), "label", gold, "clinc150-val-subsets", p0),
  );
}
// Even half of the gold suite: in-scope Choice and Score assertions.
for (const [ci, g] of GOLD.entries()) {
  if (ci % 2 !== 0) continue;
  const req: SystemOneRequest = { state: g.state, questions: g.questions };
  for (const e of g.expect) {
    if (e.choice) items.push(await item(req, e.choice.id, e.choice.value, "gold-even", p0));
    if (e.score) {
      const mid = Math.round((e.score.min + e.score.max) / 2);
      items.push(await item(req, e.score.id, String(mid), "gold-even", p0));
    }
  }
}
console.log(
  `embedded ${items.length} held-out questions in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
);

// ---------------------------------------------------------------------------
// 1) Choice temperature + lexical blend: minimise NLL on in-scope items.
// ---------------------------------------------------------------------------
const inScope = items.filter((i) => i.label >= 0);
function choiceStats(p: EmbedParams, set: readonly Item[]) {
  let nll = 0;
  let correct = 0;
  const bins = Array.from({ length: 10 }, () => ({ n: 0, conf: 0, acc: 0 }));
  for (const it of set) {
    const probs = choiceProbs(it.sims, p, p.choice.lexWeight ? it.lex : undefined);
    let best = 0;
    for (let i = 1; i < probs.length; i++) if (probs[i]! > probs[best]!) best = i;
    nll -= Math.log(Math.max(1e-9, probs[it.label]!));
    const ok = best === it.label ? 1 : 0;
    correct += ok;
    const b = bins[Math.min(9, Math.floor(probs[best]! * 10))]!;
    b.n += 1;
    b.conf += probs[best]!;
    b.acc += ok;
  }
  const ece = bins.reduce((s, b) => s + (b.n ? Math.abs(b.conf - b.acc) : 0), 0) / set.length;
  return { nll: nll / set.length, acc: correct / set.length, ece };
}

// Every source counts equally, so 1,200 public rows cannot drown the gold half.
const GROUPS = ["banking77-train", "clinc150-val", "clinc150-val-subsets", "gold-even"];
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
let best = { p: p0, nll: Infinity };
for (const lexWeight of [0, 0.1, 0.2, 0.35, 0.5, 0.75, 1]) {
  for (const spreadAdapt of [0, 0.25, 0.5, 0.75, 1]) {
    for (let scale = 10; scale <= 120; scale += 2.5) {
      const p: EmbedParams = {
        ...p0,
        choice: { ...p0.choice, scale, spreadAdapt, lexWeight, spreadRef: 0.03 },
      };
      const nll = mean(
        GROUPS.map(
          (g) =>
            choiceStats(
              p,
              inScope.filter((i) => i.group === g),
            ).nll,
        ),
      );
      if (nll < best.nll) best = { p, nll };
    }
  }
}
const fittedChoice = best.p.choice;
for (const g of GROUPS) {
  const set = inScope.filter((i) => i.group === g);
  const before = choiceStats({ ...best.p, choice: { ...best.p.choice, lexWeight: 0 } }, set);
  const after = choiceStats(best.p, set);
  console.log(
    `${g.padEnd(22)} n=${set.length} acc ${before.acc.toFixed(3)} -> ${after.acc.toFixed(3)}  ece ${before.ece.toFixed(3)} -> ${after.ece.toFixed(3)}`,
  );
}
console.log("choice:", fittedChoice);

// ---------------------------------------------------------------------------
// 2) Out-of-scope logistic (standardised features, L2, class-balanced).
// ---------------------------------------------------------------------------
const FEATS = OOD_FEATURES;
const X = items.map((i) => FEATS.map((f) => i.feats[f]));
const y = items.map((i) => (i.label < 0 ? 1 : 0));
const mu = FEATS.map((_, j) => X.reduce((s, r) => s + r[j]!, 0) / X.length);
const sd = FEATS.map(
  (_, j) => Math.sqrt(X.reduce((s, r) => s + (r[j]! - mu[j]!) ** 2, 0) / X.length) || 1,
);
const Z = X.map((r) => r.map((v, j) => (v - mu[j]!) / sd[j]!));
const pos = y.filter((v) => v === 1).length;
const wPos = y.length / (2 * pos);
const wNeg = y.length / (2 * (y.length - pos));
let w = FEATS.map(() => 0);
let b = 0;
for (let epoch = 0; epoch < 4000; epoch++) {
  const gw = FEATS.map(() => 0);
  let gb = 0;
  Z.forEach((r, i) => {
    const z = b + r.reduce((s, v, j) => s + v * w[j]!, 0);
    const pr = 1 / (1 + Math.exp(-z));
    const err = (pr - y[i]!) * (y[i] ? wPos : wNeg);
    r.forEach((v, j) => (gw[j]! += err * v));
    gb += err;
  });
  w = w.map((wj, j) => wj - 0.1 * (gw[j]! / Z.length + 1e-3 * wj));
  b -= 0.1 * (gb / Z.length);
}
// Un-standardise into raw-feature weights.
const rawW = Object.fromEntries(
  FEATS.map((f, j) => [f, w[j]! / sd[j]!]),
) as EmbedParams["ood"]["weights"];
const rawB = b - FEATS.reduce((s, _, j) => s + (w[j]! * mu[j]!) / sd[j]!, 0);
function aurocOf(set: readonly Item[], score: (i: Item) => number) {
  const ins = set.filter((i) => i.label >= 0).map(score);
  const oos = set.filter((i) => i.label < 0).map(score);
  let wins = 0;
  for (const o of oos) for (const v of ins) wins += o > v ? 1 : o === v ? 0.5 : 0;
  return wins / (ins.length * oos.length);
}
// Pick the operating point on held-out in-scope data: shift the intercept so
// that 5% of held-out in-scope questions score above 0.5, where the scope
// layer starts damping (OOD_THRESHOLD, the abstention point, sits a bit higher).
const zOf = (it: Item, bias: number) =>
  bias + FEATS.reduce((s, f) => s + (rawW[f] ?? 0) * it.feats[f], 0);
// The in-scope score level depends on the option count, so the operating
// point is set at both ends: the 95th percentile of held-out in-scope scores
// is moved to 0 (ood = 0.5, where damping starts) separately for few-option
// questions (CLINC150 subsets + gold, K <= 20) and many-option questions
// (Banking77, CLINC150; K = 77 / 150), and the intercept is interpolated
// linearly in log K between them.
const q95 = (xs: number[]) => {
  const v = [...xs].sort((a, b) => a - b);
  return v[Math.floor(0.95 * (v.length - 1))]!;
};
const inAll = items.filter((i) => i.label >= 0);
const small = inAll.filter((i) => i.feats.logK <= Math.log(20));
const large = inAll.filter((i) => i.feats.logK > Math.log(20));
const kS = mean(small.map((i) => i.feats.logK));
const kL = mean(large.map((i) => i.feats.logK));
const bS = -q95(small.map((i) => zOf(i, rawB))) + rawB;
const bL = -q95(large.map((i) => zOf(i, rawB))) + rawB;
const slope = (bL - bS) / (kL - kS);
const shiftedB = bS - slope * kS;
rawW.logK = (rawW.logK ?? 0) + slope;
const oodP = (it: Item) => 1 / (1 + Math.exp(-zOf(it, shiftedB)));
for (const g of GROUPS) {
  const set = items.filter((i) => i.group === g);
  const ins = set.filter((i) => i.label >= 0);
  const oos = set.filter((i) => i.label < 0);
  const fpr = ins.filter((i) => oodP(i) > 0.5).length / Math.max(1, ins.length);
  const tpr = oos.length ? oos.filter((i) => oodP(i) > 0.5).length / oos.length : NaN;
  const au = oos.length
    ? `AUROC maxSim-only=${aurocOf(set, (i) => -i.feats.maxSim).toFixed(3)} fitted=${aurocOf(set, oodP).toFixed(3)}`
    : "";
  console.log(
    `${g.padEnd(22)} ood>0.5: in-scope ${(fpr * 100).toFixed(1)}%  oos ${(tpr * 100).toFixed(1)}%  ${au}`,
  );
}
console.log("ood:", { bias: shiftedB, weights: rawW });

// ---------------------------------------------------------------------------
// 3) Noul logistic on the even half of the gold suite.
// ---------------------------------------------------------------------------
type NoulRow = { sYes: number; sNo: number | null; lex: number; y: number };
const noulRows: NoulRow[] = [];
for (const [ci, g] of GOLD.entries()) {
  if (ci % 2 !== 0) continue;
  const lex = lexicalAnswers({ state: g.state, questions: g.questions });
  for (const e of g.expect) {
    if (!("noul" in e) || !e.noul) continue;
    const exp = e.noul;
    const target =
      exp.min != null && exp.min >= 0.5 ? 1 : exp.max != null && exp.max <= 0.5 ? 0 : null;
    if (target === null) continue;
    const q = g.questions[exp.id];
    if (!q || q.type !== "noul") continue;
    const inst = flattenEntry(q.instructions);
    const yes = flattenEntry(q.criteria?.true ?? null);
    const no = flattenEntry(q.criteria?.false ?? null);
    const [x] = await embedTexts([embedStateText(g.state, q) || " "], "query");
    const [yv] = await embedTexts(
      [[inst.question || inst.positive, yes.positive].filter(Boolean).join(" ") || "yes"],
      "doc",
    );
    const sNo = no.positive ? dot(x!, (await embedTexts([no.positive], "doc"))[0]!) : null;
    const la = lex[exp.id];
    noulRows.push({ sYes: dot(x!, yv!), sNo, lex: la?.type === "noul" ? la.noul : 0.5, y: target });
  }
}
const lg = (p: number) =>
  Math.log(Math.min(0.9999, Math.max(1e-4, p)) / (1 - Math.min(0.9999, Math.max(1e-4, p))));
let nb = { bias: 0, simWeight: 0, lexWeight: 1, noBaseline: 0.75, nll: Infinity };
for (const noBaseline of [0.7, 0.75, 0.8, 0.85]) {
  for (const simWeight of [0, 5, 10, 15, 20, 30]) {
    for (const lexWeight of [0.25, 0.5, 0.75, 1, 1.25]) {
      for (let bias = -2; bias <= 2; bias += 0.25) {
        let nll = 0;
        for (const r of noulRows) {
          const z = bias + simWeight * (r.sYes - (r.sNo ?? noBaseline)) + lexWeight * lg(r.lex);
          const pr = 1 / (1 + Math.exp(-z));
          nll -= Math.log(Math.max(1e-9, r.y ? pr : 1 - pr));
        }
        nll /= Math.max(1, noulRows.length);
        if (nll < nb.nll) nb = { bias, simWeight, lexWeight, noBaseline, nll };
      }
    }
  }
}
console.log(`noul: ${noulRows.length} held-out gold assertions`, nb);

const fitted: EmbedParams = {
  ...p0,
  model: cap.model,
  choice: fittedChoice,
  noul: {
    bias: nb.bias,
    simWeight: nb.simWeight,
    lexWeight: nb.lexWeight,
    noBaseline: nb.noBaseline,
  },
  ood: { ...p0.ood, bias: shiftedB, weights: rawW },
  fitted_on:
    "Banking77 train, CLINC150 validation and the even half of the gold suite (choice/score temperature and lexical blend); CLINC150 validation (out-of-scope detector; operating point = 5% of held-out in-scope questions); even half of the gold suite (noul). No leaderboard test split was used.",
};
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
const json = JSON.stringify(fitted, (_k, v) => (typeof v === "number" ? r6(v) : v), 2);
console.log(json);
if (WRITE) {
  const path = join(root, "src/lib/jev/embed/params.ts");
  const src = readFileSync(path, "utf8");
  const next = src.replace(
    /export const EMBED_PARAMS: EmbedParams = [\s\S]*?\n};\n/,
    `export const EMBED_PARAMS: EmbedParams = ${json};\n`,
  );
  writeFileSync(path, next);
  console.log(`wrote ${path}`);
}
