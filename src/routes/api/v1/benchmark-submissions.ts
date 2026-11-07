import { createFileRoute } from "@tanstack/react-router";
import { resolveConsoleUser } from "@/lib/jev/console-user.server";
import { logActivity } from "@/lib/jev/activity.server";
import { badRequest, errorResponse, notFound, readJson } from "@/lib/jev/route-error";
import { parseBearer } from "@/lib/jev/usage.server";
import { checkQuota } from "@/lib/jev/quota.server";
import { planQuotaResponse } from "@/lib/jev/public-limit";
import {
  BenchmarkSubmissionError,
  createSubmission,
  getSubmission,
  listSubmissions,
  type SubmissionSourceKind,
} from "@/lib/jev/benchmark-submissions.server";

/**
 * Benchmark Submissions: a third party points their own typed-decision model
 * at the shipped 93-case gold calibration suite and gets scored by the same
 * engine OpenJev's own models are scored by (see benchmark-submissions.server.ts
 * for the full design note). Auth matches every other console-scoped /api/v1/*
 * route: an `ots_live_…` API key bearer, or the console session.
 *
 * GET  — list the caller's own submissions (?id=<id> for one, with its result).
 * POST — create + synchronously run a submission.
 *   Body: { modelLabel, sourceKind: "endpoint" | "answers",
 *           endpointUrl?, answers?, timeoutMs? }
 */
export const Route = createFileRoute("/api/v1/benchmark-submissions")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const userId = await resolveConsoleUser(request);
          const params = new URL(request.url).searchParams;
          const id = params.get("id");
          if (id) {
            const submission = await getSubmission(userId, id);
            if (!submission) return notFound("Submission not found");
            return Response.json({ data: submission });
          }
          const limitRaw = Number(params.get("limit"));
          const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined;
          return Response.json({ data: await listSubmissions(userId, limit) });
        } catch (err) {
          return errorResponse(err);
        }
      },
      POST: async ({ request }) => {
        try {
          const userId = await resolveConsoleUser(request);

          // Reuse the same per-key rate limit / monthly quota as the rest of
          // the API: an endpoint submission makes up to 93 outbound calls on
          // the submitter's behalf, so it must count against their quota like
          // any other decision volume.
          const bearer = parseBearer(request);
          const quota = await checkQuota(bearer).catch(() => ({ allowed: true } as const));
          if (!quota.allowed) return planQuotaResponse(quota);

          const body = await readJson<{
            modelLabel?: string;
            sourceKind?: SubmissionSourceKind;
            endpointUrl?: string;
            answers?: unknown;
            timeoutMs?: number;
          }>(request);
          if (typeof body.modelLabel !== "string" || !body.modelLabel.trim()) {
            return badRequest("modelLabel is required");
          }
          if (body.sourceKind !== "endpoint" && body.sourceKind !== "answers") {
            return badRequest('sourceKind must be "endpoint" or "answers"');
          }
          if (body.sourceKind === "endpoint" && typeof body.endpointUrl !== "string") {
            return badRequest("endpointUrl is required when sourceKind is \"endpoint\"");
          }
          if (body.sourceKind === "answers" && body.answers === undefined) {
            return badRequest('answers is required when sourceKind is "answers"');
          }

          const submission = await createSubmission({
            userId,
            modelLabel: body.modelLabel,
            sourceKind: body.sourceKind,
            endpointUrl: body.endpointUrl,
            answers: body.answers,
            timeoutMs: body.timeoutMs,
          });

          await logActivity({
            userId,
            kind: "benchmark.submitted",
            summary: `Benchmark submission ${submission.model_label}: ${submission.status}`,
            meta: { submissionId: submission.id, status: submission.status },
          }).catch(() => undefined);

          return Response.json({ data: submission });
        } catch (err) {
          if (err instanceof BenchmarkSubmissionError) return badRequest(err.message);
          return errorResponse(err);
        }
      },
    },
  },
});
