import { createFileRoute } from "@tanstack/react-router";
import { renderReportHtml } from "@/lib/jev/audit-report";
import { issueAuditReport, ReportError } from "@/lib/jev/audit-report.server";
import { resolveConsoleUser } from "@/lib/jev/console-user.server";
import { logActivity } from "@/lib/jev/activity.server";
import { badRequest, errorResponse } from "@/lib/jev/route-error";

/**
 * Signed calibration audit report (Team plan on the hosted service; always on
 * when self-hosted).
 *
 *   GET /api/v1/reports/:calibrationId               signed JSON report
 *   GET /api/v1/reports/:calibrationId?format=html   printable HTML
 *       add &download=1 for a Content-Disposition attachment
 *
 * The report bundles the per-question calibration maps, raw vs calibrated
 * accuracy / ECE / Brier, the recommended threshold, the drift monitor and its
 * check history, and 30-day shadow agreement, signed with HMAC-SHA256. Verify
 * it with POST /api/v1/reports/verify.
 */
const ID_RE = /^cal_[a-z0-9]{4,64}$/;

function reportErrorResponse(err: unknown): Response {
  if (err instanceof ReportError) {
    return Response.json(
      { error: { type: err.type, message: err.message } },
      { status: err.status },
    );
  }
  return errorResponse(err);
}

export const Route = createFileRoute("/api/v1/reports/$calibrationId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const userId = await resolveConsoleUser(request);
          const id = params.calibrationId;
          if (!ID_RE.test(id))
            return badRequest("calibrationId must look like cal_…", "invalid_calibration_id");
          const url = new URL(request.url);
          const format = url.searchParams.get("format") ?? "json";
          if (format !== "json" && format !== "html")
            return badRequest("format must be json or html");

          const report = await issueAuditReport(userId, id);
          await logActivity({
            userId,
            kind: "report.issue",
            summary: `Audit report ${report.report_id} for calibration ${report.calibration.name}`,
            meta: { calibrationId: id, reportId: report.report_id, format },
          }).catch(() => undefined);

          const headers: Record<string, string> = { "cache-control": "no-store" };
          if (url.searchParams.get("download") === "1") {
            headers["content-disposition"] = `attachment; filename="${report.report_id}.${format}"`;
          }
          if (format === "html") {
            return new Response(renderReportHtml(report), {
              headers: { "content-type": "text/html; charset=utf-8", ...headers },
            });
          }
          return new Response(JSON.stringify(report, null, 2), {
            headers: { "content-type": "application/json; charset=utf-8", ...headers },
          });
        } catch (err) {
          return reportErrorResponse(err);
        }
      },
    },
  },
});
