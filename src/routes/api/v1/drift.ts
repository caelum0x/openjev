import { createFileRoute } from "@tanstack/react-router";
import { resolveConsoleUser } from "@/lib/jev/console-user.server";
import { logActivity } from "@/lib/jev/activity.server";
import {
  checkDriftMonitor,
  deleteDriftMonitor,
  getDriftMonitor,
  listDriftMonitors,
  upsertDriftMonitor,
} from "@/lib/jev/drift.server";
import { JevValidationError } from "@/lib/jev/validate";
import { badRequest, errorResponse, notFound, readJson } from "@/lib/jev/route-error";

/**
 * Calibration drift monitors.
 *
 *   GET    /api/v1/drift                          list monitors
 *   GET    /api/v1/drift?calibration_id=cal_…     the monitor for one calibration (or null)
 *   POST   /api/v1/drift                          create/update the monitor for a calibration:
 *     { calibration_id, webhook_id, window_days?: 1-90, active?,
 *       thresholds?: { min_samples?, accuracy_drop?, confidence_shift?, calibration_gap? } }
 *   POST   /api/v1/drift?action=check&id=drm_…    run a check now (delivers an alert on drift)
 *   DELETE /api/v1/drift?id=drm_…
 *
 * Alerts are POSTed to the webhook as `calibration.drift` (and
 * `calibration.drift_resolved`), signed like every OpenJev webhook:
 * `X-OTS-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "<t>.<body>">`.
 */
function validationResponse(err: unknown): Response {
  if (err instanceof JevValidationError) return badRequest(err.message, err.type);
  return errorResponse(err);
}

export const Route = createFileRoute("/api/v1/drift")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const userId = await resolveConsoleUser(request);
          const params = new URL(request.url).searchParams;
          const id = params.get("id");
          if (id) {
            const monitor = await getDriftMonitor(userId, id);
            return monitor ? Response.json({ data: monitor }) : notFound("Drift monitor not found");
          }
          const calibrationId = params.get("calibration_id");
          if (calibrationId) {
            const [monitor] = await listDriftMonitors(userId, calibrationId);
            return Response.json({ data: monitor ?? null });
          }
          return Response.json({ data: await listDriftMonitors(userId) });
        } catch (err) {
          return errorResponse(err);
        }
      },
      POST: async ({ request }) => {
        try {
          const userId = await resolveConsoleUser(request);
          const params = new URL(request.url).searchParams;
          if (params.get("action") === "check") {
            const id = params.get("id");
            if (!id) return badRequest("id is required to run a check");
            const result = await checkDriftMonitor(userId, id);
            if (!result) return notFound("Drift monitor not found");
            if (result.alerted) {
              await logActivity({
                userId,
                kind: "drift.alert",
                summary: `Drift on ${result.monitor.calibration_id}: ${result.report.drifted.join(", ")}`,
                meta: { monitorId: id, drifted: result.report.drifted },
              }).catch(() => undefined);
            }
            return Response.json({ data: result });
          }
          const body = await readJson<Record<string, unknown>>(request);
          const monitor = await upsertDriftMonitor(userId, {
            calibration_id: body.calibration_id,
            webhook_id: body.webhook_id,
            window_days: body.window_days,
            thresholds: body.thresholds,
            active: body.active,
          });
          await logActivity({
            userId,
            kind: "drift.configured",
            summary: `Drift monitor for ${monitor.calibration_id} ${monitor.active ? "on" : "paused"}`,
            meta: { monitorId: monitor.id, webhookId: monitor.webhook_id },
          }).catch(() => undefined);
          return Response.json({ data: monitor });
        } catch (err) {
          return validationResponse(err);
        }
      },
      DELETE: async ({ request }) => {
        try {
          const userId = await resolveConsoleUser(request);
          const id = new URL(request.url).searchParams.get("id");
          if (!id) return badRequest("id is required");
          const ok = await deleteDriftMonitor(userId, id);
          return ok ? Response.json({ data: { id, deleted: true } }) : notFound("Drift monitor not found");
        } catch (err) {
          return errorResponse(err);
        }
      },
    },
  },
});
