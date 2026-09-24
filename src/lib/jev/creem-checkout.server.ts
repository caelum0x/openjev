import { getSql } from "@/lib/db";
import type { PlanDefinition } from "./plans";

/**
 * Per-user Creem checkout sessions. When CREEM_API_KEY and the plan's
 * CREEM_PRODUCT_ID_<PLAN> are set, checkout is created through the Creem API
 * with `request_id` / `metadata.user_id` = the signed-in account, so the
 * webhook (src/routes/api/v1/creem.ts) upgrades exactly that account even if
 * the buyer pays with a different email. CREEM_API_BASE defaults to
 * https://api.creem.io (use https://test-api.creem.io for test mode).
 */
export function creemApiConfigured(plan: PlanDefinition): boolean {
  return Boolean(process.env.CREEM_API_KEY?.trim() && plan.productEnv && process.env[plan.productEnv]?.trim());
}

async function userEmail(userId: string): Promise<string | null> {
  const sql = await getSql();
  const rows = await sql
    .query<{ email: string }>(`select email from "user" where id = $1`, [userId])
    .catch(() => []);
  return rows[0]?.email ?? null;
}

/** Create a checkout session and return its hosted URL. Throws on API failure. */
export async function createCreemCheckout(
  plan: PlanDefinition,
  userId: string,
  origin: string,
): Promise<string> {
  const apiKey = process.env.CREEM_API_KEY!.trim();
  const productId = process.env[plan.productEnv!]!.trim();
  const base = (process.env.CREEM_API_BASE?.trim() || "https://api.creem.io").replace(/\/+$/, "");
  const email = await userEmail(userId);
  const success = new URL("/settings", origin);
  success.searchParams.set("upgraded", plan.id);
  const res = await fetch(`${base}/v1/checkouts`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify({
      product_id: productId,
      request_id: userId,
      success_url: success.toString(),
      metadata: { user_id: userId, plan: plan.id },
      ...(email ? { customer: { email } } : {}),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json().catch(() => ({}))) as { checkout_url?: unknown; message?: unknown };
  if (!res.ok || typeof body.checkout_url !== "string") {
    throw new Error(
      `Creem checkout failed (${res.status})${typeof body.message === "string" ? `: ${body.message}` : ""}`,
    );
  }
  const url = new URL(body.checkout_url);
  if (url.protocol !== "https:") throw new Error("Creem returned a non-https checkout URL.");
  return url.toString();
}
