import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ContentNotFound } from "@/components/content-not-found";
import { AppShell } from "@/components/app-shell";
import { CopyButton } from "@/components/copy-button";
import { buttonVariants } from "@/components/ui/button";
import {
  type SdkGuide,
  type SdkRelated,
  SDKS,
  sdkBySlug,
} from "@/lib/content/sdks";
import {
  absUrl,
  articleLd,
  breadcrumbLd,
  faqLd,
  OG_IMAGE,
  SITE_NAME,
} from "@/lib/seo/site";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/sdks/$slug")({
  loader: ({ params }) => {
    if (!sdkBySlug(params.slug)) throw notFound();
  },
  notFoundComponent: () => (
    <ContentNotFound kind="SDK" backTo="/sdks" backLabel="All SDKs" />
  ),
  head: ({ params }) => {
    const sdk = sdkBySlug(params.slug);
    if (!sdk) return {};
    const path = `/sdks/${sdk.slug}`;
    const title = `${sdk.title} · ${SITE_NAME}`;
    return {
      meta: [
        { title },
        { name: "description", content: sdk.description },
        { name: "keywords", content: sdk.keywords.join(", ") },
        { property: "og:type", content: "article" },
        { property: "og:title", content: title },
        { property: "og:description", content: sdk.description },
        { property: "og:url", content: absUrl(path) },
        { property: "og:image", content: OG_IMAGE },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: sdk.description },
        {
          "script:ld+json": articleLd({
            headline: sdk.title,
            description: sdk.description,
            path,
            dateModified: sdk.updated,
            keywords: sdk.keywords,
          }),
        },
        {
          "script:ld+json": breadcrumbLd([
            { name: "Home", path: "/" },
            { name: "SDKs", path: "/sdks" },
            { name: sdk.navLabel, path },
          ]),
        },
        { "script:ld+json": faqLd(sdk.faqs) },
      ],
      links: [{ rel: "canonical", href: absUrl(path) }],
    };
  },
  component: SdkPage,
});

const RELATED_TO: Record<SdkRelated["kind"], string> = {
  sdk: "/sdks/$slug",
  guide: "/guides/$slug",
  compare: "/compare/$slug",
  "use-case": "/use-cases/$slug",
  doc: "/docs/$slug",
};

function relatedLink(r: SdkRelated) {
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

function SdkPage() {
  const { slug } = Route.useParams();
  const sdk = sdkBySlug(slug);

  if (!sdk) {
    return (
      <AppShell>
        <div className="mx-auto max-w-2xl space-y-4">
          <h1 className="text-2xl font-medium tracking-tight">Unknown SDK guide</h1>
          <p className="text-sm text-muted">
            No SDK guide is registered at{" "}
            <span className="font-mono text-fg">/sdks/{slug}</span>.
          </p>
          <Link
            to="/sdks"
            className={cn(buttonVariants({ variant: "secondary" }))}
          >
            All SDK guides
          </Link>
        </div>
      </AppShell>
    );
  }

  const more: SdkGuide[] = SDKS.filter(
    (s) => s.kind === sdk.kind && s.slug !== sdk.slug,
  ).slice(0, 3);

  return (
    <AppShell>
      <article className="mx-auto max-w-3xl space-y-12">
        <header className="space-y-3">
          <Link
            to="/sdks"
            className="font-mono text-xs uppercase tracking-[0.18em] text-subtle hover:text-fg"
          >
            ← SDKs
          </Link>
          <span className="ml-2 font-mono text-xs uppercase tracking-[0.16em] text-muted">
            {sdk.category}
          </span>
          <h1 className="text-3xl font-medium tracking-tight md:text-4xl">
            {sdk.title}
          </h1>
          <p className="max-w-2xl text-base leading-relaxed text-muted">
            {sdk.intro}
          </p>
        </header>

        <section className="space-y-3 rounded-md bg-surface p-5 shadow-[var(--shadow-border)]">
          <h2 className="font-mono text-xs uppercase tracking-[0.16em] text-subtle">
            Key takeaways
          </h2>
          <ul className="space-y-2 text-sm leading-relaxed text-muted">
            {sdk.takeaways.map((t) => (
              <li key={t} className="flex gap-2">
                <span className="mt-1.5 inline-block size-1.5 shrink-0 rounded-full bg-ok" />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </section>

        {sdk.sections.map((s) => (
          <section key={s.heading} className="space-y-3">
            <h2 className="text-lg font-medium tracking-tight">{s.heading}</h2>
            <p className="text-sm leading-relaxed text-muted">{s.body}</p>
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

        {sdk.table ? (
          <section className="space-y-3">
            <h2 className="text-lg font-medium tracking-tight">
              {sdk.table.caption}
            </h2>
            <div className="overflow-x-auto rounded-md bg-surface shadow-[var(--shadow-border)]">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="border-b border-border font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                  <tr>
                    <th className="px-3 py-2" />
                    <th className="px-3 py-2">{sdk.table.colA}</th>
                    <th className="px-3 py-2">{sdk.table.colB}</th>
                  </tr>
                </thead>
                <tbody className="text-muted">
                  {sdk.table.rows.map((r) => (
                    <tr
                      key={r.label}
                      className="border-b border-border/60 last:border-0"
                    >
                      <td className="px-3 py-3 font-medium text-fg">
                        {r.label}
                      </td>
                      <td className="px-3 py-3 leading-relaxed">{r.a}</td>
                      <td className="px-3 py-3 leading-relaxed text-fg">{r.b}</td>
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
            {sdk.faqs.map((f) => (
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
            {sdk.related.map(relatedLink)}
          </div>
          {more.length ? (
            <div className="flex flex-wrap gap-2 pt-2">
              {more.map((s) => (
                <Link
                  key={s.slug}
                  to="/sdks/$slug"
                  params={{ slug: s.slug }}
                  className="rounded-sm bg-raised px-3 py-2 font-mono text-xs text-muted transition-colors hover:text-fg"
                >
                  {s.navLabel}
                </Link>
              ))}
            </div>
          ) : null}
        </section>
      </article>
    </AppShell>
  );
}
