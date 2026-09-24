import { createFileRoute } from "@tanstack/react-router";
import { resolveConsoleUser } from "@/lib/jev/console-user.server";
import { runShadow, shadowSummary } from "@/lib/jev/shadow.server";
import { JevValidationError } from "@/lib/jev/validate";
import { badRequest, errorResponse, readJson } from "@/lib/jev/route-error";

/**
 * Shadow mode: run OpenJev next to your production LLM and log agreement.
 *
 *   POST /api/v1/shadow  { model?, state, questions, calibration_id?,
 *                          incumbent?: { name?, kind?: "llm"|"label", answers?: { <qid>: <value> },
 *                                        latency_ms?, usage?: { input_tokens, output_tokens } } }
 *     With `incumbent.answers` we compare against the answers you already got
 *     from your LLM (no extra spend). Without them, this server asks its own
 *     configured LLM chain (Groq / Ollama / OpenAI-if-keyed) as the incumbent.
 *     `kind: "label"` marks the answers as human ground truth; pairs that used
 *     a calibration feed that calibration's drift monitor (see /api/v1/drift).
 *   GET  /api/v1/shadow?days=30&threshold=0.8&incumbent=<name>  dashboard summary
 */
export const Route = createFileRoute("/api/v1/shadow")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const userId = await resolveConsoleUser(request);
          const p = new URL(request.url).searchParams;
          const days = Number(p.get("days"));
          const threshold = Number(p.get("threshold"));
          return Response.json({
            data: await shadowSummary({
              userId,
              days: Number.isFinite(days) && days > 0 ? days : undefined,
              threshold:
                p.get("threshold") !== null && Number.isFinite(threshold) ? threshold : undefined,
              incumbent: p.get("incumbent") ?? undefined,
            }),
          });
        } catch (err) {
          return errorResponse(err);
        }
      },
      POST: async ({ request }) => {
        try {
          const userId = await resolveConsoleUser(request);
          const body = await readJson(request);
          return Response.json({ data: await runShadow({ userId, body }) });
        } catch (err) {
          if (err instanceof JevValidationError) return badRequest(err.message, err.type);
          return errorResponse(err);
        }
      },
    },
  },
});
