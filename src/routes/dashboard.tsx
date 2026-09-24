import { useEffect, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { buttonVariants } from "@/components/ui/button";
import { api } from "@/lib/jev/browser";
import { pageHead } from "@/lib/seo/site";

// ── Types ────────────────────────────────────────────────────────────────────

type ActivityRow = {
  id: string;
  ts: number;
  kind: string;
  summary: string;
  meta: Record<string, unknown>;
};

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

type SparkPoint = { day: string; calls: number; tokens: number };

type TopModel = { model: string; calls: number; tokens: number };

type DashboardSummary = {
  today: {
    calls: number;
    input_tokens: number;
    output_tokens: number;
    tokens: number;
    p50_latency_ms: number;
    p95_latency_ms: number;
  };
  sparkline: SparkPoint[];
  top_models: TopModel[];
  recent_activity: ActivityRow[];
  recent_usage: UsageEvent[];
};

type KeyRow = { id: string; name: string; prefix: string };

type Project = { id: string; name: string; slug: string; archived_at: number | null };

const QUICK_ACTIONS = [
  { to: "/playground", label: "Playground" },
  { to: "/keys", label: "API Keys" },
  { to: "/decisions", label: "Decisions" },
] as const;

// ── Route ────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/dashboard")({
  head: () => pageHead("Dashboard"),
  component: DashboardPage,
});

// ── Page ─────────────────────────────────────────────────────────────────────

function DashboardPage() {
  const [dash, setDash] = useState<DashboardSummary | null>(null);
  const [keyCount, setKeyCount] = useState<number | null>(null);
  const [projectCount, setProjectCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const [d, keys, projects] = await Promise.all([
        api<{ data: DashboardSummary }>("/api/v1/dashboard"),
        api<{ data: KeyRow[] }>("/api/v1/keys"),
        api<{ data: Project[] }>("/api/v1/projects"),
      ]);
      setDash(d.data);
      setKeyCount(keys.data.length);
      setProjectCount(projects.data.length);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
    }
  }

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 15000);
    return () => clearInterval(t);
  }, []);

  const loading = dash === null && error === null;
  const today = dash?.today;
  const sparkline = dash?.sparkline ?? [];
  const topModels = dash?.top_models ?? [];
  const recentActivity = dash?.recent_activity ?? [];
  const recentUsage = dash?.recent_usage ?? [];

  return (
    <AppShell>
      <div className="space-y-8">
        {/* Header */}
        <header className="space-y-2">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">
            Console
          </p>
          <h1 className="text-2xl font-medium tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted">
            Live overview of your OpenJev API usage, keys, and decision activity.
          </p>
        </header>

        {error ? <p className="text-sm text-danger">{error}</p> : null}

        {/* KPI cards */}
        <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
          <Stat label="Calls today" value={today ? fmt(today.calls) : "—"} />
          <Stat label="Tokens 24h" value={today ? fmtK(today.tokens) : "—"} />
          <Stat label="p50 latency" value={fmtMs(today?.p50_latency_ms ?? 0)} />
          <Stat label="p95 latency" value={fmtMs(today?.p95_latency_ms ?? 0)} />
          <Stat
            label="Active keys"
            value={keyCount === null ? "—" : String(keyCount)}
          />
          <Stat
            label="Projects"
            value={projectCount === null ? "—" : String(projectCount)}
          />
        </div>

        {/* Sparkline + top models row */}
        <div className="grid gap-4 lg:grid-cols-3">
          {/* 14-day sparkline */}
          <div className="lg:col-span-2 rounded-md bg-surface p-4 shadow-[var(--shadow-border)] space-y-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
              Calls — last 14 days
            </p>
            <Sparkline data={sparkline} />
            <div className="flex justify-between font-mono text-[10px] text-subtle">
              {sparkline.length > 0 ? (
                <>
                  <span>{sparkline[0]?.day}</span>
                  <span>{sparkline[sparkline.length - 1]?.day}</span>
                </>
              ) : null}
            </div>
          </div>

          {/* Top models */}
          <div className="rounded-md bg-surface p-4 shadow-[var(--shadow-border)] space-y-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
              Top models — 7 days
            </p>
            {loading ? (
              <p className="text-sm text-muted">Loading…</p>
            ) : topModels.length === 0 ? (
              <p className="text-sm text-muted">No model traffic yet.</p>
            ) : (
              <ModelBars models={topModels} />
            )}
          </div>
        </div>

        {/* Quick actions */}
        <div className="flex flex-wrap gap-2">
          {QUICK_ACTIONS.map((a) => (
            <Link
              key={a.to}
              to={a.to}
              className={buttonVariants({ variant: "secondary", size: "sm" })}
            >
              {a.label}
            </Link>
          ))}
        </div>

        {/* Recent activity + recent usage */}
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Recent activity */}
          <div className="space-y-3">
            <h2 className="text-sm font-medium">Recent activity</h2>
            <div className="rounded-md bg-surface shadow-[var(--shadow-border)]">
              {loading ? (
                <p className="px-4 py-6 text-sm text-muted">Loading activity…</p>
              ) : recentActivity.length === 0 ? (
                <p className="px-4 py-6 text-sm text-muted">
                  No activity yet. Run a decision or create a key to see events.
                </p>
              ) : (
                <ul className="divide-y divide-border/60">
                  {recentActivity.map((a) => (
                    <li key={a.id} className="flex items-start gap-3 px-4 py-3">
                      <span className="mt-0.5 shrink-0 rounded-sm bg-raised px-1.5 py-0.5 font-mono text-[10px] text-subtle">
                        {a.kind}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{a.summary}</p>
                        <p className="font-mono text-[10px] text-subtle">
                          {relTime(a.ts)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Recent usage */}
          <div className="space-y-3">
            <h2 className="text-sm font-medium">Recent calls</h2>
            <div className="overflow-x-auto rounded-md bg-surface shadow-[var(--shadow-border)]">
              <table className="w-full min-w-[380px] text-left text-sm">
                <thead className="border-b border-border font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                  <tr>
                    <th className="px-3 py-2">Model</th>
                    <th className="px-3 py-2">Path</th>
                    <th className="px-3 py-2">Tok</th>
                    <th className="px-3 py-2">ms</th>
                  </tr>
                </thead>
                <tbody>
                  {recentUsage.length === 0 ? (
                    <tr>
                      <td
                        className="px-3 py-6 text-sm text-muted"
                        colSpan={4}
                      >
                        {loading ? "Loading calls…" : "No calls yet."}
                      </td>
                    </tr>
                  ) : (
                    recentUsage.map((e) => (
                      <tr key={e.id} className="border-b border-border/60">
                        <td className="px-3 py-2 font-mono text-xs">
                          {e.model}
                        </td>
                        <td className="max-w-[120px] truncate px-3 py-2 font-mono text-xs text-muted">
                          {e.path}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">
                          {fmtK(e.input_tokens + e.output_tokens)}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">
                          {e.latency_ms}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-surface px-4 py-4 shadow-[var(--shadow-border)]">
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
        {label}
      </p>
      <p className="mt-2 font-mono text-2xl tabular-nums tracking-tight">
        {value}
      </p>
    </div>
  );
}

function Sparkline({ data }: { data: SparkPoint[] }) {
  const W = 480;
  const H = 64;
  const PAD = 2;

  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded bg-raised text-xs text-subtle"
        style={{ height: H }}
      >
        No data yet
      </div>
    );
  }

  const maxCalls = Math.max(1, ...data.map((d) => d.calls));
  const n = data.length;
  const barW = Math.floor((W - PAD * (n + 1)) / n);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      aria-label="14-day calls sparkline"
    >
      {data.map((d, i) => {
        const h = Math.max(2, Math.round((d.calls / maxCalls) * (H - 8)));
        const x = PAD + i * (barW + PAD);
        const y = H - h;
        const isToday = i === n - 1;
        return (
          <rect
            key={d.day}
            x={x}
            y={y}
            width={barW}
            height={h}
            rx={2}
            className={isToday ? "fill-accent/80" : "fill-raised"}
          />
        );
      })}
    </svg>
  );
}

function ModelBars({ models }: { models: TopModel[] }) {
  const maxTok = Math.max(1, ...models.map((m) => m.tokens));

  return (
    <div className="space-y-3">
      {models.map((m) => (
        <div key={m.model} className="space-y-1">
          <div className="flex justify-between font-mono text-xs">
            <span className="truncate max-w-[140px]" title={m.model}>
              {m.model}
            </span>
            <span className="shrink-0 text-subtle">
              {m.calls} · {fmtK(m.tokens)}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-raised">
            <div
              className="h-full rounded-full bg-score"
              style={{ width: `${Math.round((m.tokens / maxTok) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString();
}

function fmtK(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

function fmtMs(ms: number) {
  if (ms === 0) return "—";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function relTime(ts: number) {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString();
}
