import { requireUserId } from "@/lib/auth/verify.server";
import { lookupBySecret, touchKey } from "./keys.server";
import { parseBearer, recordUsage } from "./usage.server";

/**
 * Server-side user resolution + usage attribution for /api/v1/* routes
 * (Foundation-1). Shared by the console read routes, the System One run path,
 * and the cookbook routes so every persisted row is scoped to the right user.
 */

/**
 * Resolve the console user for a request. The browser `api()` helper sends the
 * active API key as the bearer token, so:
 *  - an `ots_live_…` bearer resolves to the key's owner via `lookupBySecret`
 *    (the key is itself the credential — and this avoids an API-key bearer
 *    shadowing the session cookie inside Better Auth);
 *  - otherwise fall back to the verified session user (or the shared dev user
 *    in the auth-disabled preview) via `requireUserId`.
 *
 * Throws `UnauthorizedError` (status 401) when no user can be resolved.
 */
export async function resolveConsoleUser(request: Request): Promise<string> {
  const bearer = parseBearer(request);
  if (bearer.startsWith("ots_live_")) {
    const record = await lookupBySecret(bearer);
    if (record) return record.user_id;
  }
  return requireUserId();
}

/** The user + (optional) key a call should be attributed to, or null. */
export type UsageIdentity = { userId: string; keyId: string | null };

/**
 * Resolve which user + key a call should be attributed to from its bearer.
 * An `ots_live_…` key resolves to its owner (and its id); anything else falls
 * back to the session/dev user. Returns `null` when no user can be resolved
 * (an anonymous, unauthenticated call — record nothing rather than throw).
 */
export async function resolveUsageIdentity(bearer: string): Promise<UsageIdentity | null> {
  let userId: string | null = null;
  let keyId: string | null = null;
  if (bearer.startsWith("ots_live_")) {
    const record = await lookupBySecret(bearer);
    if (record) {
      userId = record.user_id;
      keyId = record.id;
    }
  }
  if (!userId) userId = await requireUserId().catch(() => null);
  return userId ? { userId, keyId } : null;
}

/** Fields describing a metered call, minus the resolved identity. */
export type RequestUsage = {
  model: string;
  path: string;
  questions: number;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
  status?: string;
};

/**
 * Best-effort: attribute + persist one usage event for a request. Resolves the
 * user/key from the request bearer, stamps the key's last-used time, and never
 * throws — usage metering must not fail the request it measures.
 */
export async function recordUsageForRequest(
  request: Request,
  usage: RequestUsage,
): Promise<void> {
  try {
    const identity = await resolveUsageIdentity(parseBearer(request));
    if (!identity) return;
    if (identity.keyId) await touchKey(identity.keyId).catch(() => undefined);
    await recordUsage({ userId: identity.userId, keyId: identity.keyId, ...usage });
  } catch {
    // Never let usage attribution surface as a request failure.
  }
}
