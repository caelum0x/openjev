/** A JSON-compatible value. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** Text, a JSON object or array, or `null` for state, instructions, and criteria. */
export type EntryType = string | { [key: string]: JsonValue } | JsonValue[] | null;

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

/** A criterion description; `null` leaves the label undescribed. */
export type Description = EntryType;

/**
 * Trust options every question type accepts (OpenJev extensions; ignored by
 * servers that do not support them).
 */
export interface QuestionExtensions {
  /**
   * Opt into abstention ("I don't know"). When the input is out of scope or the
   * confidence is below `abstain_below`, the answer comes back with
   * `abstained: true` (choice answers pick the reserved `__none__` label).
   */
  abstain?: boolean;
  /** Confidence floor for abstention, from 0 to 1. Implies `abstain: true`. */
  abstain_below?: number;
  /** `auto` model only: escalate this question to an LLM below this local confidence (0 to 1). */
  escalate_below?: number;
}

/** A yes/no question with optional descriptions for either outcome. */
export interface NoulQuestion extends QuestionExtensions {
  type: "noul";
  /** The question as text, a JSON object, or an array; optional or `null`. */
  instructions?: EntryType;
  /** Optional descriptions of the yes and no outcomes. */
  criteria?: {
    /** Description of the yes outcome. */
    true?: EntryType;
    /** Description of the no outcome. */
    false?: EntryType;
  } | null;
}

/** Labels mapped to descriptions, or `null` for undescribed labels. */
export type ChoiceCriteria = {
  [label: string]: Description;
};

/** A question that selects between named alternatives. */
export interface ChoiceQuestion<T extends ChoiceCriteria = ChoiceCriteria>
  extends QuestionExtensions {
  type: "choice";
  /** The question as text, a JSON object, or an array; optional or `null`. */
  instructions?: EntryType;
  /** Descriptions of the available outcomes. */
  criteria: T;
}

/** At least two descriptions indexed by score from zero; `null` leaves a score undescribed. */
export type ScoreCriteria = readonly [EntryType, EntryType, ...EntryType[]];

/** A question that assigns a score using an ordered rubric. */
export interface ScoreQuestion<T extends ScoreCriteria = ScoreCriteria> extends QuestionExtensions {
  type: "score";
  /** The question as text, a JSON object, or an array; optional or `null`. */
  instructions?: EntryType;
  /** Descriptions of the available outcomes. */
  criteria: T;
}

/** A question identified by its `type` field. */
export type Question = NoulQuestion | ScoreQuestion | ChoiceQuestion;

/** Questions keyed by the names used to identify their answers. */
export interface Questions {
  [name: string]: Question;
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

/** Why an answer abstained. */
export type AbstainReason = "out_of_scope" | "low_confidence";

/** Trust fields any answer may carry (all optional on the wire). */
export interface AnswerTrust {
  /** Out-of-scope score from 0 (in scope) to 1 (unrelated to the question). */
  readonly ood?: number;
  /** Present and `true` when the question opted into abstention and the model abstained. */
  readonly abstained?: boolean;
  /** Why the answer abstained. */
  readonly abstain_reason?: AbstainReason;
  /** Probability mass on "none of the above" when abstaining. */
  readonly p_none?: number;
  /** `true` when a calibration map (`calibration_id`) rewrote the confidence. */
  readonly calibrated?: boolean;
  /** `true` when the `auto` model re-asked this question to an LLM. */
  readonly escalated?: boolean;
}

/** A yes/no answer. */
export interface NoulResponse extends AnswerTrust {
  readonly type: "noul";
  /** Probability of a yes answer, from zero to one. */
  readonly noul: number;
}

/** A selected label and its probabilities. */
export interface ChoiceResponse<
  T extends ChoiceCriteria = ChoiceCriteria,
  Abstains extends boolean = false,
> extends AnswerTrust {
  readonly type: "choice";
  /**
   * The selected label. Questions that opt into abstention (`abstain: true` or
   * `abstain_below`) may also return `"__none__"` with `abstained: true`; with a
   * request-wide `abstain`, check `abstained` before using `choice`.
   */
  readonly choice: Abstains extends true ? (keyof T & string) | "__none__" : keyof T & string;
  /** Reported confidence in the selected label. */
  readonly confidence: number;
  /** Probabilities keyed by label. */
  readonly probabilities: {
    readonly [label in keyof T]: number;
  };
}

/** Score keys inferred from the rubric; a fixed-length tuple yields its indices, otherwise `number`. */
export type ScoreOf<T extends ScoreCriteria> = number extends T["length"]
  ? number
  : Extract<keyof T, `${number}`>;

/** Rubric descriptions keyed by score. */
export type ScoreLegend<T extends ScoreCriteria> = {
  readonly [score in ScoreOf<T>]: T[score];
};

/** An expected score with its rubric and probabilities. */
export interface ScoreResponse<T extends ScoreCriteria = ScoreCriteria> extends AnswerTrust {
  readonly type: "score";
  /** Expected score, which may fall between integer rubric levels. */
  readonly score: number;
  /** Reported confidence in the score. */
  readonly confidence: number;
  /** Rubric descriptions keyed by score. */
  readonly legend: ScoreLegend<T>;
  /** Probabilities keyed by score. */
  readonly probabilities: {
    readonly [score in ScoreOf<T>]: number;
  };
}

/** The answer type for a question, preserving its criteria keys. */
export type ResultFor<T extends Question> = T extends NoulQuestion
  ? NoulResponse
  : T extends ScoreQuestion<infer S>
    ? ScoreResponse<S>
    : T extends ChoiceQuestion<infer E>
      ? T extends { abstain: true } | { abstain_below: number }
        ? ChoiceResponse<E, true>
        : ChoiceResponse<E>
      : never;

/** Token usage for a request. */
export interface Usage {
  /** Number of input tokens used. */
  readonly input_tokens: number;
  /** Number of output tokens used. */
  readonly output_tokens: number;
}

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
  readonly skipped_reason?: "no_llm_configured" | "rate_limited" | "llm_error";
  readonly llm_usage?: Usage;
}

/** Present when `calibration_id` was sent. */
export interface SystemOneCalibration {
  readonly id: string;
  readonly method: "temperature" | "isotonic";
  /** Question ids whose confidence was remapped. */
  readonly questions: readonly string[];
  /** Set when the map was not applied (for example fitted on a different model). */
  readonly skipped_reason?: string;
}

/** Answers keyed by question name, with model and usage metadata. */
export interface SystemOneResult<Q extends Questions> {
  /** The model used to answer the request. */
  readonly model: string;
  /** Answers with types inferred from the supplied questions. */
  readonly answers: { readonly [K in keyof Q]: ResultFor<Q[K]> };
  /** Token usage for the request. */
  readonly usage: Usage;
  /** Server-side latency in milliseconds (OpenJev servers). */
  readonly latency_ms?: number;
  readonly fallback?: SystemOneFallback;
  readonly escalation?: SystemOneEscalation;
  readonly calibration?: SystemOneCalibration;
}

/** Metadata for an available model. */
export interface ModelCard {
  readonly name: string;
  readonly description: string;
  readonly release_date: string;
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/**
 * State and named questions for `systemOne`.
 *
 * Additional properties on a request variable are forwarded, including `null` values.
 */
export interface SystemOneRequest<Q extends Questions = Questions> {
  /** Text, a JSON object or array, or `null` to evaluate. */
  state: EntryType;
  /** Nonempty questions keyed by the names used to identify their answers. */
  questions: Q;
  /**
   * Model override; omitted values inherit `defaultModel`. `"auto"` answers
   * locally first and escalates only low-confidence questions to an LLM.
   */
  model?: ModelId;
  /** Request-wide abstention default (see {@link QuestionExtensions.abstain}). */
  abstain?: boolean;
  /** Request-wide abstention confidence floor, from 0 to 1. */
  abstain_below?: number;
  /** `auto` model: request-wide escalation threshold, from 0 to 1. */
  escalate_below?: number;
  /** Apply a calibration map fitted on your labels (`cal_…`). */
  calibration_id?: string;
}

/** Model ids an OpenJev server knows; any other string is passed through. */
export type ModelId =
  | "auto"
  | "system-one"
  | "otsone-1"
  | "otsone-mini"
  | "laya-onnx"
  | "laya-mlx"
  | "openjev-grok"
  | "system-one-cloud"
  | (string & {});

// ---------------------------------------------------------------------------
// Shadow mode
// ---------------------------------------------------------------------------

/** The reference answers a shadow request compares against. */
export interface ShadowIncumbent {
  /** Display name, e.g. `"gpt-4o-mini"` or `"support-team"`. */
  name?: string;
  /** `"label"` for human ground truth (agreement is accuracy); `"llm"` (default) for an incumbent model. */
  kind?: "llm" | "label";
  /** Answers keyed by question id: choice key, score level index, or noul boolean. */
  answers?: Record<string, string | number | boolean>;
  latency_ms?: number;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/** Request body for `POST /v1/shadow`. Omit `incumbent.answers` to let the server ask its own LLM. */
export interface ShadowRequest<Q extends Questions = Questions> extends SystemOneRequest<Q> {
  incumbent?: ShadowIncumbent;
}

/** One question compared in a shadow request. */
export interface ShadowComparison {
  readonly question_id: string;
  readonly qtype: string;
  readonly ours: string;
  readonly incumbent: string;
  readonly agree: boolean;
  readonly confidence: number;
  readonly ood: number | null;
}

/** Result of one shadow request. */
export interface ShadowResult<Q extends Questions = Questions> {
  readonly batch_id: string;
  readonly incumbent: {
    readonly name: string;
    readonly source: "caller" | "server_llm";
    readonly kind: "llm" | "label";
  };
  /** Calibration applied to our answers, which also feeds its drift monitor. */
  readonly calibration_id: string | null;
  readonly ours: SystemOneResult<Q>;
  readonly comparisons: readonly ShadowComparison[];
  /** Share of compared questions that agreed, from 0 to 1. */
  readonly agreement: number;
}

/** Query for `GET /v1/shadow`. */
export interface ShadowSummaryQuery {
  days?: number;
  threshold?: number;
  incumbent?: string;
}

/** Aggregated shadow-mode evidence (`GET /v1/shadow`). */
export interface ShadowSummary {
  readonly window_days: number;
  readonly threshold: number;
  readonly total: number;
  readonly agreed: number;
  readonly agreement: number | null;
  readonly incumbents: readonly string[];
  readonly by_question: ReadonlyArray<{
    readonly question_id: string;
    readonly qtype: string;
    readonly n: number;
    readonly agreement: number;
    readonly avg_confidence: number;
  }>;
  readonly by_confidence: ReadonlyArray<{
    readonly label: string;
    readonly lo: number;
    readonly hi: number;
    readonly n: number;
    readonly agreement: number | null;
  }>;
  readonly above_threshold: {
    readonly n: number;
    readonly share: number;
    readonly agreement: number | null;
  };
  readonly disagreements: ReadonlyArray<{
    readonly id: string;
    readonly question_id: string;
    readonly ours: string;
    readonly incumbent: string;
    readonly confidence: number;
    readonly state_excerpt: string;
    readonly created_at: number;
  }>;
  readonly savings: {
    readonly incumbent_input_tokens: number;
    readonly incumbent_output_tokens: number;
    readonly incumbent_cost_usd: number;
    readonly projected_savings_usd: number;
    readonly price_in_usd_per_mtok: number;
    readonly price_out_usd_per_mtok: number;
    readonly price_source: "env" | "default";
  };
}

/** Request body for `POST /v1/systemone`, with the model resolved. */
export interface SystemOneRequestPayload extends SystemOneRequest {
  model: string;
}

/** Retry configuration. Partial overrides inherit unset fields from the client or SDK defaults. */
export interface RetryPolicy {
  /** Maximum retries after the initial attempt; `0` disables retries. Default: 2. */
  readonly maxRetries: number;
  /** First backoff delay in milliseconds, doubled up to `backoffMaxMs`. Default: 500. */
  readonly backoffInitialMs: number;
  /** Maximum backoff delay in milliseconds. Default: 5000. */
  readonly backoffMaxMs: number;
  /** Fraction of each backoff delay randomly subtracted, from 0 to 1. Default: 0.25. */
  readonly backoffJitter: number;
  /** HTTP status codes to retry. Default: 408, 429, and 500–599. */
  readonly httpStatuses: ReadonlySet<number>;
  /** Honor `Retry-After` and `retry-after-ms` up to `maxRetryAfterMs`. Default: true. */
  readonly respectRetryAfter: boolean;
  /** Maximum server retry delay in milliseconds; longer delays use backoff. Default: 60000. */
  readonly maxRetryAfterMs: number;
  /** Retry connection failures, including interrupted response bodies (`APIConnectionError`). Default: true. */
  readonly apiConnectionError: boolean;
  /** Whether to retry `APITimeoutError`. Default: true. */
  readonly apiTimeoutError: boolean;
}

/** Per-call options that override client settings. */
export interface RequestOptions {
  /** Cancellation signal for the request and pending retries. */
  signal?: AbortSignal;
  /** Timeout per attempt in milliseconds; there is no total retry budget. */
  timeout?: number;
  /** Retry overrides for this call; omitted fields inherit client settings. */
  retry?: Partial<RetryPolicy>;
  /** Additional headers, merged over `defaultHeaders`. */
  headers?: Record<string, string>;
}

/** HTTP fetch implementation compatible with the global `fetch`. */
export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** Log verbosity; `off` disables logging. */
export type LogLevel = "debug" | "info" | "warn" | "error" | "off";

/** Log methods accepting a message and structured values; compatible with `console`. */
export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/** Client options. Explicit values take precedence over environment variables, then SDK defaults. */
export interface OpenJevClientConfig {
  /**
   * Required API key.
   * Falls back to `OPENJEV_API_KEY` (primary), then `TYPESAFE_API_KEY` (back-compat alias).
   */
  apiKey?: string;
  /**
   * API root URL.
   * Falls back to `OPENJEV_BASE_URL` (primary), then `TYPESAFE_BASE_URL` (back-compat alias),
   * then `http://localhost:8080`. Point this at any openjev host.
   */
  baseURL?: string;
  /**
   * Default model identifier.
   * Falls back to `OPENJEV_DEFAULT_MODEL` (primary), then `TYPESAFE_DEFAULT_MODEL`
   * (back-compat alias), then `otsone-latest`.
   */
  defaultModel?: string;
  /**
   * Log level; falls back to `OPENJEV_LOG_LEVEL`, then `warn`.
   * `info` logs request summaries; `debug` adds headers and bodies.
   * Known credential headers are redacted; bodies are not.
   */
  logLevel?: LogLevel;
  /** Logger filtered to `logLevel` and above. Default: prefixed `console`. */
  logger?: Logger;
  /** Retry overrides; omitted fields use the defaults in `RetryPolicy`. */
  retry?: Partial<RetryPolicy>;
  /** Timeout per attempt in milliseconds, without a total retry budget. Default: 10000. */
  timeout?: number;
  /** Additional request headers; per-call headers take precedence. */
  defaultHeaders?: Record<string, string>;
  /** Allow browser use, exposing the API key to page users. Default: false. */
  dangerouslyAllowBrowser?: boolean;
  /** Custom HTTP fetch implementation for transport configuration or tests. Default: global `fetch`. */
  fetch?: Fetch;
}

/** @deprecated Use {@link OpenJevClientConfig} */
export type TypeSafeClientConfig = OpenJevClientConfig;
