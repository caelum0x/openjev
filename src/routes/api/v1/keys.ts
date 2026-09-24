import { createFileRoute } from "@tanstack/react-router";
import { createKey, listKeys, publicKey, revokeKey } from "@/lib/jev/keys.server";
import { resolveConsoleUser } from "@/lib/jev/console-user.server";
import { logActivity } from "@/lib/jev/activity.server";

/** Map an unauthorized/other error to a JSON response. */
function errorResponse(err: unknown): Response {
  const status = (err as { status?: number })?.status === 401 ? 401 : 500;
  const message =
    status === 401
      ? "Unauthorized"
      : err instanceof Error
        ? err.message
        : "Internal error";
  const type = status === 401 ? "unauthorized" : "internal";
  return Response.json({ error: { type, message } }, { status });
}

export const Route = createFileRoute("/api/v1/keys")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const userId = await resolveConsoleUser(request);
          return Response.json({ data: await listKeys(userId) });
        } catch (err) {
          return errorResponse(err);
        }
      },
      POST: async ({ request }) => {
        try {
          const userId = await resolveConsoleUser(request);
          const body = (await request.json().catch(() => ({}))) as { name?: string };
          const row = await createKey(
            userId,
            typeof body.name === "string" ? body.name : "default",
          );
          await logActivity({
            userId,
            kind: "key.created",
            summary: `Created API key ${row.name} (${row.prefix}…)`,
            meta: { keyId: row.id, prefix: row.prefix },
          }).catch(() => undefined);
          return Response.json({
            ...publicKey(row),
            secret: row.secret,
            warning:
              "Secret is shown once. Store it as OPENJEV_API_KEY / TYPESAFE_API_KEY.",
          });
        } catch (err) {
          return errorResponse(err);
        }
      },
      DELETE: async ({ request }) => {
        try {
          const userId = await resolveConsoleUser(request);
          const url = new URL(request.url);
          const id = url.searchParams.get("id");
          if (!id) {
            return Response.json(
              { error: { type: "invalid_request", message: "id is required" } },
              { status: 400 },
            );
          }
          const ok = await revokeKey(userId, id);
          if (ok) {
            await logActivity({
              userId,
              kind: "key.revoked",
              summary: `Revoked API key ${id}`,
              meta: { keyId: id },
            }).catch(() => undefined);
          }
          return Response.json({ revoked: ok });
        } catch (err) {
          return errorResponse(err);
        }
      },
    },
  },
});
