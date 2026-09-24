import { lookupBySecret } from "./keys.server";
import { checkQuota } from "./quota.server";
import { parseBearer } from "./usage.server";
import {
  clientIp,
  hostedAnonymousLimitsEnabled,
  type PublicLimitConfig,
  publicBatchSizeResponse,
  planQuotaResponse,
  publicLimitConfigFromEnv,
  publicMaxBodyBytesFromEnv,
  publicRateLimitResponse,
  PublicRateLimiter,
  readJsonLimited,
} from "./public-limit";

/**
 * Shared admission guard for the public demo routes (cookbooks, loop, compact).
 *
 *  - A live `ots_live_` API key is held to its plan quota (checkQuota), exactly
 *    like POST /api/v1/systemone — keyed callers never hit the demo limits.
 *  - Everything else (no key, or a key that does not resolve — so a made-up
 *    bearer can't skip the limiter) gets the per-IP + global demo windows.
 *  - The JSON body is then read under a byte cap (413 over it).
 *
 * Returns either the parsed body or the ready-to-send error Response.
 */

let limiter: PublicRateLimiter | null = null;
let limiterConfig: PublicLimitConfig | null = null;

function publicLimiter(): PublicRateLimiter {
  limiterConfig ??= publicLimitConfigFromEnv();
  limiter ??= new PublicRateLimiter(limiterConfig);
  return limiter;
}

async function resolvesToLiveKey(bearer: string): Promise<boolean> {
  if (!bearer.startsWith("ots_live_")) return false;
  try {
    return (await lookupBySecret(bearer)) !== null;
  } catch (err) {
    console.error("[openjev] key lookup failed; applying public limits:", err);
    return false;
  }
}

export type GuardOptions = {
  /** Body cap for this route (OPENJEV_PUBLIC_MAX_BODY_BYTES overrides). */
  maxBodyBytes?: number;
  /** Empty / unparseable body becomes `{}` instead of a 400. */
  lenientJson?: boolean;
};

export type GuardResult = { ok: true; body: unknown } | { ok: false; response: Response };

export async function guardPublicRequest(
  request: Request,
  opts: GuardOptions = {},
): Promise<GuardResult> {
  const bearer = parseBearer(request);
  if (await resolvesToLiveKey(bearer)) {
    const quota = await checkQuota(bearer).catch((err: unknown) => {
      console.error("[openjev] quota check failed; allowing keyed call:", err);
      return { allowed: true } as const;
    });
    if (!quota.allowed) return { ok: false, response: planQuotaResponse(quota) };
  } else {
    const decision = publicLimiter().check(clientIp(request.headers));
    if (!decision.allowed) return { ok: false, response: publicRateLimitResponse(decision) };
  }

  const read = await readJsonLimited(
    request,
    publicMaxBodyBytesFromEnv(opts.maxBodyBytes),
    { lenient: opts.lenientJson },
  );
  return read.ok ? { ok: true, body: read.value } : { ok: false, response: read.response };
}

export type DecisionGuardResult =
  | { ok: true; body: unknown; anonymousLimited: boolean }
  | { ok: false; response: Response };

/**
 * Admission for POST /api/v1/systemone and /api/v1/batch.
 *
 * Self-host (OPENJEV_HOSTED unset): no demo limits — the body is parsed as
 * before and the route's own key quota check runs as usual.
 *
 * Hosted (OPENJEV_HOSTED=1): a caller without a live `ots_live_` key (no key,
 * or one that does not resolve) is held to the same per-IP + global windows
 * as the public demo routes, sharing their budget, and the body is read under
 * a byte cap. A single decision costs 1; a batch costs one unit per item and
 * is admitted or refused as a whole. Keyed callers go through the route's
 * plan quota instead.
 */
export async function guardDecisionRequest(
  request: Request,
  opts: { maxBodyBytes: number; costOf: (body: unknown) => number },
): Promise<DecisionGuardResult> {
  const anonymousLimited =
    hostedAnonymousLimitsEnabled() && !(await resolvesToLiveKey(parseBearer(request)));
  if (!anonymousLimited) {
    return { ok: true, body: await request.json(), anonymousLimited };
  }

  const read = await readJsonLimited(request, publicMaxBodyBytesFromEnv(opts.maxBodyBytes));
  if (!read.ok) return { ok: false, response: read.response };

  const rl = publicLimiter();
  const cost = Math.max(1, opts.costOf(read.value));
  const tooBig = publicBatchSizeResponse(cost, limiterConfig ?? publicLimitConfigFromEnv());
  if (tooBig) return { ok: false, response: tooBig };
  const decision = rl.check(clientIp(request.headers), Date.now(), cost);
  if (!decision.allowed) return { ok: false, response: publicRateLimitResponse(decision) };
  return { ok: true, body: read.value, anonymousLimited };
}

/** Narrow a lenient body to a plain object (`{}` for arrays / primitives / null). */
export function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
