import { createFileRoute } from "@tanstack/react-router";
import { billingSummary } from "@/lib/jev/billing.server";
import { resolveConsoleUser } from "@/lib/jev/console-user.server";
import { parseBearer } from "@/lib/jev/usage.server";
import { errorResponse } from "@/lib/jev/route-error";

export const Route = createFileRoute("/api/v1/billing")({
  server: {
    handlers: {
      // Billing summary: plan tier, current-period usage, estimated cost (real
      // Rago metering when configured, else derived), and a real-usage invoice
      // rollup. The bearer lets a Rago read attribute usage to the caller.
      GET: async ({ request }) => {
        try {
          const userId = await resolveConsoleUser(request);
          const key = parseBearer(request);
          return Response.json({ data: await billingSummary({ userId, key }) });
        } catch (err) {
          return errorResponse(err);
        }
      },
    },
  },
});
