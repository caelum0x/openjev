import { createHash } from "node:crypto";
import { getSql } from "@/lib/db";

/**
 * Per-key rate-limit and monthly-quota enforcement (Phase-2 multi-tenant).
 *
 * Fail-open rules:
 *  - bearer === "anon"  →  self-hosted / keyless call; always allowed.
 *  - Valid key but no `key_quotas` row  →  apply free-tier defaults.
 *  - Unknown or revoked bearer  →  allowed here; auth surfaces the 401 separately.
 *
 * The RPM window is a fixed 60-second window (count of usage_events in the last
 * minute for the resolved key). The monthly window is the current calendar month
 * via date_trunc('month', now()) so it resets cleanly at midnight UTC on the 1st.
 */

/** Default rate limits applied when no `key_quotas` row exists for a key. */
export const FREE_TIER_RPM = 60;
/** Default monthly decision quota (0 = unlimited). */
export const FREE_TIER_MONTHLY_QUOTA = 10_000;

export type QuotaAllowed = { allowed: true };

export type QuotaDenied = {
  allowed: false;
  reason: "rate_limit" | "quota_exceeded";
  message: string;
  used: number;
  limit: number;
  reset_at: string; // ISO-8601
};

export type QuotaCheckResult = QuotaAllowed | QuotaDenied;

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Check the rate limit and monthly quota for an inbound decision request.
 *
 * Accepts the raw bearer token. Resolves to the key's DB `id` internally with
 * a single join so the key-lookup and quota-read cost one SQL round-trip.
 */
export async function checkQuota(bearer: string): Promise<QuotaCheckResult> {
  // Fail-open for anonymous / self-hosted calls.
  if (bearer === "anon") return { allowed: true };

  const sql = await getSql();

  // Resolve key + its quota in one query. A left join means we still get the
  // keyId even when no quota row exists (we use free-tier defaults in that case).
  // Limits: a per-key row wins; otherwise the account's plan row (key_id =
  // user id, written by the Creem webhook on upgrade); otherwise free tier.
  // Account-plan limits are counted across all of the account's keys.
  const keyRows = await sql.query<{
    id: string;
    user_id: string;
    rpm_limit: number | null;
    monthly_quota: number | null;
    plan_rpm: number | null;
    plan_monthly: number | null;
  }>(
    `select k.id, k.user_id,
            q.rpm_limit, q.monthly_quota,
            uq.rpm_limit as plan_rpm, uq.monthly_quota as plan_monthly
     from api_keys k
     left join key_quotas q on q.key_id = k.id
     left join key_quotas uq on uq.key_id = k.user_id
     where k.secret_hash = $1 and k.revoked_at is null
     limit 1`,
    [sha256(bearer)],
  );

  const keyRow = keyRows[0];
  // Unknown bearer: not a live ots_live_ key — pass through; auth will 401 it.
  if (!keyRow) return { allowed: true };

  const perKey = keyRow.rpm_limit != null || keyRow.monthly_quota != null;
  const byAccount = !perKey && (keyRow.plan_rpm != null || keyRow.plan_monthly != null);
  const scopeCol = byAccount ? "user_id" : "key_id";
  const scopeId = byAccount ? keyRow.user_id : keyRow.id;
  const rpmLimit = (perKey ? keyRow.rpm_limit : keyRow.plan_rpm) ?? FREE_TIER_RPM;
  const monthlyQuota = (perKey ? keyRow.monthly_quota : keyRow.plan_monthly) ?? FREE_TIER_MONTHLY_QUOTA;

  // ── RPM: fixed 60-second window ───────────────────────────────────────────
  if (rpmLimit > 0) {
    const rpmRows = await sql.query<{ cnt: number }>(
      `select count(*)::int as cnt
       from usage_events
       where ${scopeCol} = $1 and ts > now() - interval '60 seconds'`,
      [scopeId],
    );
    const rpmUsed = rpmRows[0]?.cnt ?? 0;
    if (rpmUsed >= rpmLimit) {
      const resetAt = new Date(Math.ceil(Date.now() / 60_000) * 60_000).toISOString();
      return {
        allowed: false,
        reason: "rate_limit",
        message: `Rate limit exceeded: ${rpmUsed}/${rpmLimit} requests in the last minute.`,
        used: rpmUsed,
        limit: rpmLimit,
        reset_at: resetAt,
      };
    }
  }

  // ── Monthly quota (0 = unlimited) ─────────────────────────────────────────
  if (monthlyQuota > 0) {
    const monthRows = await sql.query<{ cnt: number }>(
      `select count(*)::int as cnt
       from usage_events
       where ${scopeCol} = $1 and ts >= date_trunc('month', now())`,
      [scopeId],
    );
    const monthUsed = monthRows[0]?.cnt ?? 0;
    if (monthUsed >= monthlyQuota) {
      const now = new Date();
      const nextMonth = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
      );
      return {
        allowed: false,
        reason: "quota_exceeded",
        message: `Monthly quota exceeded: ${monthUsed}/${monthlyQuota} decisions this month.`,
        used: monthUsed,
        limit: monthlyQuota,
        reset_at: nextMonth.toISOString(),
      };
    }
  }

  return { allowed: true };
}

/**
 * Fetch the effective quota limits for a user account (for billing display).
 *
 * Looks for a user-level override row where key_id = userId in key_quotas;
 * falls back to the free-tier defaults when no such row exists.
 */
export async function getUserQuota(userId: string): Promise<{
  rpm_limit: number;
  monthly_quota: number;
}> {
  const sql = await getSql();
  const rows = await sql.query<{ rpm_limit: number; monthly_quota: number }>(
    `select rpm_limit, monthly_quota from key_quotas where key_id = $1`,
    [userId],
  );
  return rows[0] ?? {
    rpm_limit: FREE_TIER_RPM,
    monthly_quota: FREE_TIER_MONTHLY_QUOTA,
  };
}
