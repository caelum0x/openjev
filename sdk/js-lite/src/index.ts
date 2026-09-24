/**
 * @openjev/lite — a reusable OpenJev (System One / otsone) intelligence layer.
 *
 * Judgments as programming primitives: code owns the workflow; otsone supplies
 * programmable common sense where ordinary code needs semantic understanding.
 *
 * Wire-compatible with the System One v1 API (POST /v1/systemone); derived from
 * the upstream typesafe-ai / Convai System One v1 wire contract (see LICENSE).
 *
 *   import { OpenJevClient, choice, noul, score, decideNoul } from '@openjev/lite';
 *   // Back-compat alias also available: TypeSafeClient
 *
 * Surface-specific decision modules live under `./modules` and are exported via
 * the package subpaths `@openjev/lite/flowblast`, `/aegis`, `/meta-ads`,
 * `/support-triage`, `/content-moderation`, and `/rag-answer-grader`.
 */

// ---- Client + the unified error hierarchy (re-exported through client.ts) --

export {
  OpenJevClient,
  // Back-compat aliases.
  TypeSafeClient,
  OpenTypeSafeClient,
  // Error hierarchy — re-exported from errors.ts via client.ts.
  OpenJevError,
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
  type OpenJevClientOptions,
  type TypeSafeClientOptions,
  type ModelId,
  type ShadowIncumbent,
  type ShadowRequest,
  type ShadowComparison,
  type ShadowResult,
  type ShadowSummary,
  type OpenTypeSafeClientOptions,
  type SystemOneRequest,
  type SystemOneResult,
  type SingleQuestionOpts,
  type OpenJevErrorInit,
  type TypeSafeErrorInit,
  type OpenTypeSafeErrorInit,
  type APIErrorInit,
  type ValidationFieldError,
} from './client.ts';

// ---- Primitives -----------------------------------------------------------

export {
  // Builders
  noul,
  choice,
  score,
  withAbstain,
  // Type guards
  isNoul,
  isChoice,
  isScore,
  // Assertion helpers
  asNoul,
  asChoice,
  asScore,
  // Confidence helpers
  noulConf,
  isHighConfidence,
  // Fallback helpers
  choiceOrElse,
  noulOrElse,
  scoreOrElse,
  // Error
  PrimitiveError,
  // Types
  type Question,
  type NoulQuestion,
  type ChoiceQuestion,
  type ScoreQuestion,
  type Answer,
  type NoulAnswer,
  type ChoiceAnswer,
  type ScoreAnswer,
  type SystemOneResponse,
  type SystemOneFallback,
  type SystemOneEscalation,
  type SystemOneCalibration,
  type QuestionExtensions,
  type AnswerTrust,
  type AbstainReason,
  type Instructions,
} from './primitives.ts';

// ---- Decide doctrine ------------------------------------------------------

export {
  // Single-answer deciders
  decideNoul,
  decideChoice,
  decideScore,
  // Composite scoring
  compositeScore,
  // High-level typed decision composition
  decide,
  withFallbacks,
  // Types
  type Verdict,
  type NoulFieldSpec,
  type ChoiceFieldSpec,
  type ScoreFieldSpec,
  type FieldSpec,
  type DecisionSchema,
  type DecisionResult,
} from './decide.ts';

// ---- Schema co-location ---------------------------------------------------

export {
  // Co-location helpers
  buildQuestions,
  validateSpec,
  decideWithSpec,
  // Types
  type NoulSpec,
  type ChoiceSpec,
  type ScoreSpec,
  type AnySpec,
  type DecisionSpec,
} from './schema.ts';

// ---- Configuration --------------------------------------------------------

export {
  resolveConfig,
  ENV,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  KNOWN_KEY_PREFIXES,
  type ResolveConfigOptions,
  type ResolvedConfig,
} from './config.ts';

// ---- Logging + redaction --------------------------------------------------

export {
  createLogger,
  consoleLogger,
  silentLogger,
  parseLogLevel,
  redactHeaders,
  LOG_LEVELS,
  DEFAULT_LOG_LEVEL,
  type LogLevel,
  type Logger,
} from './logging.ts';

// ---- Transport (advanced / self-hosting) ----------------------------------

export {
  HttpClient,
  streamText,
  CLIENT_VERSION,
  type FetchLike,
  type RequestOptions,
  type HttpClientOptions,
  type HttpResult,
  type ResponseMeta,
  type Usage,
} from './http.ts';
