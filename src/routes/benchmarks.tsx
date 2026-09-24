import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { buttonVariants } from "@/components/ui/button";
import {
  BENCHMARK_COLS,
  BENCHMARK_FAQS,
  BENCHMARK_SCENARIOS,
  LATENCY_BENCH,
  METHODOLOGY,
  type BenchmarkColumn,
  type BenchmarkRow,
  type BenchmarkScenario,
} from "@/lib/content/benchmarks";
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

export const Route = createFileRoute("/benchmarks")({
  head: () => {
    const path = "/benchmarks";
    const title = `Latency benchmarks · ${SITE_NAME}`;
    const description =
      "Measured p50/p95 engine latency and determinism for the OpenJev embedding and lexical engines, with the script, machine and method to reproduce them.";
    return {
      meta: [
        { title },
        { name: "description", content: description },
        {
          name: "keywords",
          content:
            "openjev benchmarks, typed decision latency, embedding classifier latency, deterministic ai decision, onnx inference latency",
        },
        { property: "og:type", content: "article" },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:url", content: absUrl(path) },
        { property: "og:image", content: OG_IMAGE },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
        {
          "script:ld+json": articleLd({
            headline: "OpenJev latency benchmarks",
            description,
            path,
            dateModified: LATENCY_BENCH.measured_at,
            keywords: [
              "openjev benchmarks",
              "typed decision latency",
              "deterministic classification",
            ],
          }),
        },
        {
          "script:ld+json": breadcrumbLd([
            { name: "Home", path: "/" },
            { name: "Benchmarks", path },
          ]),
        },
        { "script:ld+json": faqLd(BENCHMARK_FAQS) },
      ],
      links: [{ rel: "canonical", href: absUrl(path) }],
    };
  },
  component: BenchmarksPage,
});

// ─── Column appearance ────────────────────────────────────────────────────────

const COL_ACCENT: Record<BenchmarkColumn, string> = {
  embedding: "text-score",
  lexical: "text-score",
};

// ─── Page ─────────────────────────────────────────────────────────────────────

function BenchmarksPage() {
  return (
    <AppShell>
      <article className="space-y-14">
        {/* Header */}
        <header className="space-y-3">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">
            Benchmarks
          </p>
          <h1 className="max-w-3xl text-3xl font-medium tracking-tight md:text-4xl">
            Measured engine latency
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            p50 and p95 engine time per request for the two engines that run
            in-process: the embedding engine (the default when its model is
            installed) and the lexical fallback. Measured{" "}
            {LATENCY_BENCH.measured_at} on {LATENCY_BENCH.machine.cpu} with{" "}
            <span className="font-mono text-fg">{LATENCY_BENCH.method.command}</span>;
            the figures exclude HTTP and network time. Other backends are not
            listed until they are measured the same way.
          </p>
          <p className="text-xs leading-relaxed text-subtle">
            See the{" "}
            <a href="#methodology" className="underline underline-offset-2">
              methodology
            </a>{" "}
            section for exact measurement conditions.  Measured accuracy and
            calibration live on the{" "}
            <Link to="/leaderboard" className="underline underline-offset-2">
              public-dataset leaderboard
            </Link>{" "}
            (Banking77, CLINC150 + out-of-scope, AG News).
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Link
              to="/backends"
              className={cn(buttonVariants({ variant: "secondary" }))}
            >
              Backend profiles
            </Link>
            <Link
              to="/compare"
              className={cn(buttonVariants({ variant: "secondary" }))}
            >
              Compare pages
            </Link>
          </div>
        </header>

        {/* Column legend */}
        <ColLegend />

        {/* Per-scenario tables + charts */}
        {BENCHMARK_SCENARIOS.map((s) => (
          <ScenarioSection key={s.id} scenario={s} />
        ))}

        {/* Methodology */}
        <section id="methodology" className="space-y-3">
          <h2 className="text-lg font-medium tracking-tight">Methodology</h2>
          <div className="rounded-md bg-surface p-5 shadow-[var(--shadow-border)]">
            <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-muted">
              <LinkedText text={METHODOLOGY} />
            </pre>
          </div>
        </section>

        {/* FAQ */}
        <section className="space-y-4">
          <h2 className="text-lg font-medium tracking-tight">
            Frequently asked questions
          </h2>
          <dl className="space-y-4">
            {BENCHMARK_FAQS.map((faq) => (
              <div
                key={faq.q}
                className="rounded-md bg-surface p-4 shadow-[var(--shadow-border)]"
              >
                <dt className="text-sm font-medium tracking-tight">
                  {faq.q}
                </dt>
                <dd className="mt-1.5 text-sm leading-relaxed text-muted">
                  <LinkedText text={faq.a} />
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Cross-links */}
        <nav aria-label="Related pages" className="space-y-3">
          <h2 className="text-sm font-medium">Related</h2>
          <div className="flex flex-wrap gap-2">
            {[
              { to: "/backends", label: "Backends" },
              { to: "/compare", label: "Compare" },
              { to: "/system-one", label: "System One" },
              { to: "/guides", label: "Guides" },
              { to: "/pricing", label: "Pricing" },
            ].map((l) => (
              <Link
                key={l.to}
                to={l.to}
                className={cn(buttonVariants({ variant: "secondary" }))}
              >
                {l.label}
              </Link>
            ))}
          </div>
        </nav>
      </article>
    </AppShell>
  );
}

// ─── Column legend ────────────────────────────────────────────────────────────

function ColLegend() {
  return (
    <div className="flex flex-wrap gap-3">
      {BENCHMARK_COLS.map((c) => (
        <div
          key={c.id}
          className="flex items-center gap-1.5 rounded-sm border border-border px-2.5 py-1.5"
        >
          <span className="h-2 w-2 rounded-full bg-score" />
          <span className="font-mono text-[11px] text-fg">{c.label}</span>
          <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-subtle">
            {c.note}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Scenario section ─────────────────────────────────────────────────────────

function ScenarioSection({ scenario }: { scenario: BenchmarkScenario }) {
  // Partition latency rows for charting vs other rows for table display
  const latencyRows = scenario.rows.filter((r) =>
    r.id === "p50-latency" || r.id === "p95-latency",
  );
  const tableRows = scenario.rows;

  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-medium tracking-tight">{scenario.title}</h2>
        <p className="max-w-2xl text-sm leading-relaxed text-muted">
          <LinkedText text={scenario.description} />
        </p>
        <p className="font-mono text-[10px] text-subtle">{scenario.inputShape}</p>
      </div>

      {/* Latency bar chart */}
      {latencyRows.length > 0 && (
        <div className="rounded-md bg-surface p-5 shadow-[var(--shadow-border)]">
          <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
            Latency (ms) — lower is better
          </p>
          <div className="space-y-5">
            {latencyRows.map((row) => (
              <BarChart key={row.id} row={row} />
            ))}
          </div>
          <p className="mt-3 font-mono text-[9px] text-subtle">
            Measured {LATENCY_BENCH.measured_at}, engine time only — see methodology
          </p>
        </div>
      )}

      {/* Full metrics table */}
      <div className="overflow-x-auto rounded-md bg-surface shadow-[var(--shadow-border)]">
        <table className="w-full min-w-[680px] text-left text-sm">
          <thead className="border-b border-border font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
            <tr>
              <th className="px-3 py-2 w-48">Metric</th>
              {BENCHMARK_COLS.map((c) => (
                <th
                  key={c.id}
                  className="px-3 py-2 text-right text-fg"
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tableRows.map((row) => (
              <MetricRow key={row.id} row={row} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ─── Single metric row ────────────────────────────────────────────────────────

function MetricRow({ row }: { row: BenchmarkRow }) {
  // Find the best value (lowest if lowerIsBetter, highest otherwise)
  const numericValues = BENCHMARK_COLS.map((c) => {
    const v = row.values[c.id];
    return typeof v === "number" ? v : null;
  });
  const valid = numericValues.filter((v): v is number => v !== null);
  const best = valid.length > 0
    ? row.lowerIsBetter
      ? Math.min(...valid)
      : Math.max(...valid)
    : null;

  return (
    <tr className="border-b border-border/60 last:border-0">
      <td className="px-3 py-2.5">
        <span className="text-sm text-fg">{row.metric}</span>
        <span className="ml-1 font-mono text-[10px] text-subtle">
          {row.unit}
        </span>
      </td>
      {BENCHMARK_COLS.map((c) => {
        const v = row.values[c.id];
        const isNum = typeof v === "number";
        const isBest = isNum && best !== null && v === best;
        return (
          <td
            key={c.id}
            className={cn(
              "px-3 py-2.5 text-right font-mono text-xs tabular-nums",
              isBest
                ? "text-ok font-medium"
                : COL_ACCENT[c.id],
            )}
          >
            {isNum ? (
              v === 0 ? (
                <span className="text-ok">0</span>
              ) : (
                v.toLocaleString()
              )
            ) : (
              String(v)
            )}
          </td>
        );
      })}
    </tr>
  );
}

// ─── Inline SVG horizontal bar chart ─────────────────────────────────────────

const CHART_W = 500;
const BAR_H = 14;
const BAR_GAP = 8;
const LABEL_W = 110;
const VAL_W = 50;
const PLOT_W = CHART_W - LABEL_W - VAL_W;

function BarChart({ row }: { row: BenchmarkRow }) {
  const entries = BENCHMARK_COLS.map((c) => ({
    col: c,
    value: row.values[c.id],
  }));

  const numericEntries = entries.filter(
    (e): e is { col: typeof entries[0]["col"]; value: number } =>
      typeof e.value === "number",
  );

  const maxVal = Math.max(1, ...numericEntries.map((e) => e.value));

  const totalH =
    BENCHMARK_COLS.length * (BAR_H + BAR_GAP) - BAR_GAP + 2;

  return (
    <div className="space-y-0.5">
      <p className="font-mono text-[10px] text-muted">{row.metric}</p>
      <svg
        viewBox={`0 0 ${CHART_W} ${totalH}`}
        className="w-full overflow-visible"
        aria-hidden="true"
      >
        {BENCHMARK_COLS.map((c, i) => {
          const rawVal = row.values[c.id];
          const val = typeof rawVal === "number" ? rawVal : 0;
          const barWidth = Math.max(2, (val / maxVal) * PLOT_W);
          const y = i * (BAR_H + BAR_GAP);

          // Best value highlight
          const numericValues = BENCHMARK_COLS.map((cc) => {
            const v = row.values[cc.id];
            return typeof v === "number" ? v : null;
          }).filter((v): v is number => v !== null);
          const best = numericValues.length > 0
            ? row.lowerIsBetter
              ? Math.min(...numericValues)
              : Math.max(...numericValues)
            : null;
          const isBest = typeof rawVal === "number" && rawVal === best;

          return (
            <g key={c.id}>
              {/* Label */}
              <text
                x={LABEL_W - 6}
                y={y + BAR_H / 2 + 1}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize="9"
                fontFamily="monospace"
                fill="var(--color-muted)"
              >
                {c.label}
              </text>

              {/* Track */}
              <rect
                x={LABEL_W}
                y={y}
                width={PLOT_W}
                height={BAR_H}
                rx="2"
                fill="var(--color-raised)"
              />

              {/* Bar */}
              <rect
                x={LABEL_W}
                y={y}
                width={barWidth}
                height={BAR_H}
                rx="2"
                fill={isBest ? "var(--color-ok)" : "var(--color-score)"}
                fillOpacity={0.8}
              />

              {/* Value */}
              <text
                x={LABEL_W + PLOT_W + 6}
                y={y + BAR_H / 2 + 1}
                dominantBaseline="middle"
                fontSize="9"
                fontFamily="monospace"
                fill={isBest ? "var(--color-ok)" : "var(--color-muted)"}
              >
                {typeof rawVal === "number" ? rawVal.toLocaleString() : String(rawVal)}
                {" "}
                {row.unit}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
