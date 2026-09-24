import { getSql } from "@/lib/db";
import {
  fetchMeteredUsage,
  railyardMeteringEnabled,
  OPENJEV_PLAN_CODE,
} from "@/lib/railyard/meter";
import { getUserQuota, FREE_TIER_MONTHLY_QUOTA, FREE_TIER_RPM } from "@/lib/jev/quota.server";

/**
 * DB-backed billing summary (Foundation-2). Reads the plan tier + usage-based
 * cost either from the railyard Rago metering service (when configured) or,
 * otherwise, derives it from the persisted `usage_events` rollup. Invoices are a
 * per-month rollup of real usage. Scoped to a server-resolved `userId`.
 */

import {
  DEFAULT_PRICE_PER_1K_DECISIONS_USD,
  planForQuota,
  pricePer1kDecisionsUsd,
  pricePerCallCents,
  type PlanDefinition,
} from "@/lib/jev/plans";

/**
 * Derived pricing (used only when no metering backend is configured). The
 * hosted product is a SUBSCRIPTION for the trust tooling (calibration, shadow,
 * abstain, cascade) with a generous included decision allowance; raw inference
 * beyond the allowance is priced far below Jev (~$0.01 per 1k decisions) and is
 * configurable with OTS_PRICE_PER_1K_DECISIONS_USD. See src/lib/jev/plans.ts.
 * Real settlement runs through railyard (Rago = cents, Mint = microdollars).
 *
 * @deprecated Read `pricePerCallCents()` (env-configurable); kept for callers
 * that imported the old constant. Default: $0.002 per 1k = 0.0002 cents/call.
 */
export const OTS_PRICE_PER_CALL_CENTS = (DEFAULT_PRICE_PER_1K_DECISIONS_USD * 100) / 1000;

export type BillingPlan = {
  code: string;
  name: string;
  tier: PlanDefinition["id"];
  source: "railyard" | "derived";
  monthly_fee_cents: number;
  included_decisions: number;
};

export type BillingPeriod = {
  label: string; // e.g. "2026-09"
  start: string; // YYYY-MM-DD (inclusive)
  end: string; // YYYY-MM-DD (exclusive — first day of next month)
};

export type BillingUsage = {
  calls: number;
  questions: number;
  input_tokens: number;
  output_tokens: number;
  tokens: number;
};

export type BillingCharge = { code: string; amount_cents: number; units?: number };

export type BillingCost = {
  estimated_cents: number;
  currency: "usd";
  source: "railyard" | "derived";
  /** Overage price per decision in cents (tiny: see rate_per_1k_decisions_usd). */
  rate_per_call_cents: number;
  /** Overage price per 1,000 decisions in USD (config: OTS_PRICE_PER_1K_DECISIONS_USD). */
  rate_per_1k_decisions_usd: number;
  /** Plan subscription fee for the period, in cents. */
  plan_fee_cents: number;
  /** Decisions beyond the plan allowance this period. */
  overage_decisions: number;
  charges: BillingCharge[];
};

export type BillingInvoice = {
  id: string;
  month: string; // YYYY-MM
  calls: number;
  tokens: number;
  amount_cents: number;
  status: "open" | "paid";
  issued_at: number; // epoch millis (first event of the month)
};

/** The active quota limits for an account. Source: key_quotas (user-level row) or free-tier defaults. */
export type PlanQuota = {
  rpm_limit: number; // requests per minute per key; 0 = unlimited
  monthly_quota: number; // decisions per calendar month; 0 = unlimited
  source: "db" | "default";
};

export type BillingSummary = {
  plan: BillingPlan;
  quota: PlanQuota;
  metering: { configured: boolean };
  period: BillingPeriod;
  usage: BillingUsage;
  cost: BillingCost;
  invoices: BillingInvoice[];
};

/**
 * Derive a period's cost (cents) from a call count under `plan`: the plan fee
 * plus overage beyond the included allowance at the per-1k rate. Rounded to
 * whole cents at the end (per-call cents are fractions of a cent).
 */
export function deriveCents(calls: number, plan: PlanDefinition): {
  total: number;
  overage: number;
} {
  const overage = Math.max(0, calls - plan.includedDecisions);
  return {
    total: Math.round(plan.monthlyFeeCents + overage * pricePerCallCents()),
    overage,
  };
}

/** The current calendar-month period as YYYY-MM-DD boundaries. */
function currentPeriod(): BillingPeriod {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const pad = (n: number) => String(n).padStart(2, "0");
  const start = `${y}-${pad(m + 1)}-01`;
  const nextY = m === 11 ? y + 1 : y;
  const nextM = m === 11 ? 0 : m + 1;
  const end = `${nextY}-${pad(nextM + 1)}-01`;
  return { label: `${y}-${pad(m + 1)}`, start, end };
}

/**
 * The full billing summary for `userId`. `key` (a bearer token, when present)
 * lets the Rago read attribute usage to the caller's subscription.
 */
export async function billingSummary(opts: {
  userId: string;
  key?: string;
}): Promise<BillingSummary> {
  const sql = await getSql();
  const { userId } = opts;
  const period = currentPeriod();
  const meteringConfigured = railyardMeteringEnabled();

  // Current-month usage rollup from persisted events (always available).
  const usageRows = await sql.query<{
    calls: number;
    questions: number;
    input_tokens: number;
    output_tokens: number;
  }>(
    `select count(*)::int as calls,
            coalesce(sum(questions), 0)::bigint as questions,
            coalesce(sum(input_tokens), 0)::bigint as input_tokens,
            coalesce(sum(output_tokens), 0)::bigint as output_tokens
     from usage_events
     where user_id = $1 and ts >= date_trunc('month', now())`,
    [userId],
  );
  const u = usageRows[0];
  const usage: BillingUsage = {
    calls: u.calls,
    questions: u.questions,
    input_tokens: u.input_tokens,
    output_tokens: u.output_tokens,
    tokens: u.input_tokens + u.output_tokens,
  };

  // Effective account quota: user-level key_quotas row when present, else free-tier defaults.
  const rawQuota = await getUserQuota(userId).catch(() => null);
  const quota: PlanQuota = rawQuota
    ? {
        rpm_limit: rawQuota.rpm_limit,
        monthly_quota: rawQuota.monthly_quota,
        source:
          rawQuota.rpm_limit === FREE_TIER_RPM &&
          rawQuota.monthly_quota === FREE_TIER_MONTHLY_QUOTA
            ? "default"
            : "db",
      }
    : { rpm_limit: FREE_TIER_RPM, monthly_quota: FREE_TIER_MONTHLY_QUOTA, source: "default" };

  const planDef = planForQuota(quota.monthly_quota);
  const derived = deriveCents(usage.calls, planDef);
  const rate1k = pricePer1kDecisionsUsd();

  // Prefer real metered cost from Rago; fall back to the derived estimate.
  const metered = meteringConfigured ? await fetchMeteredUsage({ key: opts.key }) : null;
  const cost: BillingCost = metered
    ? {
        estimated_cents: metered.amountCents,
        currency: "usd",
        source: "railyard",
        rate_per_call_cents: pricePerCallCents(),
        rate_per_1k_decisions_usd: rate1k,
        plan_fee_cents: planDef.monthlyFeeCents,
        overage_decisions: derived.overage,
        charges: metered.charges.map((c) => ({
          code: c.code,
          amount_cents: c.amountCents,
          units: c.units,
        })),
      }
    : {
        estimated_cents: derived.total,
        currency: "usd",
        source: "derived",
        rate_per_call_cents: pricePerCallCents(),
        rate_per_1k_decisions_usd: rate1k,
        plan_fee_cents: planDef.monthlyFeeCents,
        overage_decisions: derived.overage,
        charges: [],
      };

  const plan: BillingPlan = {
    code: meteringConfigured ? OPENJEV_PLAN_CODE : planDef.code,
    name: planDef.name,
    tier: planDef.id,
    source: meteringConfigured ? "railyard" : "derived",
    monthly_fee_cents: planDef.monthlyFeeCents,
    included_decisions: planDef.includedDecisions,
  };

  // Per-month invoice rollup from real usage (last 6 months). The current month
  // is "open"; earlier months are shown as "paid".
  const monthRows = await sql.query<{
    month: string;
    calls: number;
    tokens: number;
    first_ts: number;
  }>(
    `select to_char(date_trunc('month', ts), 'YYYY-MM') as month,
            count(*)::int as calls,
            coalesce(sum(input_tokens + output_tokens), 0)::bigint as tokens,
            (extract(epoch from min(ts)) * 1000)::bigint as first_ts
     from usage_events
     where user_id = $1 and ts >= date_trunc('month', now()) - interval '5 months'
     group by 1
     order by 1 desc`,
    [userId],
  );
  const invoices: BillingInvoice[] = monthRows.map((r) => {
    const isCurrent = r.month === period.label;
    const amount =
      isCurrent && cost.source === "railyard"
        ? cost.estimated_cents
        : deriveCents(r.calls, planDef).total;
    return {
      id: `inv_${r.month}`,
      month: r.month,
      calls: r.calls,
      tokens: r.tokens,
      amount_cents: amount,
      status: isCurrent ? "open" : "paid",
      issued_at: r.first_ts,
    };
  });

  return {
    plan,
    quota,
    metering: { configured: meteringConfigured },
    period,
    usage,
    cost,
    invoices,
  };
}
