/**
 * SEO site helpers — the single source of truth for the public origin, canonical
 * URLs, OpenGraph image, and the small JSON-LD builders shared by the
 * programmatic-SEO routes (/guides, /compare, sitemap.xml, robots.txt).
 *
 * The canonical origin is CONFIG, never a hard-coded brand domain: this
 * project does not own openjev.com (it belongs to an unrelated project), so a
 * default pointing there would hand every canonical tag, OG URL and sitemap
 * entry to someone else's site.
 *
 * Set it with (first match wins):
 *   - `VITE_OPENJEV_SITE_URL`  build-time, inlined into the client bundle
 *   - `OPENJEV_SITE_URL`       server env (SSR, sitemap.xml, robots.txt)
 *   - `VITE_SITE_URL` / `PUBLIC_SITE_URL`  legacy names, still honoured
 *
 * Unset, it falls back to the local dev origin (http://localhost:8080) and
 * `SITE_URL_CONFIGURED` is false: sitemap.xml and robots.txt then tell crawlers
 * not to index the deployment instead of publishing wrong canonicals.
 */

/** Local dev origin used only when no canonical origin is configured. */
export const DEV_SITE_URL = "http://localhost:8080";

function readConfiguredOrigin(): string | undefined {
  const env = (typeof import.meta !== "undefined" ? import.meta.env : undefined) as
    | Record<string, string | undefined>
    | undefined;
  const proc =
    typeof process !== "undefined" ? (process.env as Record<string, string | undefined>) : undefined;
  const candidates = [
    env?.VITE_OPENJEV_SITE_URL,
    proc?.OPENJEV_SITE_URL,
    env?.VITE_SITE_URL,
    proc?.PUBLIC_SITE_URL,
  ];
  for (const c of candidates) {
    const v = c?.trim();
    if (!v) continue;
    try {
      const u = new URL(v);
      if (u.protocol === "http:" || u.protocol === "https:") return v;
    } catch {
      // Ignore malformed values; the next candidate (or dev origin) applies.
    }
  }
  return undefined;
}

const CONFIGURED_ORIGIN = readConfiguredOrigin();

/** True when a canonical origin was configured (safe to publish canonicals). */
export const SITE_URL_CONFIGURED: boolean = CONFIGURED_ORIGIN !== undefined;

/** Canonical origin with no trailing slash, e.g. "https://decisions.example.com". */
export const SITE_URL: string = String(CONFIGURED_ORIGIN ?? DEV_SITE_URL).replace(/\/+$/, "");

/** Human brand name used in titles and JSON-LD. */
export const SITE_NAME = "OpenJev";

/** Absolute URL for a site-relative path, e.g. absUrl("/guides") → origin + path. */
export function absUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

/** The shared OpenGraph / Twitter card image (1200×630 jpg in /public). */
export const OG_IMAGE = absUrl("/og.jpg");

export interface Breadcrumb {
  readonly name: string;
  readonly path: string;
}

/** Schema.org BreadcrumbList from an ordered trail of {name, path}. */
export function breadcrumbLd(trail: readonly Breadcrumb[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((b, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: b.name,
      item: absUrl(b.path),
    })),
  };
}

export interface ArticleLdInput {
  readonly headline: string;
  readonly description: string;
  readonly path: string;
  readonly datePublished?: string;
  readonly dateModified?: string;
  readonly keywords?: readonly string[];
}

/** Schema.org Article (TechArticle) for a guide or comparison page. */
export function articleLd(input: ArticleLdInput) {
  return {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: input.headline,
    description: input.description,
    url: absUrl(input.path),
    mainEntityOfPage: absUrl(input.path),
    image: OG_IMAGE,
    inLanguage: "en",
    ...(input.keywords?.length ? { keywords: input.keywords.join(", ") } : {}),
    datePublished: input.datePublished ?? "2026-01-01",
    dateModified: input.dateModified ?? input.datePublished ?? "2026-01-01",
    author: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
    publisher: {
      "@type": "Organization",
      name: SITE_NAME,
      url: SITE_URL,
      logo: { "@type": "ImageObject", url: absUrl("/favicon.svg") },
    },
  };
}

/** Schema.org FAQPage from a list of question/answer pairs. */
export function faqLd(faqs: readonly { readonly q: string; readonly a: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}

/** Schema.org SoftwareApplication describing openjev itself. */
export function softwareLd() {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE_NAME,
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Linux, macOS, Windows, Docker",
    url: SITE_URL,
    description:
      "Open-source System One engine that returns typed decisions — Choice, Score, and Noul — with a confidence score and full probability distribution instead of generated text.",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    softwareHelp: absUrl("/docs"),
    license: "https://www.apache.org/licenses/LICENSE-2.0",
  };
}

/** Schema.org ItemList for a hub/collection page (guides index, compare index). */
export function itemListLd(
  items: readonly { readonly name: string; readonly path: string }[],
) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      url: absUrl(it.path),
    })),
  };
}

/**
 * Minimal per-page head: a distinct browser-tab title ("<title> · OpenJev")
 * plus an optional meta description. Used by console and hub pages that do
 * not need the full OpenGraph / JSON-LD treatment of the SEO routes.
 */
export function pageHead(title: string, description?: string) {
  const full = `${title} · ${SITE_NAME}`;
  return {
    meta: [
      { title: full },
      ...(description ? [{ name: "description", content: description }] : []),
    ],
  };
}
