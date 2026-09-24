import { createFileRoute } from "@tanstack/react-router";
import { asObject, guardPublicRequest } from "@/lib/jev/public-guard.server";
import { runCascade } from "@/lib/jev/cookbooks/cascade";
import { recordUsageForRequest } from "@/lib/jev/console-user.server";
import { errorPayload } from "@/lib/jev/ask";
import { serveCookbook } from "@/lib/jev/run";
import { JevValidationError } from "@/lib/jev/validate";

function failure(err: unknown): Response {
  const status = err instanceof JevValidationError ? 400 : 500;
  if (status === 500) console.error("[openjev] cookbook failed:", err);
  return Response.json(errorPayload(err), { status });
}

export const Route = createFileRoute("/api/v1/cookbooks/cascade")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const guard = await guardPublicRequest(request, { lenientJson: true });
        if (!guard.ok) return guard.response;
        const body = asObject(guard.body) as {
          poison?: boolean;
          model?: string;
        };
        let out: Awaited<ReturnType<typeof runCascade>>;
        try {
          out = await runCascade({
            poison: Boolean(body.poison),
            model: body.model ?? "system-one",
            evaluate: serveCookbook,
          });
        } catch (err) {
          return failure(err);
        }
        await recordUsageForRequest(request, {
          model: out.stages.verify.model,
          questions: out.stages.verify.flags.length,
          input_tokens: out.stages.verify.usage.input_tokens,
          output_tokens: out.stages.verify.usage.output_tokens,
          latency_ms: out.latency_ms,
          path: "/api/v1/cookbooks/cascade",
        });
        return Response.json(out);
      },
    },
  },
});
