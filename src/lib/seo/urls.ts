/**
 * SITE_URLS — the canonical list of public, indexable URLs, assembled from the
 * same typed content modules that drive the pages. This is the single source the
 * sitemap.xml route renders, so a page and its sitemap entry can never drift.
 *
 * Console/auth surfaces (keys, usage, playground state) are intentionally left
 * out; only public marketing, reference, and programmatic-SEO pages belong here.
 */

import { COMPARISONS } from "@/lib/content/compare";
import { USE_CASES } from "@/lib/content/use-cases";
import { GUIDES } from "@/lib/content/guides";
import { DOC_PAGES } from "@/lib/content/docs";
import { INTEGRATIONS } from "@/lib/content/integrations";
import { TUTORIALS } from "@/lib/content/tutorials";
import { POSTS } from "@/lib/content/blog";
import { BACKENDS } from "@/lib/content/backends";
import { SDKS } from "@/lib/content/sdks";
import { COOKBOOKS } from "@/lib/jev/cookbooks";
import { SOLUTIONS } from "@/lib/content/solutions";
import { MODEL_CARDS } from "@/lib/jev/models";

export interface SiteUrl {
  readonly path: string;
  readonly changefreq: "daily" | "weekly" | "monthly";
  readonly priority: number;
}

/** Top-level public pages that are not generated from a content collection. */
const STATIC_URLS: readonly SiteUrl[] = [
  { path: "/", changefreq: "weekly", priority: 1.0 },
  { path: "/system-one", changefreq: "monthly", priority: 0.8 },
  { path: "/benchmarks", changefreq: "monthly", priority: 0.8 },
  { path: "/leaderboard", changefreq: "weekly", priority: 0.8 },
  { path: "/models", changefreq: "monthly", priority: 0.7 },
  { path: "/status", changefreq: "daily", priority: 0.5 },
  { path: "/reference", changefreq: "weekly", priority: 0.8 },
  { path: "/api-explorer", changefreq: "monthly", priority: 0.7 },
  { path: "/pricing", changefreq: "monthly", priority: 0.7 },
  { path: "/compare", changefreq: "weekly", priority: 0.8 },
  { path: "/solutions", changefreq: "weekly", priority: 0.8 },
  { path: "/use-cases", changefreq: "weekly", priority: 0.8 },
  { path: "/guides", changefreq: "weekly", priority: 0.8 },
  { path: "/sdks", changefreq: "weekly", priority: 0.8 },
  { path: "/roadmap", changefreq: "weekly", priority: 0.6 },
  { path: "/faq", changefreq: "weekly", priority: 0.7 },
  { path: "/glossary", changefreq: "monthly", priority: 0.6 },
  { path: "/integrations", changefreq: "weekly", priority: 0.8 },
  { path: "/tutorials", changefreq: "weekly", priority: 0.8 },
  { path: "/backends", changefreq: "weekly", priority: 0.7 },
  { path: "/blog", changefreq: "weekly", priority: 0.7 },
  { path: "/docs", changefreq: "weekly", priority: 0.8 },
  { path: "/self-hosting", changefreq: "monthly", priority: 0.6 },
  { path: "/skill", changefreq: "monthly", priority: 0.6 },
  { path: "/changelog", changefreq: "weekly", priority: 0.5 },
  { path: "/security", changefreq: "monthly", priority: 0.4 },
  { path: "/privacy", changefreq: "monthly", priority: 0.3 },
  { path: "/about", changefreq: "monthly", priority: 0.4 },
];

/** All public URLs, static pages first, then the generated collections. */
export function collectSiteUrls(): SiteUrl[] {
  const dynamic: SiteUrl[] = [
    ...GUIDES.map((g) => ({
      path: `/guides/${g.slug}`,
      changefreq: "monthly" as const,
      priority: 0.7,
    })),
    ...COMPARISONS.map((c) => ({
      path: `/compare/${c.slug}`,
      changefreq: "monthly" as const,
      priority: 0.7,
    })),
    ...USE_CASES.map((u) => ({
      path: `/use-cases/${u.slug}`,
      changefreq: "monthly" as const,
      priority: 0.6,
    })),
    ...DOC_PAGES.map((d) => ({
      path: `/docs/${d.slug}`,
      changefreq: "monthly" as const,
      priority: 0.6,
    })),
    ...SDKS.map((s) => ({
      path: `/sdks/${s.slug}`,
      changefreq: "monthly" as const,
      priority: 0.7,
    })),
    ...INTEGRATIONS.map((i) => ({
      path: `/integrations/${i.slug}`,
      changefreq: "monthly" as const,
      priority: 0.7,
    })),
    ...TUTORIALS.map((t) => ({
      path: `/tutorials/${t.slug}`,
      changefreq: "monthly" as const,
      priority: 0.7,
    })),
    ...BACKENDS.map((b) => ({
      path: `/backends/${b.slug}`,
      changefreq: "monthly" as const,
      priority: 0.6,
    })),
    ...POSTS.map((p) => ({
      path: `/blog/${p.slug}`,
      changefreq: "monthly" as const,
      priority: 0.6,
    })),
    ...COOKBOOKS.map((c) => ({
      path: `/cookbooks/${c.id}`,
      changefreq: "monthly" as const,
      priority: 0.5,
    })),
    ...SOLUTIONS.map((s) => ({
      path: `/solutions/${s.slug}`,
      changefreq: "monthly" as const,
      priority: 0.7,
    })),
    ...MODEL_CARDS.map((m) => ({
      path: `/models/${m.id}`,
      changefreq: "monthly" as const,
      priority: 0.6,
    })),
  ];
  return [...STATIC_URLS, ...dynamic];
}
