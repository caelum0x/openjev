import { createFileRoute } from "@tanstack/react-router";
import { guardPublicRequest } from "@/lib/jev/public-guard.server";
import { LOOP_PRESETS, runAgentLoop } from "@/lib/jev/loop";
import { serveCookbook } from "@/lib/jev/run";
import { JevValidationError } from "@/lib/jev/validate";

const MAX_GOAL_CHARS = 4000;
/** A 4000-char goal is at most ~16 KiB of UTF-8; leave headroom for JSON. */
const MAX_BODY_BYTES = 32 * 1024;

function invalid(message: string): Response {
  return Response.json({ error: { type: "invalid_request", message } }, { status: 400 });
}

/**
 * Router -> gate -> judge agent loop on the default System One engine.
 * Body: `{ goal: string }` or `{ preset: "login" | "refund" | "deploy" }`.
 */
export const Route = createFileRoute("/api/v1/loop")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const guard = await guardPublicRequest(request, { maxBodyBytes: MAX_BODY_BYTES });
        if (!guard.ok) return guard.response;
        if (!guard.body || typeof guard.body !== "object" || Array.isArray(guard.body)) {
          return invalid("Body must be a JSON object.");
        }
        const body = guard.body as { goal?: unknown; preset?: unknown; model?: unknown };
        let goal: string | undefined;
        if (typeof body.preset === "string") {
          goal = LOOP_PRESETS.find((p) => p.id === body.preset)?.goal;
          if (!goal) return invalid(`Unknown preset. Use one of: ${LOOP_PRESETS.map((p) => p.id).join(", ")}.`);
        } else if (typeof body.goal === "string" && body.goal.trim()) {
          goal = body.goal.trim();
        } else {
          return invalid("Send `goal` (non-empty string) or `preset`.");
        }
        if (goal.length > MAX_GOAL_CHARS) return invalid(`\`goal\` is limited to ${MAX_GOAL_CHARS} characters.`);
        if (body.model !== undefined && typeof body.model !== "string") {
          return invalid("`model` must be a string.");
        }
        try {
          const out = await runAgentLoop(goal, {
            model: body.model ?? "system-one",
            evaluate: serveCookbook,
          });
          return Response.json(out);
        } catch (err) {
          if (err instanceof JevValidationError) return invalid(err.message);
          console.error("[openjev] loop failed:", err);
          return Response.json(
            { error: { type: "server_error", message: "Agent loop failed." } },
            { status: 500 },
          );
        }
      },
    },
  },
});
