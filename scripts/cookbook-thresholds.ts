/**
 * Choose the cookbook decision thresholds for the EMBEDDING engine and report
 * how they do on data they were not chosen on.
 *
 *   npm run cookbook-thresholds             # print
 *   npm run cookbook-thresholds -- --write  # rewrite
 *       the EMBEDDING_THRESHOLDS block in src/lib/jev/cookbooks/thresholds.ts and
 *       the generated tables in docs/COOKBOOK-THRESHOLDS.md
 *
 * Data: the labelled cookbook scenarios in src/lib/jev/cookbooks/tuning-sets.ts.
 * Even rows (TUNE) choose the thresholds; odd rows (HELD-OUT) only report.
 * The odd half of the gold suite (the embedding engine's noul logistic was
 * fitted on the even half) is reported as a generic noul-cut sanity check.
 *
 * Selection (deterministic): coordinate search over a 0.05 grid, 3 passes, a
 * weighted cost per cookbook (below). Multi-gate cookbooks (smart home,
 * consistency) break ties toward the hand-set value, so a gate moves only as
 * far as the tune half asks. The cascade's single fire threshold is swept on
 * a 0.01 grid and ties take the middle of the widest tied run, so it sits in
 * the middle of the gap between the score clusters.
 *
 * Needs the encoder (scripts/embed-download.sh).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runLocal } from "../src/lib/jev/engine.ts";
import { embedCapability } from "../src/lib/jev/embed/encoder.server.ts";
import { embedEngineVersion } from "../src/lib/jev/embed/params.ts";
import { runEmbed } from "../src/lib/jev/embed/run.server.ts";
import { GOLD } from "../src/lib/jev/gold.ts";
import { verifyExtract } from "../src/lib/jev/cookbooks/cascade.ts";
import { runConsistency } from "../src/lib/jev/cookbooks/consistency.ts";
import { defaultHome, runSmarthome } from "../src/lib/jev/cookbooks/smarthome.ts";
import {
  DEFAULT_THRESHOLDS,
  type CascadeGates,
  type ConsistencyGates,
  type CookbookThresholds,
  type SmarthomeGates,
} from "../src/lib/jev/cookbooks/thresholds.ts";
import {
  CASCADE_TUNING,
  CONSISTENCY_TUNING,
  SMARTHOME_TUNING,
  splitOf,
  type Split,
} from "../src/lib/jev/cookbooks/tuning-sets.ts";
import type { Evaluator } from "../src/lib/jev/cookbooks/evaluator.ts";
import type { NoulAnswer, SystemOneRequest, SystemOneResponse } from "../src/lib/jev/types.ts";

const root = join(import.meta.dirname, "..");
const WRITE = process.argv.includes("--write");

const cap = await embedCapability();
if (!cap.available) {
  console.error(`embedding model unavailable: ${cap.reason}`);
  process.exit(1);
}
const engineVersion = embedEngineVersion(cap.model);

/** Memoised evaluators: a threshold sweep re-reads the same answers. */
function memo(run: (req: SystemOneRequest) => Promise<SystemOneResponse>): Evaluator {
  const cache = new Map<string, Promise<SystemOneResponse>>();
  return (req) => {
    const key = JSON.stringify([req.state, req.questions]);
    let hit = cache.get(key);
    if (!hit) {
      hit = run(req);
      cache.set(key, hit);
    }
    return hit;
  };
}
const embedded = memo(async (req) => {
  const out = await runEmbed(req);
  if (!out) throw new Error("embedding engine stopped answering");
  return out;
});
const lexical = memo(async (req) => runLocal(req, "system-one"));

// ---------------------------------------------------------------------------
// Search helpers.

type Score = number[]; // lexicographic, higher is better
const better = (a: Score, b: Score) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
};
const same = (a: Score, b: Score) => !better(a, b) && !better(b, a);
const grid = (lo: number, hi: number, step: number) => {
  const out: number[] = [];
  for (let v = lo; v <= hi + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
};

/**
 * Best value on the grid. Ties: with an `anchor` (the hand-set value), the
 * tied value nearest the anchor, so a gate only moves as far as the tune data
 * asks; without one, the middle of the widest run of tied values (max margin).
 */
async function sweep(
  values: number[],
  score: (v: number) => Promise<Score>,
  anchor?: number,
): Promise<number> {
  const scores: Score[] = [];
  for (const v of values) scores.push(await score(v));
  let best = scores[0]!;
  for (const s of scores) if (better(s, best)) best = s;
  if (anchor !== undefined) {
    let pick = values.find((_, i) => same(scores[i]!, best))!;
    for (const [i, v] of values.entries()) {
      if (same(scores[i]!, best) && Math.abs(v - anchor) < Math.abs(pick - anchor) - 1e-9) pick = v;
    }
    return pick;
  }
  let runStart = -1;
  let bestRun: [number, number] = [0, 0];
  for (let i = 0; i <= values.length; i++) {
    const ok = i < values.length && same(scores[i]!, best);
    if (ok && runStart < 0) runStart = i;
    if (!ok && runStart >= 0) {
      if (i - runStart > bestRun[1] - bestRun[0]) bestRun = [runStart, i];
      runStart = -1;
    }
  }
  return values[Math.floor((bestRun[0] + bestRun[1] - 1) / 2)]!;
}

async function coordinate<T extends Record<string, number>>(
  start: T,
  keys: Array<keyof T & string>,
  values: (key: keyof T & string) => number[],
  score: (t: T) => Promise<Score>,
): Promise<T> {
  let cur = { ...start };
  for (let pass = 0; pass < 3; pass++) {
    const before = JSON.stringify(cur);
    for (const k of keys) {
      const v = await sweep(values(k), (x) => score({ ...cur, [k]: x }), start[k]);
      cur = { ...cur, [k]: v };
    }
    if (JSON.stringify(cur) === before) break;
  }
  return cur;
}

const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`);

// ---------------------------------------------------------------------------
// Smart home. Cost: 4 per unsafe execution (executed when the label says do
// not) + 1 per other row that is not fully right (path + execute +
// device/action). Weighted rather than lexicographic: an unsafe row the gates
// cannot reach must not drive every threshold to "never execute".

type ShStats = { n: number; correct: number; unsafe: number; missed: number };

async function smarthomeStats(
  gates: SmarthomeGates,
  split: Split,
  evaluate: Evaluator,
): Promise<ShStats> {
  const st: ShStats = { n: 0, correct: 0, unsafe: 0, missed: 0 };
  for (const [i, c] of SMARTHOME_TUNING.entries()) {
    if (splitOf(i) !== split) continue;
    const out = await runSmarthome(c.utterance, defaultHome(), "system-one", undefined, evaluate, gates);
    st.n += 1;
    if (out.execute && !c.execute) st.unsafe += 1;
    if (!out.execute && c.execute) st.missed += 1;
    const ok =
      out.path === c.path &&
      out.execute === c.execute &&
      (c.device === undefined || out.intent.device === c.device) &&
      (c.action === undefined || out.intent.action === c.action);
    if (ok) st.correct += 1;
  }
  return st;
}

// Irreversible gates are policy (confirm before unlock / disarm), not fitted:
// the sets hold no labelled own-door unlocks to fit them on.
const SH_KEYS = ["allow", "confidence", "compound", "is_query", "whole_home"] as const;
const shTuned = await coordinate(
  DEFAULT_THRESHOLDS.smarthome,
  [...SH_KEYS],
  () => grid(0.05, 0.95, 0.05),
  async (g) => {
    const s = await smarthomeStats(g, "tune", embedded);
    return [-(4 * s.unsafe + (s.n - s.correct - s.unsafe))];
  },
);

// ---------------------------------------------------------------------------
// Cascade. Objective: fewest missed bad records (a wrong field flowing on
// unchecked costs more than one extra reasoner call), then fewest needless
// escalations.

type CaStats = { n: number; correct: number; missed: number; needless: number };

async function cascadeStats(gates: CascadeGates, split: Split, evaluate: Evaluator): Promise<CaStats> {
  const st: CaStats = { n: 0, correct: 0, missed: 0, needless: 0 };
  for (const [i, c] of CASCADE_TUNING.entries()) {
    if (splitOf(i) !== split) continue;
    const v = await verifyExtract(c.doc, c.record, "system-one", evaluate, gates);
    st.n += 1;
    if (v.escalate === c.escalate) st.correct += 1;
    else if (c.escalate) st.missed += 1;
    else st.needless += 1;
  }
  return st;
}

const caTuned: CascadeGates = {
  fire: await sweep(grid(0.3, 0.95, 0.01), async (fire) => {
    const s = await cascadeStats({ fire }, "tune", embedded);
    return [-(2 * s.missed + s.needless)];
  }),
};

// ---------------------------------------------------------------------------
// Consistency. Cost: 3 per wrong auto-pay (money out without review), 2 per
// wrong denial, 1 per other miss (sent to human review when the label was
// pay or deny).

type CoStats = { n: number; correct: number; wrongPay: number; wrongDeny: number };

async function consistencyStats(
  gates: ConsistencyGates,
  split: Split,
  evaluate: Evaluator,
): Promise<CoStats> {
  const st: CoStats = { n: 0, correct: 0, wrongPay: 0, wrongDeny: 0 };
  for (const [i, c] of CONSISTENCY_TUNING.entries()) {
    if (splitOf(i) !== split) continue;
    const out = await runConsistency("system-one", evaluate, c.claim, gates);
    st.n += 1;
    if (out.decision === c.decision) st.correct += 1;
    else if (out.decision === "pay") st.wrongPay += 1;
    else if (out.decision === "deny") st.wrongDeny += 1;
  }
  return st;
}

const coTuned = await coordinate(
  DEFAULT_THRESHOLDS.consistency,
  ["deny_min", "pay_min", "pay_max_deny", "pay_max_human"],
  () => grid(0.05, 0.95, 0.05),
  async (g) => {
    const s = await consistencyStats(g, "tune", embedded);
    return [-(3 * s.wrongPay + 2 * s.wrongDeny + (s.n - s.correct - s.wrongPay - s.wrongDeny))];
  },
);

// ---------------------------------------------------------------------------
// Gold odd half (never used by scripts/embed-fit.ts): where does a generic
// noul cut separate yes from no on this engine?

const goldRows: Array<{ p: number; y: 0 | 1 }> = [];
for (const [ci, g] of GOLD.entries()) {
  if (ci % 2 !== 1) continue;
  const out = await embedded({ state: g.state, questions: g.questions });
  for (const e of g.expect) {
    const exp = e.noul;
    if (!exp) continue;
    const y = exp.min != null && exp.min >= 0.5 ? 1 : exp.max != null && exp.max <= 0.5 ? 0 : null;
    const a = out.answers[exp.id] as NoulAnswer | undefined;
    if (y === null || a?.type !== "noul") continue;
    goldRows.push({ p: a.noul, y });
  }
}
const goldAcc = (t: number) => goldRows.filter((r) => (r.p > t ? 1 : 0) === r.y).length;
const goldBest = await sweep(grid(0.05, 0.95, 0.05), async (t) => [goldAcc(t)]);

// ---------------------------------------------------------------------------
// Report.

const tuned: CookbookThresholds = {
  smarthome: shTuned,
  cascade: caTuned,
  consistency: coTuned,
};
const D = DEFAULT_THRESHOLDS;
const rows: string[] = [];
const row = (...cells: Array<string | number>) => rows.push(`| ${cells.join(" | ")} |`);

rows.push("### Smart home (52 utterances: 26 tune, 26 held-out)", "");
rows.push("| Engine | Gates | Split | Fully right | Unsafe executions | Missed executions |");
rows.push("| --- | --- | --- | --- | --- | --- |");
for (const [label, ev, gates, gname] of [
  ["lexical", lexical, D.smarthome, "default"],
  ["embedding", embedded, D.smarthome, "default"],
  ["embedding", embedded, tuned.smarthome, "tuned"],
] as const) {
  for (const split of ["tune", "heldout"] as const) {
    const s = await smarthomeStats(gates, split, ev);
    row(label, gname, split, `${s.correct}/${s.n} (${pct(s.correct, s.n)})`, s.unsafe, s.missed);
  }
}
rows.push("", "### SDE cascade (20 records: 10 tune, 10 held-out)", "");
rows.push("| Engine | Fire threshold | Split | Right | Missed bad records | Needless escalations |");
rows.push("| --- | --- | --- | --- | --- | --- |");
for (const [label, ev, gates] of [
  ["lexical", lexical, D.cascade],
  ["embedding", embedded, D.cascade],
  ["embedding", embedded, tuned.cascade],
] as const) {
  for (const split of ["tune", "heldout"] as const) {
    const s = await cascadeStats(gates, split, ev);
    row(label, gates.fire, split, `${s.correct}/${s.n}`, s.missed, s.needless);
  }
}
rows.push("", "### Consistency (12 claims: 6 tune, 6 held-out)", "");
rows.push("| Engine | Gates | Split | Right | Wrong auto-pays | Wrong denials |");
rows.push("| --- | --- | --- | --- | --- | --- |");
for (const [label, ev, gates, gname] of [
  ["lexical", lexical, D.consistency, "default"],
  ["embedding", embedded, D.consistency, "default"],
  ["embedding", embedded, tuned.consistency, "tuned"],
] as const) {
  for (const split of ["tune", "heldout"] as const) {
    const s = await consistencyStats(gates, split, ev);
    row(label, gname, split, `${s.correct}/${s.n}`, s.wrongPay, s.wrongDeny);
  }
}
rows.push(
  "",
  `### Gold suite, odd half (${goldRows.length} noul assertions, not used to fit the engine)`,
  "",
  "| Noul cut | Accuracy |",
  "| --- | --- |",
);
for (const t of [...new Set([0.5, 0.7, goldBest])].sort((a, b) => a - b)) {
  row(t === goldBest ? `${t} (best)` : t, `${goldAcc(t)}/${goldRows.length} (${pct(goldAcc(t), goldRows.length)})`);
}

const valuesTable = [
  "| Gate | Default (hand-set) | Embedding (tuned) |",
  "| --- | --- | --- |",
  ...(Object.keys(D.smarthome) as Array<keyof SmarthomeGates>).map(
    (k) => `| smarthome.${k} | ${D.smarthome[k]} | ${tuned.smarthome[k]} |`,
  ),
  `| cascade.fire | ${D.cascade.fire} | ${tuned.cascade.fire} |`,
  ...(Object.keys(D.consistency) as Array<keyof ConsistencyGates>).map(
    (k) => `| consistency.${k} | ${D.consistency[k]} | ${tuned.consistency[k]} |`,
  ),
];

const report = [
  `Engine: embedding ${engineVersion}. Generated by scripts/cookbook-thresholds.ts.`,
  "",
  ...valuesTable,
  "",
  ...rows,
].join("\n");
console.log(report);

if (WRITE) {
  const tPath = join(root, "src/lib/jev/cookbooks/thresholds.ts");
  const src = readFileSync(tPath, "utf8");
  const begin = "// BEGIN EMBEDDING_THRESHOLDS (generated by scripts/cookbook-thresholds.ts)";
  const end = "// END EMBEDDING_THRESHOLDS";
  const i = src.indexOf(begin);
  const j = src.indexOf(end);
  if (i < 0 || j < 0) throw new Error("threshold markers not found in thresholds.ts");
  const S = tuned.smarthome;
  const C = tuned.consistency;
  const block = `${begin}
export const EMBEDDING_THRESHOLDS_FITTED_ON = ${JSON.stringify(engineVersion)};
export const EMBEDDING_THRESHOLDS: CookbookThresholds = {
  smarthome: {
    allow: ${S.allow},
    allow_irreversible: ${S.allow_irreversible},
    confidence: ${S.confidence},
    confidence_irreversible: ${S.confidence_irreversible},
    compound: ${S.compound},
    is_query: ${S.is_query},
    whole_home: ${S.whole_home},
  },
  cascade: { fire: ${tuned.cascade.fire} },
  consistency: {
    deny_min: ${C.deny_min},
    pay_min: ${C.pay_min},
    pay_max_deny: ${C.pay_max_deny},
    pay_max_human: ${C.pay_max_human},
  },
};
`;
  writeFileSync(tPath, src.slice(0, i) + block + src.slice(j));

  const dPath = join(root, "docs/COOKBOOK-THRESHOLDS.md");
  const doc = readFileSync(dPath, "utf8");
  const dBegin = "<!-- BEGIN GENERATED -->";
  const dEnd = "<!-- END GENERATED -->";
  const a = doc.indexOf(dBegin);
  const b = doc.indexOf(dEnd);
  if (a < 0 || b < 0) throw new Error("generated markers not found in docs/COOKBOOK-THRESHOLDS.md");
  writeFileSync(dPath, `${doc.slice(0, a)}${dBegin}\n${report}\n${doc.slice(b)}`);
  console.log("\nwrote src/lib/jev/cookbooks/thresholds.ts and docs/COOKBOOK-THRESHOLDS.md");
}
