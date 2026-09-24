import { createFileRoute } from "@tanstack/react-router";
import { verifyReport } from "@/lib/jev/audit-report";
import { ReportError, signingKeyOrThrow } from "@/lib/jev/audit-report.server";
import { badRequest, errorResponse } from "@/lib/jev/route-error";

/**
 * POST /api/v1/reports/verify — check that an audit report was issued by this
 * server and has not been edited. Body: the report JSON exactly as downloaded.
 *
 * No login needed: a reviewer who received the file can check it. The answer
 * only says valid / invalid (and echoes ids already in the report), so it
 * leaks nothing the caller does not already hold.
 */
const MAX_BYTES = 2_000_000;

export const Route = createFileRoute("/api/v1/reports/verify")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const key = signingKeyOrThrow();
          const declared = Number(request.headers.get("content-length") ?? "0");
          if (declared > MAX_BYTES) return badRequest("Report is too large.", "payload_too_large");
          const text = await request.text();
          if (text.length > MAX_BYTES)
            return badRequest("Report is too large.", "payload_too_large");
          let report: unknown;
          try {
            report = JSON.parse(text);
          } catch {
            return badRequest("Body must be the report JSON.", "invalid_json");
          }
          return Response.json(
            { data: verifyReport(report, key) },
            { headers: { "cache-control": "no-store" } },
          );
        } catch (err) {
          if (err instanceof ReportError) {
            return Response.json(
              { error: { type: err.type, message: err.message } },
              { status: err.status },
            );
          }
          return errorResponse(err);
        }
      },
    },
  },
});
