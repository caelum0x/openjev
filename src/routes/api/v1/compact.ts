import { createFileRoute } from "@tanstack/react-router";
import { guardPublicRequest } from "@/lib/jev/public-guard.server";
import { compactTrace, DEFAULT_COMPACT_THRESHOLD, type TraceCall } from "@/lib/jev/compact";
import { serveCookbook } from "@/lib/jev/run";
import { JevValidationError } from "@/lib/jev/validate";

const MAX_CALLS = 200;
/** Up to 200 trace calls with tool args/results: cap the raw body at 512 KiB. */
const MAX_BODY_BYTES = 512 * 1024;

function invalid(message: string): Response {
  return Response.json({ error: { type: "invalid_request", message } }, { status: 400 });
}

/** Validate one trace call: every field must be a string (ids may be numbers). */
function asCall(raw: unknown, i: number): TraceCall | string {
  if (!raw || typeof raw !== "object") return `calls[${i}] must be an object.`;
  const c = raw as Record<string, unknown>;
  const id = typeof c.id === "number" ? String(c.id) : c.id;
  for (const [k, v] of Object.entries({ id, tool: c.tool, args: c.args, result: c.result })) {
    if (typeof v !== "string") return `calls[${i}].${k} must be a string.`;
  }
  return { id: id as string, tool: c.tool as string, args: c.args as string, result: c.result as string };
}

export const Route = createFileRoute("/api/v1/compact")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const guard = await guardPublicRequest(request, { maxBodyBytes: MAX_BODY_BYTES });
        if (!guard.ok) return guard.response;
        if (!guard.body || typeof guard.body !== "object" || Array.isArray(guard.body)) {
          return invalid("Body must be a JSON object.");
        }
        const body = guard.body as { calls?: unknown; threshold?: unknown; model?: unknown };
        if (!Array.isArray(body.calls)) return invalid("`calls` must be an array.");
        if (body.calls.length > MAX_CALLS) return invalid(`At most ${MAX_CALLS} calls per request.`);
        const calls: TraceCall[] = [];
        for (const [i, raw] of body.calls.entries()) {
          const call = asCall(raw, i);
          if (typeof call === "string") return invalid(call);
          calls.push(call);
        }
        const threshold = body.threshold ?? DEFAULT_COMPACT_THRESHOLD;
        if (typeof threshold !== "number" || !(threshold >= 0 && threshold <= 1)) {
          return invalid("`threshold` must be a number between 0 and 1.");
        }
        if (body.model !== undefined && typeof body.model !== "string") {
          return invalid("`model` must be a string.");
        }
        try {
          // Same serving path as POST /api/v1/systemone: the embedding engine
          // when installed, the lexical engine otherwise; `engine` says which.
          const out = await compactTrace(calls, {
            threshold,
            model: body.model ?? "system-one",
            evaluate: serveCookbook,
          });
          return Response.json(out);
        } catch (err) {
          if (err instanceof JevValidationError) return invalid(err.message);
          console.error("[openjev] compact failed:", err);
          return Response.json(
            { error: { type: "server_error", message: "Compaction failed." } },
            { status: 500 },
          );
        }
      },
    },
  },
});
