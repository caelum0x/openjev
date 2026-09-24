import { createFileRoute } from "@tanstack/react-router";
import { CreemPayloadError, parseCreemEvent, verifyCreemSignature } from "@/lib/jev/creem";
import { applyCreemEvent } from "@/lib/jev/plan-upgrade.server";
import { logActivity } from "@/lib/jev/activity.server";

/**
 * Creem webhook: upgrades an account's plan when a checkout for a plan product
 * completes (and on subscription renewal), and returns it to Hosted Free when
 * the subscription is canceled or expires.
 *
 * Setup: in the Creem dashboard add a webhook to https://<your-host>/api/v1/creem
 * and set CREEM_WEBHOOK_SECRET to its signing secret; set
 * CREEM_PRODUCT_ID_CALIBRATE / CREEM_PRODUCT_ID_TEAM to the product ids behind
 * CREEM_CHECKOUT_URL_*. The buyer is matched to an OpenJev account by
 * `metadata.user_id` / `request_id` when the checkout carried it, else by the
 * checkout email. Unsigned or mis-signed requests get 401; each event id is
 * applied once (retries are acknowledged as duplicates).
 */
export const Route = createFileRoute("/api/v1/creem")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.CREEM_WEBHOOK_SECRET?.trim();
        if (!secret) {
          return Response.json(
            { error: { type: "webhook_not_configured", message: "Set CREEM_WEBHOOK_SECRET to accept Creem webhooks." } },
            { status: 503 },
          );
        }
        const raw = await request.text();
        if (!verifyCreemSignature(raw, request.headers.get("creem-signature"), secret)) {
          return Response.json(
            { error: { type: "invalid_signature", message: "creem-signature does not match the body." } },
            { status: 401 },
          );
        }
        let event;
        try {
          event = parseCreemEvent(JSON.parse(raw));
        } catch (err) {
          const message = err instanceof CreemPayloadError ? err.message : "Body is not valid JSON.";
          return Response.json({ error: { type: "invalid_event", message } }, { status: 400 });
        }
        try {
          const outcome = await applyCreemEvent(event);
          if (outcome.status === "applied" && outcome.user_id) {
            await logActivity({
              userId: outcome.user_id,
              kind: "billing.plan_changed",
              summary: outcome.detail,
              meta: { eventId: event.id, eventType: event.type, plan: outcome.plan },
            }).catch(() => undefined);
          }
          if (outcome.status === "ignored") {
            console.warn("[creem] event not applied", { id: event.id, type: event.type, detail: outcome.detail });
          }
          return Response.json({ data: outcome });
        } catch (err) {
          console.error("[creem] failed to apply event", {
            id: event.id,
            type: event.type,
            error: err instanceof Error ? err.message : String(err),
          });
          return Response.json(
            { error: { type: "internal", message: "Could not apply the event; Creem will retry." } },
            { status: 500 },
          );
        }
      },
    },
  },
});
