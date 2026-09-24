/**
 * HTTP transport for the TypeSafe client.
 *
 * A single {@link HttpClient.request} performs a JSON POST with authentication,
 * a `User-Agent`, and a per-request `X-Request-Id`; enforces a per-request
 * timeout via `AbortController`; retries 408/429/5xx and network/timeout errors
 * with exponential backoff and full jitter (respecting `Retry-After`); and maps
 * failures onto the typed errors in {@link ./errors.js}. `/v1/systemone` returns
 * one batched JSON body, so {@link HttpClient.request} is the batch primitive;
 * {@link streamText} is provided for any future streaming endpoint.
 *
 * Zero runtime dependencies: global `fetch`, `AbortController`, `crypto`,
 * `TextDecoder`.
 */

import {
  AbortError,
  APIError,
  ConnectionError,
  errorFromResponse,
  requestIdFrom,
  retryAfterMs,
  TimeoutError,
} from './errors.ts';
import type { Logger } from './logging.ts';
import { silentLogger } from './logging.ts';
import type { ResolvedConfig } from './config.ts';

/** A `fetch`-compatible function; defaults to the global `fetch`. */
export type FetchLike = typeof fetch;

/** Token accounting returned by the API, when present. */
export interface Usage {
  readonly input_tokens: number;
  readonly output_tokens: number;
}

/** Response metadata surfaced alongside the parsed body. */
export interface ResponseMeta {
  /** HTTP status code (always 2xx here — failures throw). */
  readonly status: number;
  /** Correlation id from the response headers, when present. */
  readonly requestId: string | undefined;
  /** Token usage parsed from the body, when present. */
  readonly usage: Usage | undefined;
}

/** Parsed body plus response metadata. */
export interface HttpResult<T> {
  readonly data: T;
  readonly meta: ResponseMeta;
}

/** Per-request overrides. */
export interface RequestOptions {
  /** Caller cancellation. Aborting raises {@link AbortError}, never retried. */
  signal?: AbortSignal;
  /** Override the client's timeout for this request. */
  timeoutMs?: number;
  /** Override the client's retry budget for this request. */
  maxRetries?: number;
  /** Extra headers merged over the defaults (cannot remove auth). */
  headers?: Record<string, string>;
  /** HTTP method. Default `POST`; `GET` sends no body. */
  method?: 'GET' | 'POST';
}

/** Construction options for the transport. */
export interface HttpClientOptions {
  config: ResolvedConfig;
  /** Per-request timeout in ms. Default 30000. */
  timeoutMs?: number;
  /** Max retry attempts on transient failures. Default 2. */
  maxRetries?: number;
  /** First-retry backoff base in ms. Default 500. */
  backoffInitialMs?: number;
  /** Backoff ceiling in ms. Default 8000. */
  backoffMaxMs?: number;
  /** Ignore `Retry-After` hints longer than this. Default 60000. */
  maxRetryAfterMs?: number;
  /** Injectable fetch (tests, proxies). Defaults to global `fetch`. */
  fetch?: FetchLike;
  /** Optional logger. Defaults to a silent logger. */
  logger?: Logger;
  /** Injectable cancellable sleep (tests). */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Injectable jitter source in [0,1). Defaults to `Math.random`. */
  random?: () => number;
  /** Override the `User-Agent`. Defaults to `openjev-client/<version>`. */
  userAgent?: string;
}

export const CLIENT_VERSION = '0.2.0';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_BACKOFF_INITIAL_MS = 500;
const DEFAULT_BACKOFF_MAX_MS = 8_000;
const DEFAULT_MAX_RETRY_AFTER_MS = 60_000;

/** Statuses worth retrying: request timeout, rate limit, and server errors. */
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504, 529]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

function usageFrom(body: unknown): Usage | undefined {
  if (!isRecord(body) || !isRecord(body.usage)) return undefined;
  const { input_tokens, output_tokens } = body.usage;
  if (typeof input_tokens === 'number' && typeof output_tokens === 'number') {
    return { input_tokens, output_tokens };
  }
  return undefined;
}

/** RFC4122 id for `X-Request-Id`, with a fallback for stripped-down runtimes. */
function newRequestId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `req_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** Cancellable sleep; rejects with the signal reason when aborted mid-wait. */
function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => '');
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export class HttpClient {
  private readonly config: ResolvedConfig;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly backoffInitialMs: number;
  private readonly backoffMaxMs: number;
  private readonly maxRetryAfterMs: number;
  private readonly fetchImpl: FetchLike;
  private readonly logger: Logger;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly random: () => number;
  private readonly userAgent: string;

  constructor(options: HttpClientOptions) {
    this.config = options.config;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.backoffInitialMs = options.backoffInitialMs ?? DEFAULT_BACKOFF_INITIAL_MS;
    this.backoffMaxMs = options.backoffMaxMs ?? DEFAULT_BACKOFF_MAX_MS;
    this.maxRetryAfterMs = options.maxRetryAfterMs ?? DEFAULT_MAX_RETRY_AFTER_MS;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.logger = options.logger ?? silentLogger;
    this.sleep = options.sleep ?? defaultSleep;
    this.random = options.random ?? Math.random;
    this.userAgent = options.userAgent ?? `openjev-client/${CLIENT_VERSION}`;
    if (typeof this.fetchImpl !== 'function') {
      throw new ConnectionError('No `fetch` implementation available (Node >= 20 or pass `fetch`).');
    }
  }

  /** Full delay before the next attempt: `Retry-After` when short enough, else full-jitter backoff. */
  private backoffDelay(attempt: number, headers: Headers | undefined): number {
    const advised = retryAfterMs(headers);
    if (advised !== undefined && advised <= this.maxRetryAfterMs) return advised;
    const cap = Math.min(this.backoffInitialMs * 2 ** attempt, this.backoffMaxMs);
    return Math.round(cap * this.random());
  }

  private headers(requestId: string, extra: Record<string, string> | undefined): Headers {
    const headers = new Headers({
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${this.config.apiKey}`,
      'User-Agent': this.userAgent,
      'X-Request-Id': requestId,
    });
    if (extra) for (const [k, v] of Object.entries(extra)) headers.set(k, v);
    return headers;
  }

  /**
   * POST `body` as JSON (or GET, with `options.method`) to `path` (joined onto the configured base URL) and
   * return the parsed result with response metadata. Retries transient failures
   * within the budget; throws a typed error otherwise.
   */
  async request<T>(path: string, body: unknown, options: RequestOptions = {}): Promise<HttpResult<T>> {
    const url = `${this.config.baseURL}${path.startsWith('/') ? path : `/${path}`}`;
    const method = options.method ?? 'POST';
    const payload = method === 'GET' ? undefined : JSON.stringify(body);
    const maxRetries = options.maxRetries ?? this.maxRetries;
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const requestId = newRequestId();
    const headers = this.headers(requestId, options.headers);

    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const timeout = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        timeout.abort();
      }, timeoutMs);
      const onCallerAbort = (): void => timeout.abort();
      options.signal?.addEventListener('abort', onCallerAbort, { once: true });

      try {
        if (options.signal?.aborted) throw new AbortError(undefined, { cause: options.signal.reason });
        const response = await this.fetchImpl(url, {
          method,
          headers,
          ...(payload !== undefined ? { body: payload } : {}),
          signal: timeout.signal,
        });

        if (response.ok) {
          const data = await parseBody(response);
          const meta: ResponseMeta = {
            status: response.status,
            requestId: requestIdFrom(response.headers) ?? requestId,
            usage: usageFrom(data),
          };
          return { data: data as T, meta };
        }

        const parsed = await parseBody(response);
        const error = errorFromResponse(response.status, parsed, response.headers);
        if (RETRYABLE_STATUS.has(response.status) && attempt < maxRetries) {
          const delay = this.backoffDelay(attempt, response.headers);
          this.logger.warn(
            `request ${requestId} got HTTP ${response.status}; retrying in ${delay}ms ` +
              `(attempt ${attempt + 1}/${maxRetries})`,
          );
          lastError = error;
          await this.sleep(delay, options.signal);
          continue;
        }
        throw error;
      } catch (err) {
        const mapped = this.mapThrown(err, options.signal, timedOut, timeoutMs);
        // Caller aborts and already-typed API errors are terminal.
        if (mapped instanceof AbortError || mapped instanceof APIError) throw mapped;
        lastError = mapped;
        if (attempt < maxRetries) {
          const delay = this.backoffDelay(attempt, undefined);
          this.logger.warn(
            `request ${requestId} failed (${mapped.message}); retrying in ${delay}ms ` +
              `(attempt ${attempt + 1}/${maxRetries})`,
          );
          await this.sleep(delay, options.signal);
          continue;
        }
        throw mapped;
      } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onCallerAbort);
      }
    }
    // Unreachable in practice: the loop returns or throws.
    throw lastError instanceof Error
      ? lastError
      : new ConnectionError('Request failed.', { cause: lastError });
  }

  /** Translate a thrown value into the correct typed error. */
  private mapThrown(
    err: unknown,
    signal: AbortSignal | undefined,
    timedOut: boolean,
    timeoutMs: number,
  ): APIError | AbortError | TimeoutError | ConnectionError {
    if (err instanceof APIError || err instanceof AbortError || err instanceof TimeoutError) {
      return err;
    }
    if (timedOut) return new TimeoutError(timeoutMs, { cause: err });
    if (signal?.aborted) return new AbortError(undefined, { cause: signal.reason ?? err });
    const message = err instanceof Error ? err.message : String(err);
    return new ConnectionError(`Connection error: ${message}`, { cause: err });
  }
}

/**
 * Decode a streaming `Response` body into text chunks.
 *
 * The `/v1/systemone` endpoint returns a single batched JSON body, so
 * {@link HttpClient.request} is the batch primitive. This helper exists for any
 * future streaming endpoint: iterate the chunks and parse SSE/NDJSON as needed.
 */
export async function* streamText(response: Response): AsyncGenerator<string> {
  const body = response.body;
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) yield decoder.decode(value, { stream: true });
    }
    const tail = decoder.decode();
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}
