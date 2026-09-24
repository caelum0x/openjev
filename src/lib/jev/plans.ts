/**
 * Plans and pricing (client-safe: no server imports; the pricing page, the
 * billing summary, and the checkout route share this one table).
 *
 * Positioning: never sell raw inference by the call. Jev charges about $0.01
 * per 1,000 decisions; self-hosting OpenJev is free and unlimited. The hosted
 * product is a subscription for the TRUST tooling (per-question calibration,
 * shadow mode, abstain/out-of-scope, the auto cascade) with a generous
 * decision allowance, and overage priced well under Jev.
 */

export type PlanId = "selfhost" | "free" | "calibrate" | "team";

export type PlanDefinition = {
  id: PlanId;
  code: string;
  name: string;
  monthlyFeeCents: number;
  /** Decisions included per calendar month (0 = unlimited). */
  includedDecisions: number;
  /** key_quotas.monthly_quota that identifies this plan (0 = unlimited). */
  monthlyQuota: number;
  /** Requests per minute per account on this plan (0 = unlimited). */
  rpmLimit: number;
  /** Env var holding the hosted checkout URL (Creem), when purchasable. */
  checkoutEnv?: string;
  /** Env var holding the Creem product id; a paid checkout for it upgrades to this plan. */
  productEnv?: string;
  features: readonly string[];
};

/**
 * Default overage price: $0.002 per 1,000 decisions, 5x under Jev's ~$0.01/1k.
 * Override with OTS_PRICE_PER_1K_DECISIONS_USD (e.g. 0 to never bill overage).
 */
export const DEFAULT_PRICE_PER_1K_DECISIONS_USD = 0.002;
/** Upper bound accepted from config, to catch a units mistake (cents vs USD). */
export const MAX_PRICE_PER_1K_DECISIONS_USD = 1;

export const PLANS: readonly PlanDefinition[] = [
  {
    id: "selfhost",
    code: "openjev_selfhost",
    name: "Self-host",
    monthlyFeeCents: 0,
    includedDecisions: 0,
    monthlyQuota: 0,
    rpmLimit: 0,
    features: [
      "The whole engine, Apache-2.0, unlimited decisions",
      "Calibration, shadow mode, abstain and the auto cascade included",
      "Your infra, your data: nothing leaves the box",
    ],
  },
  {
    id: "free",
    code: "openjev_free",
    name: "Hosted Free",
    monthlyFeeCents: 0,
    includedDecisions: 10_000,
    monthlyQuota: 10_000,
    rpmLimit: 60,
    features: [
      "10,000 decisions / month on the hosted endpoint",
      "Out-of-scope scores and abstain on every answer",
      "Evals with the reliability report",
    ],
  },
  {
    id: "calibrate",
    code: "openjev_calibrate",
    name: "Calibrate",
    monthlyFeeCents: 1_900,
    includedDecisions: 250_000,
    monthlyQuota: 250_000,
    rpmLimit: 600,
    checkoutEnv: "CREEM_CHECKOUT_URL_CALIBRATE",
    productEnv: "CREEM_PRODUCT_ID_CALIBRATE",
    features: [
      "250,000 decisions / month",
      "Per-question calibration fitted on your labels",
      "Shadow mode against your current LLM, threshold recommender",
      "Auto cascade: local first, LLM only when unsure",
    ],
  },
  {
    id: "team",
    code: "openjev_team",
    name: "Team",
    monthlyFeeCents: 9_900,
    includedDecisions: 5_000_000,
    monthlyQuota: 5_000_000,
    rpmLimit: 3_000,
    checkoutEnv: "CREEM_CHECKOUT_URL_TEAM",
    productEnv: "CREEM_PRODUCT_ID_TEAM",
    features: [
      "5,000,000 decisions / month",
      "Everything in Calibrate, multiple projects",
      "Drift webhooks and calibration history for audits",
      "Signed calibration audit reports (HTML + JSON) your risk team can verify",
    ],
  },
];

/** Features sold per plan on the hosted product. Self-host includes everything. */
export type PlanFeature = "audit_reports";

const FEATURE_PLANS: Record<PlanFeature, readonly PlanId[]> = {
  audit_reports: ["selfhost", "team"],
};

/** Cheapest plan that includes `feature`, for upgrade prompts. */
export const FEATURE_MIN_PLAN: Record<PlanFeature, PlanId> = {
  audit_reports: "team",
};

/**
 * Whether plan gating is enforced. Only the hosted service sets
 * OPENJEV_HOSTED=1; a self-hosted install has every feature (Apache-2.0).
 */
export function planGatingEnabled(): boolean {
  const raw = typeof process !== "undefined" ? process.env?.OPENJEV_HOSTED : undefined;
  return raw === "1" || raw?.toLowerCase() === "true";
}

/** True when `plan` includes `feature` (always true when gating is off). */
export function planAllows(plan: PlanDefinition, feature: PlanFeature): boolean {
  if (!planGatingEnabled()) return true;
  return FEATURE_PLANS[feature].includes(plan.id);
}

export function planById(id: string): PlanDefinition | undefined {
  return PLANS.find((p) => p.id === id);
}

/** The plan an account is on, inferred from its effective monthly quota. */
export function planForQuota(monthlyQuota: number): PlanDefinition {
  if (monthlyQuota === 0) return PLANS[0]!;
  const sorted = [...PLANS].filter((p) => p.monthlyQuota > 0).sort((a, b) => b.monthlyQuota - a.monthlyQuota);
  return sorted.find((p) => monthlyQuota >= p.monthlyQuota) ?? planById("free")!;
}

/**
 * Configured overage price per 1,000 decisions in USD. A malformed or
 * out-of-range OTS_PRICE_PER_1K_DECISIONS_USD falls back to the default (the
 * billing page shows the rate in effect, so a bad value is visible).
 */
export function pricePer1kDecisionsUsd(): number {
  const raw = typeof process !== "undefined" ? process.env?.OTS_PRICE_PER_1K_DECISIONS_USD : undefined;
  if (raw === undefined || raw.trim() === "") return DEFAULT_PRICE_PER_1K_DECISIONS_USD;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= MAX_PRICE_PER_1K_DECISIONS_USD
    ? n
    : DEFAULT_PRICE_PER_1K_DECISIONS_USD;
}

/** Overage price per single decision, in cents (a small fraction of a cent). */
export function pricePerCallCents(): number {
  return (pricePer1kDecisionsUsd() * 100) / 1000;
}

/** Format cents as "$19" / "$0". */
export function formatPlanPrice(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}
