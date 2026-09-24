import { createFileRoute } from "@tanstack/react-router";
import {
  createCalibration,
  deleteCalibration,
  getCalibration,
  listCalibrations,
  refitCalibration,
} from "@/lib/jev/calibrations.server";
import type { CalibrationMethodChoice } from "@/lib/jev/calibration-fit";
import { resolveConsoleUser } from "@/lib/jev/console-user.server";
import { logActivity } from "@/lib/jev/activity.server";
import { JevValidationError } from "@/lib/jev/validate";
import { badRequest, errorResponse, notFound, readJson } from "@/lib/jev/route-error";

/**
 * Per-customer calibration maps.
 *
 *   GET    /api/v1/calibrations            list (newest first)
 *   GET    /api/v1/calibrations?id=cal_…   one calibration with maps + metrics
 *   POST   /api/v1/calibrations            fit a new calibration. Body:
 *     { name, model?, method?: "auto"|"temperature"|"isotonic", target_precision?,
 *       questions, examples: [{ state, labels: { <question_id>: <label> } }] }
 *     or { name, eval_run_id }  to fit from an existing eval run's graded cases.
 *   POST   /api/v1/calibrations?id=cal_…&action=refit
 *     re-fit in place on the engine this deployment serves now (stored labelled
 *     inputs are answered again). Use it when `engine_mismatch` is set.
 *     Optional body { examples } re-fits an uploaded map on those labels and
 *     stores them (maps fitted before inputs were stored need this once).
 *   DELETE /api/v1/calibrations?id=cal_…
 *
 * Apply a calibration by passing `calibration_id` on POST /api/v1/systemone.
 */
function validationResponse(err: unknown): Response {
  if (err instanceof JevValidationError) return badRequest(err.message, err.type);
  return errorResponse(err);
}

export const Route = createFileRoute("/api/v1/calibrations")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const userId = await resolveConsoleUser(request);
          const params = new URL(request.url).searchParams;
          const id = params.get("id");
          if (id) {
            const cal = await getCalibration(userId, id);
            return cal ? Response.json({ data: cal }) : notFound("Calibration not found");
          }
          const limit = Number(params.get("limit"));
          return Response.json({
            data: await listCalibrations(userId, Number.isFinite(limit) && limit > 0 ? limit : 50),
          });
        } catch (err) {
          return errorResponse(err);
        }
      },
      POST: async ({ request }) => {
        try {
          const userId = await resolveConsoleUser(request);
          const params = new URL(request.url).searchParams;
          if (params.get("action") === "refit") {
            const id = params.get("id");
            if (!id) return badRequest("id is required to re-fit");
            const before = await getCalibration(userId, id);
            if (!before) return notFound("Calibration not found");
            // Optional body `{ examples }`: labels to re-fit an uploaded map on
            // (stored for later re-fits). Without it the stored inputs are used.
            const refitBody = await readJson<{ examples?: unknown }>(request);
            const cal = await refitCalibration(userId, id, { examples: refitBody.examples });
            await logActivity({
              userId,
              kind: "calibration.refit",
              summary:
                `Calibration ${cal.name} re-fitted on ${cal.engine?.kind ?? "unknown"} engine ` +
                `(${cal.engine?.version ?? "unrecorded"}), ${cal.sample_count} labels`,
              meta: {
                calibrationId: cal.id,
                model: cal.model,
                engine_before: before.engine,
                engine_after: cal.engine,
              },
            }).catch(() => undefined);
            return Response.json({ data: cal });
          }
          const body = await readJson<{
            name?: unknown;
            model?: unknown;
            method?: unknown;
            target_precision?: unknown;
            questions?: unknown;
            examples?: unknown;
            eval_run_id?: unknown;
          }>(request);
          if (body.eval_run_id !== undefined && typeof body.eval_run_id !== "string") {
            return badRequest("eval_run_id must be a string");
          }
          if (body.eval_run_id === undefined && (body.questions === undefined || body.examples === undefined)) {
            return badRequest("Send either { questions, examples } or { eval_run_id }.");
          }
          const cal = await createCalibration({
            userId,
            name: typeof body.name === "string" ? body.name : "",
            model: typeof body.model === "string" ? body.model : undefined,
            method:
              typeof body.method === "string" ? (body.method as CalibrationMethodChoice) : undefined,
            targetPrecision:
              typeof body.target_precision === "number" ? body.target_precision : undefined,
            questions: body.questions,
            examples: body.examples,
            evalRunId: body.eval_run_id as string | undefined,
          });
          await logActivity({
            userId,
            kind: "calibration.create",
            summary: `Calibration ${cal.name} (${cal.model}) fitted on ${cal.sample_count} labels`,
            meta: { calibrationId: cal.id, model: cal.model, questions: cal.question_ids },
          }).catch(() => undefined);
          return Response.json({ data: cal }, { status: 201 });
        } catch (err) {
          return validationResponse(err);
        }
      },
      DELETE: async ({ request }) => {
        try {
          const userId = await resolveConsoleUser(request);
          const id = new URL(request.url).searchParams.get("id");
          if (!id) return badRequest("id is required");
          const ok = await deleteCalibration(userId, id);
          return ok ? Response.json({ data: { id, deleted: true } }) : notFound("Calibration not found");
        } catch (err) {
          return errorResponse(err);
        }
      },
    },
  },
});
