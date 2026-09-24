import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { CopyButton } from "@/components/copy-button";
import { DOC_NAV, DOC_FOOTER, getDocPage } from "@/lib/content/docs";
import { pageHead } from "@/lib/seo/site";

export const Route = createFileRoute("/docs/")({
  head: () =>
    pageHead("Documentation", "OpenJev documentation: quickstart, primitives, API reference, SDKs, self-hosting and operations."),
  component: DocsHub,
});

const CURL = `curl -X POST http://localhost:3000/api/v1/systemone \\
  -H "Authorization: Bearer $OPENJEV_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "system-one",
    "state": "A hotdog: a sausage in a sliced bun.",
    "questions": {
      "is_sandwich": { "type": "noul", "instructions": "Is this a sandwich?" }
    }
  }'`;

function DocsHub() {
  return (
    <AppShell>
      <div className="mx-auto max-w-4xl space-y-12">
        <header className="space-y-3">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">
            Documentation
          </p>
          <h1 className="text-3xl font-medium tracking-tight md:text-4xl">
            Build with OpenJev
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            OpenJev is an open-source decision engine, wire-compatible with
            the upstream System One v1 API. Send state and typed questions —
            Choice, Score, Noul — and get calibrated judgments your code can
            combine, behind{" "}
            <span className="font-mono text-fg">POST /api/v1/systemone</span>.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Link
              to="/docs/$slug"
              params={{ slug: "quickstart" }}
              className="rounded-sm bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-opacity hover:opacity-90"
            >
              Start with the quickstart →
            </Link>
            <Link
              to="/playground"
              className="rounded-sm bg-raised px-4 py-2 text-sm text-muted transition-colors hover:text-fg"
            >
              Open the playground
            </Link>
          </div>
        </header>

        <section className="space-y-5">
          {DOC_NAV.map((grp) => (
            <div key={grp.group} className="space-y-3">
              <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-subtle">
                {grp.group}
              </h2>
              <div className="grid gap-3 md:grid-cols-2">
                {grp.slugs.map((slug) => {
                  const page = getDocPage(slug);
                  if (!page) return null;
                  return (
                    <Link
                      key={slug}
                      to="/docs/$slug"
                      params={{ slug }}
                      className="group flex flex-col rounded-md bg-surface p-4 shadow-[var(--shadow-border)] transition-[box-shadow] duration-150 hover:shadow-[var(--shadow-border-hover)]"
                    >
                      <p className="font-medium tracking-tight">{page.title}</p>
                      <p className="mt-2 text-sm leading-relaxed text-muted">
                        {page.summary}
                      </p>
                      <span className="mt-3 font-mono text-xs text-muted transition-colors group-hover:text-fg">
                        Read →
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-medium tracking-tight">
              One call, no parsing
            </h2>
            <CopyButton text={CURL} label="Copy curl" />
          </div>
          <pre className="overflow-x-auto rounded-md bg-surface p-4 font-mono text-[12px] leading-relaxed shadow-[var(--shadow-border)]">
            {CURL}
          </pre>
          <p className="text-sm text-muted">
            The same-origin playground needs no key. For your own code, create an{" "}
            <span className="font-mono text-fg">ots_live_</span> key at{" "}
            <Link to="/keys" className="text-fg underline-offset-2 hover:underline">
              /keys
            </Link>
            .
          </p>
        </section>

        <footer className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-6 text-sm text-muted">
          {DOC_FOOTER.map((l) => (
            <Link
              key={l.slug}
              to="/docs/$slug"
              params={{ slug: l.slug }}
              className="hover:text-fg"
            >
              {l.label}
            </Link>
          ))}
          <Link to="/skill" className="hover:text-fg">
            SKILL.md
          </Link>
          <span className="ml-auto font-mono text-[11px] uppercase tracking-[0.14em] text-subtle">
            OpenJev · Apache-2.0
          </span>
        </footer>
      </div>
    </AppShell>
  );
}
