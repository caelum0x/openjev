/**
 * The `auto` cascade's decision logic (pure, no I/O).
 *
 * Given the local tier's answers, decide which questions to escalate to the LLM
 * and merge the LLM's answers back in. Kept separate from the I/O in
 * run.ts so the policy is unit-testable without sidecars or network.
 */
import { decisionConfidence, OOD_THRESHOLD } from "./scope.ts";
import type { Answer, SystemOneRequest } from "./types.ts";

/**
 * Default escalation threshold on decision confidence. Questions the local tier
 * answers with confidence below this (or that are out of scope) go to the LLM.
 * Override per deployment with `OTS_AUTO_ESCALATE_BELOW`, per request with
 * `escalate_below`, or per question with `questions.<id>.escalate_below`.
 */
export const DEFAULT_ESCALATE_BELOW = 0.6;

export function envEscalateBelow(): number {
  const raw =
    typeof process !== "undefined" ? Number(process.env?.OTS_AUTO_ESCALATE_BELOW) : Number.NaN;
  return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : DEFAULT_ESCALATE_BELOW;
}

export type EscalationPlan = {
  threshold: number;
  escalate: string[];
  keep: string[];
};

/** Which questions to escalate: low decision confidence, out of scope, or abstained. */
export function planEscalation(
  req: SystemOneRequest,
  answers: Record<string, Answer>,
  defaultThreshold = envEscalateBelow(),
): EscalationPlan {
  const threshold = req.escalate_below ?? defaultThreshold;
  const escalate: string[] = [];
  const keep: string[] = [];
  for (const [id, q] of Object.entries(req.questions)) {
    const a = answers[id];
    const t = q.escalate_below ?? threshold;
    const needs =
      !a ||
      a.abstained === true ||
      (typeof a.ood === "number" && a.ood >= OOD_THRESHOLD) ||
      decisionConfidence(a) < t;
    (needs ? escalate : keep).push(id);
  }
  return { threshold, escalate, keep };
}

/** The sub-request containing only the escalated questions. */
export function escalationRequest(req: SystemOneRequest, ids: readonly string[]): SystemOneRequest {
  const questions: SystemOneRequest["questions"] = {};
  for (const id of ids) {
    const q = req.questions[id];
    if (q) questions[id] = q;
  }
  return { state: req.state, questions };
}

/** Merge LLM answers over the local ones, marking each replaced answer. */
export function mergeEscalated(
  local: Record<string, Answer>,
  llm: Record<string, Answer>,
  ids: readonly string[],
): Record<string, Answer> {
  const out: Record<string, Answer> = { ...local };
  for (const id of ids) {
    const a = llm[id];
    if (a) out[id] = { ...a, escalated: true };
  }
  return out;
}
