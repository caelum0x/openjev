/**
 * Turning typed judgments into decisions.
 *
 * Doctrine (from the TypeSafe docs and the "put it in the loop" pattern):
 * - Threshold on CONFIDENCE, not just the answer.
 * - Escalate the uncertain middle to a bigger model, a deterministic verifier,
 *   or a human.
 * - Require high confidence BEFORE anything irreversible.
 * - Keep policy explicit and raw judgments reusable: never bake thresholds into
 *   the question; apply them here so a weight change need not re-run inference.
 */

import type { Answer, ChoiceAnswer, NoulAnswer, ScoreAnswer } from './primitives.ts';

// ---- Verdict: the atomic output of a single-answer decision ----

export type Verdict<T extends string = string> = {
  /** The decided outcome, or 'escalate' when confidence is insufficient. */
  readonly outcome: T | 'escalate';
  /** True when the outcome is a committed decision (not an escalation). */
  readonly decided: boolean;
  /** The strength backing this verdict (probability or confidence, 0..1). */
  readonly strength: number;
  /** Human-facing one-liner for logs/audits. */
  readonly reason: string;
};

// ---- Single-answer deciders ----

/**
 * Resolve a Noul (yes/no probability) with an escalation band in the middle.
 * `yes` and `no` are probability thresholds; the gap between them escalates.
 * For an irreversible "yes", pass a high `yes` (e.g. 0.9).
 */
export function decideNoul(
  answer: NoulAnswer,
  opts: { yes?: number; no?: number } = {},
): Verdict<'yes' | 'no'> {
  const yes = opts.yes ?? 0.85;
  const no = opts.no ?? 0.15;
  const p = answer.noul;
  if (p >= yes)
    return { outcome: 'yes', decided: true, strength: p, reason: `p(yes)=${fmt(p)} >= ${yes}` };
  if (p <= no)
    return { outcome: 'no', decided: true, strength: 1 - p, reason: `p(yes)=${fmt(p)} <= ${no}` };
  return {
    outcome: 'escalate',
    decided: false,
    strength: 1 - Math.abs(p - 0.5) * 2,
    reason: `p(yes)=${fmt(p)} in (${no}, ${yes})`,
  };
}

/**
 * Resolve a Choice. Commits to the picked option only when confidence clears
 * `minConfidence`; otherwise escalates. Harmless preferences can use a low bar.
 */
export function decideChoice<T extends string = string>(
  answer: ChoiceAnswer,
  opts: { minConfidence?: number } = {},
): Verdict<T> {
  const min = opts.minConfidence ?? 0.85;
  if (answer.confidence >= min) {
    return {
      outcome: answer.choice as T,
      decided: true,
      strength: answer.confidence,
      reason: `choice=${answer.choice} conf=${fmt(answer.confidence)} >= ${min}`,
    };
  }
  return {
    outcome: 'escalate',
    decided: false,
    strength: answer.confidence,
    reason: `choice=${answer.choice} conf=${fmt(answer.confidence)} < ${min}`,
  };
}

/**
 * Resolve a Score against a threshold on the ordered scale.
 * `atOrAbove` is the score value (matching the level indices) that means "hot".
 */
export function decideScore(
  answer: ScoreAnswer,
  opts: { atOrAbove: number; minConfidence?: number },
): Verdict<'above' | 'below'> {
  const min = opts.minConfidence ?? 0;
  const hot = answer.score >= opts.atOrAbove;
  if (answer.confidence < min) {
    return {
      outcome: 'escalate',
      decided: false,
      strength: answer.confidence,
      reason: `score=${fmt(answer.score)} conf=${fmt(answer.confidence)} < ${min}`,
    };
  }
  return {
    outcome: hot ? 'above' : 'below',
    decided: true,
    strength: answer.confidence,
    reason: `score=${fmt(answer.score)} ${hot ? '>=' : '<'} ${opts.atOrAbove}`,
  };
}

/**
 * Composite score in code from independently-judged Score dimensions.
 * Weights are applied here (not in the model) so tuning them never re-runs
 * inference. Returns a 0..1 normalized value assuming each level scale shares
 * `maxLevel` (the top index). Pass per-dimension maxLevel if scales differ.
 */
export function compositeScore(
  dims: ReadonlyArray<{ answer: ScoreAnswer; weight: number; maxLevel?: number }>,
): { value: number; weightedSum: number; totalWeight: number } {
  let weightedSum = 0;
  let totalWeight = 0;
  for (const d of dims) {
    const max = d.maxLevel ?? topIndex(d.answer);
    const norm = max > 0 ? clamp01(d.answer.score / max) : 0;
    weightedSum += norm * d.weight;
    totalWeight += d.weight;
  }
  return {
    value: totalWeight > 0 ? weightedSum / totalWeight : 0,
    weightedSum,
    totalWeight,
  };
}

// ---- High-level typed-decision composition ----

/**
 * Per-field decision spec for a Noul answer.
 * `question` is the answer key in the `answers` map; defaults to the output field name.
 */
export interface NoulFieldSpec<T = 'yes' | 'no'> {
  readonly type: 'noul';
  /** Answer key in the systemOne response. Defaults to the output field name. */
  readonly question?: string;
  /** Probability threshold to commit 'yes' (default 0.85). */
  readonly yes?: number;
  /** Probability threshold to commit 'no' (default 0.15). */
  readonly no?: number;
  /**
   * Maps the 'yes' | 'no' outcome to an application-typed value.
   * Required when `T` differs from `'yes' | 'no'`.
   */
  readonly map?: (v: 'yes' | 'no') => T;
  /**
   * Value to use when the field escalates (confidence band too wide).
   * When provided, an escalated field is resolved and NOT counted as an escalation.
   */
  readonly fallback?: T;
}

/** Per-field decision spec for a Choice answer. */
export interface ChoiceFieldSpec<T = string> {
  readonly type: 'choice';
  readonly question?: string;
  /** Minimum confidence to commit the choice (default 0.85). */
  readonly minConfidence?: number;
  /**
   * Maps the selected choice key to an application-typed value.
   * Required when `T` differs from `string`.
   */
  readonly map?: (v: string) => T;
  readonly fallback?: T;
}

/** Per-field decision spec for a Score answer. */
export interface ScoreFieldSpec<T = 'above' | 'below'> {
  readonly type: 'score';
  readonly question?: string;
  /** Score value (inclusive) above which the outcome is 'above'. */
  readonly atOrAbove: number;
  /** Minimum confidence to commit (default 0). */
  readonly minConfidence?: number;
  /**
   * Maps the 'above' | 'below' outcome to an application-typed value.
   * Required when `T` differs from `'above' | 'below'`.
   */
  readonly map?: (v: 'above' | 'below') => T;
  readonly fallback?: T;
}

/** A per-field decision spec (union of the three answer types). */
export type FieldSpec<T = unknown> = NoulFieldSpec<T> | ChoiceFieldSpec<T> | ScoreFieldSpec<T>;

/**
 * Schema mapping each output field to a FieldSpec.
 * Each spec resolves one systemOne answer into one value of the output type.
 *
 * Typical usage:
 * ```ts
 * type Out = { isSpam: boolean; category: 'promo' | 'info' | 'other' };
 * const schema: DecisionSchema<Out> = {
 *   isSpam: { type: 'noul', map: v => v === 'yes' },
 *   category: { type: 'choice', minConfidence: 0.8, map: v => v as Out['category'], fallback: 'other' },
 * };
 * ```
 */
export type DecisionSchema<Out extends Record<string, unknown>> = {
  readonly [K in keyof Out]: FieldSpec<Out[K]>;
};

/** Output of `decide()`: resolved values, per-field verdicts, and escalation metadata. */
export interface DecisionResult<Out extends Record<string, unknown>> {
  /**
   * Resolved output. Fields that escalated and have no `fallback` are absent.
   * Check `allDecided` before relying on the value being complete.
   */
  readonly value: { readonly [K in keyof Out]?: Out[K] };
  /** Per-field Verdict — present for every key including escalations. */
  readonly verdicts: { readonly [K in keyof Out & string]: Verdict };
  /** True when every field committed to a decision (no escalations). */
  readonly allDecided: boolean;
  /** Output field names that escalated, in declaration order. */
  readonly escalations: ReadonlyArray<keyof Out & string>;
}

/**
 * Apply a DecisionSchema to a batch of systemOne answers, producing a typed
 * result object.
 *
 * For each field:
 * - Looks up the answer using `spec.question ?? fieldName`.
 * - Calls the appropriate `decideXxx` function.
 * - If decided: applies `spec.map` (if provided) and sets `value[field]`.
 * - If escalated with a `spec.fallback`: uses the fallback and does NOT list
 *   the field as an escalation.
 * - If escalated with no fallback: omits the field from `value` and adds its
 *   name to `escalations`.
 *
 * The `answers` record is typically `systemOneResponse.answers` but can be any
 * map of answer name -> Answer.
 */
export function decide<Out extends Record<string, unknown>>(
  answers: Readonly<Record<string, Answer>>,
  schema: DecisionSchema<Out>,
): DecisionResult<Out> {
  const value: Record<string, unknown> = {};
  const verdicts: Record<string, Verdict> = {};
  const escalations: string[] = [];

  for (const fieldName of Object.keys(schema)) {
    const spec = (schema as Record<string, FieldSpec>)[fieldName]!;
    const questionKey = spec.question ?? fieldName;
    const answer = answers[questionKey];

    if (answer === undefined) {
      const v: Verdict = {
        outcome: 'escalate',
        decided: false,
        strength: 0,
        reason: `no answer for question key "${questionKey}"`,
      };
      verdicts[fieldName] = v;
      if (spec.fallback !== undefined) {
        value[fieldName] = spec.fallback;
      } else {
        escalations.push(fieldName);
      }
      continue;
    }

    let verdict: Verdict;

    if (spec.type === 'noul') {
      if (answer.type !== 'noul') {
        verdict = {
          outcome: 'escalate',
          decided: false,
          strength: 0,
          reason: `type mismatch: spec=noul answer.type=${answer.type}`,
        };
      } else {
        const noulOpts: { yes?: number; no?: number } = {};
        if (spec.yes !== undefined) noulOpts.yes = spec.yes;
        if (spec.no !== undefined) noulOpts.no = spec.no;
        verdict = decideNoul(answer as NoulAnswer, noulOpts);
      }
    } else if (spec.type === 'choice') {
      if (answer.type !== 'choice') {
        verdict = {
          outcome: 'escalate',
          decided: false,
          strength: 0,
          reason: `type mismatch: spec=choice answer.type=${answer.type}`,
        };
      } else {
        const choiceOpts: { minConfidence?: number } = {};
        if (spec.minConfidence !== undefined) choiceOpts.minConfidence = spec.minConfidence;
        verdict = decideChoice(answer as ChoiceAnswer, choiceOpts);
      }
    } else {
      // score
      if (answer.type !== 'score') {
        verdict = {
          outcome: 'escalate',
          decided: false,
          strength: 0,
          reason: `type mismatch: spec=score answer.type=${answer.type}`,
        };
      } else {
        const s = spec as ScoreFieldSpec;
        const scoreOpts: { atOrAbove: number; minConfidence?: number } = {
          atOrAbove: s.atOrAbove,
        };
        if (s.minConfidence !== undefined) scoreOpts.minConfidence = s.minConfidence;
        verdict = decideScore(answer as ScoreAnswer, scoreOpts);
      }
    }

    verdicts[fieldName] = verdict;

    if (verdict.decided) {
      const raw = verdict.outcome;
      const mapped = spec.map ? (spec.map as (v: string) => unknown)(raw) : raw;
      value[fieldName] = mapped;
    } else if (spec.fallback !== undefined) {
      value[fieldName] = spec.fallback;
    } else {
      escalations.push(fieldName);
    }
  }

  return {
    value: value as { [K in keyof Out]?: Out[K] },
    verdicts: verdicts as { [K in keyof Out & string]: Verdict },
    allDecided: escalations.length === 0,
    escalations: escalations as ReadonlyArray<keyof Out & string>,
  };
}

/**
 * Merge additional fallbacks into an escalated result, filling any fields that
 * were absent due to escalation (fields that already have a value are left
 * untouched). Returns both the completed value and any fields that are still
 * unresolved after applying the fallbacks.
 *
 * @example
 * const { filled, stillEscalated } = withFallbacks(result, { category: 'other' });
 */
export function withFallbacks<Out extends Record<string, unknown>>(
  result: DecisionResult<Out>,
  fallbacks: { readonly [K in keyof Out]?: Out[K] },
): {
  readonly filled: { readonly [K in keyof Out]?: Out[K] };
  readonly stillEscalated: ReadonlyArray<keyof Out & string>;
} {
  const filled: Record<string, unknown> = { ...result.value };
  const stillEscalated: string[] = [];

  for (const fieldName of result.escalations as string[]) {
    const fb = (fallbacks as Record<string, unknown>)[fieldName];
    if (fb !== undefined) {
      filled[fieldName] = fb;
    } else {
      stillEscalated.push(fieldName);
    }
  }

  return {
    filled: filled as { [K in keyof Out]?: Out[K] },
    stillEscalated: stillEscalated as ReadonlyArray<keyof Out & string>,
  };
}

// ---- Utilities ----

function topIndex(answer: ScoreAnswer): number {
  const keys = Object.keys(answer.legend).map(Number).filter(Number.isFinite);
  return keys.length ? Math.max(...keys) : 0;
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function fmt(n: number): string {
  return n.toFixed(3);
}
