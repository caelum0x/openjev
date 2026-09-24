import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ContentNotFound } from "@/components/content-not-found";
import { AppShell } from "@/components/app-shell";
import { CopyButton } from "@/components/copy-button";
import { buttonVariants } from "@/components/ui/button";
import { useCaseBySlug, USE_CASES } from "@/lib/content/use-cases";
import { cn } from "@/lib/utils";
import { pageHead } from "@/lib/seo/site";

export const Route = createFileRoute("/use-cases/$slug")({
  loader: ({ params }) => {
    if (!USE_CASES.find((u) => u.slug === params.slug)) throw notFound();
  },
  notFoundComponent: () => (
    <ContentNotFound kind="Use case" backTo="/use-cases" backLabel="All use cases" />
  ),
  head: ({ params }) => {
    const uc = USE_CASES.find((u) => u.slug === params.slug);
    return uc ? pageHead(`${uc.title} · Use cases`, uc.summary) : pageHead("Unknown use case");
  },
  component: UseCasePage,
});

function UseCasePage() {
  const { slug } = Route.useParams();
  const uc = useCaseBySlug(slug);

  if (!uc) {
    return (
      <AppShell>
        <div className="mx-auto max-w-2xl space-y-4">
          <h1 className="text-2xl font-medium tracking-tight">Unknown use case</h1>
          <p className="text-sm text-muted">
            No pattern is registered at{" "}
            <span className="font-mono text-fg">/use-cases/{slug}</span>.
          </p>
          <Link
            to="/use-cases"
            className={cn(buttonVariants({ variant: "secondary" }))}
          >
            All use cases
          </Link>
        </div>
      </AppShell>
    );
  }

  const others = USE_CASES.filter((u) => u.slug !== uc.slug).slice(0, 3);

  return (
    <AppShell>
      <article className="mx-auto max-w-3xl space-y-10">
        <header className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">
              {uc.category}
            </span>
            <span aria-hidden className="text-subtle">
              ·
            </span>
            <span className="font-mono text-xs uppercase tracking-[0.16em] text-muted">
              {uc.primitiveLabel}
            </span>
          </div>
          <h1 className="text-3xl font-medium tracking-tight md:text-4xl">
            {uc.title}
          </h1>
          <p className="max-w-2xl text-base leading-relaxed text-muted">
            {uc.summary}
          </p>
          <p className="inline-flex items-center gap-2 rounded-full bg-surface px-3 py-1 font-mono text-[11px] uppercase tracking-[0.14em] text-subtle shadow-[var(--shadow-border)]">
            {uc.stat}
          </p>
        </header>

        <section className="space-y-3">
          <h2 className="text-lg font-medium tracking-tight">The problem</h2>
          <p className="text-sm leading-relaxed text-muted">{uc.problem}</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-medium tracking-tight">
            How OpenJev solves it
          </h2>
          <p className="text-sm leading-relaxed text-muted">{uc.solution}</p>
          <div className="grid gap-3 md:grid-cols-2">
            {uc.why.map((w) => (
              <div
                key={w.heading}
                className="space-y-1.5 rounded-md bg-surface p-4 shadow-[var(--shadow-border)]"
              >
                <p className="text-sm font-medium tracking-tight text-fg">
                  {w.heading}
                </p>
                <p className="text-sm leading-relaxed text-muted">{w.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-medium tracking-tight">The code</h2>
            <CopyButton text={uc.code} label="Copy" />
          </div>
          <p className="text-sm leading-relaxed text-muted">
            Against the{" "}
            <span className="font-mono text-fg">@caelum/typesafe</span> client SDK.
            The request is wire-compatible with the System One v1 API, so the
            same payload runs on any compatible endpoint.
          </p>
          <pre className="overflow-x-auto rounded-md bg-surface p-4 font-mono text-[12px] leading-relaxed shadow-[var(--shadow-border)]">
            {uc.code}
          </pre>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-medium tracking-tight">Runs well on</h2>
          <div className="flex flex-wrap gap-2">
            {uc.backends.map((b) => (
              <span
                key={b}
                className="rounded-full bg-inset px-3 py-1 font-mono text-[11px] text-muted shadow-[var(--shadow-border)]"
              >
                {b}
              </span>
            ))}
          </div>
          <p className="text-sm text-muted">
            All five backends —{" "}
            <span className="font-mono text-fg">laya-mlx</span>,{" "}
            <span className="font-mono text-fg">laya-onnx</span>,{" "}
            <span className="font-mono text-fg">native</span>,{" "}
            <span className="font-mono text-fg">local</span>, and{" "}
            <span className="font-mono text-fg">any-LLM</span> — accept this exact
            request. Self-host with Docker and point the SDK at your URL.
          </p>
        </section>

        <div className="flex flex-wrap gap-2">
          {uc.cookbook ? (
            <Link
              to="/cookbooks/$id"
              params={{ id: uc.cookbook.id }}
              className={cn(buttonVariants({ variant: "primary" }))}
            >
              {uc.cookbook.label} →
            </Link>
          ) : null}
          <Link
            to="/docs"
            className={cn(buttonVariants({ variant: "secondary" }))}
          >
            API reference
          </Link>
          <Link
            to="/use-cases"
            className={cn(buttonVariants({ variant: "ghost" }))}
          >
            All use cases
          </Link>
        </div>

        <section className="space-y-3 border-t border-border pt-8">
          <h2 className="text-lg font-medium tracking-tight">More patterns</h2>
          <div className="grid gap-3 md:grid-cols-3">
            {others.map((u) => (
              <Link
                key={u.slug}
                to="/use-cases/$slug"
                params={{ slug: u.slug }}
                className="group rounded-md bg-surface p-4 shadow-[var(--shadow-border)] transition-[box-shadow] duration-150 hover:shadow-[var(--shadow-border-hover)]"
              >
                <p className="font-medium tracking-tight">{u.title}</p>
                <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                  {u.stat}
                </p>
                <span className="mt-3 inline-block font-mono text-xs text-muted transition-colors group-hover:text-fg">
                  Open →
                </span>
              </Link>
            ))}
          </div>
        </section>
      </article>
    </AppShell>
  );
}
