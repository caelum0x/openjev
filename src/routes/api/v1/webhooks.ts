import { createFileRoute } from "@tanstack/react-router";
import {
  createWebhook,
  deleteWebhook,
  getWebhook,
  isValidWebhookUrl,
  listWebhooks,
  testWebhook,
  updateWebhook,
} from "@/lib/jev/webhooks.server";
import { resolveConsoleUser } from "@/lib/jev/console-user.server";
import { logActivity } from "@/lib/jev/activity.server";
import { badRequest, errorResponse, notFound, readJson } from "@/lib/jev/route-error";

/** Coerce an unknown value into a clean string[] (drops non-strings/blanks). */
function toStringArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

export const Route = createFileRoute("/api/v1/webhooks")({
  server: {
    handlers: {
      // Detail (?id=<id>) or list.
      GET: async ({ request }) => {
        try {
          const userId = await resolveConsoleUser(request);
          const id = new URL(request.url).searchParams.get("id");
          if (id) {
            const webhook = await getWebhook(userId, id);
            if (!webhook) return notFound("Webhook not found");
            return Response.json({ data: webhook });
          }
          return Response.json({ data: await listWebhooks(userId) });
        } catch (err) {
          return errorResponse(err);
        }
      },
      // Create a webhook, OR send a signed test delivery when
      // ?action=test / ?test / ?id=<id> is present.
      // Create body: { url, events?, secret? }. Test: id from query/body.
      POST: async ({ request }) => {
        try {
          const userId = await resolveConsoleUser(request);
          const params = new URL(request.url).searchParams;
          const isTest =
            params.get("action") === "test" || params.has("test") || params.has("id");

          if (isTest) {
            const body = await readJson<{ id?: string }>(request);
            const id = params.get("id") ?? params.get("test") ?? body.id;
            if (!id) return badRequest("id is required to test a webhook");
            const delivery = await testWebhook(userId, id);
            if (!delivery) return notFound("Webhook not found");
            await logActivity({
              userId,
              kind: "webhook.tested",
              summary: `Tested webhook ${id} (${delivery.ok ? "ok" : "failed"})`,
              meta: { webhookId: id, status: delivery.status, ok: delivery.ok },
            }).catch(() => undefined);
            return Response.json({ data: delivery });
          }

          const body = await readJson<{
            url?: string;
            events?: string[];
            secret?: string;
          }>(request);
          if (typeof body.url !== "string" || !isValidWebhookUrl(body.url)) {
            return badRequest("url must be a valid http(s) URL");
          }
          const webhook = await createWebhook(userId, {
            url: body.url,
            events: toStringArray(body.events),
            secret: typeof body.secret === "string" ? body.secret : undefined,
          });
          await logActivity({
            userId,
            kind: "webhook.created",
            summary: `Created webhook ${webhook.url}`,
            meta: { webhookId: webhook.id, url: webhook.url },
          }).catch(() => undefined);
          return Response.json({
            data: webhook,
            warning:
              "Signing secret is shown once. Store it to verify the X-OTS-Signature header.",
          });
        } catch (err) {
          return errorResponse(err);
        }
      },
      // Update a webhook. Query: ?id=<id>. Body: { url?, events?, active? }.
      PATCH: async ({ request }) => {
        try {
          const userId = await resolveConsoleUser(request);
          const id = new URL(request.url).searchParams.get("id");
          if (!id) return badRequest("id is required");
          const body = await readJson<{
            url?: string;
            events?: string[];
            active?: boolean;
          }>(request);
          if (
            body.url !== undefined &&
            (typeof body.url !== "string" || !isValidWebhookUrl(body.url))
          ) {
            return badRequest("url must be a valid http(s) URL");
          }
          const webhook = await updateWebhook(userId, id, {
            url: typeof body.url === "string" ? body.url : undefined,
            events: toStringArray(body.events),
            active: typeof body.active === "boolean" ? body.active : undefined,
          });
          if (!webhook) return notFound("Webhook not found");
          return Response.json({ data: webhook });
        } catch (err) {
          return errorResponse(err);
        }
      },
      // Delete a webhook. Query: ?id=<id>.
      DELETE: async ({ request }) => {
        try {
          const userId = await resolveConsoleUser(request);
          const id = new URL(request.url).searchParams.get("id");
          if (!id) return badRequest("id is required");
          const deleted = await deleteWebhook(userId, id);
          if (!deleted) return notFound("Webhook not found");
          await logActivity({
            userId,
            kind: "webhook.deleted",
            summary: `Deleted webhook ${id}`,
            meta: { webhookId: id },
          }).catch(() => undefined);
          return Response.json({ data: { deleted } });
        } catch (err) {
          return errorResponse(err);
        }
      },
    },
  },
});
