/**
 * Calibration drift detection (pure, no I/O).
 *
 * A calibration map promises "confidence c means right c of the time on YOUR
 * data". That promise decays when traffic changes. This module compares what a
 * calibration measured at fit time (its held-out after-metrics, the baseline)
 * with what recent traffic shows:
 *
 *   - accuracy_drop     observed accuracy fell more than `accuracy_drop` below
 *                       the baseline accuracy
 *   - confidence_shift  mean calibrated confidence moved more than
 *                       `confidence_shift` from the baseline mean confidence
 *                       (the input distribution changed)
 *   - overconfidence    mean confidence exceeds observed accuracy by more than
 *                       `calibration_gap` (the map no longer tells the truth)
 *
 * Observed "correct" comes from shadow traffic: agreement with a human label
 * (reference kind "label") or with the incumbent LLM (kind "llm", a proxy).
 * Questions with fewer than `min_samples` observations are reported as
 * "insufficient" and never alert.
 */

export type DriftBaseline = {
  accuracy: number;
  avgConfidence: number;
  n: number;
};

export type DriftObservation = {
  question_id: string;
  confidence: number;
  correct: boolean;
  reference: "label" | "llm";
};

export type DriftThresholds = {
  min_samples: number;
  accuracy_drop: number;
  confidence_shift: number;
  calibration_gap: number;
};

export const DEFAULT_DRIFT_THRESHOLDS: DriftThresholds = {
  min_samples: 30,
  accuracy_drop: 0.1,
  confidence_shift: 0.1,
  calibration_gap: 0.1,
};

export type DriftSignalKind = "accuracy_drop" | "confidence_shift" | "overconfidence";

export type DriftSignal = {
  kind: DriftSignalKind;
  observed: number;
  expected: number;
  delta: number;
  tolerance: number;
};

export type QuestionDrift = {
  question_id: string;
  status: "ok" | "drift" | "insufficient";
  n: number;
  /** Share of observations graded against human labels (vs the incumbent LLM). */
  label_share: number;
  baseline: DriftBaseline | null;
  observed: { accuracy: number; avgConfidence: number } | null;
  signals: DriftSignal[];
};

export type DriftReport = {
  status: "ok" | "drift" | "insufficient";
  drifted: string[];
  questions: QuestionDrift[];
  observations: number;
};

const round4 = (x: number) => Math.round(x * 1e4) / 1e4;

function inUnit(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 1;
}

/** Validate and fill drift thresholds from untrusted input. Throws on bad values. */
export function parseDriftThresholds(raw: unknown): DriftThresholds {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: DriftThresholds = { ...DEFAULT_DRIFT_THRESHOLDS };
  if (o.min_samples !== undefined) {
    const n = o.min_samples;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 5 || n > 100_000) {
      throw new RangeError("min_samples must be an integer between 5 and 100000.");
    }
    out.min_samples = n;
  }
  for (const key of ["accuracy_drop", "confidence_shift", "calibration_gap"] as const) {
    if (o[key] === undefined) continue;
    const v = o[key];
    if (!inUnit(v) || v <= 0) throw new RangeError(`${key} must be a number in (0, 1].`);
    out[key] = v;
  }
  return out;
}

/**
 * Compare recent observations with each question's baseline. A question with
 * no baseline of its own uses the pooled baseline under key "*" when present.
 */
export function detectDrift(
  baselines: Readonly<Record<string, DriftBaseline>>,
  observations: readonly DriftObservation[],
  thresholds: DriftThresholds,
): DriftReport {
  const byQ = new Map<string, DriftObservation[]>();
  for (const o of observations) {
    if (!inUnit(o.confidence)) continue;
    const list = byQ.get(o.question_id);
    if (list) list.push(o);
    else byQ.set(o.question_id, [o]);
  }
  const qids = new Set<string>([...Object.keys(baselines).filter((k) => k !== "*"), ...byQ.keys()]);
  const questions: QuestionDrift[] = [];
  for (const qid of [...qids].sort()) {
    const obs = byQ.get(qid) ?? [];
    const baseline = baselines[qid] ?? baselines["*"] ?? null;
    const n = obs.length;
    const labelShare = n ? obs.filter((o) => o.reference === "label").length / n : 0;
    if (n < thresholds.min_samples || !baseline) {
      questions.push({
        question_id: qid,
        status: "insufficient",
        n,
        label_share: round4(labelShare),
        baseline,
        observed: n
          ? {
              accuracy: round4(obs.filter((o) => o.correct).length / n),
              avgConfidence: round4(obs.reduce((s, o) => s + o.confidence, 0) / n),
            }
          : null,
        signals: [],
      });
      continue;
    }
    const accuracy = obs.filter((o) => o.correct).length / n;
    const avgConfidence = obs.reduce((s, o) => s + o.confidence, 0) / n;
    const signals: DriftSignal[] = [];
    const accDrop = baseline.accuracy - accuracy;
    if (accDrop > thresholds.accuracy_drop) {
      signals.push({
        kind: "accuracy_drop",
        observed: round4(accuracy),
        expected: round4(baseline.accuracy),
        delta: round4(accDrop),
        tolerance: thresholds.accuracy_drop,
      });
    }
    const shift = avgConfidence - baseline.avgConfidence;
    if (Math.abs(shift) > thresholds.confidence_shift) {
      signals.push({
        kind: "confidence_shift",
        observed: round4(avgConfidence),
        expected: round4(baseline.avgConfidence),
        delta: round4(shift),
        tolerance: thresholds.confidence_shift,
      });
    }
    const gap = avgConfidence - accuracy;
    if (gap > thresholds.calibration_gap) {
      signals.push({
        kind: "overconfidence",
        observed: round4(avgConfidence),
        expected: round4(accuracy),
        delta: round4(gap),
        tolerance: thresholds.calibration_gap,
      });
    }
    questions.push({
      question_id: qid,
      status: signals.length ? "drift" : "ok",
      n,
      label_share: round4(labelShare),
      baseline,
      observed: { accuracy: round4(accuracy), avgConfidence: round4(avgConfidence) },
      signals,
    });
  }
  const drifted = questions.filter((q) => q.status === "drift").map((q) => q.question_id);
  const anyEvaluated = questions.some((q) => q.status !== "insufficient");
  return {
    status: drifted.length ? "drift" : anyEvaluated ? "ok" : "insufficient",
    drifted,
    questions,
    observations: observations.length,
  };
}

/** Stable fingerprint of which questions drifted on which signals (for alert de-duplication). */
export function driftFingerprint(report: DriftReport): string {
  return report.questions
    .filter((q) => q.status === "drift")
    .map((q) => `${q.question_id}:${q.signals.map((s) => s.kind).sort().join("+")}`)
    .join("|");
}
