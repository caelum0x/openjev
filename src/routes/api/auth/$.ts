import { createFileRoute } from "@tanstack/react-router";

/**
 * Better Auth endpoints (`/api/auth/*`): email/password sign-up + sign-in,
 * session, sign-out. Only served when auth is enabled (`VITE_AUTH_ENABLED=true`);
 * otherwise the console runs keyless and these paths 404.
 */
async function handle(request: Request): Promise<Response> {
  const { auth, authConfigured } = await import("@/lib/auth/server");
  if (!authConfigured) {
    return Response.json(
      { error: { type: "not_found", message: "Auth is disabled (set VITE_AUTH_ENABLED=true)." } },
      { status: 404 },
    );
  }
  return auth.handler(request);
}

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      POST: ({ request }) => handle(request),
    },
  },
});
