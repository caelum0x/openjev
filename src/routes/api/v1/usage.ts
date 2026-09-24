import { createFileRoute } from "@tanstack/react-router";
import { listUsage, usageSummary, parseBearer } from "@/lib/jev/usage.server";
import { resolveConsoleUser } from "@/lib/jev/console-user.server";
import { fetchMeteredUsage, railyardMeteringEnabled } from "@/lib/railyard/meter";

export const Route = createFileRoute("/api/v1/usage")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const userId = await resolveConsoleUser(request);
          const key = parseBearer(request);
          // Real metered usage from Rago when configured; null otherwise (and on
          // any read error) so the page falls back to its persisted view.
          const [summary, events, metered] = await Promise.all([
            usageSummary({ userId }),
            listUsage({ userId, limit: 200 }),
            fetchMeteredUsage({ key }),
          ]);
          return Response.json({
            summary,
            events,
            metered: metered
              ? {
                  configured: true,
                  amount_cents: metered.amountCents,
                  charges: metered.charges,
                }
              : { configured: railyardMeteringEnabled() },
          });
        } catch (err) {
          const status = (err as { status?: number })?.status === 401 ? 401 : 500;
          const message =
            status === 401
              ? "Unauthorized"
              : err instanceof Error
                ? err.message
                : "Internal error";
          const type = status === 401 ? "unauthorized" : "internal";
          return Response.json({ error: { type, message } }, { status });
        }
      },
    },
  },
});
