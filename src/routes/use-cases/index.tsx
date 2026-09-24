import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { USE_CASES, BACKENDS } from "@/lib/content/use-cases";
import { pageHead } from "@/lib/seo/site";

export const Route = createFileRoute("/use-cases/")({
  head: () => pageHead("Use cases", "Where typed decisions replace prompt-and-parse LLM calls."),
  component: UseCasesPage,
});

function UseCasesPage() {
  return (
    <AppShell>
      <div className="space-y-10">
        <header className="space-y-3">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">
            Use cases
          </p>
          <h1 className="max-w-3xl text-3xl font-medium tracking-tight md:text-4xl">
            What typed decisions are for.
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            Each of these is a real workflow built on the same three primitives —{" "}
            <span className="font-mono text-fg">Choice</span>,{" "}
            <span className="font-mono text-fg">Score</span>,{" "}
            <span className="font-mono text-fg">Noul</span> — behind one{" "}
            <span className="font-mono text-fg">POST /api/v1/systemone</span> call.
            The model makes the judgment; your code keeps the control flow, the
            math, and the policy.
          </p>
        </header>

        <section className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            {USE_CASES.map((u) => (
              <Link
                key={u.slug}
                to="/use-cases/$slug"
                params={{ slug: u.slug }}
                className="group flex flex-col rounded-md bg-surface p-5 shadow-[var(--shadow-border)] transition-[box-shadow] duration-150 hover:shadow-[var(--shadow-border-hover)]"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-medium tracking-tight">{u.title}</p>
                  <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                    {u.stat}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  {u.summary}
                </p>
                <div className="mt-4 flex items-center gap-2">
                  <span className="rounded-full bg-inset px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-subtle">
                    {u.category}
                  </span>
                  <span className="rounded-full bg-inset px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
                    {u.primitiveLabel}
                  </span>
                </div>
                <span className="mt-4 font-mono text-xs text-muted transition-colors group-hover:text-fg">
                  Read the pattern →
                </span>
              </Link>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-medium tracking-tight">
            One request shape, five backends
          </h2>
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            Every pattern here is the same wire-compatible request. Point it at
            whichever backend fits your deployment — nothing in the code above
            changes.
          </p>
          <div className="overflow-x-auto rounded-md bg-surface shadow-[var(--shadow-border)]">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="border-b border-border font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                <tr>
                  <th className="px-3 py-2">Backend</th>
                  <th className="px-3 py-2">Where it runs</th>
                </tr>
              </thead>
              <tbody className="text-muted">
                {BACKENDS.map((b) => (
                  <tr key={b.id} className="border-b border-border/60 last:border-0">
                    <td className="px-3 py-2 font-mono text-fg">{b.id}</td>
                    <td className="px-3 py-2">{b.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-muted">
            New to the primitives?{" "}
            <Link to="/system-one" className="text-fg hover:underline">
              Read how System One works
            </Link>{" "}
            or{" "}
            <Link to="/playground" className="text-fg hover:underline">
              open the playground
            </Link>
            .
          </p>
        </section>
      </div>
    </AppShell>
  );
}
