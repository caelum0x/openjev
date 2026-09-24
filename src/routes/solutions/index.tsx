import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { SOLUTIONS } from "@/lib/content/solutions";
import {
  absUrl,
  breadcrumbLd,
  itemListLd,
  OG_IMAGE,
  SITE_NAME,
} from "@/lib/seo/site";

const PATH = "/solutions";
const TITLE = `Solutions — typed decisions by industry · ${SITE_NAME}`;
const DESCRIPTION =
  "Industry-specific patterns for typed LLM decisions: fintech fraud gates, healthcare triage, legal contract risk, customer support routing, ecommerce return fraud, content moderation, insurance adjudication, and developer tool CI gates.";

export const Route = createFileRoute("/solutions/")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:url", content: absUrl(PATH) },
      { property: "og:image", content: OG_IMAGE },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESCRIPTION },
      {
        "script:ld+json": breadcrumbLd([
          { name: "Home", path: "/" },
          { name: "Solutions", path: PATH },
        ]),
      },
      {
        "script:ld+json": itemListLd(
          SOLUTIONS.map((s) => ({
            name: s.title,
            path: `/solutions/${s.slug}`,
          })),
        ),
      },
    ],
    links: [{ rel: "canonical", href: absUrl(PATH) }],
  }),
  component: SolutionsIndex,
});

function SolutionsIndex() {
  return (
    <AppShell>
      <div className="space-y-12">
        <header className="space-y-3">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">
            Solutions
          </p>
          <h1 className="max-w-3xl text-3xl font-medium tracking-tight md:text-4xl">
            Typed decisions, industry by industry.
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            Every industry has a stack of closed-set judgments that today get
            made by keyword rules, prose extraction, or expensive generative
            calls. The eight verticals below show how{" "}
            <span className="text-fg">Choice</span>,{" "}
            <span className="text-fg">Score</span>, and{" "}
            <span className="text-fg">Noul</span> replace each one with a
            calibrated, auditable, deterministic judgment — self-hostable
            inside your compliance boundary.
          </p>
        </header>

        <div className="grid gap-3 md:grid-cols-2">
          {SOLUTIONS.map((s) => (
            <Link
              key={s.slug}
              to="/solutions/$slug"
              params={{ slug: s.slug }}
              className="group flex flex-col rounded-md bg-surface p-5 shadow-[var(--shadow-border)] transition-[box-shadow] duration-150 hover:shadow-[var(--shadow-border-hover)]"
            >
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-medium tracking-tight">{s.title}</p>
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                  {s.industry}
                </span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                {s.description}
              </p>
              <div className="mt-4 flex items-center justify-between gap-3">
                <span className="rounded-sm bg-raised px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
                  {s.primitiveLabel}
                </span>
                <span className="font-mono text-xs text-muted transition-colors group-hover:text-fg">
                  Explore →
                </span>
              </div>
            </Link>
          ))}
        </div>

        <section className="space-y-3 rounded-md bg-surface p-5 shadow-[var(--shadow-border)]">
          <h2 className="text-lg font-medium tracking-tight">
            One request, every vertical.
          </h2>
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            All eight patterns run against the same{" "}
            <span className="font-mono text-fg">POST /api/v1/systemone</span>{" "}
            endpoint. Self-host with Docker for data residency, or point the
            SDK at a hosted endpoint to get started in minutes.
          </p>
          <div className="flex flex-wrap gap-x-5 gap-y-2 pt-1 text-sm text-muted">
            <Link to="/playground" className="hover:text-fg">
              Open the playground →
            </Link>
            <Link to="/use-cases" className="hover:text-fg">
              Browse all use cases →
            </Link>
            <Link to="/docs" className="hover:text-fg">
              Read the docs →
            </Link>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
