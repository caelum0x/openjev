/**
 * Co-location pattern for the TypeSafe decision layer.
 *
 * A `DecisionSpec` bundles the question definition (what to ask the model) with
 * the decision parameters (how to resolve the answer) into a single per-field
 * object. This lets you define both sides once, in the same place, and then:
 *
 *   1. Extract just the questions for the `systemOne` batch request.
 *   2. Pass the same spec to `decideWithSpec()` to resolve the answers.
 *
 * The underlying `decide()` in decide.ts also accepts raw `DecisionSchema` when
 * you prefer to separate the question and decision concerns.
 *
 * @example
 * ```ts
 * type Moderation = { isSpam: boolean; severity: 'low' | 'high' };
 *
 * const spec: DecisionSpec<Moderation> = {
 *   isSpam: {
 *     def: noul('Is this message unsolicited commercial content or abuse?'),
 *     type: 'noul', yes: 0.9, map: v => v === 'yes',
 *   },
 *   severity: {
 *     def: choice('Harm severity?', { low: 'Minor', high: 'Serious' }),
 *     type: 'choice', minConfidence: 0.8, map: v => v as 'low' | 'high', fallback: 'low',
 *   },
 * };
 *
 * const questions = buildQuestions(spec); // send to systemOne
 * const result = decideWithSpec(response.answers, spec);
 * ```
 */

import type { Question, NoulQuestion, ChoiceQuestion, ScoreQuestion, Answer } from './primitives.ts';
import type {
  NoulFieldSpec,
  ChoiceFieldSpec,
  ScoreFieldSpec,
  DecisionSchema,
  DecisionResult,
} from './decide.ts';
import { decide } from './decide.ts';

// ---- Per-field spec types (question definition + decision parameters) ----

/**
 * Noul spec: bundles the question definition with Noul decision parameters.
 * The `question` field in the base NoulFieldSpec is ignored here — the output
 * field name is always used as the question key.
 */
export interface NoulSpec<T = 'yes' | 'no'>
  extends Omit<NoulFieldSpec<T>, 'question'> {
  /** The NoulQuestion to include in the systemOne batch. */
  readonly def: NoulQuestion;
}

/**
 * Choice spec: bundles the question definition with Choice decision parameters.
 */
export interface ChoiceSpec<T = string>
  extends Omit<ChoiceFieldSpec<T>, 'question'> {
  /** The ChoiceQuestion to include in the systemOne batch. */
  readonly def: ChoiceQuestion;
}

/**
 * Score spec: bundles the question definition with Score decision parameters.
 */
export interface ScoreSpec<T = 'above' | 'below'>
  extends Omit<ScoreFieldSpec<T>, 'question'> {
  /** The ScoreQuestion to include in the systemOne batch. */
  readonly def: ScoreQuestion;
}

/** Any spec variant (union). */
export type AnySpec<T = unknown> = NoulSpec<T> | ChoiceSpec<T> | ScoreSpec<T>;

/**
 * A complete decision spec for output shape `Out`.
 * Each field co-locates its question definition and decision parameters.
 *
 * Output field names are used as question keys in both the systemOne request
 * and the answers lookup.
 */
export type DecisionSpec<Out extends Record<string, unknown>> = {
  readonly [K in keyof Out]: AnySpec<Out[K]>;
};

// ---- Helpers ----

/**
 * Extract the question map from a DecisionSpec for use in a `systemOne` call.
 * Keys match the output field names.
 *
 * @example
 * const res = await client.systemOne({ state, questions: buildQuestions(spec) });
 */
export function buildQuestions<Out extends Record<string, unknown>>(
  spec: DecisionSpec<Out>,
): Record<keyof Out & string, Question> {
  const result: Record<string, Question> = {};
  for (const [key, s] of Object.entries(spec)) {
    result[key] = (s as AnySpec).def;
  }
  return result as Record<keyof Out & string, Question>;
}

/**
 * Validate all questions embedded in a DecisionSpec.
 * Throws if any question would fail at request time (e.g. a choice with no
 * options, a score with fewer than 2 levels).
 *
 * Validate early — at startup or module load — rather than at request time.
 */
export function validateSpec<Out extends Record<string, unknown>>(
  spec: DecisionSpec<Out>,
): void {
  for (const [key, s] of Object.entries(spec)) {
    const q: Question = (s as AnySpec).def;

    if (q.type === 'choice') {
      const keys = Object.keys(q.criteria);
      if (keys.length === 0) {
        throw new Error(
          `DecisionSpec field "${key}": ChoiceQuestion has no option keys.`,
        );
      }
    }

    if (q.type === 'score') {
      if (q.criteria.length < 2) {
        throw new Error(
          `DecisionSpec field "${key}": ScoreQuestion has ${q.criteria.length} level(s); at least 2 required.`,
        );
      }
    }
  }
}

/**
 * Apply a DecisionSpec to a batch of systemOne answers.
 * Equivalent to `decide(answers, specToSchema(spec))` but without a separate
 * conversion step.
 *
 * Output field names are used as answer keys (each spec's question key is always
 * the field name when using DecisionSpec; use `decide()` directly for custom key
 * mappings).
 */
export function decideWithSpec<Out extends Record<string, unknown>>(
  answers: Readonly<Record<string, Answer>>,
  spec: DecisionSpec<Out>,
): DecisionResult<Out> {
  // AnySpec extends the corresponding FieldSpec minus `question`; adding the
  // field name as `question` makes it fully compatible with DecisionSchema.
  const schema: Record<string, unknown> = {};
  for (const [key, s] of Object.entries(spec)) {
    schema[key] = { ...(s as object), question: key };
  }
  return decide(answers, schema as DecisionSchema<Out>);
}
