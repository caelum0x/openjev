import { createFileRoute } from "@tanstack/react-router";
import {
  createEvalRun,
  getEvalRun,
  listEvalRuns,
  type EvalCaseInput,
} from "@/lib/jev/evals.server";
import { resolveConsoleUser } from "@/lib/jev/console-user.server";
import { logActivity } from "@/lib/jev/activity.server";
import { badRequest, errorResponse, notFound, readJson } from "@/lib/jev/route-error";
import { MAX_IMPORT_ROWS } from "@/lib/jev/eval-import";
import { JevValidationError } from "@/lib/jev/validate";

/** Shape check for client-supplied cases (the engine validates questions). */
function caseError(cases: unknown[]): string | null {
  if (cases.length > MAX_IMPORT_ROWS) return `At most ${MAX_IMPORT_ROWS} cases per run.`;
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i] as Record<string, unknown> | null;
    if (!c || typeof c !== "object") return `cases[${i}] must be an object.`;
    if (typeof c.name !== "string" || !c.name.trim()) return `cases[${i}].name is required.`;
    if (c.state === undefined || c.state === null) return `cases[${i}].state is required.`;
    if (!Array.isArray(c.expect)) return `cases[${i}].expect must be an array.`;
  }
  return null;
}

export const Route = createFileRoute("/api/v1/evals")({
  server: {
    handlers: {
      // Detail (?id=<runId>) or list (?limit=<n>).
      GET: async ({ request }) => {
        try {
          const userId = await resolveConsoleUser(request);
          const params = new URL(request.url).searchParams;
          const id = params.get("id");
          if (id) {
            const run = await getEvalRun(userId, id);
            if (!run) return notFound("Eval run not found");
            return Response.json({ data: run });
          }
          const limitRaw = Number(params.get("limit"));
          const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined;
          return Response.json({ data: await listEvalRuns({ userId, limit }) });
        } catch (err) {
          return errorResponse(err);
        }
      },
      // Run an evaluation. Body: { decisionId?, model?, backend?, suite?, cases? }.
      // With no `cases`, the shipped gold calibration suite runs.
      POST: async ({ request }) => {
        try {
          const userId = await resolveConsoleUser(request);
          const body = await readJson<{
            decisionId?: string | null;
            model?: string;
            backend?: string;
            suite?: "gold" | "custom";
            cases?: EvalCaseInput[];
          }>(request);
          if (body.cases !== undefined && !Array.isArray(body.cases)) {
            return badRequest("cases must be an array");
          }
          const invalid = body.cases ? caseError(body.cases) : null;
          if (invalid) return badRequest(invalid);
          const run = await createEvalRun({
            userId,
            decisionId: body.decisionId ?? null,
            model: typeof body.model === "string" ? body.model : undefined,
            backend: typeof body.backend === "string" ? body.backend : undefined,
            suite: body.suite,
            cases: body.cases,
          });
          await logActivity({
            userId,
            kind: "eval.run",
            summary: `Eval ${run.model}: ${run.passed}/${run.total} passed`,
            meta: {
              runId: run.id,
              model: run.model,
              backend: run.backend,
              passed: run.passed,
              failed: run.failed,
            },
          }).catch(() => undefined);
          return Response.json({ data: run });
        } catch (err) {
          if (err instanceof JevValidationError) return badRequest(err.message, err.type);
          return errorResponse(err);
        }
      },
    },
  },
});
