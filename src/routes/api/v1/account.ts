import { createFileRoute } from "@tanstack/react-router";
import {
  getAccount,
  updateAccount,
  type AccountTheme,
  type UpdateAccountInput,
} from "@/lib/jev/account.server";
import { resolveConsoleUser } from "@/lib/jev/console-user.server";
import { logActivity } from "@/lib/jev/activity.server";
import { badRequest, errorResponse, readJson } from "@/lib/jev/route-error";

const THEMES: readonly AccountTheme[] = ["system", "light", "dark"];

/** Read an optional string|null field from a raw body value. */
function optString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
}

export const Route = createFileRoute("/api/v1/account")({
  server: {
    handlers: {
      // Account profile: auth identity (email/name) + console display settings.
      GET: async ({ request }) => {
        try {
          const userId = await resolveConsoleUser(request);
          return Response.json({ data: await getAccount(userId) });
        } catch (err) {
          return errorResponse(err);
        }
      },
      // Update console display settings + org display fields. Any omitted field
      // is left unchanged. Body: { display_name?, org_name?, org_slug?,
      // timezone?, theme?, email_digest? }.
      PATCH: async ({ request }) => {
        try {
          const userId = await resolveConsoleUser(request);
          const body = await readJson<{
            display_name?: string | null;
            org_name?: string | null;
            org_slug?: string | null;
            timezone?: string | null;
            theme?: string;
            email_digest?: boolean;
          }>(request);

          if (
            body.theme !== undefined &&
            !THEMES.includes(body.theme as AccountTheme)
          ) {
            return badRequest("theme must be one of: system, light, dark");
          }

          const patch: UpdateAccountInput = {
            display_name: optString(body.display_name),
            org_name: optString(body.org_name),
            org_slug: optString(body.org_slug),
            timezone: optString(body.timezone),
            theme: body.theme !== undefined ? (body.theme as AccountTheme) : undefined,
            email_digest:
              typeof body.email_digest === "boolean" ? body.email_digest : undefined,
          };
          const profile = await updateAccount(userId, patch);
          await logActivity({
            userId,
            kind: "account.updated",
            summary: "Updated account settings",
            meta: { theme: profile.theme, org_slug: profile.org_slug },
          }).catch(() => undefined);
          return Response.json({ data: profile });
        } catch (err) {
          return errorResponse(err);
        }
      },
    },
  },
});
