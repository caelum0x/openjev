import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { COOKBOOKS } from "@/lib/jev/cookbooks";
import { pageHead } from "@/lib/seo/site";

export const Route = createFileRoute("/cookbooks/")({
  head: () =>
    pageHead("Cookbooks", "Runnable typed-decision patterns: fan-out, confidence routing, cascades, self-consistency, function calling."),
  component: CookbooksPage,
});

function CookbooksPage() {
  return (
    <AppShell>
      <div className="space-y-6">
        <header className="space-y-2">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">
            Cookbooks
          </p>
          <h1 className="text-2xl font-medium tracking-tight">Patterns that run</h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            Each cookbook is an HTTP endpoint and a runnable demo. The questions
            live in one file so they are easy to review.
          </p>
        </header>
        <div className="grid gap-3 md:grid-cols-2">
          {COOKBOOKS.map((c) => (
            <Link
              key={c.id}
              to="/cookbooks/$id"
              params={{ id: c.id }}
              className="block rounded-md bg-surface p-4 shadow-[var(--shadow-border)] transition-[box-shadow] duration-150 hover:shadow-[var(--shadow-border-hover)]"
            >
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-medium">{c.title}</p>
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                  {c.stat}
                </span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-muted">{c.blurb}</p>
            </Link>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
