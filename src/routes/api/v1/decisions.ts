import { createFileRoute } from "@tanstack/react-router";
import {
  createDecision,
  deleteDecision,
  getDecision,
  listDecisions,
  runDecision,
  updateDecision,
} from "@/lib/jev/decisions.server";
import { resolveConsoleUser } from "@/lib/jev/console-user.server";
import { logActivity } from "@/lib/jev/activity.server";
import { badRequest, errorResponse, notFound, readJson } from "@/lib/jev/route-error";
import type { Questions, State } from "@/lib/jev/types";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export const Route = createFileRoute("/api/v1/decisions")({
  server: {
    handlers: {
      // Detail (?id=<id>) or list (optional ?projectId=<id>).
      GET: async ({ request }) => {
        try {
          const userId = await resolveConsoleUser(request);
          const params = new URL(request.url).searchParams;
          const id = params.get("id");
          if (id) {
            const decision = await getDecision(userId, id);
            if (!decision) return notFound("Decision not found");
            return Response.json({ data: decision });
          }
          const projectId = params.get("projectId");
          const data = await listDecisions(userId, {
            projectId: projectId ?? undefined,
          });
          return Response.json({ data });
        } catch (err) {
          return errorResponse(err);
        }
      },
      // Create (default), OR run an existing decision when ?action=run / ?run=<id>.
      // Create body:  { name, description?, projectId?, state, questions }.
      // Run body:     { id?, model?, state? }  (id may also come from ?run=<id>).
      POST: async ({ request }) => {
        try {
          const userId = await resolveConsoleUser(request);
          const params = new URL(request.url).searchParams;
          const isRun =
            params.get("action") === "run" || params.has("run") || params.has("id");

          if (isRun) {
            const body = await readJson<{
              id?: string;
              model?: string;
              state?: State;
            }>(request);
            const id = params.get("run") ?? params.get("id") ?? body.id;
            if (!id) return badRequest("id is required to run a decision");
            const result = await runDecision(userId, id, {
              model: typeof body.model === "string" ? body.model : undefined,
              state: body.state,
            });
            if (!result) return notFound("Decision not found");
            return Response.json({ data: result });
          }

          const body = await readJson<{
            name?: string;
            description?: string | null;
            projectId?: string | null;
            state?: State;
            questions?: Questions;
          }>(request);
          if (typeof body.name !== "string" || !body.name.trim()) {
            return badRequest("name is required");
          }
          if (!isPlainObject(body.questions) || Object.keys(body.questions).length === 0) {
            return badRequest("questions must be a non-empty object");
          }
          if (body.state === undefined) {
            return badRequest("state is required");
          }
          const decision = await createDecision(userId, {
            name: body.name,
            description: body.description ?? null,
            projectId: body.projectId ?? null,
            state: body.state,
            questions: body.questions,
          });
          await logActivity({
            userId,
            kind: "decision.saved",
            summary: `Saved decision ${decision.name}`,
            meta: { decisionId: decision.id },
          }).catch(() => undefined);
          return Response.json({ data: decision });
        } catch (err) {
          return errorResponse(err);
        }
      },
      // Update a decision (bumps version). Query: ?id=<id>.
      PATCH: async ({ request }) => {
        try {
          const userId = await resolveConsoleUser(request);
          const id = new URL(request.url).searchParams.get("id");
          if (!id) return badRequest("id is required");
          const body = await readJson<{
            name?: string;
            description?: string | null;
            projectId?: string | null;
            state?: State;
            questions?: Questions;
          }>(request);
          if (
            body.questions !== undefined &&
            (!isPlainObject(body.questions) || Object.keys(body.questions).length === 0)
          ) {
            return badRequest("questions must be a non-empty object");
          }
          const decision = await updateDecision(userId, id, {
            name: typeof body.name === "string" ? body.name : undefined,
            description: body.description,
            projectId: body.projectId,
            state: body.state,
            questions: body.questions,
          });
          if (!decision) return notFound("Decision not found");
          return Response.json({ data: decision });
        } catch (err) {
          return errorResponse(err);
        }
      },
      // Delete a decision. Query: ?id=<id>.
      DELETE: async ({ request }) => {
        try {
          const userId = await resolveConsoleUser(request);
          const id = new URL(request.url).searchParams.get("id");
          if (!id) return badRequest("id is required");
          const deleted = await deleteDecision(userId, id);
          if (!deleted) return notFound("Decision not found");
          return Response.json({ data: { deleted } });
        } catch (err) {
          return errorResponse(err);
        }
      },
    },
  },
});
