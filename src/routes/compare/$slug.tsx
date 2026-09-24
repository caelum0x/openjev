import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ContentNotFound } from "@/components/content-not-found";
import { AppShell } from "@/components/app-shell";
import { CopyButton } from "@/components/copy-button";
import { buttonVariants } from "@/components/ui/button";
import { COMPARISONS, comparisonBySlug, type Edge } from "@/lib/content/compare";
import {
  absUrl,
  articleLd,
  breadcrumbLd,
  OG_IMAGE,
  SITE_NAME,
  softwareLd,
} from "@/lib/seo/site";
import { cn } from "@/lib/utils";
import { LinkedText } from "@/components/linked-text";

export const Route = createFileRoute("/compare/$slug")({
  loader: ({ params }) => {
    if (!comparisonBySlug(params.slug)) throw notFound();
  },
  notFoundComponent: () => (
    <ContentNotFound kind="Comparison" backTo="/compare" backLabel="All comparisons" />
  ),
  head: ({ params }) => {
    const cmp = comparisonBySlug(params.slug);
    if (!cmp) return {};
    const path = `/compare/${cmp.slug}`;
    const title = `${cmp.title} · ${SITE_NAME}`;
    const description = cmp.tagline;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:type", content: "article" },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:url", content: absUrl(path) },
        { property: "og:image", content: OG_IMAGE },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
        {
          "script:ld+json": articleLd({
            headline: cmp.title,
            description: cmp.summary,
            path,
          }),
        },
        {
          "script:ld+json": breadcrumbLd([
            { name: "Home", path: "/" },
            { name: "Compare", path: "/compare" },
            { name: cmp.navLabel, path },
          ]),
        },
        { "script:ld+json": softwareLd() },
      ],
      links: [{ rel: "canonical", href: absUrl(path) }],
    };
  },
  component: ComparePage,
});

const EDGE_TONE: Record<Edge, string> = {
  openjev: "text-ok",
  other: "text-muted",
  even: "text-subtle",
};

const EDGE_LABEL: Record<Edge, string> = {
  openjev: "openjev",
  other: "the other",
  even: "even",
};

function ComparePage() {
  const { slug } = Route.useParams();
  const cmp = comparisonBySlug(slug);

  if (!cmp) {
    return (
      <AppShell>
        <div className="space-y-3">
          <p className="text-sm text-muted">Unknown comparison.</p>
          <Link
            to="/compare"
            className={cn(buttonVariants({ variant: "secondary" }))}
          >
            All comparisons
          </Link>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <article className="space-y-12">
        <header className="space-y-3">
          <Link
            to="/compare"
            className="font-mono text-xs uppercase tracking-[0.18em] text-subtle hover:text-fg"
          >
            ← Compare
          </Link>
          <h1 className="max-w-3xl text-3xl font-medium tracking-tight md:text-4xl">
            {cmp.title}
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            {cmp.tagline}
          </p>
        </header>

        <section className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2 rounded-md bg-surface p-4 shadow-[var(--shadow-border)]">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
              OpenJev
            </p>
            <p className="font-medium tracking-tight">System One typed decisions</p>
            <p className="text-sm leading-relaxed text-muted">
              Send a state and typed questions; get a Choice / Score / Noul
              plus a probability distribution your code can gate on, with
              calibration measured on the public leaderboard and fittable to
              your own labels. Local
              backends, 0 output tokens, deterministic.
            </p>
          </div>
          <div className="space-y-2 rounded-md bg-surface p-4 shadow-[var(--shadow-border)]">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
              {cmp.navLabel}
            </p>
            <p className="font-medium tracking-tight">{cmp.otherLabel}</p>
            <p className="text-sm leading-relaxed text-muted">{cmp.otherBlurb}</p>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-medium tracking-tight">The honest summary</h2>
          <p className="max-w-3xl text-sm leading-relaxed text-muted">
            <LinkedText text={cmp.summary} />
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-medium tracking-tight">
            Side by side
          </h2>
          <div className="overflow-x-auto rounded-md bg-surface shadow-[var(--shadow-border)]">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="border-b border-border font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                <tr>
                  <th className="px-3 py-2">Dimension</th>
                  <th className="px-3 py-2">OpenJev</th>
                  <th className="px-3 py-2">{cmp.otherLabel}</th>
                  <th className="px-3 py-2">Edge</th>
                </tr>
              </thead>
              <tbody className="text-muted">
                {cmp.rows.map((r) => (
                  <tr key={r.dimension} className="border-b border-border/60 last:border-0">
                    <td className="px-3 py-3 font-medium text-fg">{r.dimension}</td>
                    <td className="px-3 py-3 leading-relaxed"><LinkedText text={r.openjev} /></td>
                    <td className="px-3 py-3 leading-relaxed">{r.other}</td>
                    <td
                      className={cn(
                        "px-3 py-3 font-mono text-xs uppercase tracking-[0.12em]",
                        EDGE_TONE[r.edge],
                      )}
                    >
                      {EDGE_LABEL[r.edge]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2 rounded-md bg-surface p-4 shadow-[var(--shadow-border)]">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
              Use {cmp.otherLabel} when
            </p>
            <ul className="space-y-2 text-sm leading-relaxed text-muted">
              {cmp.whenOther.map((w) => (
                <li key={w} className="flex gap-2">
                  <span className="mt-1.5 inline-block size-1.5 shrink-0 rounded-full bg-muted" />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-2 rounded-md bg-surface p-4 shadow-[var(--shadow-border)]">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
              Use OpenJev when
            </p>
            <ul className="space-y-2 text-sm leading-relaxed text-muted">
              {cmp.whenOts.map((w) => (
                <li key={w} className="flex gap-2">
                  <span className="mt-1.5 inline-block size-1.5 shrink-0 rounded-full bg-ok" />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {cmp.proof && cmp.proof.length > 0 ? (
          <section className="space-y-3">
            <h2 className="text-lg font-medium tracking-tight">Check it yourself</h2>
            <div className="flex flex-wrap gap-2">
              {cmp.proof.map((p) => (
                <Link
                  key={p.to}
                  to={p.to}
                  className="rounded-sm bg-raised px-3 py-2 font-mono text-xs text-muted transition-colors hover:text-fg"
                >
                  {p.label}
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        {cmp.code ? (
          <section className="space-y-3">
            <h2 className="text-lg font-medium tracking-tight">In code</h2>
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="space-y-2 rounded-md bg-surface p-4 shadow-[var(--shadow-border)]">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-mono text-xs uppercase tracking-[0.14em] text-subtle">
                    {cmp.code.otherLabel}
                  </p>
                  <CopyButton text={cmp.code.other} />
                </div>
                <pre className="overflow-x-auto rounded-sm bg-inset p-3 font-mono text-[12px] leading-relaxed text-fg">
                  {cmp.code.other}
                </pre>
              </div>
              <div className="space-y-2 rounded-md bg-surface p-4 shadow-[var(--shadow-border)]">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-mono text-xs uppercase tracking-[0.14em] text-subtle">
                    {cmp.code.otsLabel}
                  </p>
                  <CopyButton text={cmp.code.ots} />
                </div>
                <pre className="overflow-x-auto rounded-sm bg-inset p-3 font-mono text-[12px] leading-relaxed text-fg">
                  {cmp.code.ots}
                </pre>
              </div>
            </div>
          </section>
        ) : null}

        <section className="space-y-3 border-t border-border pt-6">
          <h2 className="text-lg font-medium tracking-tight">
            Other comparisons
          </h2>
          <div className="flex flex-wrap gap-2">
            {COMPARISONS.filter((c) => c.slug !== cmp.slug).map((c) => (
              <Link
                key={c.slug}
                to="/compare/$slug"
                params={{ slug: c.slug }}
                className="rounded-sm bg-raised px-3 py-2 font-mono text-xs text-muted transition-colors hover:text-fg"
              >
                {c.navLabel}
              </Link>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 pt-2">
            <Link
              to="/playground"
              className={cn(buttonVariants({ variant: "primary" }))}
            >
              Try OpenJev →
            </Link>
            <Link
              to="/models"
              className={cn(buttonVariants({ variant: "secondary" }))}
            >
              Models &amp; backends
            </Link>
          </div>
        </section>
      </article>
    </AppShell>
  );
}
