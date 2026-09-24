/**
 * `/v1/*` is the public wire path of the System One API (what the SDKs,
 * README and typesafe.ai-compatible clients call); the handlers live under
 * `/api/v1/*`. This router input rewrite serves both from the same handlers so
 * `POST {baseURL}/v1/systemone` works against a stock install.
 */
const PUBLIC_PREFIX = "/v1";
const HANDLER_PREFIX = "/api/v1";

/** Map a `/v1/...` URL onto its `/api/v1/...` handler; anything else is untouched. */
export function rewriteApiAlias(url: URL): URL | undefined {
  const { pathname } = url;
  if (pathname !== PUBLIC_PREFIX && !pathname.startsWith(`${PUBLIC_PREFIX}/`)) {
    return undefined;
  }
  const next = new URL(url.href);
  next.pathname = HANDLER_PREFIX + pathname.slice(PUBLIC_PREFIX.length);
  return next;
}
