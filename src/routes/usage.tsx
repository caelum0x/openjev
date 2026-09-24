import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { api } from "@/lib/jev/browser";
import { pageHead } from "@/lib/seo/site";

// ─── Wire types ────────────────────────────────────────────────────────────

type UsageEvent = {
  id: string;
  ts: number;
  model: string;
  key: string;
  questions: number;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
  path: string;
  status: string;
};

type DayBucket = { day: string; calls: number; tokens: number };

type UsageSummary = {
  window: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  tokens: number;
  by_model: Record<string, { calls: number; tokens: number }>;
  by_key: Record<string, { calls: number; tokens: number }>;
  by_day: DayBucket[];
  p50_latency_ms: number;
  p95_latency_ms: number;
};

type MeteredUsage = {
  configured: boolean;
  amount_cents?: number;
  charges?: { code: string; amountCents: number; units?: number }[];
};

type UsagePayload = {
  summary: UsageSummary;
  events: UsageEvent[];
  metered?: MeteredUsage;
};

type BillingCost = {
  estimated_cents: number;
  currency: "usd";
  source: "railyard" | "derived";
  rate_per_call_cents: number;
  charges: Array<{ code: string; amount_cents: number; units?: number }>;
};

type BillingPayload = {
  data: {
    cost: BillingCost;
  };
};

// ─── Range helpers ──────────────────────────────────────────────────────────

type Range = "24h" | "7d" | "14d";
const RANGES: Range[] = ["24h", "7d", "14d"];

function cutoffMs(range: Range): number {
  const now = Date.now();
  if (range === "24h") return now - 24 * 60 * 60 * 1000;
  if (range === "7d") return now - 7 * 24 * 60 * 60 * 1000;
  return now - 14 * 24 * 60 * 60 * 1000;
}

function daysBack(range: Range): number {
  if (range === "24h") return 1;
  if (range === "7d") return 7;
  return 14;
}

type Derived = {
  calls: number;
  input_tokens: number;
  output_tokens: number;
  tokens: number;
  p50_latency_ms: number;
  p95_latency_ms: number;
  estimated_cents: number;
  by_model: { id: string; calls: number; tokens: number }[];
  by_key: { id: string; calls: number; tokens: number }[];
  sparkline: DayBucket[];
};

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function deriveStats(
  payload: UsagePayload,
  range: Range,
  billingCost: BillingCost | null,
): Derived {
  const { summary, events } = payload;

  // For 24h we use server-side summary (authoritative); wider ranges aggregate
  // from by_day (calls/tokens) and from the events list (latency).
  if (range === "24h") {
    const by_model = Object.entries(summary.by_model)
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.tokens - a.tokens);
    const by_key = Object.entries(summary.by_key)
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.tokens - a.tokens);
    const sparkline = summary.by_day.slice(-1); // just today for 24h view
    return {
      calls: summary.calls,
      input_tokens: summary.input_tokens,
      output_tokens: summary.output_tokens,
      tokens: summary.tokens,
      p50_latency_ms: summary.p50_latency_ms,
      p95_latency_ms: summary.p95_latency_ms,
      estimated_cents:
        billingCost?.estimated_cents ?? 0,
      by_model,
      by_key,
      sparkline,
    };
  }

  // 7d / 14d — aggregate from server by_day buckets
  const nDays = daysBack(range);
  const buckets = summary.by_day.slice(-nDays);
  const calls = buckets.reduce((s, b) => s + b.calls, 0);
  const tokens = buckets.reduce((s, b) => s + b.tokens, 0);

  // Filter events for latency and model/key breakdown
  const cutoff = cutoffMs(range);
  const filtered = events.filter((e) => e.ts >= cutoff);

  const latencies = filtered.map((e) => e.latency_ms).sort((a, b) => a - b);
  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);

  const modelMap: Record<string, { calls: number; tokens: number }> = {};
  const keyMap: Record<string, { calls: number; tokens: number }> = {};
  let inTok = 0;
  let outTok = 0;

  for (const e of filtered) {
    inTok += e.input_tokens;
    outTok += e.output_tokens;
    if (!modelMap[e.model]) modelMap[e.model] = { calls: 0, tokens: 0 };
    modelMap[e.model].calls += 1;
    modelMap[e.model].tokens += e.input_tokens + e.output_tokens;
    const k = e.key || "anon";
    if (!keyMap[k]) keyMap[k] = { calls: 0, tokens: 0 };
    keyMap[k].calls += 1;
    keyMap[k].tokens += e.input_tokens + e.output_tokens;
  }

  const by_model = Object.entries(modelMap)
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.tokens - a.tokens);
  const by_key = Object.entries(keyMap)
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.tokens - a.tokens);

  return {
    calls,
    input_tokens: inTok,
    output_tokens: outTok,
    tokens,
    p50_latency_ms: p50,
    p95_latency_ms: p95,
    // Overage-rate estimate for the window (the plan fee is shown on Settings).
    estimated_cents: Math.round(calls * (billingCost?.rate_per_call_cents ?? 0)),
    by_model,
    by_key,
    sparkline: buckets,
  };
}

// ─── Route ─────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/usage")({
  head: () => pageHead("Usage"),
  component: UsagePage,
});

function UsagePage() {
  const [payload, setPayload] = useState<UsagePayload | null>(null);
  const [billing, setBilling] = useState<BillingCost | null>(null);
  const [range, setRange] = useState<Range>("7d");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const [u, b] = await Promise.allSettled([
        api<UsagePayload>("/api/v1/usage"),
        api<BillingPayload>("/api/v1/billing"),
      ]);
      if (u.status === "fulfilled") {
        setPayload(u.value);
        setError(null);
      } else {
        setError(
          u.reason instanceof Error ? u.reason.message : "Failed to load usage",
        );
      }
      if (b.status === "fulfilled") setBilling(b.value.data?.cost ?? null);
    } catch {
      // allSettled never throws; individual rejections handled above
    }
  }

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 15_000);
    return () => clearInterval(t);
  }, []);

  const stats = useMemo(
    () => (payload ? deriveStats(payload, range, billing) : null),
    [payload, billing, range],
  );

  const metered = payload?.metered;

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header */}
        <header className="space-y-2">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">
            Usage
          </p>
          <h1 className="text-2xl font-medium tracking-tight">Analytics</h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            System One call volume, token consumption, latency, and estimated
            cost. Aggregated from persisted usage events.
          </p>
        </header>

        {error ? <p className="text-sm text-danger">{error}</p> : null}

        {/* Range selector */}
        <div className="flex gap-1 rounded-md bg-raised p-1 w-fit">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={[
                "rounded px-3 py-1 font-mono text-xs uppercase tracking-[0.14em] transition-colors",
                range === r
                  ? "bg-surface text-fg shadow-[var(--shadow-border)]"
                  : "text-muted hover:text-fg",
              ].join(" ")}
            >
              {r}
            </button>
          ))}
        </div>

        {/* Stat row */}
        {stats || !payload ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Calls" value={stats ? fmtN(stats.calls) : "—"} />
            <Stat
              label="Tokens"
              value={stats ? fmtN(stats.tokens) : "—"}
              sub={
                stats
                  ? `${fmtN(stats.input_tokens)} in · ${fmtN(stats.output_tokens)} out`
                  : undefined
              }
            />
            <Stat
              label="Latency p50 / p95"
              value={
                stats
                  ? `${fmtN(stats.p50_latency_ms)} ms`
                  : "—"
              }
              sub={stats ? `p95 ${fmtN(stats.p95_latency_ms)} ms` : undefined}
            />
            <Stat
              label="Est. cost"
              value={stats ? fmtCents(stats.estimated_cents) : "—"}
              sub={`$0.002 / call`}
            />
          </div>
        ) : null}

        {/* Sparkline — calls over time */}
        {stats && stats.sparkline.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-medium">
              {range === "24h" ? "Today" : `Last ${daysBack(range)} days`}
            </h2>
            <div className="rounded-md bg-surface px-4 py-4 shadow-[var(--shadow-border)]">
              <SparklineChart buckets={stats.sparkline} />
            </div>
          </section>
        )}

        {/* Model breakdown */}
        <section className="space-y-3">
          <h2 className="text-sm font-medium">By model</h2>
          {!stats ? (
            <p className="text-sm text-muted">{error ? "Unavailable." : "Loading…"}</p>
          ) : stats.by_model.length === 0 ? (
            <p className="text-sm text-muted">
              No calls in this window. Run the playground or a cookbook.
            </p>
          ) : (
            <BreakdownTable
              rows={stats.by_model.map((r) => ({
                label: r.id,
                calls: r.calls,
                tokens: r.tokens,
              }))}
              total={stats.tokens}
            />
          )}
        </section>

        {/* Key breakdown */}
        <section className="space-y-3">
          <h2 className="text-sm font-medium">By key</h2>
          {!stats ? (
            <p className="text-sm text-muted">{error ? "Unavailable." : "Loading…"}</p>
          ) : stats.by_key.length === 0 ? (
            <p className="text-sm text-muted">No attributable calls yet.</p>
          ) : (
            <BreakdownTable
              rows={stats.by_key.map((r) => ({
                label: r.id === "anon" ? "anonymous" : r.id,
                calls: r.calls,
                tokens: r.tokens,
              }))}
              total={stats.tokens}
            />
          )}
        </section>

        {/* Metered / Rago panel */}
        {metered?.configured ? (
          <section className="space-y-3">
            <h2 className="text-sm font-medium">Metered usage (Rago)</h2>
            {typeof metered.amount_cents === "number" ? (
              <div className="grid gap-3 sm:grid-cols-3">
                <Stat
                  label="Billed this period"
                  value={fmtCents(metered.amount_cents)}
                />
                {(metered.charges ?? []).map((c) => (
                  <Stat
                    key={c.code}
                    label={c.code}
                    value={fmtCents(c.amountCents)}
                    sub={c.units != null ? `${fmtN(c.units)} units` : undefined}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-md bg-surface px-4 py-3 shadow-[var(--shadow-border)]">
                <p className="text-sm text-muted">
                  Rago metering is active. Usage totals appear once calls are
                  recorded for this key.
                </p>
              </div>
            )}
          </section>
        ) : null}

        {/* Recent calls */}
        <section className="space-y-3">
          <h2 className="text-sm font-medium">Recent calls</h2>
          <div className="overflow-x-auto rounded-md bg-surface shadow-[var(--shadow-border)]">
            <table className="w-full min-w-[700px] text-left text-sm">
              <thead className="border-b border-border font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                <tr>
                  <th className="px-3 py-2">Time</th>
                  <th className="px-3 py-2">Model</th>
                  <th className="px-3 py-2">Path</th>
                  <th className="px-3 py-2">Key</th>
                  <th className="px-3 py-2">Qs</th>
                  <th className="px-3 py-2">Tokens</th>
                  <th className="px-3 py-2">ms</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {(payload?.events ?? [])
                  .filter((e) => e.ts >= cutoffMs(range))
                  .slice(0, 50)
                  .map((e) => (
                    <tr key={e.id} className="border-b border-border/60 last:border-0">
                      <td className="px-3 py-2 font-mono text-xs text-muted whitespace-nowrap">
                        {fmtTs(e.ts)}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{e.model}</td>
                      <td className="px-3 py-2 font-mono text-xs text-muted">
                        {e.path}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-muted">
                        {e.key === "anon" ? (
                          <span className="text-subtle">anon</span>
                        ) : (
                          e.key.slice(0, 14) + "…"
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{e.questions}</td>
                      <td className="px-3 py-2 font-mono text-xs">
                        <span className="text-muted">{fmtN(e.input_tokens)}</span>
                        <span className="text-subtle mx-0.5">+</span>
                        <span>{fmtN(e.output_tokens)}</span>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{e.latency_ms}</td>
                      <td className="px-3 py-2 font-mono text-xs">
                        <span
                          className={
                            e.status === "ok" ? "text-score" : "text-danger"
                          }
                        >
                          {e.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                {(payload?.events.filter((e) => e.ts >= cutoffMs(range)) ?? [])
                  .length === 0 && (
                  <tr>
                    <td
                      className="px-3 py-6 text-sm text-muted"
                      colSpan={8}
                    >
                      {payload
                        ? "No calls in this time window."
                        : "Loading…"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </AppShell>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-md bg-surface px-4 py-4 shadow-[var(--shadow-border)]">
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
        {label}
      </p>
      <p className="mt-2 font-mono text-2xl tabular-nums tracking-tight">
        {value}
      </p>
      {sub ? (
        <p className="mt-0.5 font-mono text-[11px] text-muted">{sub}</p>
      ) : null}
    </div>
  );
}

function BreakdownTable({
  rows,
  total,
}: {
  rows: { label: string; calls: number; tokens: number }[];
  total: number;
}) {
  const max = Math.max(1, ...rows.map((r) => r.tokens));
  return (
    <div className="overflow-x-auto rounded-md bg-surface shadow-[var(--shadow-border)]">
      <table className="w-full min-w-[440px] text-left text-sm">
        <thead className="border-b border-border font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
          <tr>
            <th className="px-3 py-2">Name</th>
            <th className="px-3 py-2 text-right">Calls</th>
            <th className="px-3 py-2 text-right">Tokens</th>
            <th className="px-3 py-2 text-right">Share</th>
            <th className="px-3 py-2 w-28" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-b border-border/60 last:border-0">
              <td className="px-3 py-2 font-mono text-xs">{r.label}</td>
              <td className="px-3 py-2 font-mono text-xs text-right tabular-nums">
                {fmtN(r.calls)}
              </td>
              <td className="px-3 py-2 font-mono text-xs text-right tabular-nums">
                {fmtN(r.tokens)}
              </td>
              <td className="px-3 py-2 font-mono text-xs text-right text-muted tabular-nums">
                {total > 0
                  ? Math.round((r.tokens / total) * 100) + "%"
                  : "—"}
              </td>
              <td className="px-3 py-2">
                <div className="h-1.5 overflow-hidden rounded-full bg-raised">
                  <div
                    className="h-full rounded-full bg-score"
                    style={{
                      width: `${Math.round((r.tokens / max) * 100)}%`,
                    }}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Inline SVG sparkline (area + line) ─────────────────────────────────────

const CHART_W = 600;
const CHART_H = 80;
const PAD_L = 0;
const PAD_R = 0;
const PAD_T = 8;
const PAD_B = 20;

function SparklineChart({ buckets }: { buckets: DayBucket[] }) {
  if (buckets.length === 0) return null;

  const n = buckets.length;
  const maxCalls = Math.max(1, ...buckets.map((b) => b.calls));
  const maxTok = Math.max(1, ...buckets.map((b) => b.tokens));

  const plotW = CHART_W - PAD_L - PAD_R;
  const plotH = CHART_H - PAD_T - PAD_B;

  function xAt(i: number) {
    return PAD_L + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  }
  function yAt(v: number, mx: number) {
    return PAD_T + plotH - (v / mx) * plotH;
  }

  // Build SVG path points
  function polyPoints(vals: number[], mx: number) {
    return vals.map((v, i) => `${xAt(i)},${yAt(v, mx)}`).join(" ");
  }

  function areaPath(vals: number[], mx: number) {
    const pts = vals.map((v, i) => [xAt(i), yAt(v, mx)] as [number, number]);
    const lastX = xAt(n - 1);
    const baseY = PAD_T + plotH;
    const move = `M ${pts[0][0]} ${pts[0][1]}`;
    const lines = pts.slice(1).map(([x, y]) => `L ${x} ${y}`).join(" ");
    const close = `L ${lastX} ${baseY} L ${PAD_L} ${baseY} Z`;
    return [move, lines, close].join(" ");
  }

  const callVals = buckets.map((b) => b.calls);
  const tokVals = buckets.map((b) => b.tokens);

  return (
    <div className="space-y-3">
      {/* Calls chart */}
      <div className="space-y-1">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
          Calls
        </p>
        <svg
          viewBox={`0 0 ${CHART_W} ${CHART_H}`}
          className="w-full overflow-visible"
          aria-hidden="true"
        >
          {/* Zero line */}
          <line
            x1={PAD_L}
            y1={PAD_T + plotH}
            x2={CHART_W - PAD_R}
            y2={PAD_T + plotH}
            stroke="var(--color-border)"
            strokeWidth="1"
          />
          {/* Area fill */}
          <path
            d={areaPath(callVals, maxCalls)}
            fill="var(--color-score)"
            fillOpacity="0.12"
          />
          {/* Line */}
          <polyline
            points={polyPoints(callVals, maxCalls)}
            fill="none"
            stroke="var(--color-score)"
            strokeWidth="1.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {/* Day labels */}
          {buckets.map((b, i) =>
            i % Math.ceil(n / 7) === 0 ? (
              <text
                key={b.day}
                x={xAt(i)}
                y={CHART_H - 4}
                textAnchor="middle"
                fontSize="9"
                fill="var(--color-subtle)"
                fontFamily="monospace"
              >
                {b.day.slice(5)}
              </text>
            ) : null,
          )}
        </svg>
      </div>

      {/* Tokens chart */}
      <div className="space-y-1">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
          Tokens
        </p>
        <svg
          viewBox={`0 0 ${CHART_W} ${CHART_H}`}
          className="w-full overflow-visible"
          aria-hidden="true"
        >
          <line
            x1={PAD_L}
            y1={PAD_T + plotH}
            x2={CHART_W - PAD_R}
            y2={PAD_T + plotH}
            stroke="var(--color-border)"
            strokeWidth="1"
          />
          <path
            d={areaPath(tokVals, maxTok)}
            fill="var(--color-score)"
            fillOpacity="0.08"
          />
          <polyline
            points={polyPoints(tokVals, maxTok)}
            fill="none"
            stroke="var(--color-score)"
            strokeWidth="1.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {buckets.map((b, i) =>
            i % Math.ceil(n / 7) === 0 ? (
              <text
                key={b.day}
                x={xAt(i)}
                y={CHART_H - 4}
                textAnchor="middle"
                fontSize="9"
                fill="var(--color-subtle)"
                fontFamily="monospace"
              >
                {b.day.slice(5)}
              </text>
            ) : null,
          )}
        </svg>
      </div>
    </div>
  );
}

// ─── Formatters ─────────────────────────────────────────────────────────────

function fmtN(n: number) {
  return n.toLocaleString();
}

function fmtCents(cents: number) {
  return (cents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function fmtTs(epochMs: number): string {
  const d = new Date(epochMs);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : d.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}
