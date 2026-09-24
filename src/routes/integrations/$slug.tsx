import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ContentNotFound } from "@/components/content-not-found";
import { AppShell } from "@/components/app-shell";
import { CopyButton } from "@/components/copy-button";
import { buttonVariants } from "@/components/ui/button";
import {
  type Integration,
  type IntegrationRelated,
  INTEGRATIONS,
  integrationBySlug,
} from "@/lib/content/integrations";
import {
  absUrl,
  articleLd,
  breadcrumbLd,
  faqLd,
  OG_IMAGE,
  SITE_NAME,
} from "@/lib/seo/site";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/integrations/$slug")({
  loader: ({ params }) => {
    if (!integrationBySlug(params.slug)) throw notFound();
  },
  notFoundComponent: () => (
    <ContentNotFound kind="Integration" backTo="/integrations" backLabel="All integrations" />
  ),
  head: ({ params }) => {
    const integration = integrationBySlug(params.slug);
    if (!integration) return {};
    const path = `/integrations/${integration.slug}`;
    const title = `${integration.title} · ${SITE_NAME}`;
    return {
      meta: [
        { title },
        { name: "description", content: integration.description },
        { name: "keywords", content: integration.keywords.join(", ") },
        { property: "og:type", content: "article" },
        { property: "og:title", content: title },
        { property: "og:description", content: integration.description },
        { property: "og:url", content: absUrl(path) },
        { property: "og:image", content: OG_IMAGE },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: integration.description },
        {
          "script:ld+json": articleLd({
            headline: integration.title,
            description: integration.description,
            path,
            dateModified: integration.updated,
            keywords: integration.keywords,
          }),
        },
        {
          "script:ld+json": breadcrumbLd([
            { name: "Home", path: "/" },
            { name: "Integrations", path: "/integrations" },
            { name: integration.navLabel, path },
          ]),
        },
        { "script:ld+json": faqLd(integration.faqs) },
      ],
      links: [{ rel: "canonical", href: absUrl(path) }],
    };
  },
  component: IntegrationPage,
});

const RELATED_TO: Record<IntegrationRelated["kind"], string> = {
  guide: "/guides/$slug",
  compare: "/compare/$slug",
  "use-case": "/use-cases/$slug",
  doc: "/docs/$slug",
};

function relatedLink(r: IntegrationRelated) {
  const to = RELATED_TO[r.kind];
  return (
    <Link
      key={`${r.kind}:${r.slug}`}
      to={to}
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

function IntegrationPage() {
  const { slug } = Route.useParams();
  const integration = integrationBySlug(slug);

  if (!integration) {
    return (
      <AppShell>
        <div className="mx-auto max-w-2xl space-y-4">
          <h1 className="text-2xl font-medium tracking-tight">
            Unknown integration
          </h1>
          <p className="text-sm text-muted">
            No integration guide is registered at{" "}
            <span className="font-mono text-fg">/integrations/{slug}</span>.
          </p>
          <Link
            to="/integrations"
            className={cn(buttonVariants({ variant: "secondary" }))}
          >
            All integrations
          </Link>
        </div>
      </AppShell>
    );
  }

  const more: Integration[] = INTEGRATIONS.filter(
    (i) => i.kind === integration.kind && i.slug !== integration.slug,
  ).slice(0, 3);

  return (
    <AppShell>
      <article className="mx-auto max-w-3xl space-y-12">
        <header className="space-y-3">
          <Link
            to="/integrations"
            className="font-mono text-xs uppercase tracking-[0.18em] text-subtle hover:text-fg"
          >
            ← Integrations
          </Link>
          <span className="ml-2 font-mono text-xs uppercase tracking-[0.16em] text-muted">
            {integration.category}
          </span>
          <h1 className="text-3xl font-medium tracking-tight md:text-4xl">
            {integration.title}
          </h1>
          <p className="max-w-2xl text-base leading-relaxed text-muted">
            {integration.intro}
          </p>
        </header>

        <section className="space-y-3 rounded-md bg-surface p-5 shadow-[var(--shadow-border)]">
          <h2 className="font-mono text-xs uppercase tracking-[0.16em] text-subtle">
            Key takeaways
          </h2>
          <ul className="space-y-2 text-sm leading-relaxed text-muted">
            {integration.takeaways.map((t) => (
              <li key={t} className="flex gap-2">
                <span className="mt-1.5 inline-block size-1.5 shrink-0 rounded-full bg-ok" />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </section>

        {integration.sections.map((s) => (
          <section key={s.heading} className="space-y-3">
            <h2 className="text-lg font-medium tracking-tight">{s.heading}</h2>
            {s.body ? (
              <p className="text-sm leading-relaxed text-muted">{s.body}</p>
            ) : null}
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

        <section className="space-y-3">
          <h2 className="text-lg font-medium tracking-tight">
            Frequently asked
          </h2>
          <div className="space-y-3">
            {integration.faqs.map((f) => (
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
            {integration.related.map(relatedLink)}
          </div>
          {more.length ? (
            <div className="flex flex-wrap gap-2 pt-2">
              {more.map((i) => (
                <Link
                  key={i.slug}
                  to="/integrations/$slug"
                  params={{ slug: i.slug }}
                  className="rounded-sm bg-raised px-3 py-2 font-mono text-xs text-muted transition-colors hover:text-fg"
                >
                  {i.navLabel}
                </Link>
              ))}
            </div>
          ) : null}
        </section>
      </article>
    </AppShell>
  );
}
