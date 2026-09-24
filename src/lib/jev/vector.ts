import { expandTokens } from "./lexicon.ts";
import { stem } from "./stem.ts";

// Re-exported for backward compatibility: `stem` now lives in ./stem.ts so that
// vector.ts and lexicon.ts share ONE stemmer (see stem.ts for why).
export { stem };

const STOP = new Set([
  "the",
  "a",
  "an",
  "of",
  "and",
  "or",
  "to",
  "in",
  "on",
  "for",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "this",
  "that",
  "it",
  "as",
  "at",
  "by",
  "with",
  "from",
  "does",
  "do",
  "did",
  "how",
  "what",
  "which",
  "should",
  "would",
  "could",
  "i",
  "my",
  "we",
  "you",
  "your",
  "our",
  "me",
  "them",
  "they",
  "their",
  "its",
  "if",
  "yes",
  "can",
  "will",
  "just",
  "so",
  "but",
  "about",
  "into",
  "over",
  "after",
  "before",
  "than",
  "then",
  "too",
  "very",
  "also",
  "here",
  "there",
  "when",
  "where",
  "who",
  "whom",
  "has",
  "have",
  "had",
  "please",
]);

export function tokenize(text: string): string[] {
  const lowered = text.toLowerCase().replace(/[_/\\]+/g, " ");
  const raw = lowered.match(/[a-z0-9]+/g) ?? [];
  const tokens: string[] = [];
  for (const r of raw) {
    if (r.length < 2) continue;
    if (STOP.has(r)) continue;
    tokens.push(stem(r));
  }
  return tokens;
}

export type SparseVec = Map<string, number>;

export function bag(tokens: string[], expandedWeight = 0.42): SparseVec {
  const original = new Set(tokens);
  const all = expandTokens(tokens);
  const tf = new Map<string, number>();
  for (const t of all) {
    const w = original.has(t) ? 1 : expandedWeight;
    tf.set(t, (tf.get(t) ?? 0) + w);
  }
  // sublinear tf
  const out: SparseVec = new Map();
  for (const [k, v] of tf) {
    out.set(k, 1 + Math.log(v));
  }
  return out;
}

export function charNgrams(text: string, n = 3): SparseVec {
  const s = text.toLowerCase().replace(/\s+/g, " ").trim();
  const tf = new Map<string, number>();
  if (s.length < n) {
    if (s) tf.set(s, 1);
    return tf;
  }
  for (let i = 0; i <= s.length - n; i++) {
    const g = s.slice(i, i + n);
    if (g.trim().length === 0) continue;
    tf.set(g, (tf.get(g) ?? 0) + 1);
  }
  const out: SparseVec = new Map();
  for (const [k, v] of tf) out.set(k, 1 + Math.log(v));
  return out;
}

export function idfWeight(docs: SparseVec[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const d of docs) {
    for (const k of d.keys()) df.set(k, (df.get(k) ?? 0) + 1);
  }
  const n = Math.max(1, docs.length);
  const idf = new Map<string, number>();
  for (const [k, c] of df) {
    idf.set(k, Math.log((n + 1) / (c + 0.5)) + 0.2);
  }
  return idf;
}

export function applyIdf(vec: SparseVec, idf: Map<string, number>): SparseVec {
  const out: SparseVec = new Map();
  for (const [k, v] of vec) {
    out.set(k, v * (idf.get(k) ?? 1));
  }
  return out;
}

export function l2(vec: SparseVec): number {
  let s = 0;
  for (const v of vec.values()) s += v * v;
  return Math.sqrt(s);
}

export function cosine(a: SparseVec, b: SparseVec): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [k, v] of small) {
    const u = large.get(k);
    if (u) dot += v * u;
  }
  const d = l2(a) * l2(b);
  if (d === 0) return 0;
  return dot / d;
}

export function overlap(a: string[], b: Set<string>): number {
  if (a.length === 0 || b.size === 0) return 0;
  let hit = 0;
  const orig = new Set(a);
  for (const t of a) {
    if (b.has(t) && orig.has(t)) hit += 1;
    else if (b.has(t)) hit += 0.35;
  }
  return hit / Math.sqrt(a.length * b.size);
}

export function distinctive(optionTokens: string[][]): Set<string>[] {
  const df = new Map<string, number>();
  for (const toks of optionTokens) {
    const seen = new Set(toks);
    for (const t of seen) df.set(t, (df.get(t) ?? 0) + 1);
  }
  return optionTokens.map((toks) => {
    const set = new Set<string>();
    for (const t of toks) {
      if ((df.get(t) ?? 0) <= 1) set.add(t);
    }
    return set;
  });
}

export function softmax(logits: number[], temperature = 0.38): number[] {
  if (logits.length === 0) return [];
  const t = Math.max(0.12, temperature);
  const max = Math.max(...logits);
  const exps = logits.map((x) => Math.exp((x - max) / t));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map((e) => e / sum);
}

export function entropy(p: number[]): number {
  let h = 0;
  for (const x of p) {
    if (x > 1e-12) h -= x * Math.log(x);
  }
  return h;
}

/**
 * RAW confidence: how *peaked* the probability distribution is (entropy + margin
 * of the top-1 over top-2). This measures the shape of the distribution, NOT the
 * empirical accuracy of the decision — a flat distribution can still pick the
 * right option most of the time, and a peaked one can be confidently wrong.
 * `calibratedConfidence` below maps this raw signal onto observed accuracy.
 */
export function peakedConfidence(p: number[], blend = 0.55): number {
  const n = p.length;
  if (n <= 1) return 1;
  const h = entropy(p);
  const hmax = Math.log(n);
  const peaked = hmax === 0 ? 1 : 1 - h / hmax;
  const sorted = [...p].sort((a, b) => b - a);
  const margin = (sorted[0] ?? 0) - (sorted[1] ?? 0);
  const marginNorm = margin / (1 - 1 / n);
  const conf = blend * peaked + (1 - blend) * marginNorm;
  return clamp01(conf);
}

export type Qtype = "choice" | "score" | "noul";

/**
 * Fitted reliability map: raw peakedness-confidence -> observed accuracy, per
 * question type. Each entry is a set of interpolation knots [rawConfidence,
 * calibratedConfidence] produced by ISOTONIC regression (PAVA) over the gold
 * suite, so the mapping is monotonic non-decreasing and every reported number is
 * an empirically-grounded probability of being right rather than a distribution
 * shape statistic.
 *
 * These are BAKED constants (deterministic, no fit at runtime). To regenerate
 * after changing the engine, weights, or the gold set, run:
 *   OTS_CALIBRATION=identity node --experimental-strip-types scripts/fit-calibration.ts
 * and paste its `CALIBRATION_KNOTS` output below.
 *
 * Refit 2026-09-23 (system-one over 93 gold cases / 97 predictions, for the
 * fitted TEMP_SCHEDULE in engine.ts):
 *   choice: acc=0.875 rawAvgConf=0.817
 *   score:  acc=0.941 rawAvgConf=0.541 (engine was badly under-confident on score)
 *   noul:   acc=0.781 rawAvgConf=0.780
 */
const CALIBRATION_KNOTS: Record<Qtype, ReadonlyArray<readonly [number, number]>> = {
  choice: [[0, 0.6], [0.044, 0.6], [0.438, 0.714], [0.995, 0.9], [1, 1]],
  score: [[0, 0.75], [0.111, 0.75], [0.674, 1], [1, 1]],
  noul: [[0, 0.545], [0.405, 0.545], [0.952, 0.9], [1, 0.909]],
};

/** Linear interpolation over a sorted, monotonic knot table with flat clamps. */
function interpKnots(
  knots: ReadonlyArray<readonly [number, number]>,
  x: number,
): number {
  if (knots.length === 0) return x;
  const first = knots[0]!;
  if (x <= first[0]) return first[1];
  for (let i = 1; i < knots.length; i++) {
    const a = knots[i - 1]!;
    const b = knots[i]!;
    if (x <= b[0]) {
      const span = b[0] - a[0];
      if (span <= 0) return b[1];
      return a[1] + ((x - a[0]) / span) * (b[1] - a[1]);
    }
  }
  return knots[knots.length - 1]![1];
}

/**
 * Map a RAW peakedness-confidence onto the calibrated probability of being
 * correct for the given question type, using the fitted isotonic reliability
 * map. This is what Choice/Score confidences are reported through so that a
 * stated 0.8 means "right about 80% of the time", not "the distribution looks
 * 80% peaked".
 *
 * Setting OTS_CALIBRATION=identity disables the mapping (returns the raw value):
 * used only by scripts/fit-calibration.ts so the refit sees raw confidences and
 * does not stack a calibration on top of a calibration. Production leaves it
 * unset, so this is deterministic.
 */
export function calibratedConfidence(raw: number, qtype: Qtype): number {
  const r = clamp01(raw);
  if (
    typeof process !== "undefined" &&
    process.env?.OTS_CALIBRATION === "identity"
  ) {
    return r;
  }
  return clamp01(interpKnots(CALIBRATION_KNOTS[qtype], r));
}

export function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

export function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

export function bigrams(tokens: string[]): Set<string> {
  const s = new Set<string>();
  for (let i = 0; i < tokens.length - 1; i++) {
    s.add(`${tokens[i]}_${tokens[i + 1]}`);
  }
  return s;
}

export function bigramOverlap(a: string[], b: string[]): number {
  if (a.length < 2 || b.length < 2) return 0;
  const bs = bigrams(b);
  if (bs.size === 0) return 0;
  let hit = 0;
  const as = bigrams(a);
  for (const g of as) if (bs.has(g)) hit += 1;
  return hit / Math.sqrt(as.size * bs.size);
}

export function containsPhrase(haystack: string, needle: string): boolean {
  if (!needle) return false;
  return haystack.toLowerCase().includes(needle.toLowerCase());
}


