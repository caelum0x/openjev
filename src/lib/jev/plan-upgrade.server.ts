import { getSql } from "@/lib/db";
import { DOWNGRADE_EVENTS, planForProduct, UPGRADE_EVENTS, type CreemEvent } from "./creem";
import { planById, type PlanDefinition } from "./plans";

/**
 * Apply a verified Creem event to an account's plan. The plan is the
 * user-level `key_quotas` row (key_id = user id) that quota enforcement and the
 * billing page read. Idempotent: each event id is claimed once in
 * `billing_events`; a retried delivery is acknowledged without re-applying.
 */

export type BillingEventOutcome = {
  event_id: string;
  status: "applied" | "duplicate" | "ignored";
  detail: string;
  user_id: string | null;
  plan: PlanDefinition["id"] | null;
};

async function resolveUser(event: CreemEvent): Promise<string | null> {
  const sql = await getSql();
  if (event.userId) {
    const rows = await sql.query<{ id: string }>(`select id from "user" where id = $1`, [event.userId]);
    if (rows[0]) return rows[0].id;
  }
  if (event.customerEmail) {
    const rows = await sql.query<{ id: string }>(
      `select id from "user" where lower(email) = $1 order by "createdAt" asc limit 1`,
      [event.customerEmail],
    );
    if (rows[0]) return rows[0].id;
  }
  return null;
}

/** Upsert the account-level quota row for `plan`. */
export async function setAccountPlan(userId: string, plan: PlanDefinition): Promise<void> {
  const sql = await getSql();
  await sql.query(
    `insert into key_quotas (key_id, rpm_limit, monthly_quota, updated_at)
     values ($1, $2, $3, now())
     on conflict (key_id) do update
       set rpm_limit = excluded.rpm_limit, monthly_quota = excluded.monthly_quota, updated_at = now()`,
    [userId, plan.rpmLimit, plan.monthlyQuota],
  );
}

async function finish(
  eventId: string,
  outcome: Omit<BillingEventOutcome, "event_id">,
  subscriptionId: string | null,
): Promise<BillingEventOutcome> {
  const sql = await getSql();
  await sql.query(
    `update billing_events set status = $2, detail = $3, user_id = $4, plan = $5, subscription_id = $6
     where id = $1`,
    [eventId, outcome.status, outcome.detail, outcome.user_id, outcome.plan, subscriptionId],
  );
  return { event_id: eventId, ...outcome };
}

async function decide(event: CreemEvent): Promise<Omit<BillingEventOutcome, "event_id">> {
  const isUpgrade = UPGRADE_EVENTS.has(event.type);
  const isDowngrade = DOWNGRADE_EVENTS.has(event.type);
  if (!isUpgrade && !isDowngrade) {
    return { status: "ignored", detail: `event type ${event.type} does not change plans`, user_id: null, plan: null };
  }
  const plan = planForProduct(event.productId, process.env);
  if (!plan) {
    return {
      status: "ignored",
      detail: `product ${event.productId ?? "(none)"} is not mapped to a plan (set CREEM_PRODUCT_ID_CALIBRATE / CREEM_PRODUCT_ID_TEAM)`,
      user_id: null,
      plan: null,
    };
  }
  const userId = await resolveUser(event);
  if (!userId) {
    return {
      status: "ignored",
      detail: `no OpenJev account matches ${event.customerEmail ?? "the checkout"}; sign up with the same email, then contact support with event ${event.id}`,
      user_id: null,
      plan: plan.id,
    };
  }
  if (isUpgrade) {
    await setAccountPlan(userId, plan);
    return { status: "applied", detail: `upgraded to ${plan.name}`, user_id: userId, plan: plan.id };
  }
  // Downgrade only when the ending subscription is the one that granted the plan.
  const sql = await getSql();
  const latest = await sql.query<{ subscription_id: string | null; plan: string | null }>(
    `select subscription_id, plan from billing_events
     where user_id = $1 and status = 'applied' and event_type = any($2::text[])
     order by created_at desc limit 1`,
    [userId, `{${[...UPGRADE_EVENTS].join(",")}}`],
  );
  const granting = latest[0];
  if (granting?.subscription_id && event.subscriptionId && granting.subscription_id !== event.subscriptionId) {
    return {
      status: "ignored",
      detail: `subscription ${event.subscriptionId} ended but the plan comes from ${granting.subscription_id}`,
      user_id: userId,
      plan: null,
    };
  }
  const free = planById("free")!;
  await setAccountPlan(userId, free);
  return { status: "applied", detail: `${event.type}: back to ${free.name}`, user_id: userId, plan: free.id };
}

/** Process one verified Creem event exactly once. */
export async function applyCreemEvent(event: CreemEvent): Promise<BillingEventOutcome> {
  const sql = await getSql();
  const claimed = await sql.query<{ id: string }>(
    `insert into billing_events (id, provider, event_type, status)
     values ($1, 'creem', $2, 'processing')
     on conflict (id) do nothing
     returning id`,
    [event.id, event.type],
  );
  if (claimed.length === 0) {
    const prior = await sql.query<{ status: string; user_id: string | null; plan: string | null }>(
      `select status, user_id, plan from billing_events where id = $1`,
      [event.id],
    );
    return {
      event_id: event.id,
      status: "duplicate",
      detail: `already processed (${prior[0]?.status ?? "unknown"})`,
      user_id: prior[0]?.user_id ?? null,
      plan: (planById(prior[0]?.plan ?? "")?.id ?? null),
    };
  }
  try {
    return await finish(event.id, await decide(event), event.subscriptionId);
  } catch (err) {
    // Release the claim so Creem's retry can process the event again.
    await sql.query(`delete from billing_events where id = $1`, [event.id]).catch(() => undefined);
    throw err;
  }
}
