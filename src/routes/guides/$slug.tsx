import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ContentNotFound } from "@/components/content-not-found";
import { AppShell } from "@/components/app-shell";
import { CopyButton } from "@/components/copy-button";
import { buttonVariants } from "@/components/ui/button";
import {
  type Guide,
  type GuideRelated,
  GUIDES,
  guideBySlug,
} from "@/lib/content/guides";
import {
  absUrl,
  articleLd,
  breadcrumbLd,
  faqLd,
  OG_IMAGE,
  SITE_NAME,
} from "@/lib/seo/site";
import { cn } from "@/lib/utils";
import { LinkedText } from "@/components/linked-text";

export const Route = createFileRoute("/guides/$slug")({
  loader: ({ params }) => {
    if (!guideBySlug(params.slug)) throw notFound();
  },
  notFoundComponent: () => (
    <ContentNotFound kind="Guide" backTo="/guides" backLabel="All guides" />
  ),
  head: ({ params }) => {
    const guide = guideBySlug(params.slug);
    if (!guide) return {};
    const path = `/guides/${guide.slug}`;
    const title = `${guide.title} · ${SITE_NAME}`;
    return {
      meta: [
        { title },
        { name: "description", content: guide.description },
        { name: "keywords", content: guide.keywords.join(", ") },
        { property: "og:type", content: "article" },
        { property: "og:title", content: title },
        { property: "og:description", content: guide.description },
        { property: "og:url", content: absUrl(path) },
        { property: "og:image", content: OG_IMAGE },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: guide.description },
        {
          "script:ld+json": articleLd({
            headline: guide.title,
            description: guide.description,
            path,
            dateModified: guide.updated,
            keywords: guide.keywords,
          }),
        },
        {
          "script:ld+json": breadcrumbLd([
            { name: "Home", path: "/" },
            { name: "Guides", path: "/guides" },
            { name: guide.navLabel, path },
          ]),
        },
        { "script:ld+json": faqLd(guide.faqs) },
      ],
      links: [{ rel: "canonical", href: absUrl(path) }],
    };
  },
  component: GuidePage,
});

const RELATED_TO: Record<Exclude<GuideRelated["kind"], "page">, string> = {
  guide: "/guides/$slug",
  compare: "/compare/$slug",
  "use-case": "/use-cases/$slug",
  doc: "/docs/$slug",
};

const RELATED_CARD =
  "group rounded-md bg-surface p-4 shadow-[var(--shadow-border)] transition-[box-shadow] duration-150 hover:shadow-[var(--shadow-border-hover)]";

function RelatedCardBody({ kind, label }: { kind: string; label: string }) {
  return (
    <>
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
        {kind}
      </p>
      <p className="mt-1 text-sm font-medium tracking-tight text-fg">
        {label}
      </p>
      <span className="mt-2 inline-block font-mono text-xs text-muted transition-colors group-hover:text-fg">
        Open →
      </span>
    </>
  );
}

function relatedLink(r: GuideRelated) {
  if (r.kind === "page") {
    return (
      <Link key={`page:${r.slug}`} to={r.slug} className={RELATED_CARD}>
        <RelatedCardBody kind="page" label={r.label} />
      </Link>
    );
  }
  // Docs live under /docs/$slug; use-cases under /use-cases/$slug — all share the
  // `$slug` param name, so a single param map works for every kind.
  return (
    <Link
      key={`${r.kind}:${r.slug}`}
      to={RELATED_TO[r.kind]}
      params={{ slug: r.slug }}
      className={RELATED_CARD}
    >
      <RelatedCardBody kind={r.kind === "use-case" ? "use case" : r.kind} label={r.label} />
    </Link>
  );
}

function GuidePage() {
  const { slug } = Route.useParams();
  const guide = guideBySlug(slug);

  if (!guide) {
    return (
      <AppShell>
        <div className="mx-auto max-w-2xl space-y-4">
          <h1 className="text-2xl font-medium tracking-tight">Unknown guide</h1>
          <p className="text-sm text-muted">
            No guide is registered at{" "}
            <span className="font-mono text-fg">/guides/{slug}</span>.
          </p>
          <Link
            to="/guides"
            className={cn(buttonVariants({ variant: "secondary" }))}
          >
            All guides
          </Link>
        </div>
      </AppShell>
    );
  }

  const more: Guide[] = GUIDES.filter(
    (g) => g.kind === guide.kind && g.slug !== guide.slug,
  ).slice(0, 3);

  return (
    <AppShell>
      <article className="mx-auto max-w-3xl space-y-12">
        <header className="space-y-3">
          <Link
            to="/guides"
            className="font-mono text-xs uppercase tracking-[0.18em] text-subtle hover:text-fg"
          >
            ← Guides
          </Link>
          <span className="ml-2 font-mono text-xs uppercase tracking-[0.16em] text-muted">
            {guide.category}
          </span>
          <h1 className="text-3xl font-medium tracking-tight md:text-4xl">
            {guide.title}
          </h1>
          <p className="max-w-2xl text-base leading-relaxed text-muted">
            <LinkedText text={guide.intro} />
          </p>
        </header>

        <section className="space-y-3 rounded-md bg-surface p-5 shadow-[var(--shadow-border)]">
          <h2 className="font-mono text-xs uppercase tracking-[0.16em] text-subtle">
            Key takeaways
          </h2>
          <ul className="space-y-2 text-sm leading-relaxed text-muted">
            {guide.takeaways.map((t) => (
              <li key={t} className="flex gap-2">
                <span className="mt-1.5 inline-block size-1.5 shrink-0 rounded-full bg-ok" />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </section>

        {guide.sections.map((s) => (
          <section key={s.heading} className="space-y-3">
            <h2 className="text-lg font-medium tracking-tight">{s.heading}</h2>
            <p className="text-sm leading-relaxed text-muted"><LinkedText text={s.body} /></p>
            {s.bullets ? (
              <ul className="space-y-2 text-sm leading-relaxed text-muted">
                {s.bullets.map((b) => (
                  <li key={b} className="flex gap-2">
                    <span className="mt-1.5 inline-block size-1.5 shrink-0 rounded-full bg-muted" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {s.code ? (
              <div className="space-y-2 rounded-md bg-surface p-4 shadow-[var(--shadow-border)]">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                    {s.code.lang ?? "code"}
                  </p>
                  <CopyButton text={s.code.code} />
                </div>
                <pre className="overflow-x-auto rounded-sm bg-inset p-3 font-mono text-[12px] leading-relaxed text-fg">
                  {s.code.code}
                </pre>
              </div>
            ) : null}
          </section>
        ))}

        {guide.table ? (
          <section className="space-y-3">
            <h2 className="text-lg font-medium tracking-tight">
              {guide.table.caption}
            </h2>
            <div className="overflow-x-auto rounded-md bg-surface shadow-[var(--shadow-border)]">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="border-b border-border font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                  <tr>
                    <th className="px-3 py-2" />
                    <th className="px-3 py-2">{guide.table.colA}</th>
                    <th className="px-3 py-2">{guide.table.colB}</th>
                  </tr>
                </thead>
                <tbody className="text-muted">
                  {guide.table.rows.map((r) => (
                    <tr
                      key={r.label}
                      className="border-b border-border/60 last:border-0"
                    >
                      <td className="px-3 py-3 font-medium text-fg">
                        {r.label}
                      </td>
                      <td className="px-3 py-3 leading-relaxed"><LinkedText text={r.a} /></td>
                      <td className="px-3 py-3 leading-relaxed text-fg">
                        {r.b}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        <section className="space-y-3">
          <h2 className="text-lg font-medium tracking-tight">
            Frequently asked
          </h2>
          <div className="space-y-3">
            {guide.faqs.map((f) => (
              <div
                key={f.q}
                className="space-y-1.5 rounded-md bg-surface p-4 shadow-[var(--shadow-border)]"
              >
                <p className="text-sm font-medium tracking-tight text-fg">
                  {f.q}
                </p>
                <p className="text-sm leading-relaxed text-muted"><LinkedText text={f.a} /></p>
              </div>
            ))}
          </div>
        </section>

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

        <section className="space-y-3 border-t border-border pt-8">
          <h2 className="text-lg font-medium tracking-tight">Keep reading</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {guide.related.map(relatedLink)}
          </div>
          {more.length ? (
            <div className="flex flex-wrap gap-2 pt-2">
              {more.map((g) => (
                <Link
                  key={g.slug}
                  to="/guides/$slug"
                  params={{ slug: g.slug }}
                  className="rounded-sm bg-raised px-3 py-2 font-mono text-xs text-muted transition-colors hover:text-fg"
                >
                  {g.navLabel}
                </Link>
              ))}
            </div>
          ) : null}
        </section>
      </article>
    </AppShell>
  );
}
