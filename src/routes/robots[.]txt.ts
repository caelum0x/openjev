import { createFileRoute } from "@tanstack/react-router";
import { absUrl, SITE_URL_CONFIGURED } from "@/lib/seo/site";

/**
 * /robots.txt — allows crawling of the public site, keeps bots out of the API and
 * auth surfaces, and points at the live sitemap.
 */
export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: () => {
        // No canonical origin configured (OPENJEV_SITE_URL): this deployment
        // cannot publish correct canonicals, so keep it out of search indexes.
        if (!SITE_URL_CONFIGURED) {
          return new Response(
            "# OPENJEV_SITE_URL is not set on this deployment; indexing disabled.\nUser-agent: *\nDisallow: /\n",
            { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } },
          );
        }
        const body = `User-agent: *
Allow: /
Disallow: /api/
Disallow: /keys
Disallow: /usage
Disallow: /auth/

Sitemap: ${absUrl("/sitemap.xml")}
`;
        return new Response(body, {
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "public, max-age=86400",
          },
        });
      },
    },
  },
});
