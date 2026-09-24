import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ContentNotFound } from "@/components/content-not-found";
import { AppShell } from "@/components/app-shell";
import { CopyButton } from "@/components/copy-button";
import { buttonVariants } from "@/components/ui/button";
import {
  type Backend,
  type BackendRelated,
  BACKENDS,
  backendBySlug,
} from "@/lib/content/backends";
import {
  absUrl,
  breadcrumbLd,
  faqLd,
  softwareLd,
  OG_IMAGE,
  SITE_NAME,
} from "@/lib/seo/site";
import { cn } from "@/lib/utils";
import { LinkedText } from "@/components/linked-text";

export const Route = createFileRoute("/backends/$slug")({
  loader: ({ params }) => {
    if (!backendBySlug(params.slug)) throw notFound();
  },
  notFoundComponent: () => (
    <ContentNotFound kind="Backend" backTo="/backends" backLabel="All backends" />
  ),
  head: ({ params }) => {
    const backend = backendBySlug(params.slug);
    if (!backend) return {};
    const path = `/backends/${backend.slug}`;
    const title = `${backend.title} · ${SITE_NAME}`;
    return {
      meta: [
        { title },
        { name: "description", content: backend.description },
        { name: "keywords", content: backend.keywords.join(", ") },
        { property: "og:type", content: "article" },
        { property: "og:title", content: title },
        { property: "og:description", content: backend.description },
        { property: "og:url", content: absUrl(path) },
        { property: "og:image", content: OG_IMAGE },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: backend.description },
        { "script:ld+json": softwareLd() },
        {
          "script:ld+json": breadcrumbLd([
            { name: "Home", path: "/" },
            { name: "Backends", path: "/backends" },
            { name: backend.navLabel, path },
          ]),
        },
        { "script:ld+json": faqLd(backend.faqs) },
      ],
      links: [{ rel: "canonical", href: absUrl(path) }],
    };
  },
  component: BackendPage,
});

const RELATED_TO: Record<BackendRelated["kind"], string> = {
  backend: "/backends/$slug",
  guide: "/guides/$slug",
  "use-case": "/use-cases/$slug",
  doc: "/docs/$slug",
};

function relatedLink(r: BackendRelated) {
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

function BackendPage() {
  const { slug } = Route.useParams();
  const backend = backendBySlug(slug);

  if (!backend) {
    return (
      <AppShell>
        <div className="mx-auto max-w-2xl space-y-4">
          <h1 className="text-2xl font-medium tracking-tight">
            Unknown backend
          </h1>
          <p className="text-sm text-muted">
            No backend is registered at{" "}
            <span className="font-mono text-fg">/backends/{slug}</span>.
          </p>
          <Link
            to="/backends"
            className={cn(buttonVariants({ variant: "secondary" }))}
          >
            All backends
          </Link>
        </div>
      </AppShell>
    );
  }

  const others: Backend[] = BACKENDS.filter(
    (b) => b.slug !== backend.slug,
  ).slice(0, 4);

  return (
    <AppShell>
      <article className="mx-auto max-w-3xl space-y-12">
        {/* Header */}
        <header className="space-y-3">
          <Link
            to="/backends"
            className="font-mono text-xs uppercase tracking-[0.18em] text-subtle hover:text-fg"
          >
            ← Backends
          </Link>
          <span className="ml-2 font-mono text-xs uppercase tracking-[0.16em] text-muted">
            {backend.category}
          </span>
          <h1 className="text-3xl font-medium tracking-tight md:text-4xl">
            {backend.title}
          </h1>
          <p className="max-w-2xl text-base leading-relaxed text-muted">
            <LinkedText text={backend.intro} />
          </p>
        </header>

        {/* Profile card */}
        <section className="space-y-3 rounded-md bg-surface p-5 shadow-[var(--shadow-border)]">
          <h2 className="font-mono text-xs uppercase tracking-[0.16em] text-subtle">
            Profile
          </h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-3">
            <div className="space-y-0.5">
              <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-subtle">
                Latency
              </dt>
              <dd className="font-mono text-fg">{backend.profile.latency}</dd>
            </div>
            <div className="space-y-0.5">
              <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-subtle">
                Cost
              </dt>
              <dd className="font-mono text-fg">{backend.profile.cost}</dd>
            </div>
            <div className="space-y-0.5">
              <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-subtle">
                Accuracy
              </dt>
              <dd className="font-mono text-fg">{backend.profile.accuracy}</dd>
            </div>
            <div className="space-y-0.5">
              <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-subtle">
                Platform
              </dt>
              <dd className="font-mono text-fg">{backend.profile.platform}</dd>
            </div>
            <div className="space-y-0.5 col-span-2">
              <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-subtle">
                Requirements
              </dt>
              <dd className="font-mono text-fg">
                {backend.profile.requirements}
              </dd>
            </div>
          </dl>
        </section>

        {/* Takeaways */}
        <section className="space-y-3 rounded-md bg-surface p-5 shadow-[var(--shadow-border)]">
          <h2 className="font-mono text-xs uppercase tracking-[0.16em] text-subtle">
            Key takeaways
          </h2>
          <ul className="space-y-2 text-sm leading-relaxed text-muted">
            {backend.takeaways.map((t) => (
              <li key={t} className="flex gap-2">
                <span className="mt-1.5 inline-block size-1.5 shrink-0 rounded-full bg-ok" />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* Body sections */}
        {backend.sections.map((s) => (
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

        {/* FAQ */}
        <section className="space-y-3">
          <h2 className="text-lg font-medium tracking-tight">
            Frequently asked
          </h2>
          <div className="space-y-3">
            {backend.faqs.map((f) => (
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

        {/* CTA */}
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

        {/* Related */}
        <section className="space-y-3 border-t border-border pt-8">
          <h2 className="text-lg font-medium tracking-tight">Keep reading</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {backend.related.map(relatedLink)}
          </div>
          {others.length ? (
            <div className="space-y-1.5 pt-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                Other backends
              </p>
              <div className="flex flex-wrap gap-2">
                {others.map((b) => (
                  <Link
                    key={b.slug}
                    to="/backends/$slug"
                    params={{ slug: b.slug }}
                    className="rounded-sm bg-raised px-3 py-2 font-mono text-xs text-muted transition-colors hover:text-fg"
                  >
                    {b.navLabel}
                  </Link>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      </article>
    </AppShell>
  );
}
