/**
 * Reproducible leaderboard harness (pure: backends are injected as runners).
 *
 * Every model is scored on the SAME public, in-repo data:
 *   - the gold suite (src/lib/jev/gold/*): accuracy, strict pass rate, and
 *     calibration (ECE, Brier) of reported confidence against correctness;
 *   - the out-of-scope probe set (gold/ood.ts): how often the model admits it
 *     does not know (confidence < 0.5 or `abstained`) and how often it is
 *     confidently wrong (confidence >= 0.9) on inputs it should not judge.
 *
 * `scripts/leaderboard.mjs` wires real backends in and writes the result to
 * src/lib/content/leaderboard.json, which the /leaderboard page renders.
 */
import { buildReliability, type CalPrediction } from "./calibration.ts";
import { evalGoldWith } from "./gold.ts";
import { OOD_CASES } from "./gold/ood.ts";
import {
  isOutOfScope,
  QUESTION_ID,
  toRequest,
  type DatasetExample,
  type LoadedDataset,
  type PublicDatasetId,
} from "./public-datasets.ts";
import { decisionConfidence, OOD_THRESHOLD } from "./scope.ts";
import type { SystemOneRequest, SystemOneResponse } from "./types.ts";

export type Runner = (req: SystemOneRequest) => Promise<SystemOneResponse | null>;

export type LeaderboardRow = {
  id: string;
  label: string;
  kind: "local" | "neural" | "llm" | "cascade" | "cloud" | "ablation";
  status: "ok" | "not_run";
  /** Why a row was not run (missing sidecar / key), when status is not_run. */
  reason?: string;
  gold?: {
    cases: number;
    strict_pass_rate: number;
    accuracy: number;
    avg_confidence: number;
    ece: number;
    brier: number;
  };
  ood?: {
    pairs: number;
    /** Share answered with confidence < 0.5 or abstained (higher is better). */
    flag_rate: number;
    /** Share answered with confidence >= 0.9 (lower is better). */
    confident_rate: number;
    mean_confidence: number;
  };
  latency_ms?: { p50: number; p95: number };
  errors?: number;
};

/** One backend's score on one public dataset. */
export type PublicTrackRow = {
  id: string;
  label: string;
  kind: LeaderboardRow["kind"];
  status: "ok" | "not_run";
  reason?: string;
  /** In-scope examples scored. */
  n?: number;
  accuracy?: number;
  ece?: number;
  brier?: number;
  avg_confidence?: number;
  /** Out-of-scope tracks only (CLINC150 oos). */
  ood?: {
    n: number;
    /** Share of OOS inputs flagged when the flag threshold lets 5% of in-scope inputs through as false alarms. */
    flag_rate_at_5_fpr: number;
    /** Threshold on the OOS score that yields 5% false positives on in-scope inputs. */
    threshold: number;
    /** Area under the ROC curve of the OOS score (0.5 = chance). */
    auroc: number;
    /**
     * AUROC of the backend's own `ood` field alone (missing = 0, abstained or
     * failed = 1), for backends that expose a dedicated detector.
     */
    auroc_ood_field: number;
    /** Share of OOS inputs answered at confidence 0.9+ without abstaining. */
    confident_rate: number;
    /**
     * The backend's own shipped decision rule, no test-set tuning: an answer
     * is flagged when its `ood` is at or above OOD_THRESHOLD (the abstention
     * threshold). Reports recall on OOS inputs and the false-alarm rate on
     * in-scope inputs.
     */
    at_shipped_threshold?: { threshold: number; flag_rate: number; false_positive_rate: number };
  };
  latency_ms?: { p50: number; p95: number };
  errors?: number;
};

export type PublicTrack = {
  id: PublicDatasetId;
  name: string;
  description: string;
  homepage: string;
  license: string;
  split: string;
  classes: number;
  /** Rows in the source split. */
  total: number;
  /** Rows scored (deterministic sample). */
  sampled: number;
  oos_sampled: number;
  rows: PublicTrackRow[];
};

export type LeaderboardFile = {
  generated_at: string;
  harness: string;
  /** How the default embedding engine was configured for this run. */
  embedding_engine?: { encoder: string; fitted_on: string } | { not_installed: string };
  datasets: { gold_cases: number; ood_pairs: number };
  rows: LeaderboardRow[];
  /** Standard public datasets (downloaded at run time, scores only committed). */
  public_tracks?: PublicTrack[];
};

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

/** Score one runner on gold + OOD. Never throws; failed calls count as errors. */
export async function scoreRunner(
  meta: Pick<LeaderboardRow, "id" | "label" | "kind">,
  runner: Runner,
): Promise<LeaderboardRow> {
  const latencies: number[] = [];
  let errors = 0;
  const timed: Runner = async (req) => {
    const t0 = performance.now();
    try {
      const out = await runner(req);
      if (!out) errors += 1;
      return out;
    } catch {
      errors += 1;
      return null;
    } finally {
      latencies.push(performance.now() - t0);
    }
  };

  const gold = await evalGoldWith(timed);
  const strictTotal = gold.passed + gold.failed;

  let pairs = 0;
  let flagged = 0;
  let confident = 0;
  let confSum = 0;
  for (const c of OOD_CASES) {
    const out = await timed({ state: c.state, questions: c.questions });
    for (const id of Object.keys(c.questions)) {
      const a = out?.answers[id];
      pairs += 1;
      if (!a) continue;
      const conf = decisionConfidence(a);
      confSum += conf;
      if (a.abstained || conf < 0.5) flagged += 1;
      if (!a.abstained && conf >= 0.9) confident += 1;
    }
  }

  const sorted = [...latencies].sort((a, b) => a - b);
  return {
    ...meta,
    status: "ok",
    gold: {
      cases: gold.caseCount,
      strict_pass_rate: r4(strictTotal ? gold.passed / strictTotal : 0),
      accuracy: gold.calibration.overallAccuracy,
      avg_confidence: gold.calibration.avgConfidence,
      ece: gold.calibration.ece,
      brier: gold.calibration.brier,
    },
    ood: {
      pairs,
      flag_rate: r4(pairs ? flagged / pairs : 0),
      confident_rate: r4(pairs ? confident / pairs : 0),
      mean_confidence: r4(pairs ? confSum / pairs : 0),
    },
    latency_ms: { p50: r4(percentile(sorted, 50)), p95: r4(percentile(sorted, 95)) },
    errors,
  };
}

export function notRun(
  meta: Pick<LeaderboardRow, "id" | "label" | "kind">,
  reason: string,
): LeaderboardRow {
  return { ...meta, status: "not_run", reason };
}

// ---------------------------------------------------------------------------
// Public-dataset tracks
// ---------------------------------------------------------------------------

/** False-positive rate on in-scope inputs at which OOS recall is reported. */
export const OOD_TARGET_FPR = 0.05;

/**
 * Out-of-scope score for one answer: 1 when abstained, else the larger of the
 * backend's `ood` score and (1 - confidence). Higher means "more likely OOS".
 */
export function oosScore(a: SystemOneResponse["answers"][string] | undefined): number {
  if (!a) return 1;
  if (a.abstained) return 1;
  return Math.max(typeof a.ood === "number" ? a.ood : 0, 1 - decisionConfidence(a));
}

/**
 * Flag rate on OOS inputs at a threshold chosen so at most `fpr` of in-scope
 * inputs are flagged (score strictly above the threshold counts as flagged).
 */
export function flagRateAtFpr(
  inScope: readonly number[],
  oos: readonly number[],
  fpr = OOD_TARGET_FPR,
): { rate: number; threshold: number } {
  if (oos.length === 0) return { rate: 0, threshold: 1 };
  const sorted = [...inScope].sort((a, b) => b - a);
  const allowed = Math.floor(fpr * sorted.length);
  // Threshold = the (allowed+1)-th highest in-scope score: at most `allowed` lie strictly above it.
  const threshold = sorted.length === 0 ? 0 : sorted[Math.min(allowed, sorted.length - 1)]!;
  const flagged = oos.filter((x) => x > threshold).length;
  return { rate: r4(flagged / oos.length), threshold: r4(threshold) };
}

/** Mann-Whitney AUROC of OOS scores (ties count half). */
export function auroc(inScope: readonly number[], oos: readonly number[]): number {
  if (inScope.length === 0 || oos.length === 0) return 0.5;
  let wins = 0;
  for (const o of oos) {
    for (const i of inScope) {
      if (o > i) wins += 1;
      else if (o === i) wins += 0.5;
    }
  }
  return r4(wins / (oos.length * inScope.length));
}

/** Score one runner on one loaded public dataset sample. Never throws. */
export async function scorePublicTrack(
  meta: Pick<PublicTrackRow, "id" | "label" | "kind">,
  runner: Runner,
  ds: LoadedDataset,
  sample: readonly DatasetExample[],
): Promise<PublicTrackRow> {
  const preds: CalPrediction[] = [];
  const inScopeScores: number[] = [];
  const oosScores: number[] = [];
  let oosConfident = 0;
  const inOodField: number[] = [];
  const oosOodField: number[] = [];
  const oodField = (a: SystemOneResponse["answers"][string] | undefined): number =>
    !a || a.abstained ? 1 : typeof a.ood === "number" ? a.ood : 0;
  let oosShipped = 0;
  let inShipped = 0;
  const shippedFlag = (a: SystemOneResponse["answers"][string] | undefined): boolean =>
    !a || Boolean(a.abstained) || (typeof a.ood === "number" && a.ood >= OOD_THRESHOLD);
  const latencies: number[] = [];
  let errors = 0;

  for (const [i, ex] of sample.entries()) {
    const t0 = performance.now();
    let out: SystemOneResponse | null = null;
    try {
      out = await runner(toRequest(ds, ex));
    } catch {
      out = null;
    }
    latencies.push(performance.now() - t0);
    if (!out) errors += 1;
    const a = out?.answers[QUESTION_ID];
    const score = oosScore(a);
    if (isOutOfScope(ds, ex)) {
      oosScores.push(score);
      if (a && !a.abstained && decisionConfidence(a) >= 0.9) oosConfident += 1;
      if (shippedFlag(a)) oosShipped += 1;
      oosOodField.push(oodField(a));
      continue;
    }
    inScopeScores.push(score);
    if (shippedFlag(a)) inShipped += 1;
    inOodField.push(oodField(a));
    const correct = Boolean(a && a.type === "choice" && !a.abstained && a.choice === ex.label);
    preds.push({
      caseId: `${ds.spec.id}:${i}`,
      questionId: QUESTION_ID,
      qtype: "choice",
      features: [],
      confidence: a ? decisionConfidence(a) : 0,
      correct,
      soft: false,
    });
  }

  const cal = buildReliability(preds, 10);
  const sorted = [...latencies].sort((a, b) => a - b);
  const row: PublicTrackRow = {
    ...meta,
    status: "ok",
    n: preds.length,
    accuracy: cal.overallAccuracy,
    ece: cal.ece,
    brier: cal.brier,
    avg_confidence: cal.avgConfidence,
    latency_ms: { p50: r4(percentile(sorted, 50)), p95: r4(percentile(sorted, 95)) },
    errors,
  };
  if (ds.spec.oosLabel !== undefined) {
    const at = flagRateAtFpr(inScopeScores, oosScores);
    row.ood = {
      n: oosScores.length,
      flag_rate_at_5_fpr: at.rate,
      threshold: at.threshold,
      auroc: auroc(inScopeScores, oosScores),
      auroc_ood_field: auroc(inOodField, oosOodField),
      confident_rate: r4(oosScores.length ? oosConfident / oosScores.length : 0),
      at_shipped_threshold: {
        threshold: OOD_THRESHOLD,
        flag_rate: r4(oosScores.length ? oosShipped / oosScores.length : 0),
        false_positive_rate: r4(inScopeScores.length ? inShipped / inScopeScores.length : 0),
      },
    };
  }
  return row;
}
