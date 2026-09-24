/**
 * Per-customer calibration fitting + threshold selection (pure, no I/O).
 *
 * A customer uploads labelled examples; each example is answered by a model and
 * graded, producing `(confidence, correct)` samples per question. From those we
 * fit a monotone map `raw confidence -> calibrated probability of being right`:
 *
 *  - TEMPERATURE scaling: one scalar T on the confidence logit,
 *    p = sigmoid(logit(c) / T), chosen to minimise negative log-likelihood.
 *    Robust with few labels (1 parameter), cannot fix non-monotone shape.
 *  - ISOTONIC regression (Pool Adjacent Violators): a free-form non-decreasing
 *    step map, interpolated between block centroids. Needs more labels but fixes
 *    any monotone miscalibration.
 *  - AUTO: isotonic when a question has >= ISOTONIC_MIN_SAMPLES labels, else
 *    temperature.
 *
 * Also computes coverage/precision curves over confidence thresholds so a
 * product owner can pick "answer automatically above t, escalate below".
 */
import { buildReliability, type CalibrationReport, type CalPrediction } from "./calibration.ts";

export type CalibrationMethod = "temperature" | "isotonic";
export type CalibrationMethodChoice = CalibrationMethod | "auto";

/** One graded sample: model confidence and whether the answer was right. */
export type CalSample = { confidence: number; correct: boolean };

export type TemperatureMap = { method: "temperature"; temperature: number };
export type IsotonicMap = {
  method: "isotonic";
  /** Non-decreasing interpolation knots [x, y], x ascending, pinned at 0 and 1. */
  knots: Array<[number, number]>;
};
export type QuestionCalibrationMap = TemperatureMap | IsotonicMap;

/** Labels at which AUTO switches from temperature to isotonic. */
export const ISOTONIC_MIN_SAMPLES = 50;
/** Minimum labelled samples per question to fit anything at all. */
export const MIN_SAMPLES_PER_QUESTION = 10;

const EPS = 1e-4;

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

function round4(x: number): number {
  return Math.round(x * 1e4) / 1e4;
}

function logit(p: number): number {
  const c = Math.min(1 - EPS, Math.max(EPS, p));
  return Math.log(c / (1 - c));
}

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

/** Mean negative log-likelihood of `samples` under temperature T. */
function nll(samples: readonly CalSample[], t: number): number {
  let sum = 0;
  for (const s of samples) {
    const p = Math.min(1 - EPS, Math.max(EPS, sigmoid(logit(s.confidence) / t)));
    sum += s.correct ? -Math.log(p) : -Math.log(1 - p);
  }
  return sum / Math.max(1, samples.length);
}

/**
 * Fit temperature by golden-section search over log T in [0.05, 20]. NLL in
 * log T is unimodal for this 1-parameter family, so golden section converges.
 */
export function fitTemperature(samples: readonly CalSample[]): TemperatureMap {
  if (samples.length === 0) return { method: "temperature", temperature: 1 };
  let lo = Math.log(0.05);
  let hi = Math.log(20);
  const g = (Math.sqrt(5) - 1) / 2;
  let a = hi - g * (hi - lo);
  let b = lo + g * (hi - lo);
  let fa = nll(samples, Math.exp(a));
  let fb = nll(samples, Math.exp(b));
  for (let i = 0; i < 80; i++) {
    if (fa < fb) {
      hi = b;
      b = a;
      fb = fa;
      a = hi - g * (hi - lo);
      fa = nll(samples, Math.exp(a));
    } else {
      lo = a;
      a = b;
      fa = fb;
      b = lo + g * (hi - lo);
      fb = nll(samples, Math.exp(b));
    }
  }
  return { method: "temperature", temperature: round4(Math.exp((lo + hi) / 2)) };
}

type Block = { y: number; w: number; xsum: number };

/** Pool Adjacent Violators over samples sorted by confidence. */
function pava(samples: readonly CalSample[]): Block[] {
  const sorted = [...samples].sort((p, q) => p.confidence - q.confidence);
  const blocks: Block[] = [];
  for (const s of sorted) {
    blocks.push({ y: s.correct ? 1 : 0, w: 1, xsum: clamp01(s.confidence) });
    while (blocks.length >= 2) {
      const last = blocks[blocks.length - 1]!;
      const prev = blocks[blocks.length - 2]!;
      // Pool ties too, so runs of equal outcomes form one block (the shrinkage
      // below then uses the whole run's count, not one pseudo-count per sample).
      if (prev.y < last.y) break;
      const w = prev.w + last.w;
      blocks.splice(blocks.length - 2, 2, {
        y: (prev.y * prev.w + last.y * last.w) / w,
        w,
        xsum: prev.xsum + last.xsum,
      });
    }
  }
  return blocks;
}

/** Fit an isotonic map; knots at block centroids, pinned at x=0 and x=1. */
export function fitIsotonic(samples: readonly CalSample[]): IsotonicMap {
  if (samples.length === 0) {
    return { method: "isotonic", knots: [[0, 0], [1, 1]] };
  }
  const blocks = pava(samples);
  const knots: Array<[number, number]> = [];
  for (const b of blocks) {
    const x = round4(b.xsum / b.w);
    // Shrink each block's accuracy toward 0.5 by one pseudo-count per side so a
    // tiny all-correct block does not map to a literal 1.0 (or 0.0).
    const y = round4((b.y * b.w + 0.5) / (b.w + 1));
    const last = knots[knots.length - 1];
    if (last && last[0] === x) {
      last[1] = Math.max(last[1], y);
    } else {
      knots.push([x, Math.max(y, last ? last[1] : 0)]);
    }
  }
  const first = knots[0]!;
  if (first[0] > 0) knots.unshift([0, first[1]]);
  const end = knots[knots.length - 1]!;
  if (end[0] < 1) knots.push([1, end[1]]);
  return { method: "isotonic", knots };
}

/** Apply a fitted map to one raw confidence. */
export function applyCalibrationMap(map: QuestionCalibrationMap, confidence: number): number {
  const c = clamp01(confidence);
  if (map.method === "temperature") {
    const t = map.temperature > 0 ? map.temperature : 1;
    return round4(clamp01(sigmoid(logit(c) / t)));
  }
  const k = map.knots;
  if (k.length === 0) return c;
  if (c <= k[0]![0]) return k[0]![1];
  for (let i = 1; i < k.length; i++) {
    const [x1, y1] = k[i]!;
    const [x0, y0] = k[i - 1]!;
    if (c <= x1) {
      const t = x1 === x0 ? 1 : (c - x0) / (x1 - x0);
      return round4(y0 + t * (y1 - y0));
    }
  }
  return k[k.length - 1]![1];
}

/** Fit one question's map with the requested (or auto-selected) method. */
export function fitQuestion(
  samples: readonly CalSample[],
  method: CalibrationMethodChoice = "auto",
): QuestionCalibrationMap {
  const chosen: CalibrationMethod =
    method === "auto"
      ? samples.length >= ISOTONIC_MIN_SAMPLES
        ? "isotonic"
        : "temperature"
      : method;
  return chosen === "isotonic" ? fitIsotonic(samples) : fitTemperature(samples);
}

function toPreds(samples: readonly CalSample[], qid: string): CalPrediction[] {
  return samples.map((s, i) => ({
    caseId: `s${i}`,
    questionId: qid,
    qtype: "choice",
    features: [],
    confidence: clamp01(s.confidence),
    correct: s.correct,
    soft: false,
  }));
}

/** Reliability before and after applying `map` to `samples`. */
export function calibrationDelta(
  qid: string,
  samples: readonly CalSample[],
  map: QuestionCalibrationMap,
): { before: CalibrationReport; after: CalibrationReport } {
  const before = buildReliability(toPreds(samples, qid), 10);
  const after = buildReliability(
    toPreds(
      samples.map((s) => ({ ...s, confidence: applyCalibrationMap(map, s.confidence) })),
      qid,
    ),
    10,
  );
  return { before, after };
}

/** One point of the coverage/precision curve. */
export type ThresholdPoint = {
  threshold: number;
  /** Fraction of cases answered automatically (confidence >= threshold). */
  coverage: number;
  /** Accuracy among the automatically answered cases (null when none). */
  precision: number | null;
  /** Fraction escalated / abstained (1 - coverage). */
  escalated: number;
  answered: number;
};

/** Coverage/precision at thresholds 0.00, 0.05, ..., 1.00. */
export function thresholdCurve(samples: readonly CalSample[], step = 0.05): ThresholdPoint[] {
  const points: ThresholdPoint[] = [];
  const n = samples.length;
  const steps = Math.round(1 / step);
  for (let i = 0; i <= steps; i++) {
    const t = round4(i * step);
    let answered = 0;
    let correct = 0;
    for (const s of samples) {
      if (s.confidence >= t) {
        answered += 1;
        if (s.correct) correct += 1;
      }
    }
    const coverage = n ? answered / n : 0;
    points.push({
      threshold: t,
      coverage: round4(coverage),
      precision: answered ? round4(correct / answered) : null,
      escalated: round4(1 - coverage),
      answered,
    });
  }
  return points;
}

/**
 * The lowest threshold whose precision meets `targetPrecision` (maximising
 * coverage at that precision), or null when no threshold reaches it.
 */
export function pickThreshold(
  curve: readonly ThresholdPoint[],
  targetPrecision: number,
): ThresholdPoint | null {
  for (const p of curve) {
    if (p.answered > 0 && p.precision !== null && p.precision >= targetPrecision) return p;
  }
  return null;
}

/** Map key used for the pooled fallback (questions without their own map). */
export const POOLED_KEY = "*";

/** Stored per-question maps of one calibration. */
export type CalibrationMaps = Record<string, QuestionCalibrationMap>;

/**
 * Rewrite answer confidences through a customer's calibration maps. Choice and
 * score answers get a calibrated `confidence` (the probability the answer is
 * right on THIS customer's data); a noul answer's yes-probability becomes the
 * calibrated probability that its chosen side is right. Questions without a map pass through.
 * Returns the new answers plus the ids that were remapped. Never mutates.
 */
export function applyCalibrationToAnswers<A extends { type: string }>(
  answers: Record<string, A>,
  maps: CalibrationMaps,
): { answers: Record<string, A>; applied: string[] } {
  const out: Record<string, A> = {};
  const applied: string[] = [];
  for (const [id, a] of Object.entries(answers)) {
    const map = maps[id] ?? maps[POOLED_KEY];
    if (!map) {
      out[id] = a;
      continue;
    }
    const rec = a as unknown as Record<string, unknown>;
    if (a.type === "noul" && typeof rec.noul === "number") {
      // Noul maps are fitted on P(chosen side) = max(noul, 1 - noul) and output
      // P(correct); the calibrated yes-probability follows from the side.
      const noul = rec.noul;
      const p = applyCalibrationMap(map, Math.max(noul, 1 - noul));
      const next = noul >= 0.5 ? p : 1 - p;
      out[id] = { ...a, noul: round4(next), calibrated: true };
      applied.push(id);
    } else if (typeof rec.confidence === "number") {
      out[id] = { ...a, confidence: applyCalibrationMap(map, rec.confidence), calibrated: true };
      applied.push(id);
    } else {
      out[id] = a;
    }
  }
  return { answers: out, applied };
}

// ─── Held-out evaluation ──────────────────────────────────────────────────────

/** Fraction of each question's labels held out to measure the fitted map. */
export const HELDOUT_FRACTION = 0.25;
/** Smallest held-out slice worth reporting on (below this we report in-sample). */
export const MIN_HELDOUT_SAMPLES = 5;
/** Held-out size at which the threshold curve is drawn on held-out data. */
export const MIN_HELDOUT_FOR_CURVE = 20;

/** Deterministic 32-bit hash of a string (FNV-1a), used to seed the split. */
function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: small, fast, deterministic PRNG in [0, 1). */
function prng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

export type TrainHeldoutSplit = {
  train: CalSample[];
  heldout: CalSample[];
  /** "held_out" when a real split was made, "in_sample" when too few labels. */
  evaluation: "held_out" | "in_sample";
};

/**
 * Deterministic, stratified train / held-out split. Correct and wrong samples
 * are shuffled separately (seeded by `seed`, e.g. the calibration id + question
 * id) and `HELDOUT_FRACTION` of each goes to held-out, so a small held-out
 * slice still contains both outcomes. When the held-out slice would be smaller
 * than `MIN_HELDOUT_SAMPLES`, or the train slice smaller than `minTrain`, no
 * split is made: train = held-out = all samples, flagged "in_sample".
 */
export function splitTrainHeldout(
  samples: readonly CalSample[],
  seed: string,
  minTrain = MIN_SAMPLES_PER_QUESTION,
): TrainHeldoutSplit {
  const heldoutN = Math.floor(samples.length * HELDOUT_FRACTION);
  if (heldoutN < MIN_HELDOUT_SAMPLES || samples.length - heldoutN < minTrain) {
    return { train: [...samples], heldout: [...samples], evaluation: "in_sample" };
  }
  const rand = prng(hashSeed(seed));
  const right = shuffled(samples.filter((s) => s.correct), rand);
  const wrong = shuffled(samples.filter((s) => !s.correct), rand);
  // Allocate held-out slots proportionally, rounding so the total is exact.
  let rightHeld = Math.round((right.length / samples.length) * heldoutN);
  rightHeld = Math.min(right.length, Math.max(0, rightHeld));
  let wrongHeld = heldoutN - rightHeld;
  if (wrongHeld > wrong.length) {
    wrongHeld = wrong.length;
    rightHeld = heldoutN - wrongHeld;
  }
  return {
    train: [...right.slice(rightHeld), ...wrong.slice(wrongHeld)],
    heldout: [...right.slice(0, rightHeld), ...wrong.slice(0, wrongHeld)],
    evaluation: "held_out",
  };
}
