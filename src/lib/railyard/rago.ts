/**
 * Railyard client layer — RAGO (usage metering).
 *
 * Thin fetch client for the standalone Rago Rust server. Rago speaks CENTS and
 * exposes a REST API under `/api/v1`, authenticated with
 * `Authorization: Bearer <RAGO_API_KEY>`. There is no TS SDK, so this is a
 * hand-written client that mirrors the server's request/response envelopes.
 *
 * Entirely OPT-IN: every method first checks `getRagoConfig()`. When Rago is
 * unconfigured a method throws RailyardError("not_configured") so the caller can
 * fall back to running without metering. The seed catalog for openjev
 * (metric `systemone_call`, plan `opentypesafe_pro`) lives at
 * railyard/apps/rago/seeds/opentypesafe.json — provisioning of the API key +
 * metric/plan is out-of-band (owner seed).
 */

import { getRagoConfig, type RagoConfig, type RailyardEnv } from "./config";
import { RailyardError } from "./errors";
import { railyardFetch } from "./http";

const API_BASE = "/api/v1";

// ── Request/response shapes (mirror the Rago server envelopes) ────────────────

/** One metered usage event. `transactionId` is the idempotency key. */
export interface RagoEmitEventInput {
  /** Billable metric code (e.g. "systemone_call"). */
  code: string;
  /** Idempotency key — Rago dedupes on this. */
  transactionId: string;
  externalSubscriptionId: string;
  /** Metric properties (dimensions/amounts) — provider-specific. */
  properties?: Record<string, string | number | boolean>;
  /** RFC3339/epoch timestamp; defaults to server time when omitted. */
  timestamp?: string | number;
}

export interface RagoEmitEventResult {
  emitted: boolean;
  transactionId: string;
}

export interface RagoRenderAllowanceInput {
  externalCustomerId: string;
  externalSubscriptionId: string;
  estimatedCostCents: number;
  /** Optional hard cap for this action, in cents. */
  capCents?: number;
}

export interface RagoRenderAllowance {
  allowed: boolean;
  reasons: string[];
  currentUsageCents: number;
  projectedUsageCents: number;
  creditBalanceCents: number;
  capCents: number | null;
}

export interface RagoUpsertCustomerInput {
  externalId: string;
  name?: string;
  email?: string;
  currency?: string;
}

export interface RagoCustomer {
  externalId: string;
}

export interface RagoEnsureSubscriptionInput {
  externalCustomerId: string;
  planCode: string;
  /** When omitted, Rago assigns one — captured from the response. */
  externalId?: string;
  billingTime?: "calendar" | "anniversary";
}

export interface RagoSubscription {
  externalId: string;
  planCode: string;
  externalCustomerId: string;
}

export interface RagoChargeUsage {
  code: string;
  amountCents: number;
  units?: number;
}

export interface RagoCurrentUsage {
  amountCents: number;
  charges: RagoChargeUsage[];
}

// ── Client ────────────────────────────────────────────────────────────────────

export interface RagoClient {
  readonly configured: boolean;
  emitEvent(input: RagoEmitEventInput): Promise<RagoEmitEventResult>;
  renderAllowance(input: RagoRenderAllowanceInput): Promise<RagoRenderAllowance>;
  upsertCustomer(input: RagoUpsertCustomerInput): Promise<RagoCustomer>;
  ensureSubscription(input: RagoEnsureSubscriptionInput): Promise<RagoSubscription>;
  currentUsage(
    externalCustomerId: string,
    externalSubscriptionId: string,
  ): Promise<RagoCurrentUsage>;
}

function authHeaders(config: RagoConfig): Record<string, string> {
  return { Authorization: `Bearer ${config.apiKey}` };
}

function requireConfigured(
  config: RagoConfig,
): asserts config is RagoConfig & { apiKey: string } {
  if (!config.configured || !config.apiKey) {
    throw new RailyardError("Rago is not configured", {
      service: "rago",
      code: "not_configured",
    });
  }
}

/**
 * Build a Rago client bound to the given env. Construction never throws; the
 * gate is enforced per-call so a caller can safely construct the client and then
 * branch on `.configured`.
 */
export function createRagoClient(env: RailyardEnv = process.env): RagoClient {
  const config = getRagoConfig(env);

  return {
    configured: config.configured,

    async emitEvent(input) {
      requireConfigured(config);
      const endpoint = `${API_BASE}/events`;
      await railyardFetch({
        service: "rago",
        method: "POST",
        url: `${config.baseUrl}${endpoint}`,
        endpoint,
        headers: authHeaders(config),
        body: {
          event: {
            code: input.code,
            transaction_id: input.transactionId,
            external_subscription_id: input.externalSubscriptionId,
            properties: input.properties ?? {},
            ...(input.timestamp !== undefined ? { timestamp: input.timestamp } : {}),
          },
        },
      });
      return { emitted: true, transactionId: input.transactionId };
    },

    async renderAllowance(input) {
      requireConfigured(config);
      const endpoint = `${API_BASE}/customers/${encodeURIComponent(
        input.externalCustomerId,
      )}/render_allowance`;
      const { data } = await railyardFetch<{ render_allowance?: RawRenderAllowance }>({
        service: "rago",
        method: "POST",
        url: `${config.baseUrl}${endpoint}`,
        endpoint,
        headers: authHeaders(config),
        body: {
          external_subscription_id: input.externalSubscriptionId,
          estimated_cost_cents: Math.trunc(input.estimatedCostCents),
          ...(input.capCents !== undefined ? { cap_cents: Math.trunc(input.capCents) } : {}),
        },
      });
      return normalizeRenderAllowance(data.render_allowance, endpoint);
    },

    async upsertCustomer(input) {
      requireConfigured(config);
      const endpoint = `${API_BASE}/customers`;
      await railyardFetch({
        service: "rago",
        method: "POST",
        url: `${config.baseUrl}${endpoint}`,
        endpoint,
        headers: authHeaders(config),
        body: {
          customer: {
            external_id: input.externalId,
            ...(input.name ? { name: input.name } : {}),
            ...(input.email ? { email: input.email } : {}),
            ...(input.currency ? { currency: input.currency } : {}),
          },
        },
      });
      return { externalId: input.externalId };
    },

    async ensureSubscription(input) {
      requireConfigured(config);
      const endpoint = `${API_BASE}/subscriptions`;
      const { data } = await railyardFetch<{ subscription?: RawSubscription }>({
        service: "rago",
        method: "POST",
        url: `${config.baseUrl}${endpoint}`,
        endpoint,
        headers: authHeaders(config),
        body: {
          subscription: {
            external_customer_id: input.externalCustomerId,
            plan_code: input.planCode,
            billing_time: input.billingTime ?? "anniversary",
            ...(input.externalId ? { external_id: input.externalId } : {}),
          },
        },
      });
      const externalId = data.subscription?.external_id ?? input.externalId;
      if (!externalId) {
        throw new RailyardError("Rago subscription response had no external_id", {
          service: "rago",
          code: "bad_response",
          endpoint,
        });
      }
      return {
        externalId,
        planCode: data.subscription?.plan_code ?? input.planCode,
        externalCustomerId:
          data.subscription?.external_customer_id ?? input.externalCustomerId,
      };
    },

    async currentUsage(externalCustomerId, externalSubscriptionId) {
      requireConfigured(config);
      const endpoint = `${API_BASE}/customers/${encodeURIComponent(
        externalCustomerId,
      )}/current_usage`;
      const query = `?external_subscription_id=${encodeURIComponent(externalSubscriptionId)}`;
      const { data } = await railyardFetch<{ customer_usage?: RawCurrentUsage }>({
        service: "rago",
        method: "GET",
        url: `${config.baseUrl}${endpoint}${query}`,
        endpoint,
        headers: authHeaders(config),
      });
      return normalizeCurrentUsage(data.customer_usage);
    },
  };
}

// ── Response normalizers (snake_case wire → camelCase domain) ─────────────────

interface RawRenderAllowance {
  allowed?: boolean;
  reasons?: string[];
  current_usage_cents?: number;
  projected_usage_cents?: number;
  credit_balance_cents?: number;
  cap_cents?: number | null;
}

interface RawSubscription {
  external_id?: string;
  plan_code?: string;
  external_customer_id?: string;
}

interface RawCurrentUsage {
  amount_cents?: number;
  charges_usage?: Array<{ code?: string; amount_cents?: number; units?: number }>;
}

function normalizeRenderAllowance(
  raw: RawRenderAllowance | undefined,
  endpoint: string,
): RagoRenderAllowance {
  if (!raw) {
    throw new RailyardError("Rago render_allowance response was empty", {
      service: "rago",
      code: "bad_response",
      endpoint,
    });
  }
  return {
    // Fail CLOSED: an ambiguous/absent `allowed` is treated as not allowed.
    allowed: raw.allowed === true,
    reasons: raw.reasons ?? [],
    currentUsageCents: raw.current_usage_cents ?? 0,
    projectedUsageCents: raw.projected_usage_cents ?? 0,
    creditBalanceCents: raw.credit_balance_cents ?? 0,
    capCents: raw.cap_cents ?? null,
  };
}

function normalizeCurrentUsage(raw: RawCurrentUsage | undefined): RagoCurrentUsage {
  return {
    amountCents: raw?.amount_cents ?? 0,
    charges: (raw?.charges_usage ?? []).map((c) => ({
      code: c.code ?? "",
      amountCents: c.amount_cents ?? 0,
      units: c.units,
    })),
  };
}
