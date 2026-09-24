/**
 * OpenJevClient — production-grade System One client.
 *
 * Delegates transport, retries, timeouts, and typed errors to the foundation
 * layer (http.ts / errors.ts / config.ts). Zero runtime dependencies.
 *
 * All questions in a single call run in parallel on the server; batch every
 * question you might need into one call to avoid extra round-trips.
 */

import type { Logger } from './logging.ts';
import { createLogger } from './logging.ts';
import type { FetchLike, RequestOptions } from './http.ts';
import { HttpClient } from './http.ts';
import { resolveConfig } from './config.ts';
import { OpenJevError } from './errors.ts';
import type {
  Question,
  SystemOneResponse,
  NoulQuestion,
  ChoiceQuestion,
  ScoreQuestion,
  NoulAnswer,
  ChoiceAnswer,
  ScoreAnswer,
} from './primitives.ts';

// Re-export the unified error hierarchy so callers only need one import path.
export {
  OpenJevError,
  // Back-compat alias: TypeSafeError === OpenJevError.
  TypeSafeError,
  OpenTypeSafeError,
  APIError,
  ValidationError,
  AuthenticationError,
  PermissionError,
  NotFoundError,
  RateLimitError,
  TimeoutError,
  ConnectionError,
  NetworkError,
  AbortError,
  errorFromResponse,
  requestIdFrom,
  retryAfterMs,
  messageFromBody,
  typeFromBody,
  type OpenJevErrorInit,
  // Back-compat alias type.
  type TypeSafeErrorInit,
  type OpenTypeSafeErrorInit,
  type APIErrorInit,
  type ValidationFieldError,
} from './errors.ts';

// ---- Client options -------------------------------------------------------

/** Construction options for the OpenJev client. */
export interface OpenJevClientOptions {
  /**
   * API key. Falls back to OPENJEV_API_KEY, TYPESAFE_API_KEY (back-compat alias), or
   * the legacy lowercase `typesafe_api_key` env var.
   */
  apiKey?: string;
  /** API root URL (no trailing slash). Falls back to OPENJEV_BASE_URL / TYPESAFE_BASE_URL (alias). */
  baseURL?: string;
  /** @deprecated Accepted for backward compatibility. Prefer `baseURL`. */
  baseUrl?: string;
  /** Default model. Falls back to TYPESAFE_MODEL / OPENJEV_MODEL. */
  model?: string;
  /** Max retry attempts on transient failures (408/429/5xx + network). Default 2. */
  maxRetries?: number;
  /** Per-request timeout in ms. Default 30 000. */
  timeoutMs?: number;
  /** @deprecated Accepted for backward compatibility. Prefer `timeoutMs`. */
  timeout?: number;
  /** Initial retry backoff in ms (full-jitter exponential). Default 500. */
  backoffMs?: number;
  /** Default extra headers merged into every request. */
  headers?: Record<string, string>;
  /** Structured logger. Defaults to silent unless `logLevel` is configured. */
  logger?: Logger;
  /** Injectable `fetch` implementation (tests, proxies). */
  fetch?: FetchLike;
  /** @deprecated Accepted for backward compatibility. Prefer `fetch`. */
  fetchImpl?: FetchLike;
  /**
   * Injectable sleep for tests.
   * @deprecated The transport's `sleep` option (which accepts a signal) is preferred.
   */
  sleepImpl?: (ms: number) => Promise<void>;
  /** Injectable jitter source in [0, 1). @deprecated Map to the `random` transport option. */
  jitterImpl?: () => number;
}

// ---- Request / response types ---------------------------------------------

/** A System One batch request. */
export interface SystemOneRequest<K extends string = string> {
  /** Application state to be judged: string, object, or array. */
  state: unknown;
  /** Map of question id → question. Ids are yours; answers arrive under the same keys. */
  questions: Record<K, Question>;
  /**
   * Override the client's default model for this call only. `'auto'` answers
   * locally and escalates only low-confidence questions to an LLM.
   */
  model?: ModelId;
  /** Request-wide abstention default (see QuestionExtensions.abstain). */
  abstain?: boolean;
  /** Request-wide abstention confidence floor (0..1). */
  abstain_below?: number;
  /** `auto` model: request-wide escalation threshold (0..1). */
  escalate_below?: number;
  /** Apply a calibration map fitted on your own labels (`cal_…`). */
  calibration_id?: string;
  /** Cancel the request via an AbortSignal. */
  signal?: AbortSignal;
  /** Extra headers for this call only (merged over any client-level defaults). */
  headers?: Record<string, string>;
  /** Per-request timeout override in ms. */
  timeoutMs?: number;
  /** Per-request retry budget override. */
  maxRetries?: number;
}

/** Model ids an OpenJev server knows; any other string is passed through. */
export type ModelId =
  | 'auto'
  | 'system-one'
  | 'otsone-1'
  | 'otsone-mini'
  | 'laya-onnx'
  | 'laya-mlx'
  | 'openjev-grok'
  | 'system-one-cloud'
  | (string & {});

/** Reference answers for a shadow request. */
export interface ShadowIncumbent {
  /** Display name, e.g. `'gpt-4o-mini'` or `'support-team'`. */
  name?: string;
  /** `'label'` = human ground truth (agreement is accuracy); `'llm'` (default) = incumbent model. */
  kind?: 'llm' | 'label';
  /** Answers by question id: choice key, score level index, or noul boolean. */
  answers?: Record<string, string | number | boolean>;
  latency_ms?: number;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/** A shadow request: a System One request plus the incumbent's answers. */
export interface ShadowRequest<K extends string = string> extends SystemOneRequest<K> {
  /** Omit `answers` to let the server ask its own configured LLM. */
  incumbent?: ShadowIncumbent;
}

export interface ShadowComparison {
  readonly question_id: string;
  readonly qtype: string;
  readonly ours: string;
  readonly incumbent: string;
  readonly agree: boolean;
  readonly confidence: number;
  readonly ood: number | null;
}

export interface ShadowResult<K extends string = string> {
  readonly batch_id: string;
  readonly incumbent: { readonly name: string; readonly source: 'caller' | 'server_llm'; readonly kind: 'llm' | 'label' };
  /** Calibration applied to our answers (it also feeds that calibration's drift monitor). */
  readonly calibration_id: string | null;
  readonly ours: SystemOneResponse<K>;
  readonly comparisons: readonly ShadowComparison[];
  readonly agreement: number;
}

/** Aggregated shadow-mode evidence (`GET /v1/shadow`). Fields mirror the server summary. */
export interface ShadowSummary {
  readonly window_days: number;
  readonly threshold: number;
  readonly total: number;
  readonly agreed: number;
  readonly agreement: number | null;
  readonly incumbents: readonly string[];
  readonly by_question: ReadonlyArray<{ question_id: string; qtype: string; n: number; agreement: number; avg_confidence: number }>;
  readonly by_confidence: ReadonlyArray<{ label: string; lo: number; hi: number; n: number; agreement: number | null }>;
  readonly above_threshold: { readonly n: number; readonly share: number; readonly agreement: number | null };
  readonly savings: {
    readonly incumbent_cost_usd: number;
    readonly projected_savings_usd: number;
    readonly price_source: 'env' | 'default';
  };
}

/** System One response with the server correlation id attached. */
export interface SystemOneResult<K extends string = string> extends SystemOneResponse<K> {
  /** Correlation id from the response headers, when the server provides one. */
  readonly requestId: string | undefined;
}

/** Options common to all single-question convenience methods. */
export interface SingleQuestionOpts {
  /** Override the client's default model for this call only. */
  model?: string;
  /** Cancel the request via an AbortSignal. */
  signal?: AbortSignal;
  /** Per-request timeout override in ms. */
  timeoutMs?: number;
  /** Per-request retry budget override. */
  maxRetries?: number;
  /** Extra headers for this call only. */
  headers?: Record<string, string>;
}

// ---- Client ---------------------------------------------------------------

export class OpenJevClient {
  private readonly http: HttpClient;
  private readonly defaultModel: string;
  private readonly defaultHeaders: Record<string, string> | undefined;

  constructor(options: OpenJevClientOptions = {}) {
    // Resolve field aliases so callers can use either name.
    const baseURL = options.baseURL ?? options.baseUrl;
    const timeoutMs = options.timeoutMs ?? options.timeout;
    const fetchFn = options.fetchImpl ?? options.fetch;

    // Buffer config warnings so they route through the logger rather than
    // directly to console.warn (avoids noise when logLevel is 'off').
    const pendingWarnings: string[] = [];
    const config = resolveConfig(
      {
        // exactOptionalPropertyTypes: only spread defined values.
        ...(options.apiKey !== undefined ? { apiKey: options.apiKey } : {}),
        ...(baseURL !== undefined ? { baseURL } : {}),
        ...(options.model !== undefined ? { model: options.model } : {}),
      },
      (msg) => pendingWarnings.push(msg),
    );

    const logger = options.logger ?? createLogger(config.logLevel);
    for (const w of pendingWarnings) logger.warn(w);

    this.defaultModel = config.model;
    this.defaultHeaders = options.headers;
    // exactOptionalPropertyTypes: only pass options that are actually defined.
    const sleepFn = options.sleepImpl
      ? (ms: number, _signal?: AbortSignal) => options.sleepImpl!(ms)
      : undefined;
    this.http = new HttpClient({
      config,
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      ...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
      ...(options.backoffMs !== undefined ? { backoffInitialMs: options.backoffMs } : {}),
      ...(fetchFn !== undefined ? { fetch: fetchFn } : {}),
      logger,
      ...(sleepFn !== undefined ? { sleep: sleepFn } : {}),
      ...(options.jitterImpl !== undefined ? { random: options.jitterImpl } : {}),
    });
  }

  // ---- Core ---------------------------------------------------------------

  /** Ask a batch of typed questions over one piece of state in one HTTP call. */
  async systemOne<K extends string>(req: SystemOneRequest<K>): Promise<SystemOneResult<K>> {
    const { data, meta } = await this.http.request<SystemOneResponse<K>>(
      '/v1/systemone',
      this.payload(req),
      this.requestOptions(req),
    );
    return { ...data, requestId: meta.requestId };
  }

  /**
   * Shadow mode: answer the request and compare with the incumbent's answers
   * (your production LLM's, or human labels with `incumbent.kind: 'label'`).
   * Production keeps serving the incumbent; OpenJev only logs agreement.
   */
  async shadow<K extends string>(req: ShadowRequest<K>): Promise<ShadowResult<K>> {
    const body = req.incumbent !== undefined ? { ...this.payload(req), incumbent: req.incumbent } : this.payload(req);
    const { data } = await this.http.request<{ data: ShadowResult<K> }>(
      '/v1/shadow',
      body,
      this.requestOptions(req),
    );
    return unwrapData(data, 'POST /v1/shadow');
  }

  /** Aggregated shadow agreement, confidence bands and projected savings. */
  async shadowSummary(
    query: { days?: number; threshold?: number; incumbent?: string } = {},
    opts: SingleQuestionOpts = {},
  ): Promise<ShadowSummary> {
    const params = new URLSearchParams();
    if (query.days !== undefined) params.set('days', String(query.days));
    if (query.threshold !== undefined) params.set('threshold', String(query.threshold));
    if (query.incumbent !== undefined) params.set('incumbent', query.incumbent);
    const qs = params.toString();
    const { data } = await this.http.request<{ data: ShadowSummary }>(
      `/v1/shadow${qs ? `?${qs}` : ''}`,
      undefined,
      { ...this.requestOptions(opts), method: 'GET' },
    );
    return unwrapData(data, 'GET /v1/shadow');
  }

  /** The JSON body for /v1/systemone (only defined trust fields are sent). */
  private payload(req: SystemOneRequest<string>): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      model: req.model ?? this.defaultModel,
      state: req.state,
      questions: req.questions,
    };
    if (req.abstain !== undefined) payload.abstain = req.abstain;
    if (req.abstain_below !== undefined) payload.abstain_below = req.abstain_below;
    if (req.escalate_below !== undefined) payload.escalate_below = req.escalate_below;
    if (req.calibration_id !== undefined) payload.calibration_id = req.calibration_id;
    return payload;
  }

  /** exactOptionalPropertyTypes: build RequestOptions with only defined fields. */
  private requestOptions(req: SingleQuestionOpts): RequestOptions {
    const opts: RequestOptions = {};
    if (req.signal !== undefined) opts.signal = req.signal;
    if (req.timeoutMs !== undefined) opts.timeoutMs = req.timeoutMs;
    if (req.maxRetries !== undefined) opts.maxRetries = req.maxRetries;
    const h = mergeHeaders(this.defaultHeaders, req.headers);
    if (h !== undefined) opts.headers = h;
    return opts;
  }

  /**
   * Positional alias for `systemOne`. Pass state and a question map directly
   * without wrapping them in a request object.
   */
  async batch<K extends string>(
    state: unknown,
    questions: Record<K, Question>,
    opts?: SingleQuestionOpts,
  ): Promise<SystemOneResult<K>> {
    return this.systemOne({ state, questions, ...opts });
  }

  // ---- Single-question convenience helpers --------------------------------

  /** Ask one noul (calibrated yes/no confidence) question. */
  async noul(
    state: unknown,
    question: NoulQuestion,
    opts?: SingleQuestionOpts,
  ): Promise<NoulAnswer> {
    const res = await this.systemOne({ state, questions: { _q: question }, ...opts });
    return res.answers._q as NoulAnswer;
  }

  /** Ask one choice (closed-set label) question. */
  async choice(
    state: unknown,
    question: ChoiceQuestion,
    opts?: SingleQuestionOpts,
  ): Promise<ChoiceAnswer> {
    const res = await this.systemOne({ state, questions: { _q: question }, ...opts });
    return res.answers._q as ChoiceAnswer;
  }

  /** Ask one score (ordered position along a described dimension) question. */
  async score(
    state: unknown,
    question: ScoreQuestion,
    opts?: SingleQuestionOpts,
  ): Promise<ScoreAnswer> {
    const res = await this.systemOne({ state, questions: { _q: question }, ...opts });
    return res.answers._q as ScoreAnswer;
  }
}

// ---- Helpers --------------------------------------------------------------

function unwrapData<T>(wire: { data: T } | null | undefined, route: string): T {
  if (wire && typeof wire === 'object' && wire.data != null) return wire.data;
  throw new OpenJevError(`Unexpected response shape from ${route}; expected { data: ... }.`);
}

function mergeHeaders(
  defaults: Record<string, string> | undefined,
  perRequest: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!defaults && !perRequest) return undefined;
  if (!defaults) return perRequest;
  if (!perRequest) return defaults;
  return { ...defaults, ...perRequest };
}

// ---- Back-compat aliases --------------------------------------------------

/** @deprecated Use {@link OpenJevClient} instead. */
export const TypeSafeClient = OpenJevClient;
/** @deprecated Use {@link OpenJevClient} instead. */
export type TypeSafeClient = OpenJevClient;

/** @deprecated Use {@link OpenJevClientOptions} instead. */
export type TypeSafeClientOptions = OpenJevClientOptions;

/** @deprecated Pre-rename name; use {@link OpenJevClient} instead. */
export const OpenTypeSafeClient = OpenJevClient;
/** @deprecated Pre-rename name; use {@link OpenJevClient} instead. */
export type OpenTypeSafeClient = OpenJevClient;
/** @deprecated Pre-rename name; use {@link OpenJevClientOptions} instead. */
export type OpenTypeSafeClientOptions = OpenJevClientOptions;
