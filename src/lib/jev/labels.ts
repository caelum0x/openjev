/**
 * Ground-truth labels for typed questions (pure, no I/O).
 *
 * Shared by per-customer calibration (grading labelled examples) and shadow
 * mode (comparing our answer with an incumbent LLM's answer). A label is the
 * natural value of each question type:
 *   - choice: the option key (string)
 *   - score:  the level index (integer 0..n-1)
 *   - noul:   a boolean (true = yes); 0/1 and "true"/"false"/"yes"/"no" accepted
 */
import { decisionConfidence } from "./scope.ts";
import type { Answer, Question } from "./types.ts";

export type LabelValue = string | number | boolean;

export class LabelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LabelError";
  }
}

/** Normalise and validate a raw label for question `q`. Throws LabelError. */
export function normalizeLabel(qid: string, q: Question, raw: unknown): LabelValue {
  if (q.type === "choice") {
    if (typeof raw !== "string" || !(raw in q.criteria)) {
      throw new LabelError(
        `Label for choice "${qid}" must be one of: ${Object.keys(q.criteria).join(", ")}.`,
      );
    }
    return raw;
  }
  if (q.type === "score") {
    const n = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n >= q.criteria.length) {
      throw new LabelError(
        `Label for score "${qid}" must be an integer level 0-${q.criteria.length - 1}.`,
      );
    }
    return n;
  }
  if (typeof raw === "boolean") return raw;
  if (raw === 1 || raw === 0) return raw === 1;
  if (typeof raw === "string") {
    const v = raw.trim().toLowerCase();
    if (["true", "yes", "1"].includes(v)) return true;
    if (["false", "no", "0"].includes(v)) return false;
  }
  throw new LabelError(`Label for noul "${qid}" must be true or false.`);
}

/** The discrete value an answer commits to (comparable with a label). */
export function answerValue(a: Answer): LabelValue {
  if (a.type === "choice") return a.choice;
  if (a.type === "score") return Math.round(a.score);
  return a.noul >= 0.5;
}

/** Stable string form of a label/answer value (for storage and display). */
export function valueText(v: LabelValue): string {
  return typeof v === "string" ? v : String(v);
}

/**
 * Grade an answer against a label: correctness plus the answer's decision
 * confidence (see scope.ts `decisionConfidence`), ready for calibration fitting.
 */
export function gradeAnswer(a: Answer, label: LabelValue): { correct: boolean; confidence: number } {
  return { correct: answerValue(a) === label, confidence: decisionConfidence(a) };
}
