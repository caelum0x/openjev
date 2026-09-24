/**
 * TypeSafe System One primitives.
 *
 * These are thin, immutable builders that produce the exact question shapes the
 * HTTP API (`POST /v1/systemone`) expects. They never mutate their inputs.
 *
 * Design rules (from the TypeSafe docs):
 * - Ask ONE narrow, coherent judgment per question.
 * - Put the judgment in `instructions`, the possible answers in `criteria`.
 * - Question IDs are for code; they are NOT sent to the model, so the meaning
 *   must live entirely inside instructions/criteria.
 * - Include a no-match outcome when nothing may fit.
 */

/** A value the API accepts as instructions/criteria: plain string or structured JSON. */
export type Instructions = string | Record<string, unknown> | unknown[];

/**
 * Trust options every question type accepts (OpenJev extensions).
 * - `abstain`: allow "I don't know" when the input is out of scope or unsure.
 * - `abstain_below`: confidence floor for abstention (0..1); implies `abstain`.
 * - `escalate_below`: `auto` model only, re-ask this question to an LLM below this confidence.
 */
export interface QuestionExtensions {
  readonly abstain?: boolean;
  readonly abstain_below?: number;
  readonly escalate_below?: number;
}

export interface NoulQuestion extends QuestionExtensions {
  readonly type: 'noul';
  readonly instructions: Instructions;
  /** Optional descriptions of what true/false mean. */
  readonly criteria?: { readonly true: string; readonly false: string };
}

export interface ChoiceQuestion extends QuestionExtensions {
  readonly type: 'choice';
  readonly instructions: Instructions;
  /** option key -> description (null when the key is self-explanatory). */
  readonly criteria: Readonly<Record<string, string | null>>;
}

export interface ScoreQuestion extends QuestionExtensions {
  readonly type: 'score';
  readonly instructions: Instructions;
  /** Ordered level descriptions, lowest to highest. Each must stand on its own. */
  readonly criteria: readonly string[];
}

export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;

// ---- Validation error ----

/** Thrown by builders and assertion helpers when inputs are structurally invalid. */
export class PrimitiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PrimitiveError';
  }
}

// ---- Builders (validate eagerly; never mutate inputs) ----

/**
 * Whether a condition holds. Returns the probability of "yes" (0..1).
 * A value near 0.5 means genuinely uncertain, NOT "medium intensity".
 */
export function noul(
  instructions: Instructions,
  criteria?: { true: string; false: string },
): NoulQuestion {
  return criteria ? { type: 'noul', instructions, criteria } : { type: 'noul', instructions };
}

/**
 * Pick one of a defined set. Accepts either a list of keys (self-explanatory)
 * or a map of key -> description. Always include a no-match key when nothing
 * may fit (e.g. `other`, `none`).
 *
 * Throws `PrimitiveError` when `options` is empty or any key is an empty string.
 */
export function choice(
  instructions: Instructions,
  options: readonly string[] | Readonly<Record<string, string | null>>,
): ChoiceQuestion {
  const criteria: Record<string, string | null> = {};
  if (Array.isArray(options)) {
    if ((options as readonly string[]).length === 0) {
      throw new PrimitiveError('choice() requires at least one option key.');
    }
    for (const key of options as readonly string[]) {
      if (typeof key !== 'string' || key.length === 0) {
        throw new PrimitiveError(
          `choice() option keys must be non-empty strings; got ${JSON.stringify(key)}.`,
        );
      }
      criteria[key] = null;
    }
  } else {
    const entries = Object.entries(options as Record<string, string | null>);
    if (entries.length === 0) {
      throw new PrimitiveError('choice() requires at least one option key.');
    }
    for (const [key, desc] of entries) {
      criteria[key] = desc;
    }
  }
  return { type: 'choice', instructions, criteria };
}

/**
 * Position along an ordered, described dimension. `levels` are lowest -> highest
 * and each must describe a concrete situation.
 *
 * Throws `PrimitiveError` when fewer than 2 levels are supplied.
 */
export function score(instructions: Instructions, levels: readonly string[]): ScoreQuestion {
  if (levels.length < 2) {
    throw new PrimitiveError(
      `score() requires at least 2 levels; got ${levels.length}. ` +
        'Each level should describe a concrete situation on the ordered scale.',
    );
  }
  return { type: 'score', instructions, criteria: [...levels] };
}

/**
 * Return a copy of `question` that may abstain ("I don't know") when the input
 * is out of scope, or when confidence falls below `below` (0..1). Never mutates.
 */
export function withAbstain<Q extends Question>(question: Q, below?: number): Q {
  if (below !== undefined && !(Number.isFinite(below) && below >= 0 && below <= 1)) {
    throw new PrimitiveError('withAbstain() threshold must be a number between 0 and 1.');
  }
  return below === undefined ? { ...question, abstain: true } : { ...question, abstain: true, abstain_below: below };
}

// ---- Response shapes (as returned by /v1/systemone) ----

/** Why an answer abstained. */
export type AbstainReason = 'out_of_scope' | 'low_confidence';

/** Trust fields any answer may carry (all optional on the wire). */
export interface AnswerTrust {
  /** Out-of-scope score: 0 = in scope, 1 = unrelated to the question. */
  readonly ood?: number;
  /** True when the question opted into abstention and the model abstained. */
  readonly abstained?: boolean;
  readonly abstain_reason?: AbstainReason;
  /** Probability mass on "none of the above" when abstaining. */
  readonly p_none?: number;
  /** True when a calibration map (`calibration_id`) rewrote the confidence. */
  readonly calibrated?: boolean;
  /** True when the `auto` model re-asked this question to an LLM. */
  readonly escalated?: boolean;
}

export interface NoulAnswer extends AnswerTrust {
  readonly type: 'noul';
  /** Probability of "yes" (0..1). */
  readonly noul: number;
}

export interface ChoiceAnswer extends AnswerTrust {
  readonly type: 'choice';
  /** The selected option key (`__none__` when the answer abstained). */
  readonly choice: string;
  /** Probability mass per option key. */
  readonly probabilities: Readonly<Record<string, number>>;
  /** Concentration of the distribution (0..1). NOT overall correctness. */
  readonly confidence: number;
}

export interface ScoreAnswer extends AnswerTrust {
  readonly type: 'score';
  /** Probability-weighted position across the levels. */
  readonly score: number;
  /** Index (as string) -> level description. */
  readonly legend: Readonly<Record<string, string>>;
  readonly probabilities: Readonly<Record<string, number>>;
  readonly confidence: number;
}

export type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

/** Set when the requested backend was unavailable and another one answered. */
export interface SystemOneFallback {
  readonly requested: string;
  readonly served: string;
  readonly reason: string;
  readonly detail: string;
}

/** Present on `auto` responses: which questions stayed local and which escalated. */
export interface SystemOneEscalation {
  readonly local_model: string;
  readonly escalated: readonly string[];
  readonly kept: readonly string[];
  readonly threshold: number;
  readonly provider: string | null;
  readonly llm_model: string | null;
  readonly needed?: readonly string[];
  readonly skipped_reason?: 'no_llm_configured' | 'rate_limited' | 'llm_error';
  readonly llm_usage?: { readonly input_tokens: number; readonly output_tokens: number };
}

/** Present when `calibration_id` was sent. */
export interface SystemOneCalibration {
  readonly id: string;
  readonly method: 'temperature' | 'isotonic';
  readonly questions: readonly string[];
  /** Set when the map was not applied (e.g. fitted on a different model). */
  readonly skipped_reason?: string;
}

export interface SystemOneResponse<K extends string = string> {
  readonly model: string;
  readonly answers: Readonly<Record<K, Answer>>;
  readonly usage?: { readonly input_tokens: number; readonly output_tokens: number };
  readonly latency_ms?: number;
  readonly fallback?: SystemOneFallback;
  readonly escalation?: SystemOneEscalation;
  readonly calibration?: SystemOneCalibration;
}

// ---- Type guards (typed output guarantees the interface, not truth) ----

export function isNoul(a: Answer): a is NoulAnswer {
  return a.type === 'noul';
}
export function isChoice(a: Answer): a is ChoiceAnswer {
  return a.type === 'choice';
}
export function isScore(a: Answer): a is ScoreAnswer {
  return a.type === 'score';
}

// ---- Assertion helpers (throw on type mismatch) ----

/** Assert `a` is a NoulAnswer; throws `PrimitiveError` otherwise. */
export function asNoul(a: Answer): NoulAnswer {
  if (!isNoul(a)) throw new PrimitiveError(`Expected a noul answer; got type="${a.type}".`);
  return a;
}

/** Assert `a` is a ChoiceAnswer; throws `PrimitiveError` otherwise. */
export function asChoice(a: Answer): ChoiceAnswer {
  if (!isChoice(a)) throw new PrimitiveError(`Expected a choice answer; got type="${a.type}".`);
  return a;
}

/** Assert `a` is a ScoreAnswer; throws `PrimitiveError` otherwise. */
export function asScore(a: Answer): ScoreAnswer {
  if (!isScore(a)) throw new PrimitiveError(`Expected a score answer; got type="${a.type}".`);
  return a;
}

// ---- Confidence helpers ----

/**
 * Calibrated noul confidence: distance of the probability from the maximally
 * uncertain 0.5, normalized to [0, 1].
 *
 * Returns 0 when p = 0.5 (total uncertainty) and 1 when p = 0 or p = 1.
 * Use this to decide whether to show a result or ask for human review.
 */
export function noulConf(a: NoulAnswer): number {
  return Math.abs(a.noul - 0.5) * 2;
}

/**
 * True when a Choice or Score answer's concentration meets or exceeds `threshold`
 * (default 0.85). Pass a lower bar for harmless soft preferences; raise it for
 * irreversible or high-stakes commits.
 */
export function isHighConfidence(a: ChoiceAnswer | ScoreAnswer, threshold = 0.85): boolean {
  return a.confidence >= threshold;
}

// ---- Fallback / default helpers ----
// These return a concrete value directly. Use decideXxx in decide.ts when you
// need the full Verdict shape (outcome + strength + reason + escalation tracking).

/**
 * Returns the chosen key when `a.confidence >= minConf`; otherwise returns `fallback`.
 *
 * @example
 * const label = choiceOrElse(answer, 0.8, 'unknown');
 */
export function choiceOrElse<T>(a: ChoiceAnswer, minConf: number, fallback: T): string | T {
  return a.confidence >= minConf ? a.choice : fallback;
}

/**
 * Returns `'yes'` when p(yes) >= `opts.yes` (default 0.85),
 * `'no'` when p(yes) <= `opts.no` (default 0.15), otherwise `fallback`.
 *
 * @example
 * const result = noulOrElse(answer, { yes: 0.9 }, 'review');
 */
export function noulOrElse<T>(
  a: NoulAnswer,
  opts: { yes?: number; no?: number },
  fallback: T,
): 'yes' | 'no' | T {
  const yesT = opts.yes ?? 0.85;
  const noT = opts.no ?? 0.15;
  if (a.noul >= yesT) return 'yes';
  if (a.noul <= noT) return 'no';
  return fallback;
}

/**
 * Returns `'above'` when `a.score >= atOrAbove` and `a.confidence >= minConf`,
 * `'below'` when score is below the threshold and confidence is sufficient,
 * otherwise `fallback`.
 *
 * `minConf` defaults to 0 (any confidence). Raise it for irreversible actions.
 */
export function scoreOrElse<T>(
  a: ScoreAnswer,
  atOrAbove: number,
  fallback: T,
  minConf = 0,
): 'above' | 'below' | T {
  if (a.confidence < minConf) return fallback;
  return a.score >= atOrAbove ? 'above' : 'below';
}
