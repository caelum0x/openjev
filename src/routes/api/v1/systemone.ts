import { createFileRoute } from "@tanstack/react-router";
import { errorPayload } from "@/lib/jev/ask";
import { executeSystemOne } from "@/lib/jev/run";
import { parseBearer } from "@/lib/jev/usage.server";
import { MODEL_CARDS } from "@/lib/jev/models";
import { checkSystemOneAllowance, meterSystemOneCall } from "@/lib/railyard/meter";
import { checkQuota } from "@/lib/jev/quota.server";
import { DEFAULT_PUBLIC_MAX_BODY_BYTES, planQuotaResponse } from "@/lib/jev/public-limit";
import { guardDecisionRequest } from "@/lib/jev/public-guard.server";

export const Route = createFileRoute("/api/v1/systemone")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          // Hosted deployment only: anonymous callers get the public demo
          // per-IP + global limits and a body cap. Self-host is unlimited.
          const guard = await guardDecisionRequest(request, {
            maxBodyBytes: DEFAULT_PUBLIC_MAX_BODY_BYTES,
            costOf: () => 1,
          });
          if (!guard.ok) return guard.response;
          const body = guard.body;
          const key = parseBearer(request);

          // Optional railyard allowance pre-check. No-op unless RAGO is
          // configured; only a definitive denial blocks (self-host stays open).
          const allowance = await checkSystemOneAllowance({ key });
          if (allowance && !allowance.allowed) {
            return Response.json(
              {
                error: {
                  type: "rate_limit",
                  message: "System One usage allowance exceeded for this key.",
                  reasons: allowance.reasons,
                },
              },
              { status: 402 },
            );
          }

          // Built-in per-key rate limit + monthly quota enforcement. Runs after
          // the railyard check (which handles the paid-tier allowance) and acts
          // as the free-tier floor. Fail-open: anonymous calls (bearer = "anon")
          // pass here; on the hosted deployment they were already held to the
          // public demo limits above. Unknown keys pass through.
          const quota = await checkQuota(key).catch(() => ({ allowed: true } as const));
          if (!quota.allowed) return planQuotaResponse(quota);

          const out = await executeSystemOne(body, {
            key,
            path: "/api/v1/systemone",
          });

          // Best-effort usage metering. No-op unless RAGO is configured; never
          // throws, so a metering failure can't fail the decision request.
          await meterSystemOneCall({ key });

          return Response.json(out);
        } catch (err) {
          const payload = errorPayload(err);
          const status = payload.error.type === "internal" ? 500 : 400;
          return Response.json(payload, { status });
        }
      },
      GET: async () =>
        Response.json({
          name: "openjev",
          models: MODEL_CARDS.map((m) => m.id),
          primitives: ["choice", "score", "noul"],
          endpoint: "POST /api/v1/systemone",
          compatible: "TypeSafe System One v1",
        }),
    },
  },
});
