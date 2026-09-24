/**
 * Turn stored eval-run cases into graded calibration samples per question
 * (pure; shared by the calibration fitter and the evals threshold picker).
 */
import type { CalSample } from "./calibration-fit.ts";
import type { GoldExpect } from "./gold/types.ts";
import { decisionConfidence } from "./scope.ts";
import type { Answer } from "./types.ts";

export type GradedCase = { expected: GoldExpect[]; got: Record<string, Answer> };

export function evalRunSamples(cases: readonly GradedCase[]): Record<string, CalSample[]> {
  const samples: Record<string, CalSample[]> = {};
  const push = (qid: string, s: CalSample) => {
    samples[qid] = [...(samples[qid] ?? []), s];
  };
  for (const c of cases) {
    for (const exp of c.expected) {
      if (exp.choice) {
        const a = c.got[exp.choice.id];
        if (a?.type === "choice") {
          push(exp.choice.id, {
            confidence: decisionConfidence(a),
            correct: a.choice === exp.choice.value,
          });
        }
      } else if (exp.noul) {
        const a = c.got[exp.noul.id];
        if (a?.type === "noul") {
          const v = a.noul;
          const ok =
            (exp.noul.min == null || v >= exp.noul.min) &&
            (exp.noul.max == null || v <= exp.noul.max);
          push(exp.noul.id, { confidence: decisionConfidence(a), correct: ok });
        }
      } else if (exp.score) {
        const a = c.got[exp.score.id];
        if (a?.type === "score") {
          push(exp.score.id, {
            confidence: decisionConfidence(a),
            correct: a.score >= exp.score.min && a.score <= exp.score.max,
          });
        }
      }
    }
  }
  return samples;
}

/** All questions' samples pooled (for a run-level threshold). */
export function pooledSamples(byQuestion: Record<string, CalSample[]>): CalSample[] {
  return Object.values(byQuestion).flat();
}
