/**
 * Flatten OpenJev answers into JSON a model or a log can read, and grade them
 * against expectations. Pure: no I/O, no AI SDK imports.
 */
import type { Questions, SystemOneResult } from "@openjev/sdk";

/** Reserved label an abstaining Choice returns. */
export const NONE_LABEL = "__none__";

export type AbstainReason = "out_of_scope" | "low_confidence";

/** One answer as returned by `@openjev/sdk`. */
export type AnyAnswer = SystemOneResult<Questions>["answers"][string];

/** One answer, flattened to JSON a model (or a log) can read. */
export interface DecisionSummary {
  readonly type: "choice" | "score" | "noul";
  /** Choice label, expected score, or yes/no. `null` when the answer abstained. */
  readonly answer: string | number | boolean | null;
  readonly confidence: number;
  /** Choice labels, score levels, or `"true"`/`"false"` for Noul. */
  readonly probabilities: Readonly<Record<string, number>>;
  readonly abstained: boolean;
  readonly abstain_reason?: AbstainReason;
  readonly escalated: boolean;
  readonly calibrated: boolean;
  readonly ood?: number;
}

export interface DecisionOutput {
  readonly model: string;
  readonly answers: Readonly<Record<string, DecisionSummary>>;
  /** Question ids the `auto` model re-asked to an LLM. */
  readonly escalated: readonly string[];
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

type Trust = Pick<
  DecisionSummary,
  "abstained" | "abstain_reason" | "escalated" | "calibrated" | "ood"
>;

function trust(a: AnyAnswer): Trust {
  return {
    abstained: a.abstained === true,
    ...(a.abstain_reason ? { abstain_reason: a.abstain_reason } : {}),
    escalated: a.escalated === true,
    calibrated: a.calibrated === true,
    ...(typeof a.ood === "number" ? { ood: a.ood } : {}),
  };
}

export function toNumberRecord(obj: object): Record<string, number> {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [String(k), Number(v)]));
}

/** Flatten any answer into a JSON-safe summary. */
export function summarize(a: AnyAnswer): DecisionSummary {
  const t = trust(a);
  if (a.type === "noul") {
    const p = clamp01(a.noul);
    return {
      type: "noul",
      answer: t.abstained ? null : p >= 0.5,
      confidence: Math.max(p, 1 - p),
      probabilities: { true: p, false: 1 - p },
      ...t,
    };
  }
  if (a.type === "choice") {
    const abstained = t.abstained || a.choice === NONE_LABEL;
    return {
      type: "choice",
      answer: abstained ? null : a.choice,
      confidence: a.confidence,
      probabilities: toNumberRecord(a.probabilities),
      ...t,
      abstained,
    };
  }
  return {
    type: "score",
    answer: t.abstained ? null : a.score,
    confidence: a.confidence,
    probabilities: toNumberRecord(a.probabilities),
    ...t,
  };
}

export function toOutput(result: SystemOneResult<Questions>): DecisionOutput {
  const answers = Object.fromEntries(
    Object.entries(result.answers).map(([id, a]) => [id, summarize(a as AnyAnswer)]),
  );
  return { model: result.model, answers, escalated: result.escalation?.escalated ?? [] };
}

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

/** What a passing answer looks like for one question. */
export type Expectation =
  | { readonly id: string; readonly equals: boolean }
  | { readonly id: string; readonly oneOf: readonly string[] }
  | { readonly id: string; readonly atLeast: number }
  | { readonly id: string; readonly atMost: number };

export interface Evaluation {
  readonly pass: boolean;
  /** Lowest confidence among the checked answers (0 when any abstained or is missing). */
  readonly score: number;
  readonly reasons: readonly string[];
  readonly answers: Readonly<Record<string, DecisionSummary>>;
}

function checkExpectation(e: Expectation, s: DecisionSummary): string | null {
  if (s.answer === null) return `${e.id}: abstained (${s.abstain_reason ?? "no answer"})`;
  if ("equals" in e) {
    return s.answer === e.equals ? null : `${e.id}: expected ${e.equals}, got ${String(s.answer)}`;
  }
  if ("oneOf" in e) {
    return typeof s.answer === "string" && e.oneOf.includes(s.answer)
      ? null
      : `${e.id}: expected one of ${e.oneOf.join(", ")}, got ${String(s.answer)}`;
  }
  const value = Number(s.answer);
  if ("atLeast" in e) {
    return value >= e.atLeast ? null : `${e.id}: expected at least ${e.atLeast}, got ${value}`;
  }
  return value <= e.atMost ? null : `${e.id}: expected at most ${e.atMost}, got ${value}`;
}

/** Grade decision answers against expectations. */
export function grade(
  answers: Readonly<Record<string, DecisionSummary>>,
  expect: readonly Expectation[],
  minConfidence = 0,
): Evaluation {
  const reasons: string[] = [];
  let lowest = 1;
  for (const e of expect) {
    const s = answers[e.id];
    if (!s) {
      reasons.push(`${e.id}: no answer returned`);
      lowest = 0;
      continue;
    }
    lowest = Math.min(lowest, s.answer === null ? 0 : s.confidence);
    const failure = checkExpectation(e, s);
    if (failure) reasons.push(failure);
    else if (s.confidence < minConfidence) {
      reasons.push(`${e.id}: confidence ${s.confidence.toFixed(2)} below ${minConfidence}`);
    }
  }
  return { pass: reasons.length === 0, score: expect.length ? lowest : 0, reasons, answers };
}
