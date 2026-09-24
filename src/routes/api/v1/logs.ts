import { createFileRoute } from "@tanstack/react-router";
import { listLogs } from "@/lib/jev/logs.server";
import { resolveConsoleUser } from "@/lib/jev/console-user.server";
import { errorResponse } from "@/lib/jev/route-error";

/** Parse a query param as a finite number, or undefined when absent/invalid. */
function numParam(value: string | null): number | undefined {
  if (value === null || value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export const Route = createFileRoute("/api/v1/logs")({
  server: {
    handlers: {
      // Filtered usage + activity feed. Query: model, key, kind, from, to, limit.
      // `from`/`to` are epoch-millis bounds; `key` matches a key id or 'anon'.
      GET: async ({ request }) => {
        try {
          const userId = await resolveConsoleUser(request);
          const p = new URL(request.url).searchParams;
          const result = await listLogs({
            userId,
            model: p.get("model") ?? undefined,
            key: p.get("key") ?? undefined,
            kind: p.get("kind") ?? undefined,
            from: numParam(p.get("from")),
            to: numParam(p.get("to")),
            limit: numParam(p.get("limit")),
          });
          return Response.json({ data: result });
        } catch (err) {
          return errorResponse(err);
        }
      },
    },
  },
});
