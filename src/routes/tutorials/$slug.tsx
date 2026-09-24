import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ContentNotFound } from "@/components/content-not-found";
import { AppShell } from "@/components/app-shell";
import { CopyButton } from "@/components/copy-button";
import { buttonVariants } from "@/components/ui/button";
import {
  type Tutorial,
  type TutorialRelated,
  TUTORIALS,
  tutorialBySlug,
} from "@/lib/content/tutorials";
import {
  absUrl,
  articleLd,
  breadcrumbLd,
  faqLd,
  OG_IMAGE,
  SITE_NAME,
} from "@/lib/seo/site";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/tutorials/$slug")({
  loader: ({ params }) => {
    if (!tutorialBySlug(params.slug)) throw notFound();
  },
  notFoundComponent: () => (
    <ContentNotFound kind="Tutorial" backTo="/tutorials" backLabel="All tutorials" />
  ),
  head: ({ params }) => {
    const tutorial = tutorialBySlug(params.slug);
    if (!tutorial) return {};
    const path = `/tutorials/${tutorial.slug}`;
    const title = `${tutorial.title} · ${SITE_NAME}`;
    return {
      meta: [
        { title },
        { name: "description", content: tutorial.description },
        { name: "keywords", content: tutorial.keywords.join(", ") },
        { property: "og:type", content: "article" },
        { property: "og:title", content: title },
        { property: "og:description", content: tutorial.description },
        { property: "og:url", content: absUrl(path) },
        { property: "og:image", content: OG_IMAGE },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: tutorial.description },
        {
          "script:ld+json": articleLd({
            headline: tutorial.title,
            description: tutorial.description,
            path,
            dateModified: tutorial.updated,
            keywords: tutorial.keywords,
          }),
        },
        {
          "script:ld+json": breadcrumbLd([
            { name: "Home", path: "/" },
            { name: "Tutorials", path: "/tutorials" },
            { name: tutorial.navLabel, path },
          ]),
        },
        { "script:ld+json": faqLd(tutorial.faqs) },
      ],
      links: [{ rel: "canonical", href: absUrl(path) }],
    };
  },
  component: TutorialPage,
});

// Route map for related cross-links.
const RELATED_TO: Record<TutorialRelated["kind"], string> = {
  guide: "/guides/$slug",
  compare: "/compare/$slug",
  "use-case": "/use-cases/$slug",
  doc: "/docs/$slug",
  tutorial: "/tutorials/$slug",
};

function relatedLink(r: TutorialRelated) {
  return (
    <Link
      key={`${r.kind}:${r.slug}`}
      to={RELATED_TO[r.kind]}
      params={{ slug: r.slug }}
      className="group rounded-md bg-surface p-4 shadow-[var(--shadow-border)] transition-[box-shadow] duration-150 hover:shadow-[var(--shadow-border-hover)]"
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
        {r.kind === "use-case" ? "use case" : r.kind}
      </p>
      <p className="mt-1 text-sm font-medium tracking-tight text-fg">
        {r.label}
      </p>
      <span className="mt-2 inline-block font-mono text-xs text-muted transition-colors group-hover:text-fg">
        Open →
      </span>
    </Link>
  );
}

function TutorialPage() {
  const { slug } = Route.useParams();
  const tutorial = tutorialBySlug(slug);

  if (!tutorial) {
    return (
      <AppShell>
        <div className="mx-auto max-w-2xl space-y-4">
          <h1 className="text-2xl font-medium tracking-tight">
            Unknown tutorial
          </h1>
          <p className="text-sm text-muted">
            No tutorial is registered at{" "}
            <span className="font-mono text-fg">/tutorials/{slug}</span>.
          </p>
          <Link
            to="/tutorials"
            className={cn(buttonVariants({ variant: "secondary" }))}
          >
            All tutorials
          </Link>
        </div>
      </AppShell>
    );
  }

  // Sibling tutorials for the "More tutorials" footer strip.
  const siblings: Tutorial[] = TUTORIALS.filter(
    (t) => t.slug !== tutorial.slug,
  ).slice(0, 4);

  // Index within the full list for "Tutorial N of M" label.
  const tutorialIndex = TUTORIALS.findIndex((t) => t.slug === tutorial.slug);
  const tutorialLabel =
    tutorialIndex >= 0
      ? `Tutorial ${tutorialIndex + 1} of ${TUTORIALS.length}`
      : tutorial.category;

  return (
    <AppShell>
      <article className="mx-auto max-w-3xl space-y-12">
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <header className="space-y-3">
          <div className="flex items-center gap-2">
            <Link
              to="/tutorials"
              className="font-mono text-xs uppercase tracking-[0.18em] text-subtle hover:text-fg"
            >
              ← Tutorials
            </Link>
            <span className="font-mono text-xs uppercase tracking-[0.16em] text-muted">
              {tutorialLabel}
            </span>
          </div>
          <h1 className="text-3xl font-medium tracking-tight md:text-4xl">
            {tutorial.title}
          </h1>
          <p className="max-w-2xl text-base leading-relaxed text-muted">
            {tutorial.intro}
          </p>
        </header>

        {/* ── Goal + meta ─────────────────────────────────────────────────── */}
        <section className="space-y-3 rounded-md bg-surface p-5 shadow-[var(--shadow-border)]">
          <h2 className="font-mono text-xs uppercase tracking-[0.16em] text-subtle">
            Goal
          </h2>
          <p className="text-sm leading-relaxed text-fg">{tutorial.goal}</p>
          <div className="flex flex-wrap gap-x-5 gap-y-1 pt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
            <span>{tutorial.readingTime} min read</span>
            <span>{tutorial.steps.length} steps</span>
          </div>
        </section>

        {/* ── Prerequisites ───────────────────────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="text-lg font-medium tracking-tight">
            Before you start
          </h2>
          <ul className="space-y-2 text-sm leading-relaxed text-muted">
            {tutorial.prerequisites.map((p) => (
              <li key={p} className="flex gap-2">
                <span className="mt-1.5 inline-block size-1.5 shrink-0 rounded-full bg-muted" />
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* ── Numbered steps ──────────────────────────────────────────────── */}
        {tutorial.steps.map((step) => (
          <section key={step.n} className="space-y-3">
            <div className="flex items-baseline gap-3">
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-subtle">
                Step {step.n}
              </span>
              <h2 className="text-lg font-medium tracking-tight">
                {step.heading}
              </h2>
            </div>
            <p className="text-sm leading-relaxed text-muted">{step.body}</p>
            {step.code ? (
              <div className="space-y-2 rounded-md bg-surface p-4 shadow-[var(--shadow-border)]">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                    {step.code.lang ?? "code"}
                  </p>
                  <CopyButton text={step.code.code} />
                </div>
                <pre className="overflow-x-auto rounded-sm bg-inset p-3 font-mono text-[12px] leading-relaxed text-fg">
                  {step.code.code}
                </pre>
              </div>
            ) : null}
          </section>
        ))}

        {/* ── Expected output ─────────────────────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="text-lg font-medium tracking-tight">
            Expected output
          </h2>
          <p className="text-sm leading-relaxed text-muted">
            {tutorial.expectedOutput}
          </p>
        </section>

        {/* ── Next steps ──────────────────────────────────────────────────── */}
        <section className="space-y-3 rounded-md bg-surface p-5 shadow-[var(--shadow-border)]">
          <h2 className="font-mono text-xs uppercase tracking-[0.16em] text-subtle">
            Next steps
          </h2>
          <ul className="space-y-2 text-sm leading-relaxed text-muted">
            {tutorial.nextSteps.map((s) => (
              <li key={s} className="flex gap-2">
                <span className="mt-1.5 inline-block size-1.5 shrink-0 rounded-full bg-ok" />
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* ── FAQ ─────────────────────────────────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="text-lg font-medium tracking-tight">
            Frequently asked
          </h2>
          <div className="space-y-3">
            {tutorial.faqs.map((f) => (
              <div
                key={f.q}
                className="space-y-1.5 rounded-md bg-surface p-4 shadow-[var(--shadow-border)]"
              >
                <p className="text-sm font-medium tracking-tight text-fg">
                  {f.q}
                </p>
                <p className="text-sm leading-relaxed text-muted">{f.a}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── CTAs ────────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap gap-2">
          <Link
            to="/playground"
            className={cn(buttonVariants({ variant: "primary" }))}
          >
            Try it in the playground →
          </Link>
          <Link
            to="/docs"
            className={cn(buttonVariants({ variant: "secondary" }))}
          >
            API reference
          </Link>
        </div>

        {/* ── Related ─────────────────────────────────────────────────────── */}
        <section className="space-y-3 border-t border-border pt-8">
          <h2 className="text-lg font-medium tracking-tight">Keep reading</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {tutorial.related.map(relatedLink)}
          </div>

          {/* More tutorials strip */}
          {siblings.length > 0 ? (
            <div className="flex flex-wrap gap-2 pt-2">
              {siblings.map((t) => (
                <Link
                  key={t.slug}
                  to="/tutorials/$slug"
                  params={{ slug: t.slug }}
                  className="rounded-sm bg-raised px-3 py-2 font-mono text-xs text-muted transition-colors hover:text-fg"
                >
                  {t.navLabel}
                </Link>
              ))}
            </div>
          ) : null}
        </section>
      </article>
    </AppShell>
  );
}
