/**
 * Rate + body-size limits for the keyless public demo routes
 * (/api/v1/cookbooks/*, /api/v1/loop, /api/v1/compact) — and, on the hosted
 * deployment only (OPENJEV_HOSTED=1), for anonymous calls to
 * /api/v1/systemone and /api/v1/batch. Self-hosted installs leave those two
 * unlimited by default.
 *
 * Pure and dependency-free so it runs under `node --test` directly; the
 * request wiring (API-key bypass, plan quotas) lives in public-guard.server.ts.
 *
 * Two fixed 60-second windows are checked per request:
 *  - per client IP  (OPENJEV_PUBLIC_RPM_PER_IP, default 30)
 *  - global, all IPs (OPENJEV_PUBLIC_RPM_GLOBAL, default 600)
 * A limit of 0 disables that window. A request only consumes budget when both
 * windows admit it, so a denied IP never burns the global allowance.
 *
 * State is in-process: each server instance enforces its own windows.
 *
 * Per-IP bucketing requires a trustworthy client IP (see `trustProxyHeaders` /
 * `clientIp` below) — untrusted deployments collapse every caller onto one
 * "unknown" bucket, so the global window is still the real backstop.
 */

export const PUBLIC_WINDOW_MS = 60_000;
export const DEFAULT_PUBLIC_RPM_PER_IP = 30;
export const DEFAULT_PUBLIC_RPM_GLOBAL = 600;
/** Default JSON body cap for public demo routes (64 KiB). */
export const DEFAULT_PUBLIC_MAX_BODY_BYTES = 64 * 1024;
/** Upper bound on tracked IP windows before expired entries are swept. */
const MAX_TRACKED_IPS = 50_000;

export type PublicLimitConfig = {
  perIpPerWindow: number;
  globalPerWindow: number;
  windowMs: number;
};

export type LimitScope = "ip" | "global";

export type LimitDecision =
  | { allowed: true; scope: null; limit: number; remaining: number; resetAt: number }
  | {
      allowed: false;
      scope: LimitScope;
      limit: number;
      remaining: 0;
      resetAt: number;
      retryAfterSeconds: number;
    };

type Window = { start: number; count: number };

function envInt(env: Record<string, string | undefined>, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

/** Read the limiter config from env; invalid values fall back to defaults. */
export function publicLimitConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): PublicLimitConfig {
  return {
    perIpPerWindow: envInt(env, "OPENJEV_PUBLIC_RPM_PER_IP", DEFAULT_PUBLIC_RPM_PER_IP),
    globalPerWindow: envInt(env, "OPENJEV_PUBLIC_RPM_GLOBAL", DEFAULT_PUBLIC_RPM_GLOBAL),
    windowMs: PUBLIC_WINDOW_MS,
  };
}

/** Body cap from env (OPENJEV_PUBLIC_MAX_BODY_BYTES), else `fallback`. */
export function publicMaxBodyBytesFromEnv(
  fallback: number = DEFAULT_PUBLIC_MAX_BODY_BYTES,
  env: Record<string, string | undefined> = process.env,
): number {
  const n = envInt(env, "OPENJEV_PUBLIC_MAX_BODY_BYTES", 0);
  return n > 0 ? n : fallback;
}

/**
 * Whether anonymous /api/v1/systemone + /api/v1/batch calls get the public
 * demo limits. Only the hosted service sets OPENJEV_HOSTED=1 (same flag as
 * plan gating); a self-hosted install stays unlimited unless it opts in.
 */
export function hostedAnonymousLimitsEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const raw = env.OPENJEV_HOSTED?.trim();
  return raw === "1" || raw?.toLowerCase() === "true";
}

/** Default JSON body cap for anonymous hosted /api/v1/batch calls (256 KiB). */
export const DEFAULT_PUBLIC_BATCH_MAX_BODY_BYTES = 256 * 1024;

/**
 * An anonymous batch costs one unit per item. A batch larger than the per-IP
 * window can never be admitted, so it gets an explicit 400 instead of a
 * misleading Retry-After. Returns null when the batch size is admissible.
 */
export function publicBatchSizeResponse(items: number, config: PublicLimitConfig): Response | null {
  const cap = config.perIpPerWindow;
  if (cap <= 0 || items <= cap) return null;
  return Response.json(
    {
      error: {
        type: "batch_too_large",
        reason: "public_batch_limit",
        message: `Anonymous batches on the hosted demo are limited to ${cap} items (each item counts toward the ${cap} requests-per-minute demo limit). Split the batch or send an API key to use your plan quota.`,
        limit: cap,
        received: items,
      },
    },
    { status: 400 },
  );
}

export class PublicRateLimiter {
  private readonly config: PublicLimitConfig;
  private readonly perIp = new Map<string, Window>();
  private global: Window = { start: 0, count: 0 };

  constructor(config: PublicLimitConfig) {
    this.config = config;
  }

  /** Number of IP windows currently tracked (for tests / diagnostics). */
  get trackedIps(): number {
    return this.perIp.size;
  }

  private current(w: Window | undefined, now: number): Window {
    if (!w || now - w.start >= this.config.windowMs) return { start: now, count: 0 };
    return w;
  }

  private sweep(now: number): void {
    if (this.perIp.size < MAX_TRACKED_IPS) return;
    for (const [ip, w] of this.perIp) {
      if (now - w.start >= this.config.windowMs) this.perIp.delete(ip);
    }
  }

  private deny(scope: LimitScope, limit: number, w: Window, now: number): LimitDecision {
    const resetAt = w.start + this.config.windowMs;
    return {
      allowed: false,
      scope,
      limit,
      remaining: 0,
      resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)),
    };
  }

  /**
   * Check-and-consume `cost` units for `ip` at time `now` (ms).
   * Returns the decision; on denial nothing is consumed.
   */
  check(ip: string, now: number = Date.now(), cost = 1): LimitDecision {
    const { perIpPerWindow, globalPerWindow, windowMs } = this.config;
    const ipWin = this.current(this.perIp.get(ip), now);
    const globalWin = this.current(this.global, now);

    if (perIpPerWindow > 0 && ipWin.count + cost > perIpPerWindow) {
      return this.deny("ip", perIpPerWindow, ipWin, now);
    }
    if (globalPerWindow > 0 && globalWin.count + cost > globalPerWindow) {
      return this.deny("global", globalPerWindow, globalWin, now);
    }

    this.sweep(now);
    const nextIp = { start: ipWin.start, count: ipWin.count + cost };
    this.perIp.set(ip, nextIp);
    this.global = { start: globalWin.start, count: globalWin.count + cost };

    const limit = perIpPerWindow > 0 ? perIpPerWindow : globalPerWindow;
    const used = perIpPerWindow > 0 ? nextIp.count : this.global.count;
    const start = perIpPerWindow > 0 ? nextIp.start : this.global.start;
    return {
      allowed: true,
      scope: null,
      limit,
      remaining: limit > 0 ? Math.max(0, limit - used) : 0,
      resetAt: start + windowMs,
    };
  }
}

/**
 * Whether CF-Connecting-IP / X-Real-IP / X-Forwarded-For are safe to read for
 * rate-limit bucketing. Those headers are fully attacker-controlled unless a
 * reverse proxy in front of this process overwrites them with the real client
 * address before the request arrives here — the stock `docker compose up`
 * self-host path does NOT put such a proxy in front (it exposes this process'
 * port directly), so trusting them there would let a caller mint a fresh
 * per-IP bucket on every request by sending a new X-Forwarded-For each time.
 *
 * Trusted when OPENJEV_HOSTED=1 (the hosted deployment always sits behind
 * Cloudflare, which overwrites CF-Connecting-IP at its edge) or when a
 * self-hoster opts in explicitly via OPENJEV_TRUST_PROXY_HEADERS=1 after
 * confirming their own reverse proxy strips/overwrites these headers.
 */
export function trustProxyHeaders(
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (hostedAnonymousLimitsEnabled(env)) return true;
  const raw = env.OPENJEV_TRUST_PROXY_HEADERS?.trim().toLowerCase();
  return raw === "1" || raw === "true";
}

/**
 * Best-effort client IP. Prefers headers set by the edge (Cloudflare, then a
 * reverse proxy's X-Real-IP); for X-Forwarded-For it takes the RIGHTMOST hop —
 * the one our own proxy appended — because the leftmost entries are
 * client-controlled and would let a caller rotate identities per request.
 * Falls back to "unknown" (all such callers share one bucket) when those
 * headers aren't trusted (see `trustProxyHeaders`) or aren't present.
 */
export function clientIp(
  headers: Headers,
  env: Record<string, string | undefined> = process.env,
): string {
  if (!trustProxyHeaders(env)) return "unknown";
  const cf = headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const hops = xff.split(",").map((h) => h.trim()).filter(Boolean);
    const last = hops[hops.length - 1];
    if (last) return last;
  }
  return "unknown";
}

/** Standard headers describing a limit decision. */
export function rateLimitHeaders(d: LimitDecision, now: number = Date.now()): Record<string, string> {
  const resetSeconds = Math.max(0, Math.ceil((d.resetAt - now) / 1000));
  const h: Record<string, string> = {
    "RateLimit-Limit": String(d.limit),
    "RateLimit-Remaining": String(d.remaining),
    "RateLimit-Reset": String(resetSeconds),
  };
  if (!d.allowed) h["Retry-After"] = String(d.retryAfterSeconds);
  return h;
}

/** The 429 JSON body + headers for a denied public request. */
export function publicRateLimitResponse(
  d: Extract<LimitDecision, { allowed: false }>,
  now: number = Date.now(),
): Response {
  const message =
    d.scope === "ip"
      ? `Too many requests from your address: the public demo allows ${d.limit} requests per minute. Retry in ${d.retryAfterSeconds}s, or send an API key to use your plan quota.`
      : `The public demo is at capacity (${d.limit} requests per minute across all callers). Retry in ${d.retryAfterSeconds}s, or send an API key to use your plan quota.`;
  return Response.json(
    {
      error: {
        type: "rate_limit",
        reason: d.scope === "ip" ? "ip_rate_limit" : "global_rate_limit",
        message,
        limit: d.limit,
        window_seconds: PUBLIC_WINDOW_MS / 1000,
        retry_after_seconds: d.retryAfterSeconds,
        reset_at: new Date(d.resetAt).toISOString(),
      },
    },
    { status: 429, headers: rateLimitHeaders(d, now) },
  );
}

/**
 * The 429 for a keyed call denied by its plan quota (quota.server.ts),
 * with Retry-After derived from the quota's reset time.
 */
export function planQuotaResponse(
  denied: { message: string; reason: string; used: number; limit: number; reset_at: string },
  now: number = Date.now(),
): Response {
  const resetMs = Date.parse(denied.reset_at);
  const retry = Number.isFinite(resetMs) ? Math.max(1, Math.ceil((resetMs - now) / 1000)) : 60;
  return Response.json(
    {
      error: {
        type: "rate_limit",
        message: denied.message,
        reason: denied.reason,
        used: denied.used,
        limit: denied.limit,
        retry_after_seconds: retry,
        reset_at: denied.reset_at,
      },
    },
    { status: 429, headers: { "Retry-After": String(retry) } },
  );
}

export type BodyReadResult =
  | { ok: true; value: unknown }
  | { ok: false; response: Response };

function tooLarge(maxBytes: number): Response {
  return Response.json(
    {
      error: {
        type: "payload_too_large",
        message: `Request body exceeds the ${maxBytes}-byte limit for this endpoint.`,
        limit_bytes: maxBytes,
      },
    },
    { status: 413 },
  );
}

function invalidJson(message: string): Response {
  return Response.json({ error: { type: "invalid_request", message } }, { status: 400 });
}

/**
 * Read and parse a JSON body, refusing anything over `maxBytes` — first by
 * Content-Length, then by counting streamed bytes (Content-Length can be absent
 * or wrong on chunked uploads). With `lenient`, an empty or unparseable body
 * yields `{}` instead of a 400 (the cookbook demos default every field).
 */
export async function readJsonLimited(
  request: Request,
  maxBytes: number,
  opts: { lenient?: boolean } = {},
): Promise<BodyReadResult> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, response: tooLarge(maxBytes) };

  let text = "";
  if (request.body) {
    const reader = request.body.getReader();
    const decoder = new TextDecoder();
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, response: tooLarge(maxBytes) };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  }

  if (!text.trim()) {
    return opts.lenient ? { ok: true, value: {} } : { ok: false, response: invalidJson("Request body must be JSON.") };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (err) {
    if (opts.lenient) return { ok: true, value: {} };
    return { ok: false, response: invalidJson(err instanceof Error ? err.message : "Invalid JSON") };
  }
}
