import { Fragment, type ReactNode } from "react";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ContentNotFound } from "@/components/content-not-found";
import { AppShell } from "@/components/app-shell";
import { CopyButton } from "@/components/copy-button";
import {
  DOC_NAV,
  type DocBlock,
  type DocPage,
  docNeighbors,
  getDocPage,
} from "@/lib/content/docs";
import { pageHead } from "@/lib/seo/site";

export const Route = createFileRoute("/docs/$slug")({
  loader: ({ params }) => {
    if (!getDocPage(params.slug)) throw notFound();
  },
  notFoundComponent: () => (
    <ContentNotFound kind="Doc page" backTo="/docs" backLabel="All documentation" />
  ),
  head: ({ params }) => {
    const page = getDocPage(params.slug);
    return page ? pageHead(`${page.title} · Docs`, page.summary) : pageHead("Page not found");
  },
  component: DocSlugPage,
});

function DocSlugPage() {
  const { slug } = Route.useParams();
  const page = getDocPage(slug);

  if (!page) {
    return (
      <AppShell>
        <div className="mx-auto max-w-3xl space-y-4 py-8">
          <h1 className="text-2xl font-medium tracking-tight">Page not found</h1>
          <p className="text-sm text-muted">
            There is no doc page at{" "}
            <span className="font-mono text-fg">/docs/{slug}</span>.
          </p>
          <Link to="/docs" className="inline-block text-sm text-fg">
            ← All documentation
          </Link>
        </div>
      </AppShell>
    );
  }

  const { prev, next } = docNeighbors(slug);

  return (
    <AppShell>
      <div className="mx-auto grid max-w-5xl gap-10 lg:grid-cols-[200px_minmax(0,1fr)]">
        <DocSidebar current={slug} />

        <article className="min-w-0 space-y-8">
          <header className="space-y-3">
            <Link
              to="/docs"
              className="font-mono text-xs uppercase tracking-[0.18em] text-subtle hover:text-fg"
            >
              ← Documentation
            </Link>
            <h1 className="text-3xl font-medium tracking-tight">{page.title}</h1>
            <p className="max-w-2xl text-sm leading-relaxed text-muted">
              {page.summary}
            </p>
          </header>

          <div className="space-y-6">
            {page.blocks.map((block, i) => (
              <DocBlockView key={i} block={block} />
            ))}
          </div>

          <DocPager prev={prev} next={next} />
        </article>
      </div>
    </AppShell>
  );
}

function DocSidebar({ current }: { current: string }) {
  return (
    <nav className="hidden lg:block">
      <div className="sticky top-20 space-y-5">
        {DOC_NAV.map((grp) => (
          <div key={grp.group} className="space-y-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-subtle">
              {grp.group}
            </p>
            <ul className="space-y-1">
              {grp.slugs.map((slug) => {
                const page = getDocPage(slug);
                if (!page) return null;
                const active = slug === current;
                return (
                  <li key={slug}>
                    <Link
                      to="/docs/$slug"
                      params={{ slug }}
                      className={
                        active
                          ? "block rounded-sm bg-raised px-2 py-1 text-sm text-fg"
                          : "block rounded-sm px-2 py-1 text-sm text-muted transition-colors hover:text-fg"
                      }
                    >
                      {page.nav}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}

function DocPager({ prev, next }: { prev: DocPage | null; next: DocPage | null }) {
  if (!prev && !next) return null;
  return (
    <div className="flex flex-wrap justify-between gap-3 border-t border-border pt-6">
      {prev ? (
        <Link
          to="/docs/$slug"
          params={{ slug: prev.slug }}
          className="group flex flex-col rounded-md bg-surface px-4 py-3 shadow-[var(--shadow-border)] transition-[box-shadow] hover:shadow-[var(--shadow-border-hover)]"
        >
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
            ← Previous
          </span>
          <span className="text-sm text-muted transition-colors group-hover:text-fg">
            {prev.nav}
          </span>
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link
          to="/docs/$slug"
          params={{ slug: next.slug }}
          className="group flex flex-col rounded-md bg-surface px-4 py-3 text-right shadow-[var(--shadow-border)] transition-[box-shadow] hover:shadow-[var(--shadow-border-hover)]"
        >
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
            Next →
          </span>
          <span className="text-sm text-muted transition-colors group-hover:text-fg">
            {next.nav}
          </span>
        </Link>
      ) : (
        <span />
      )}
    </div>
  );
}

function DocBlockView({ block }: { block: DocBlock }) {
  switch (block.kind) {
    case "h2":
      return (
        <h2 className="pt-2 text-lg font-medium tracking-tight">{block.text}</h2>
      );
    case "p":
      return (
        <p className="max-w-2xl text-sm leading-relaxed text-muted">
          {renderInline(block.text)}
        </p>
      );
    case "note":
      return (
        <p className="max-w-2xl rounded-md bg-surface px-4 py-3 text-sm leading-relaxed text-muted shadow-[var(--shadow-border)]">
          {renderInline(block.text)}
        </p>
      );
    case "list":
      return block.ordered ? (
        <ol className="max-w-2xl list-decimal space-y-2 pl-5 text-sm leading-relaxed text-muted">
          {block.items.map((it, i) => (
            <li key={i}>{renderInline(it)}</li>
          ))}
        </ol>
      ) : (
        <ul className="max-w-2xl space-y-2 text-sm leading-relaxed text-muted">
          {block.items.map((it, i) => (
            <li key={i} className="flex gap-2">
              <span aria-hidden className="select-none text-subtle">
                ·
              </span>
              <span>{renderInline(it)}</span>
            </li>
          ))}
        </ul>
      );
    case "table":
      return (
        <div className="overflow-x-auto rounded-md bg-surface shadow-[var(--shadow-border)]">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="border-b border-border font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
              <tr>
                {block.head.map((h) => (
                  <th key={h} className="px-3 py-2">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="text-muted">
              {block.rows.map((row, ri) => (
                <tr
                  key={ri}
                  className={
                    ri < block.rows.length - 1 ? "border-b border-border/60" : ""
                  }
                >
                  {row.map((cell, ci) => (
                    <td
                      key={ci}
                      className={
                        ci === 0
                          ? "px-3 py-2 font-mono text-fg"
                          : "px-3 py-2"
                      }
                    >
                      {renderInline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "code":
      return (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            {block.lang ? (
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                {block.lang}
              </span>
            ) : (
              <span />
            )}
            <CopyButton text={block.code} label="Copy" />
          </div>
          <pre className="overflow-x-auto rounded-md bg-surface p-4 font-mono text-[12px] leading-relaxed shadow-[var(--shadow-border)]">
            {block.code}
          </pre>
        </div>
      );
    default:
      return null;
  }
}

/** Render inline `code` spans inside a text string. */
function renderInline(text: string): ReactNode {
  const parts = text.split("`");
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <span key={i} className="font-mono text-fg">
        {part}
      </span>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}
