import { createFileRoute } from "@tanstack/react-router";
import { planById } from "@/lib/jev/plans";
import { requireUserId } from "@/lib/auth/verify.server";
import { createCreemCheckout, creemApiConfigured } from "@/lib/jev/creem-checkout.server";

/**
 * Hosted-plan checkout. GET /api/v1/checkout?plan=calibrate|team redirects to
 * the plan's hosted checkout (Creem, merchant of record) configured in
 * CREEM_CHECKOUT_URL_<PLAN>. When the URL is not configured on this deployment
 * the browser is sent back to /pricing with a visible configuration error, and
 * JSON clients get a 503 naming the missing variable. Nothing is faked.
 *
 * With CREEM_API_KEY + CREEM_PRODUCT_ID_<PLAN> set and a signed-in user, a
 * per-user checkout session is created instead, so the Creem webhook upgrades
 * that exact account (see /api/v1/creem). A failure there falls back to the
 * static link when one is configured.
 */
function wantsJson(request: Request): boolean {
  return (request.headers.get("accept") ?? "").includes("application/json");
}

export const Route = createFileRoute("/api/v1/checkout")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const planId = url.searchParams.get("plan") ?? "";
        const plan = planById(planId);
        if (!plan || !plan.checkoutEnv) {
          return Response.json(
            { error: { type: "invalid_request", message: "plan must be calibrate or team" } },
            { status: 400 },
          );
        }
        if (creemApiConfigured(plan)) {
          const userId = await requireUserId().catch(() => null);
          // Signed out: use the static link (matched by email) when there is
          // one, otherwise ask the visitor to sign in first.
          if (!userId && !process.env[plan.checkoutEnv]?.trim()) {
            return Response.redirect(new URL("/login", url.origin).toString(), 302);
          }
          if (userId) {
            try {
              return Response.redirect(await createCreemCheckout(plan, userId, url.origin), 302);
            } catch (err) {
              console.error("[checkout] Creem session failed", {
                plan: plan.id,
                error: err instanceof Error ? err.message : String(err),
              });
              if (!process.env[plan.checkoutEnv]?.trim()) {
                return Response.json(
                  { error: { type: "checkout_failed", message: "Could not start checkout. Try again shortly." } },
                  { status: 502 },
                );
              }
            }
          }
        }
        const target = process.env[plan.checkoutEnv]?.trim();
        let valid = false;
        if (target) {
          try {
            valid = new URL(target).protocol === "https:";
          } catch {
            valid = false;
          }
        }
        if (!target || !valid) {
          const message = target
            ? `${plan.checkoutEnv} is set but is not a valid https URL.`
            : `Checkout for ${plan.name} is not configured on this deployment. Set ${plan.checkoutEnv} to your Creem checkout link.`;
          if (wantsJson(request)) {
            return Response.json(
              { error: { type: "checkout_not_configured", message, env: plan.checkoutEnv } },
              { status: 503 },
            );
          }
          const back = new URL("/pricing", url.origin);
          back.searchParams.set("checkout_error", plan.id);
          return Response.redirect(back.toString(), 302);
        }
        return Response.redirect(target, 302);
      },
    },
  },
});
