/**
 * Railyard client layer — openjev usage metering (Rago slice).
 *
 * Wraps the Rago client for the one thing openjev meters: a `systemone_call`
 * event per served System One decision (see the seed at
 * railyard/apps/rago/seeds/opentypesafe.json). Every helper is OPT-IN and
 * best-effort: with RAGO_URL / RAGO_API_KEY unset they are pure no-ops, and a
 * metering failure NEVER breaks a decision request — it is swallowed (structured,
 * key-free) so the endpoint degrades cleanly.
 */

import { isRagoEnabled, type RailyardEnv } from "./config";
import {
  createRagoClient,
  type RagoCurrentUsage,
  type RagoRenderAllowance,
} from "./rago";

/** Billable metric code metered per System One decision call (matches the seed). */
export const SYSTEMONE_METRIC_CODE = "systemone_call";
/** Plan the OpenJev Rago seed provisions (code kept as `opentypesafe_pro` to match the existing seed) (informational — owner seeds it). */
export const OPENJEV_PLAN_CODE = "opentypesafe_pro";

function readEnv(env: RailyardEnv, key: string): string | undefined {
  const raw = env[key];
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return trimmed.length > 0 ? trimmed : undefined;
}

/** True when usage metering (Rago) is configured. */
export function railyardMeteringEnabled(env: RailyardEnv = process.env): boolean {
  return isRagoEnabled(env);
}

/**
 * Stable Rago identifiers for a caller. Prefers explicit RAGO_CUSTOMER_ID /
 * RAGO_SUBSCRIPTION_ID env, else derives from the API key, else a shared
 * "opentypesafe" fallback (anon / keyless self-host).
 */
export function ragoIdentity(
  key: string | undefined,
  env: RailyardEnv = process.env,
): { customerId: string; subscriptionId: string } {
  const safeKey = key && key !== "anon" ? key : "opentypesafe"; // stable Rago customer id (pre-rename; do not change)
  return {
    customerId: readEnv(env, "RAGO_CUSTOMER_ID") ?? safeKey,
    subscriptionId: readEnv(env, "RAGO_SUBSCRIPTION_ID") ?? safeKey,
  };
}

function newTransactionId(): string {
  return `st_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Emit one `systemone_call` usage event. No-op unless Rago is configured; never
 * throws — a metering failure must not fail the decision request.
 */
export async function meterSystemOneCall(args: {
  key?: string;
  requestId?: string;
  env?: RailyardEnv;
}): Promise<void> {
  const env = args.env ?? process.env;
  if (!isRagoEnabled(env)) return;
  try {
    const rago = createRagoClient(env);
    const { subscriptionId } = ragoIdentity(args.key, env);
    await rago.emitEvent({
      code: SYSTEMONE_METRIC_CODE,
      transactionId: args.requestId ?? newTransactionId(),
      externalSubscriptionId: subscriptionId,
    });
  } catch (err) {
    // Metering is best-effort telemetry — degrade cleanly (never leaks a key).
    console.warn(
      "[railyard] systemone metering failed:",
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * Optional pre-check: ask Rago whether this caller may render another call. Returns
 * null when Rago is unconfigured OR the check errored (advisory — never block on a
 * metering outage). A definitive `{ allowed: false }` lets the caller stop.
 */
export async function checkSystemOneAllowance(args: {
  key?: string;
  estimatedCostCents?: number;
  env?: RailyardEnv;
}): Promise<RagoRenderAllowance | null> {
  const env = args.env ?? process.env;
  if (!isRagoEnabled(env)) return null;
  try {
    const rago = createRagoClient(env);
    const { customerId, subscriptionId } = ragoIdentity(args.key, env);
    return await rago.renderAllowance({
      externalCustomerId: customerId,
      externalSubscriptionId: subscriptionId,
      estimatedCostCents: args.estimatedCostCents ?? 0,
    });
  } catch {
    return null;
  }
}

/**
 * Fetch the caller's current metered usage from Rago for the usage surface.
 * Returns null when Rago is unconfigured OR the read errored.
 */
export async function fetchMeteredUsage(args: {
  key?: string;
  env?: RailyardEnv;
}): Promise<RagoCurrentUsage | null> {
  const env = args.env ?? process.env;
  if (!isRagoEnabled(env)) return null;
  try {
    const rago = createRagoClient(env);
    const { customerId, subscriptionId } = ragoIdentity(args.key, env);
    return await rago.currentUsage(customerId, subscriptionId);
  } catch {
    return null;
  }
}
