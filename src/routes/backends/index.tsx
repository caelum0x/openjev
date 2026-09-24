import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import {
  BACKENDS,
  COMPARE_COLS,
  COMPARE_ROWS,
} from "@/lib/content/backends";
import {
  absUrl,
  breadcrumbLd,
  itemListLd,
  softwareLd,
  OG_IMAGE,
  SITE_NAME,
} from "@/lib/seo/site";

const PATH = "/backends";
const TITLE = `Backends — five inference engines for typed decisions · ${SITE_NAME}`;
const DESCRIPTION =
  "Compare all five OpenJev backends: laya-mlx (Apple Silicon), laya-onnx (Linux CPU), native-kernel (in-process C++/Rust), local-ts (pure TypeScript), and any-llm (hosted LLM fallback).";

export const Route = createFileRoute("/backends/")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:url", content: absUrl(PATH) },
      { property: "og:image", content: OG_IMAGE },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESCRIPTION },
      {
        "script:ld+json": breadcrumbLd([
          { name: "Home", path: "/" },
          { name: "Backends", path: PATH },
        ]),
      },
      {
        "script:ld+json": itemListLd(
          BACKENDS.map((b) => ({ name: b.title, path: `/backends/${b.slug}` })),
        ),
      },
      { "script:ld+json": softwareLd() },
    ],
    links: [{ rel: "canonical", href: absUrl(PATH) }],
  }),
  component: BackendsIndex,
});

const ACCURACY_DOT: Record<string, string> = {
  highest: "bg-ok",
  high: "bg-ok/70",
  moderate: "bg-subtle",
};

function BackendsIndex() {
  return (
    <AppShell>
      <div className="space-y-12">
        <header className="space-y-3">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">
            Backends
          </p>
          <h1 className="max-w-3xl text-3xl font-medium tracking-tight md:text-4xl">
            Five inference engines, one API.
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            Every OpenJev backend accepts the same{" "}
            <span className="font-mono text-fg">POST /v1/systemone</span> — you
            switch backends by changing one environment variable. Pick the one
            that matches your platform, latency budget, and accuracy
            requirement.
          </p>
        </header>

        {/* Backend cards */}
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {BACKENDS.map((b) => (
            <Link
              key={b.slug}
              to="/backends/$slug"
              params={{ slug: b.slug }}
              className="group flex flex-col rounded-md bg-surface p-5 shadow-[var(--shadow-border)] transition-[box-shadow] duration-150 hover:shadow-[var(--shadow-border-hover)]"
            >
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-mono text-sm font-medium text-fg">
                  {b.navLabel}
                </p>
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                  {b.category}
                </span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                {b.description}
              </p>
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
                <div className="flex gap-1.5">
                  <dt className="text-subtle">Latency</dt>
                  <dd className="font-mono text-fg">{b.profile.latency}</dd>
                </div>
                <div className="flex gap-1.5">
                  <dt className="text-subtle">Cost</dt>
                  <dd className="font-mono text-fg">{b.profile.cost}</dd>
                </div>
                <div className="flex items-center gap-1.5">
                  <dt className="text-subtle">Accuracy</dt>
                  <dd className="flex items-center gap-1 font-mono text-fg">
                    <span
                      className={`inline-block size-1.5 rounded-full ${ACCURACY_DOT[b.profile.accuracy] ?? "bg-muted"}`}
                    />
                    {b.profile.accuracy}
                  </dd>
                </div>
                <div className="flex gap-1.5">
                  <dt className="text-subtle">Platform</dt>
                  <dd className="font-mono text-fg">{b.profile.platform}</dd>
                </div>
              </dl>
              <span className="mt-4 font-mono text-xs text-muted transition-colors group-hover:text-fg">
                Deep dive →
              </span>
            </Link>
          ))}
        </section>

        {/* Comparison table */}
        <section className="space-y-3">
          <h2 className="text-lg font-medium tracking-tight">
            Side-by-side comparison
          </h2>
          <div className="overflow-x-auto rounded-md bg-surface shadow-[var(--shadow-border)]">
            <table className="w-full min-w-[700px] text-left text-sm">
              <thead className="border-b border-border font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                <tr>
                  <th className="px-3 py-2 w-28" />
                  {COMPARE_COLS.map((col) => (
                    <th key={col} className="px-3 py-2">
                      <Link
                        to="/backends/$slug"
                        params={{ slug: col }}
                        className="hover:text-fg"
                      >
                        {col}
                      </Link>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="text-muted">
                {COMPARE_ROWS.map((row) => (
                  <tr
                    key={row.label}
                    className="border-b border-border/60 last:border-0"
                  >
                    <td className="px-3 py-3 font-medium text-fg">
                      {row.label}
                    </td>
                    {COMPARE_COLS.map((col) => (
                      <td key={col} className="px-3 py-3 leading-relaxed">
                        {row.values[col] ?? "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Quick decision guide */}
        <section className="space-y-4">
          <h2 className="text-lg font-medium tracking-tight">
            Which backend should I start with?
          </h2>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-md bg-surface p-4 shadow-[var(--shadow-border)]">
              <p className="text-sm font-medium text-fg">
                On a Mac with Apple Silicon
              </p>
              <p className="mt-1 text-sm leading-relaxed text-muted">
                Start with{" "}
                <Link
                  to="/backends/$slug"
                  params={{ slug: "laya-mlx" }}
                  className="font-mono text-fg hover:underline"
                >
                  laya-mlx
                </Link>{" "}
                — it is the fastest local option on M-series hardware.
              </p>
            </div>
            <div className="rounded-md bg-surface p-4 shadow-[var(--shadow-border)]">
              <p className="text-sm font-medium text-fg">
                On Linux / Docker / Kubernetes
              </p>
              <p className="mt-1 text-sm leading-relaxed text-muted">
                Use{" "}
                <Link
                  to="/backends/$slug"
                  params={{ slug: "laya-onnx" }}
                  className="font-mono text-fg hover:underline"
                >
                  laya-onnx
                </Link>{" "}
                — the production default, CPU-only, one Docker pull.
              </p>
            </div>
            <div className="rounded-md bg-surface p-4 shadow-[var(--shadow-border)]">
              <p className="text-sm font-medium text-fg">
                On Cloudflare Workers / Vercel Edge
              </p>
              <p className="mt-1 text-sm leading-relaxed text-muted">
                Use{" "}
                <Link
                  to="/backends/$slug"
                  params={{ slug: "local-ts" }}
                  className="font-mono text-fg hover:underline"
                >
                  local-ts
                </Link>{" "}
                — pure TypeScript, no native binaries, runs anywhere ES2020
                runs.
              </p>
            </div>
            <div className="rounded-md bg-surface p-4 shadow-[var(--shadow-border)]">
              <p className="text-sm font-medium text-fg">
                Need highest accuracy or prototyping
              </p>
              <p className="mt-1 text-sm leading-relaxed text-muted">
                Use{" "}
                <Link
                  to="/backends/$slug"
                  params={{ slug: "any-llm" }}
                  className="font-mono text-fg hover:underline"
                >
                  any-llm
                </Link>{" "}
                — routes through OpenAI, Anthropic, or xAI with full semantic
                depth.
              </p>
            </div>
          </div>
        </section>

        <section className="space-y-3 rounded-md bg-surface p-5 shadow-[var(--shadow-border)]">
          <h2 className="text-lg font-medium tracking-tight">
            Same request, any backend.
          </h2>
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            The{" "}
            <span className="font-mono text-fg">POST /v1/systemone</span>{" "}
            contract is identical across all five backends. Switch by setting{" "}
            <span className="font-mono text-fg">OPENJEV_BASE_URL</span> —
            your code does not change.
          </p>
          <div className="flex flex-wrap gap-x-5 gap-y-2 pt-1 text-sm text-muted">
            <Link to="/playground" className="hover:text-fg">
              Open the playground →
            </Link>
            <Link to="/benchmarks" className="hover:text-fg">
              Latency &amp; cost benchmarks →
            </Link>
            <Link to="/reference" className="hover:text-fg">
              API reference →
            </Link>
            <Link to="/guides" className="hover:text-fg">
              Read the guides →
            </Link>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
