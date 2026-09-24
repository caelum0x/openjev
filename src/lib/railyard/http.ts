/**
 * Railyard client layer — shared fetch helper.
 *
 * A thin, dependency-free JSON fetch used by the rago + relay + abacus clients.
 * It adds a per-request AbortController timeout, normalizes transport failures
 * and non-2xx responses into structured RailyardErrors, and never puts
 * credentials into an error message (only the endpoint path + status + a
 * truncated body).
 */

import { RAILYARD_HTTP_TIMEOUT_MS } from "./config";
import { RailyardError, truncateDetail, type RailyardService } from "./errors";

export interface RailyardFetchOptions {
  service: RailyardService;
  method?: "GET" | "POST";
  /** Absolute URL to call. */
  url: string;
  /** Endpoint path used in errors (never includes credentials). */
  endpoint: string;
  headers?: Record<string, string>;
  /** JSON-serializable body for POST. */
  body?: unknown;
  timeoutMs?: number;
  /** When set, this status is returned to the caller instead of throwing. */
  passthroughStatus?: number;
}

export interface RailyardFetchResult<T> {
  status: number;
  data: T;
}

/**
 * Perform a JSON request against a railyard service.
 *
 * Throws RailyardError("http_error") on a non-2xx status (unless it matches
 * `passthroughStatus`, which is returned so the caller can special-case it — e.g.
 * Abacus HTTP 402), RailyardError("network_error") on a transport failure/timeout,
 * and RailyardError("bad_response") when a 2xx body is not valid JSON.
 */
export async function railyardFetch<T>(
  options: RailyardFetchOptions,
): Promise<RailyardFetchResult<T>> {
  const method = options.method ?? "GET";
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? RAILYARD_HTTP_TIMEOUT_MS,
  );

  let response: Response;
  try {
    response = await fetch(options.url, {
      method,
      headers: {
        Accept: "application/json",
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
  } catch (cause) {
    const aborted = cause instanceof Error && cause.name === "AbortError";
    throw new RailyardError(
      `${options.service} request ${aborted ? "timed out" : "failed"} at ${options.endpoint}`,
      {
        service: options.service,
        code: "network_error",
        endpoint: options.endpoint,
        cause,
      },
    );
  } finally {
    clearTimeout(timeout);
  }

  const rawText = await response.text().catch(() => "");

  if (!response.ok && response.status !== options.passthroughStatus) {
    throw new RailyardError(`${options.service} ${response.status} at ${options.endpoint}`, {
      service: options.service,
      code: "http_error",
      status: response.status,
      endpoint: options.endpoint,
      detail: truncateDetail(rawText),
    });
  }

  let data: T;
  try {
    data = (rawText ? JSON.parse(rawText) : {}) as T;
  } catch (cause) {
    throw new RailyardError(
      `${options.service} returned a non-JSON body at ${options.endpoint}`,
      {
        service: options.service,
        code: "bad_response",
        status: response.status,
        endpoint: options.endpoint,
        detail: truncateDetail(rawText),
        cause,
      },
    );
  }

  return { status: response.status, data };
}
