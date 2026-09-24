import { createRouter } from "@tanstack/react-router";
import { AppErrorComponent } from "@/lib/error-component";
import { rewriteApiAlias } from "@/lib/api-alias";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  return createRouter({
    routeTree,
    defaultErrorComponent: AppErrorComponent,
    // Serve the public `/v1/*` API paths from the `/api/v1/*` handlers.
    rewrite: { input: ({ url }) => rewriteApiAlias(url) },
  });
}
