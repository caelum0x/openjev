import { createFileRoute } from "@tanstack/react-router";
import { errorPayload } from "@/lib/jev/ask";
import { executeSystemOne } from "@/lib/jev/run";
import { parseBearer } from "@/lib/jev/usage.server";
import { checkSystemOneAllowance, meterSystemOneCall } from "@/lib/railyard/meter";
import { checkQuota } from "@/lib/jev/quota.server";
import { DEFAULT_PUBLIC_BATCH_MAX_BODY_BYTES, planQuotaResponse } from "@/lib/jev/public-limit";
import { guardDecisionRequest } from "@/lib/jev/public-guard.server";
import type { SystemOneResponse } from "@/lib/jev/types";

/** Maximum number of decision items accepted in a single batch request. */
const MAX_BATCH_SIZE = 32;

type BatchResultOk = {
  ok: true;
  index: number;
  result: SystemOneResponse;
};

type BatchResultErr = {
  ok: false;
  index: number;
  error: { type: string; message: string };
};

type BatchResult = BatchResultOk | BatchResultErr;

/**
 * POST /api/v1/batch
 *
 * Run up to MAX_BATCH_SIZE System One decisions in one HTTP round-trip.
 * Body: JSON array where each element is a full System One request
 * ({ state, questions, model? }).
 *
 * Each item is executed and metered independently — a per-item error does NOT
 * abort the rest of the batch. The response preserves the original index so
 * callers can correlate results without ordering assumptions.
 *
 * Allowance + quota are checked once for the key before the batch runs; the
 * limits apply to the calling key as a whole, not per item.
 */
export const Route = createFileRoute("/api/v1/batch")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          // Hosted deployment only: anonymous callers get the public demo
          // limits, charged one unit per item (self-host is unlimited).
          // A malformed or over-size body is charged a single unit.
          const guard = await guardDecisionRequest(request, {
            maxBodyBytes: DEFAULT_PUBLIC_BATCH_MAX_BODY_BYTES,
            costOf: (b) => (Array.isArray(b) && b.length <= MAX_BATCH_SIZE ? b.length : 0),
          });
          if (!guard.ok) return guard.response;
          const body = guard.body;
          const key = parseBearer(request);

          if (!Array.isArray(body)) {
            return Response.json(
              {
                error: {
                  type: "invalid_request",
                  message: "Body must be a JSON array of System One request objects.",
                },
              },
              { status: 400 },
            );
          }

          if (body.length === 0) {
            return Response.json(
              {
                error: {
                  type: "invalid_request",
                  message: "Batch must contain at least one item.",
                },
              },
              { status: 400 },
            );
          }

          if (body.length > MAX_BATCH_SIZE) {
            return Response.json(
              {
                error: {
                  type: "batch_too_large",
                  message:
                    `Batch size ${body.length} exceeds the maximum of ` +
                    `${MAX_BATCH_SIZE} items per request. Split into smaller batches.`,
                  limit: MAX_BATCH_SIZE,
                  received: body.length,
                },
              },
              { status: 400 },
            );
          }

          // Allowance pre-check — once for the whole batch key.
          const allowance = await checkSystemOneAllowance({ key });
          if (allowance && !allowance.allowed) {
            return Response.json(
              {
                error: {
                  type: "rate_limit",
                  message: "System One usage allowance exceeded for this key.",
                  reasons: allowance.reasons,
                },
              },
              { status: 402 },
            );
          }

          // Quota check — once for the whole batch key.
          const quota = await checkQuota(key).catch(() => ({ allowed: true } as const));
          if (!quota.allowed) return planQuotaResponse(quota);

          // Execute all items in parallel. Per-item errors are captured and do
          // not abort the remaining items; the whole-batch error block above
          // handles structural failures (bad body, over-quota) before we get here.
          const results: BatchResult[] = await Promise.all(
            (body as unknown[]).map(async (item, index) => {
              try {
                const result = await executeSystemOne(item, {
                  key,
                  path: "/api/v1/batch",
                });
                // Best-effort metering — one event per executed item.
                await meterSystemOneCall({ key });
                return { ok: true as const, index, result };
              } catch (err) {
                const payload = errorPayload(err);
                return { ok: false as const, index, error: payload.error };
              }
            }),
          );

          return Response.json({
            object: "batch_response",
            count: results.length,
            results,
          });
        } catch (err) {
          const payload = errorPayload(err);
          const status = payload.error.type === "internal" ? 500 : 400;
          return Response.json(payload, { status });
        }
      },

      GET: async () =>
        Response.json({
          name: "openjev batch",
          description:
            "Run up to 32 System One decisions in a single request. " +
            "Body: JSON array of { state, questions, model? } objects. " +
            "Returns { object, count, results[] } where each result carries " +
            "{ ok, index, result } or { ok: false, index, error }.",
          max_batch_size: MAX_BATCH_SIZE,
          endpoint: "POST /api/v1/batch",
          compatible: "TypeSafe System One v1 batch",
        }),
    },
  },
});
