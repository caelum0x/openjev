/**
 * Creem (merchant of record) webhook parsing and verification. Server-only
 * (node:crypto), no DB: the route in src/routes/api/v1/creem.ts persists.
 *
 * Creem signs every webhook with HMAC-SHA256 over the RAW request body using
 * the webhook secret from the Creem dashboard, hex-encoded in the
 * `creem-signature` header. Events look like:
 *   { id: "evt_…", eventType: "checkout.completed", created_at, object: { … } }
 * where `object` is a checkout (with nested product / customer / subscription /
 * metadata) or a subscription (with product / customer / metadata).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { PLANS, type PlanDefinition } from "./plans.ts";

/** Events that grant (or renew) the paid plan. */
export const UPGRADE_EVENTS = new Set(["checkout.completed", "subscription.active", "subscription.paid"]);
/** Events that end the paid plan (back to Hosted Free). */
export const DOWNGRADE_EVENTS = new Set(["subscription.expired", "subscription.canceled"]);

export type CreemEvent = {
  id: string;
  type: string;
  productId: string | null;
  customerEmail: string | null;
  /** Our user id, when the checkout carried it in metadata / request_id. */
  userId: string | null;
  subscriptionId: string | null;
};

export class CreemPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CreemPayloadError";
  }
}

/** Hex HMAC-SHA256 of `rawBody` under `secret`. */
export function creemSignature(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

/** Constant-time check of the `creem-signature` header. */
export function verifyCreemSignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header || !secret) return false;
  const expected = Buffer.from(creemSignature(rawBody, secret), "hex");
  const given = /^[0-9a-f]+$/i.test(header.trim()) ? Buffer.from(header.trim(), "hex") : Buffer.alloc(0);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** An id that is either a bare string or `{ id }`. */
function idOf(v: unknown): string | null {
  return str(v) ?? str(obj(v)?.id);
}

/** Extract the fields we act on from a parsed Creem event. Throws on a malformed envelope. */
export function parseCreemEvent(body: unknown): CreemEvent {
  const root = obj(body);
  if (!root) throw new CreemPayloadError("Event body must be a JSON object.");
  const id = str(root.id);
  const type = str(root.eventType) ?? str(root.event_type) ?? str(root.type);
  if (!id || !type) throw new CreemPayloadError("Event is missing id or eventType.");
  const o = obj(root.object) ?? {};
  const isSubscription = str(o.object) === "subscription";
  const subscription = obj(o.subscription);
  const metadata = obj(o.metadata) ?? obj(subscription?.metadata) ?? {};
  const customer = obj(o.customer);
  const userId = str(metadata.user_id) ?? str(metadata.userId) ?? str(o.request_id);
  return {
    id,
    type,
    productId: idOf(o.product) ?? idOf(subscription?.product),
    customerEmail: str(customer?.email)?.toLowerCase() ?? null,
    userId,
    subscriptionId: isSubscription ? str(o.id) : idOf(o.subscription),
  };
}

/**
 * The paid plan a Creem product id buys, from CREEM_PRODUCT_ID_<PLAN>. Only
 * the product id (signed by Creem) decides the plan, never client metadata.
 */
export function planForProduct(
  productId: string | null,
  env: Record<string, string | undefined>,
): PlanDefinition | null {
  if (!productId) return null;
  return PLANS.find((p) => p.productEnv && env[p.productEnv]?.trim() === productId) ?? null;
}
