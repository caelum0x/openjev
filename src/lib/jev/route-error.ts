/**
 * Shared JSON error helpers for the console API routes (Foundation-2). Mirrors
 * the envelope the existing /api/v1/keys + /api/v1/usage routes emit:
 *   { error: { type, message } }  with a matching HTTP status.
 */

/** Map an unauthorized/other error to a JSON Response (401 or 500). */
export function errorResponse(err: unknown): Response {
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

/** 400 with a typed error envelope (defaults to `invalid_request`). */
export function badRequest(message: string, type = "invalid_request"): Response {
  return Response.json({ error: { type, message } }, { status: 400 });
}

/** 404 with a typed error envelope. */
export function notFound(message = "Not found"): Response {
  return Response.json({ error: { type: "not_found", message } }, { status: 404 });
}

/** Parse a JSON request body, returning `{}` on any parse error. */
export async function readJson<T = Record<string, unknown>>(
  request: Request,
): Promise<T> {
  return (await request.json().catch(() => ({}))) as T;
}
