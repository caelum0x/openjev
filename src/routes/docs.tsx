import { createFileRoute, Outlet } from "@tanstack/react-router";

/**
 * Layout route for /docs. The hub lives in docs/index.tsx and individual
 * pages in docs/$slug.tsx; each child renders its own AppShell, so this
 * layout only needs to provide an Outlet for the nested routes.
 */
export const Route = createFileRoute("/docs")({ component: DocsLayout });

function DocsLayout() {
  return <Outlet />;
}
