import { createFileRoute } from "@tanstack/react-router";
import { asObject, guardPublicRequest } from "@/lib/jev/public-guard.server";
import { runConsistency } from "@/lib/jev/cookbooks/consistency";
import { recordUsageForRequest } from "@/lib/jev/console-user.server";
import { errorPayload } from "@/lib/jev/ask";
import { serveCookbook } from "@/lib/jev/run";
import { JevValidationError } from "@/lib/jev/validate";

function failure(err: unknown): Response {
  const status = err instanceof JevValidationError ? 400 : 500;
  if (status === 500) console.error("[openjev] cookbook failed:", err);
  return Response.json(errorPayload(err), { status });
}

export const Route = createFileRoute("/api/v1/cookbooks/consistency")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const guard = await guardPublicRequest(request, { lenientJson: true });
        if (!guard.ok) return guard.response;
        const body = asObject(guard.body) as { model?: string };
        let out: Awaited<ReturnType<typeof runConsistency>>;
        try {
          out = await runConsistency(body.model ?? "system-one", serveCookbook);
        } catch (err) {
          return failure(err);
        }
        await recordUsageForRequest(request, {
          model: out.model,
          questions: out.rows.length,
          input_tokens: out.usage.input_tokens,
          output_tokens: out.usage.output_tokens,
          latency_ms: out.latency_ms,
          path: "/api/v1/cookbooks/consistency",
        });
        return Response.json(out);
      },
    },
  },
});
