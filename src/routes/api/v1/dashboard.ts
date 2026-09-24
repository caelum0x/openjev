import { createFileRoute } from "@tanstack/react-router";
import { dashboardSummary } from "@/lib/jev/dashboard.server";
import { resolveConsoleUser } from "@/lib/jev/console-user.server";
import { errorResponse } from "@/lib/jev/route-error";

export const Route = createFileRoute("/api/v1/dashboard")({
  server: {
    handlers: {
      // Console home aggregate: today's totals, 14-day sparkline, top models,
      // recent activity + usage. Scoped to the resolved console user.
      GET: async ({ request }) => {
        try {
          const userId = await resolveConsoleUser(request);
          return Response.json({ data: await dashboardSummary({ userId }) });
        } catch (err) {
          return errorResponse(err);
        }
      },
    },
  },
});
