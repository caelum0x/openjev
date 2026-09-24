/**
 * Typed error hierarchy for the OpenJev (System One / otsone) client.
 *
 * Every error is a {@link OpenJevError}. HTTP failures become an {@link APIError}
 * subclass carrying `status`, `requestId`, and the raw/parsed `body`. Transport
 * failures become {@link TimeoutError}, {@link ConnectionError}, or
 * {@link AbortError}. Use {@link errorFromResponse} to build the right subclass
 * from a `Response`-derived status, parsed body, and headers.
 *
 * Zero runtime dependencies: only Web/Node built-ins (`Headers`, `Date`).
 */

/**
 * Request-id headers, in precedence order, emitted by the API/proxies.
 * The new `x-openjev-request-id` header is checked first; the legacy
 * `x-typesafe-request-id` is kept as a back-compat fallback for servers that
 * still emit the old name.
 */
const REQUEST_ID_HEADERS: readonly string[] = [
  'x-openjev-request-id',
  'x-typesafe-request-id',
  'x-request-id',
];

/** Read the request id from response headers, if present. */
export function requestIdFrom(headers: Headers | undefined): string | undefined {
  if (!headers) return undefined;
  for (const name of REQUEST_ID_HEADERS) {
    const value = headers.get(name);
    if (value) return value;
  }
  return undefined;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** Extract the API envelope: `{ error: { type, message, ... } }` or plain shapes. */
function envelope(body: unknown): Record<string, unknown> | undefined {
  if (!isRecord(body)) return undefined;
  if (isRecord(body.error)) return body.error;
  return body;
}

const MAX_RAW_BODY = 200;

/** Best-effort human-readable message from a response body. */
export function messageFromBody(body: unknown): string | undefined {
  if (typeof body === 'string') return body.trim() || undefined;
  const env = envelope(body);
  if (env) {
    if (typeof env.message === 'string' && env.message) return env.message;
    if (typeof env.detail === 'string' && env.detail) return env.detail;
    if (typeof env.error === 'string' && env.error) return env.error;
  }
  if (body === undefined || body === null) return undefined;
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  if (!raw) return undefined;
  return raw.length > MAX_RAW_BODY ? `${raw.slice(0, MAX_RAW_BODY)}...` : raw;
}

/** The API's machine-readable error `type`, when the envelope provides one. */
export function typeFromBody(body: unknown): string | undefined {
  const env = envelope(body);
  return env && typeof env.type === 'string' ? env.type : undefined;
}

/** Shared construction data for every error in the hierarchy. */
export interface OpenJevErrorInit {
  /** HTTP status code, when the error originated from a response. */
  status?: number;
  /** Correlation id from the response headers. */
  requestId?: string;
  /** Parsed JSON, raw text, or `undefined` when there was no body. */
  body?: unknown;
  /** Underlying cause (network error, abort reason, etc.). */
  cause?: unknown;
}

/** Base class for every error thrown by the client. */
export class OpenJevError extends Error {
  /** HTTP status code, or `undefined` for transport/config errors. */
  readonly status: number | undefined;
  /** Correlation id from the response headers, when available. */
  readonly requestId: string | undefined;
  /** Parsed JSON, raw text, or `undefined`. */
  readonly body: unknown;

  constructor(message: string, init: OpenJevErrorInit = {}) {
    super(message, init.cause !== undefined ? { cause: init.cause } : undefined);
    // Subclass name survives minification via new.target.
    this.name = new.target.name;
    this.status = init.status;
    this.requestId = init.requestId;
    this.body = init.body;
  }
}

/** @deprecated Alias kept for back-compat; prefer {@link OpenJevError}. */
export const TypeSafeError = OpenJevError;
/** @deprecated Alias kept for back-compat; prefer {@link OpenJevError}. */
export type TypeSafeError = OpenJevError;

/** @deprecated Alias kept for back-compat; prefer {@link OpenJevErrorInit}. */
export type TypeSafeErrorInit = OpenJevErrorInit;

/** @deprecated Pre-rename name; prefer {@link OpenJevError}. */
export const OpenTypeSafeError = OpenJevError;
/** @deprecated Pre-rename name; prefer {@link OpenJevError}. */
export type OpenTypeSafeError = OpenJevError;
/** @deprecated Pre-rename name; prefer {@link OpenJevErrorInit}. */
export type OpenTypeSafeErrorInit = OpenJevErrorInit;

/** Extra fields available on any HTTP-derived error. */
export interface APIErrorInit extends OpenJevErrorInit {
  status: number;
  headers?: Headers;
}

/** A non-2xx HTTP response from the API. */
export class APIError extends OpenJevError {
  /** Response headers, when captured. */
  readonly headers: Headers | undefined;
  /** The API's machine-readable error `type`, when present. */
  readonly errorType: string | undefined;

  constructor(message: string, init: APIErrorInit) {
    super(message, init);
    this.headers = init.headers;
    this.errorType = typeFromBody(init.body);
  }
}

/** HTTP 400: the request was malformed or failed validation. */
export interface ValidationFieldError {
  /** Dotted path to the offending field, when the API reports one. */
  readonly field: string | undefined;
  /** Human-readable explanation. */
  readonly message: string;
}

/** Pull per-field validation errors out of the API envelope. */
function fieldsFromBody(body: unknown): ValidationFieldError[] {
  const env = envelope(body);
  const source = env?.details ?? env?.fields ?? env?.errors;
  if (!Array.isArray(source)) return [];
  const out: ValidationFieldError[] = [];
  for (const item of source) {
    if (!isRecord(item)) continue;
    const message =
      typeof item.message === 'string'
        ? item.message
        : typeof item.msg === 'string'
          ? item.msg
          : undefined;
    if (!message) continue;
    const loc = item.field ?? item.path ?? item.loc;
    const field =
      typeof loc === 'string'
        ? loc
        : Array.isArray(loc)
          ? loc.filter((p) => p !== 'body').join('.')
          : undefined;
    out.push({ field: field || undefined, message });
  }
  return out;
}

/** HTTP 400: invalid request; carries any per-field details. */
export class ValidationError extends APIError {
  /** Per-field validation problems reported by the API. */
  readonly fields: readonly ValidationFieldError[];

  constructor(message: string, init: APIErrorInit) {
    super(message, init);
    this.fields = fieldsFromBody(init.body);
  }
}

/** HTTP 401: the API key is missing, malformed, or rejected. */
export class AuthenticationError extends APIError {}

/** HTTP 403: the key is valid but not permitted for this action. */
export class PermissionError extends APIError {}

/** HTTP 404: the endpoint or resource does not exist. */
export class NotFoundError extends APIError {}

/** Parse a `Retry-After` header (delta-seconds or HTTP-date) into milliseconds. */
export function retryAfterMs(headers: Headers | undefined, now: number = Date.now()): number | undefined {
  if (!headers) return undefined;
  const ms = headers.get('retry-after-ms');
  if (ms !== null) {
    const n = Number(ms);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  const raw = headers.get('retry-after');
  if (raw === null) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return seconds >= 0 ? seconds * 1000 : undefined;
  const date = Date.parse(raw);
  if (!Number.isNaN(date)) return Math.max(0, date - now);
  return undefined;
}

/** Parse a rate-limit reset header (epoch seconds or ms) into a `Date`. */
function resetFrom(headers: Headers | undefined): Date | undefined {
  if (!headers) return undefined;
  const raw = headers.get('x-ratelimit-reset') ?? headers.get('ratelimit-reset');
  if (raw === null) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return undefined;
  // Heuristic: values below ~10^12 are epoch seconds, otherwise milliseconds.
  const millis = n < 1e12 ? n * 1000 : n;
  return new Date(millis);
}

/** HTTP 429: too many requests. Exposes the server's retry hint. */
export class RateLimitError extends APIError {
  /** Server-advised delay before retrying, in milliseconds. */
  readonly retryAfter: number | undefined;
  /** When the rate-limit window resets, when the API reports it. */
  readonly reset: Date | undefined;

  constructor(message: string, init: APIErrorInit) {
    super(message, init);
    this.retryAfter = retryAfterMs(init.headers);
    this.reset = resetFrom(init.headers);
  }
}

/** The request did not complete within the configured timeout. */
export class TimeoutError extends OpenJevError {
  /** Configured timeout in milliseconds. */
  readonly timeoutMs: number;

  constructor(timeoutMs: number, init: OpenJevErrorInit = {}) {
    super(`Request timed out after ${timeoutMs}ms.`, init);
    this.timeoutMs = timeoutMs;
  }
}

/** The transport failed before a response arrived (DNS, TLS, socket, etc.). */
export class ConnectionError extends OpenJevError {
  constructor(message = 'Connection error.', init: OpenJevErrorInit = {}) {
    super(message, init);
  }
}

/** Alias for {@link ConnectionError}; a network-layer failure with no response. */
export const NetworkError = ConnectionError;
export type NetworkError = ConnectionError;

/** The caller cancelled the request via an `AbortSignal`. */
export class AbortError extends OpenJevError {
  constructor(message = 'Request was aborted.', init: OpenJevErrorInit = {}) {
    super(message, init);
  }
}

/**
 * Build the most specific {@link APIError} for a non-2xx response.
 *
 * `status` and `headers` come from the `Response`; `body` is the already-parsed
 * JSON or raw text so this stays synchronous and body reads are not duplicated.
 */
export function errorFromResponse(
  status: number,
  body: unknown,
  headers: Headers | undefined,
): APIError {
  const requestId = requestIdFrom(headers);
  const detail = messageFromBody(body);
  const message = detail ? `${status} ${detail}` : `${status} request failed`;
  const init: APIErrorInit =
    headers !== undefined
      ? requestId !== undefined
        ? { status, body, headers, requestId }
        : { status, body, headers }
      : requestId !== undefined
        ? { status, body, requestId }
        : { status, body };

  if (status === 400 || status === 422) return new ValidationError(message, init);
  if (status === 401) return new AuthenticationError(message, init);
  if (status === 403) return new PermissionError(message, init);
  if (status === 404) return new NotFoundError(message, init);
  if (status === 429) return new RateLimitError(message, init);
  return new APIError(message, init);
}
