import { createFileRoute } from "@tanstack/react-router";
import { asObject, guardPublicRequest } from "@/lib/jev/public-guard.server";
import {
  coerceHome,
  converseLocal,
  runSmarthome,
  type HomeState,
  type SmarthomeResult,
} from "@/lib/jev/cookbooks/smarthome";
import { llmGenerate } from "@/lib/jev/llm.server";
import { recordUsageForRequest } from "@/lib/jev/console-user.server";
import { errorPayload } from "@/lib/jev/ask";
import { serveCookbook } from "@/lib/jev/run";
import { JevValidationError } from "@/lib/jev/validate";

function failure(err: unknown): Response {
  const status = err instanceof JevValidationError ? 400 : 500;
  if (status === 500) console.error("[openjev] cookbook failed:", err);
  return Response.json(errorPayload(err), { status });
}

export const Route = createFileRoute("/api/v1/cookbooks/smarthome")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const guard = await guardPublicRequest(request, { lenientJson: true });
        if (!guard.ok) return guard.response;
        const body = asObject(guard.body) as {
          utterance?: string;
          model?: string;
          home?: HomeState;
          llm?: boolean;
        };
        const utterance =
          typeof body.utterance === "string" && body.utterance.trim()
            ? body.utterance.trim()
            : "Turn off all of the lights in the house";
        const home = coerceHome(body.home);
        const model = body.model ?? "system-one";
        const wantLlm = body.llm !== false;

        let splits: string[] | undefined;
        let llm: { used: boolean; purpose: "split" | "converse" | null } = {
          used: false,
          purpose: null,
        };

        let preview: SmarthomeResult;
        try {
          preview = await runSmarthome(utterance, home, model, undefined, serveCookbook);
        } catch (err) {
          return failure(err);
        }
        if (wantLlm && preview.path === "compound") {
          const split = await llmGenerate({
            system:
              'Split a smart-home utterance into atomic single-action commands. Return only JSON {"commands":["..."]}. Each command names a device and an action. If already atomic, return one command.',
            user: utterance,
            max_tokens: 160,
          });
          if (split.ok) {
            const cmds = parseCommands(split.text);
            if (cmds.length >= 2) {
              splits = cmds;
              llm = { used: true, purpose: "split" };
            }
          }
        }

        let out: SmarthomeResult = preview;
        if (splits) {
          try {
            out = await runSmarthome(utterance, home, model, splits, serveCookbook);
          } catch (err) {
            return failure(err);
          }
        }
        out.llm = llm;

        if (wantLlm && out.path === "conversation") {
          const snap = home.devices
            .map((d) => `${d.label}: ${d.on ? "on" : "off"}`)
            .join("; ");
          const talk = await llmGenerate({
            system:
              "You are a concise smart-home assistant. Answer in 1–2 sentences. Use the home snapshot if relevant. Do not claim you changed a device. If they want a change, tell them the command to say.",
            user: `Home: ${snap}\n\nUser: ${utterance}`,
            max_tokens: 120,
          });
          if (talk.ok && talk.text.trim()) {
            out.reply = talk.text.trim();
            out.llm = { used: true, purpose: "converse" };
            if (out.steps[0]) out.steps[0].reply = out.reply;
          } else {
            out.reply = converseLocal(utterance, home);
            if (out.steps[0]) out.steps[0].reply = out.reply;
          }
        }

        await recordUsageForRequest(request, {
          model: out.model,
          questions: out.questions_asked * Math.max(1, out.steps.length),
          input_tokens: out.usage.input_tokens,
          output_tokens: out.usage.output_tokens,
          latency_ms: out.latency_ms,
          path: "/api/v1/cookbooks/smarthome",
        });
        return Response.json(out);
      },
    },
  },
});

function parseCommands(text: string): string[] {
  const tryParse = (raw: string): string[] => {
    try {
      const j = JSON.parse(raw) as { commands?: unknown };
      if (Array.isArray(j.commands)) {
        return j.commands.filter((s): s is string => typeof s === "string" && s.trim().length > 0);
      }
    } catch {
      return [];
    }
    return [];
  };
  const direct = tryParse(text);
  if (direct.length) return direct;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return tryParse(text.slice(start, end + 1));
  return [];
}
