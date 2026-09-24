/**
 * Railyard client layer — structured errors.
 *
 * Every railyard client (rago / relay / abacus / mint) throws a RailyardError so
 * callers can branch on the failing service, the HTTP status, and — for the
 * money/gateway services — a coarse machine `code` (e.g. "cap_exceeded" on an
 * Abacus HTTP 402). The error message NEVER contains an API key: only the
 * service name, endpoint, status, and a truncated response body are captured.
 *
 * The railyard hop is always opt-in (see config.ts). Callers that want the
 * existing openjev path (pure-TS engine + direct-provider LLM escalation)
 * to keep working on any failure should catch RailyardError and fall back — the
 * clients never swallow errors themselves.
 */

export type RailyardService = "rago" | "relay" | "abacus" | "mint";

/** Coarse, machine-branchable failure codes shared across services. */
export type RailyardErrorCode =
  | "not_configured" // the service env gate is off — caller should use its fallback
  | "cap_exceeded" // Abacus per-key spend cap breached (HTTP 402) — stop that key
  | "http_error" // non-2xx response from the service
  | "network_error" // fetch threw / timed out before a response
  | "bad_response" // 2xx but the body was missing/unparseable
  | "sdk_unavailable"; // @railyard/mint-sdk is not installed (owner installs)

export interface RailyardErrorOptions {
  service: RailyardService;
  code: RailyardErrorCode;
  /** HTTP status when the failure came from a response. */
  status?: number;
  /** Endpoint path (never includes credentials). */
  endpoint?: string;
  /** Truncated, key-free response body for diagnostics. */
  detail?: string;
  cause?: unknown;
}

export class RailyardError extends Error {
  readonly service: RailyardService;
  readonly code: RailyardErrorCode;
  readonly status?: number;
  readonly endpoint?: string;
  readonly detail?: string;

  constructor(message: string, options: RailyardErrorOptions) {
    super(message);
    this.name = "RailyardError";
    this.service = options.service;
    this.code = options.code;
    this.status = options.status;
    this.endpoint = options.endpoint;
    this.detail = options.detail;
    if (options.cause !== undefined) {
      // Preserve the underlying cause without leaking it into `message`.
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

/** Type guard for callers deciding whether to fall back to the existing path. */
export function isRailyardError(value: unknown): value is RailyardError {
  return value instanceof RailyardError;
}

/** True when the failure means "railyard is off/unavailable — use the fallback path". */
export function isRailyardUnavailable(value: unknown): boolean {
  return (
    isRailyardError(value) &&
    (value.code === "not_configured" || value.code === "sdk_unavailable")
  );
}

/** Truncate a response body so diagnostics never balloon (and never log keys). */
export function truncateDetail(body: string, max = 300): string {
  const trimmed = body.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}
