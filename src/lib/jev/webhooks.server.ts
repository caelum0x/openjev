import { createHmac, randomBytes } from "node:crypto";
import { getSql } from "@/lib/db";

/**
 * DB-backed, user-scoped outbound webhooks (Foundation-2). A user registers a URL
 * to be notified of console events; deliveries are HMAC-signed with a per-webhook
 * `secret`. Only a hint of the secret is returned to the client — the full secret
 * is shown once at creation and kept server-side for signing. Scoped to a
 * server-resolved `userId`.
 */

/** Public webhook row (no full secret). Timestamps are epoch millis. */
export type PublicWebhook = {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  secret_hint: string; // e.g. "whsec_ab12…" — never the full secret
  created_at: number;
  last_delivery_at: number | null;
};

/** `createWebhook` result: the public row PLUS the one-time plaintext secret. */
export type CreatedWebhook = PublicWebhook & { secret: string };

/** Result of a signed test delivery. */
export type WebhookDelivery = {
  ok: boolean;
  status: number; // HTTP status, or 0 when the request never completed
  signature: string; // the X-OTS-Signature header value that was sent
  event: Record<string, unknown>; // the payload that was posted
  duration_ms: number;
  error?: string;
};

const PUBLIC_COLS = `
  id, url, events, active,
  substr(secret, 1, 12) || '…' as secret_hint,
  (extract(epoch from created_at) * 1000)::bigint       as created_at,
  (extract(epoch from last_delivery_at) * 1000)::bigint as last_delivery_at`;

function suffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

// Render a JS string[] as a Postgres array literal passed as one `$n::text[]`
// param, so both Neon and PGLite bind it identically (see keys.server.ts).
function toPgTextArray(values: string[]): string {
  if (values.length === 0) return "{}";
  const escaped = values.map(
    (v) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`,
  );
  return `{${escaped.join(",")}}`;
}

/** True when `url` is a well-formed http(s) URL with a host. */
export function isValidWebhookUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === "http:" || u.protocol === "https:") && Boolean(u.host);
  } catch {
    return false;
  }
}

/** Create a webhook for `userId`. Returns the public row PLUS the one-time secret. */
export async function createWebhook(
  userId: string,
  input: { url: string; events?: string[]; secret?: string },
): Promise<CreatedWebhook> {
  const sql = await getSql();
  const id = `wh_${Date.now().toString(36)}${suffix()}`;
  const secret = input.secret?.trim() || `whsec_${randomBytes(24).toString("hex")}`;
  const events = Array.isArray(input.events) ? input.events.filter(Boolean) : [];
  const rows = await sql.query<PublicWebhook>(
    `insert into webhooks (id, user_id, url, secret, events)
     values ($1, $2, $3, $4, $5::text[])
     returning ${PUBLIC_COLS}`,
    [id, userId, input.url.trim(), secret, toPgTextArray(events)],
  );
  return { ...rows[0], secret };
}

/** A user's webhooks, newest first. */
export async function listWebhooks(userId: string): Promise<PublicWebhook[]> {
  const sql = await getSql();
  return sql.query<PublicWebhook>(
    `select ${PUBLIC_COLS} from webhooks where user_id = $1 order by created_at desc`,
    [userId],
  );
}

/** One webhook by id (scoped to the user), or null. */
export async function getWebhook(
  userId: string,
  id: string,
): Promise<PublicWebhook | null> {
  const sql = await getSql();
  const rows = await sql.query<PublicWebhook>(
    `select ${PUBLIC_COLS} from webhooks where id = $1 and user_id = $2`,
    [id, userId],
  );
  return rows[0] ?? null;
}

/** Update a webhook's url / events / active flag (scoped). Null if absent. */
export async function updateWebhook(
  userId: string,
  id: string,
  patch: { url?: string; events?: string[]; active?: boolean },
): Promise<PublicWebhook | null> {
  const current = await getWebhook(userId, id);
  if (!current) return null;

  const url =
    typeof patch.url === "string" && patch.url.trim() ? patch.url.trim() : current.url;
  const events = Array.isArray(patch.events)
    ? patch.events.filter(Boolean)
    : current.events;
  const active = typeof patch.active === "boolean" ? patch.active : current.active;

  const sql = await getSql();
  const rows = await sql.query<PublicWebhook>(
    `update webhooks set url = $3, events = $4::text[], active = $5
     where id = $1 and user_id = $2
     returning ${PUBLIC_COLS}`,
    [id, userId, url, toPgTextArray(events), active],
  );
  return rows[0] ?? null;
}

/** Hard-delete a webhook (scoped to the user). True if a row was removed. */
export async function deleteWebhook(userId: string, id: string): Promise<boolean> {
  const sql = await getSql();
  const rows = await sql.query<{ id: string }>(
    `delete from webhooks where id = $1 and user_id = $2 returning id`,
    [id, userId],
  );
  return rows.length > 0;
}

/** The Stripe-style signature header value for a payload. */
function signPayload(secret: string, timestamp: number, body: string): string {
  const mac = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${mac}`;
}

/**
 * POST a signed event to `url`. Signs `{ id, type, created, data }` with
 * HMAC-SHA256 over `<ts>.<body>` (header `X-OTS-Signature: t=<ts>,v1=<hex>`).
 * Best-effort: network/timeout errors are captured, never thrown.
 */
export async function deliverSignedEvent(
  url: string,
  secret: string,
  type: string,
  data: Record<string, unknown>,
): Promise<WebhookDelivery> {
  const timestamp = Math.floor(Date.now() / 1000);
  const event = {
    id: `evt_${Date.now().toString(36)}${suffix()}`,
    type,
    created: timestamp,
    data,
  };
  const body = JSON.stringify(event);
  const signature = signPayload(secret, timestamp, body);
  if (!isValidWebhookUrl(url)) {
    return {
      ok: false,
      status: 0,
      signature,
      event,
      duration_ms: 0,
      error: "Webhook URL must be a valid http(s) URL",
    };
  }
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "openjev-webhooks/1",
        "x-ots-event": type,
        "x-ots-signature": signature,
      },
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    return { ok: res.ok, status: res.status, signature, event, duration_ms: Date.now() - started };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      signature,
      event,
      duration_ms: Date.now() - started,
      error: err instanceof Error ? err.message : "delivery failed",
    };
  }
}

/**
 * Deliver `type` to one of the user's webhooks (by id). Skips inactive
 * webhooks and webhooks whose non-empty `events` list excludes `type`.
 * Returns null when the webhook does not exist for this user.
 */
export async function deliverToWebhook(
  userId: string,
  id: string,
  type: string,
  data: Record<string, unknown>,
): Promise<WebhookDelivery | null> {
  const sql = await getSql();
  const rows = await sql.query<{ url: string; secret: string; active: boolean; events: string[] }>(
    `select url, secret, active, events from webhooks where id = $1 and user_id = $2`,
    [id, userId],
  );
  const hook = rows[0];
  if (!hook) return null;
  const events = Array.isArray(hook.events) ? hook.events : [];
  if (!hook.active || (events.length > 0 && !events.includes(type) && type !== "ping")) {
    return {
      ok: false,
      status: 0,
      signature: "",
      event: { type, data },
      duration_ms: 0,
      error: hook.active ? `Webhook is not subscribed to ${type}` : "Webhook is paused",
    };
  }
  const delivery = await deliverSignedEvent(hook.url, hook.secret, type, data);
  await sql
    .query(`update webhooks set last_delivery_at = now() where id = $1 and user_id = $2`, [id, userId])
    .catch(() => undefined);
  return delivery;
}

/**
 * Send a signed `ping` test delivery to a webhook's URL. Returns null when the
 * webhook doesn't exist. Delivered even when paused, so a URL can be checked
 * before it is switched on.
 */
export async function testWebhook(
  userId: string,
  id: string,
): Promise<WebhookDelivery | null> {
  const sql = await getSql();
  const rows = await sql.query<{ url: string; secret: string }>(
    `select url, secret from webhooks where id = $1 and user_id = $2`,
    [id, userId],
  );
  if (rows.length === 0) return null;
  const { url, secret } = rows[0];
  const delivery = await deliverSignedEvent(url, secret, "ping", {
    message: "openjev webhook test delivery",
    webhook_id: id,
  });
  await sql
    .query(`update webhooks set last_delivery_at = now() where id = $1 and user_id = $2`, [
      id,
      userId,
    ])
    .catch(() => undefined);
  return delivery;
}
