import { createFileRoute } from "@tanstack/react-router";
import { asObject, guardPublicRequest } from "@/lib/jev/public-guard.server";
import { executeSystemOne } from "@/lib/jev/run";
import { GDPR_STATE, PARALLEL_QUESTIONS } from "@/lib/jev/cookbooks/parallel";
import { parseBearer } from "@/lib/jev/usage.server";
import { errorPayload } from "@/lib/jev/ask";

export const Route = createFileRoute("/api/v1/cookbooks/parallel")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const guard = await guardPublicRequest(request, { lenientJson: true });
        if (!guard.ok) return guard.response;
        try {
          const body = asObject(guard.body) as {
            model?: string;
            state?: unknown;
          };
          const out = await executeSystemOne(
            {
              model: body.model ?? "system-one",
              state: body.state ?? GDPR_STATE,
              questions: PARALLEL_QUESTIONS,
            },
            { key: parseBearer(request), path: "/api/v1/cookbooks/parallel" },
          );
          return Response.json({
            ...out,
            cookbook: "parallel",
            questions: Object.keys(PARALLEL_QUESTIONS).length,
          });
        } catch (err) {
          const payload = errorPayload(err);
          return Response.json(payload, { status: 400 });
        }
      },
    },
  },
});
