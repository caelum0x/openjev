import { createFileRoute } from "@tanstack/react-router";
import { absUrl, SITE_URL_CONFIGURED } from "@/lib/seo/site";
import { collectSiteUrls } from "@/lib/seo/urls";

/**
 * /sitemap.xml — a live XML sitemap generated from the typed content modules, so
 * every guide, comparison, use case, doc, and cookbook is listed automatically.
 */
export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: () => {
        if (!SITE_URL_CONFIGURED) {
          return Response.json(
            {
              error: {
                type: "site_url_not_configured",
                message:
                  "Set OPENJEV_SITE_URL (or VITE_OPENJEV_SITE_URL at build time) to this deployment's public origin to publish a sitemap.",
              },
            },
            { status: 503 },
          );
        }
        const urls = collectSiteUrls();
        const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) =>
      `  <url>\n    <loc>${absUrl(u.path)}</loc>\n    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority.toFixed(1)}</priority>\n  </url>`,
  )
  .join("\n")}
</urlset>
`;
        return new Response(body, {
          headers: {
            "content-type": "application/xml; charset=utf-8",
            "cache-control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
