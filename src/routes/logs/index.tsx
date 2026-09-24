import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/jev/browser";
import { pageHead } from "@/lib/seo/site";

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

type ActivityRow = {
  id: string;
  ts: number;
  kind: string;
  summary: string;
  meta: Record<string, unknown>;
};

type LogsResult = {
  usage: UsageEvent[];
  activity: ActivityRow[];
  filters: {
    model: string | null;
    key: string | null;
    kind: string | null;
    from: number | null;
    to: number | null;
    limit: number;
  };
};

type FilterState = {
  model: string;
  key: string;
  kind: string;
  from: string;
  to: string;
};

const EMPTY_FILTERS: FilterState = { model: "", key: "", kind: "", from: "", to: "" };

const KIND_PILLS = [
  "",
  "decision",
  "key.created",
  "key.revoked",
  "project.created",
  "project.archived",
  "webhook.created",
  "webhook.deleted",
  "eval.run",
  "account.updated",
];

export const Route = createFileRoute("/logs/")({
  head: () => pageHead("Logs"),
  component: LogsPage,
});

function buildQuery(f: FilterState): string {
  const p = new URLSearchParams();
  if (f.model) p.set("model", f.model);
  if (f.key) p.set("key", f.key);
  if (f.kind) p.set("kind", f.kind);
  if (f.from) p.set("from", String(new Date(f.from).getTime()));
  if (f.to) p.set("to", String(new Date(f.to).getTime() + 86399999));
  p.set("limit", "200");
  return p.toString();
}

function LogsPage() {
  const [data, setData] = useState<LogsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"usage" | "activity">("usage");
  const [draft, setDraft] = useState<FilterState>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<FilterState>(EMPTY_FILTERS);

  async function load(f: FilterState) {
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ data: LogsResult }>(`/api/v1/logs?${buildQuery(f)}`);
      setData(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load logs");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(applied);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applied]);

  function apply() {
    setApplied({ ...draft });
  }

  function clear() {
    setDraft(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
  }

  function setKind(k: string) {
    const next = { ...draft, kind: k };
    setDraft(next);
    setApplied(next);
  }

  const hasFilters =
    applied.model || applied.key || applied.kind || applied.from || applied.to;

  const usageCount = data?.usage.length ?? 0;
  const activityCount = data?.activity.length ?? 0;

  return (
    <AppShell>
      <div className="space-y-6">
        <header className="space-y-2">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">
            Logs
          </p>
          <h1 className="text-2xl font-medium tracking-tight">Request feed</h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            Every System One API call and console action. Filter by model, key, event
            kind, or date range. Click any row to inspect.
          </p>
        </header>

        {/* Filter bar */}
        <form
          className="flex flex-col gap-2 lg:flex-row lg:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            apply();
          }}
        >
          <div className="flex-1 space-y-1">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
              Model
            </p>
            <Input
              value={draft.model}
              onChange={(e) => setDraft((f) => ({ ...f, model: e.target.value }))}
              placeholder="system-one"
              className="sm:max-w-xs"
            />
          </div>
          <div className="flex-1 space-y-1">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
              Key
            </p>
            <Input
              value={draft.key}
              onChange={(e) => setDraft((f) => ({ ...f, key: e.target.value }))}
              placeholder="anon or key_id…"
              className="sm:max-w-xs"
            />
          </div>
          <div className="space-y-1">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
              From
            </p>
            <Input
              type="date"
              value={draft.from}
              onChange={(e) => setDraft((f) => ({ ...f, from: e.target.value }))}
            />
          </div>
          <div className="space-y-1">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
              To
            </p>
            <Input
              type="date"
              value={draft.to}
              onChange={(e) => setDraft((f) => ({ ...f, to: e.target.value }))}
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={loading}>
              Apply
            </Button>
            {hasFilters ? (
              <Button type="button" variant="secondary" size="sm" onClick={clear}>
                Clear
              </Button>
            ) : null}
          </div>
        </form>

        {/* Kind pills */}
        <div className="flex flex-wrap gap-1.5">
          {KIND_PILLS.map((k) => (
            <button
              key={k || "__all__"}
              type="button"
              onClick={() => setKind(k)}
              className={[
                "h-8 rounded-sm px-3 font-mono text-xs transition-colors",
                applied.kind === k
                  ? "bg-raised text-fg shadow-[var(--shadow-border)]"
                  : "text-muted hover:text-fg",
              ].join(" ")}
            >
              {k || "all events"}
            </button>
          ))}
        </div>

        {error ? <p className="text-sm text-danger">{error}</p> : null}

        {/* Tabs */}
        <div className="flex gap-6 border-b border-border">
          {(["usage", "activity"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={[
                "pb-2 text-sm font-medium transition-colors",
                tab === t
                  ? "-mb-px border-b-2 border-fg text-fg"
                  : "text-muted hover:text-fg",
              ].join(" ")}
            >
              {t === "usage"
                ? `API calls${data ? ` (${usageCount})` : ""}`
                : `Activity${data ? ` (${activityCount})` : ""}`}
            </button>
          ))}
        </div>

        {loading && !data ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : tab === "usage" ? (
          <UsageTable rows={data?.usage ?? []} loading={loading} />
        ) : (
          <ActivityTable rows={data?.activity ?? []} loading={loading} />
        )}
      </div>
    </AppShell>
  );
}

/* ── Usage table ─────────────────────────────────────────────────────────── */

function UsageTable({ rows, loading }: { rows: UsageEvent[]; loading: boolean }) {
  return (
    <div className="overflow-x-auto rounded-md bg-surface shadow-[var(--shadow-border)]">
      <table className="w-full min-w-[760px] text-left text-sm">
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
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.id} className="border-b border-border/60 hover:bg-raised/50">
              <td className="px-3 py-2 font-mono text-xs text-muted">
                {fmtTs(e.ts)}
              </td>
              <td className="px-3 py-2 font-mono text-xs">{e.model}</td>
              <td className="px-3 py-2 font-mono text-xs text-muted">
                {truncate(e.path, 32)}
              </td>
              <td className="px-3 py-2 font-mono text-xs text-muted">
                {e.key === "anon" ? (
                  <span className="text-subtle">anon</span>
                ) : (
                  truncate(e.key, 14)
                )}
              </td>
              <td className="px-3 py-2 font-mono text-xs tabular-nums">
                {e.questions}
              </td>
              <td className="px-3 py-2 font-mono text-xs tabular-nums">
                {e.input_tokens}+{e.output_tokens}
              </td>
              <td className="px-3 py-2 font-mono text-xs tabular-nums">{e.latency_ms}</td>
              <td className="px-3 py-2">
                <StatusPill status={e.status} />
              </td>
              <td className="px-3 py-2 text-right">
                <Link
                  to="/logs/$id"
                  params={{ id: e.id }}
                  className="font-mono text-xs text-muted hover:text-fg"
                >
                  view
                </Link>
              </td>
            </tr>
          ))}
          {rows.length === 0 && !loading ? (
            <tr>
              <td className="px-3 py-6 text-sm text-muted" colSpan={9}>
                No API calls match the current filters.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

/* ── Activity table ──────────────────────────────────────────────────────── */

function ActivityTable({ rows, loading }: { rows: ActivityRow[]; loading: boolean }) {
  return (
    <div className="overflow-x-auto rounded-md bg-surface shadow-[var(--shadow-border)]">
      <table className="w-full min-w-[520px] text-left text-sm">
        <thead className="border-b border-border font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
          <tr>
            <th className="px-3 py-2">Time</th>
            <th className="px-3 py-2">Kind</th>
            <th className="px-3 py-2">Summary</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id} className="border-b border-border/60 hover:bg-raised/50">
              <td className="px-3 py-2 font-mono text-xs text-muted">
                {fmtTs(a.ts)}
              </td>
              <td className="px-3 py-2">
                <KindPill kind={a.kind} />
              </td>
              <td className="px-3 py-2 text-xs text-muted">{a.summary}</td>
              <td className="px-3 py-2 text-right">
                <Link
                  to="/logs/$id"
                  params={{ id: a.id }}
                  className="font-mono text-xs text-muted hover:text-fg"
                >
                  view
                </Link>
              </td>
            </tr>
          ))}
          {rows.length === 0 && !loading ? (
            <tr>
              <td className="px-3 py-6 text-sm text-muted" colSpan={4}>
                No activity matches the current filters.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function StatusPill({ status }: { status: string }) {
  const ok = status === "ok";
  return (
    <span
      className={[
        "inline-block rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide",
        ok ? "bg-score/15 text-score" : "bg-danger/15 text-danger",
      ].join(" ")}
    >
      {status}
    </span>
  );
}

const KIND_COLORS: Record<string, string> = {
  decision: "bg-accent/15 text-accent",
  "key.created": "bg-score/15 text-score",
  "key.revoked": "bg-danger/15 text-danger",
  "project.created": "bg-score/15 text-score",
  "project.archived": "bg-muted/15 text-muted",
  "eval.run": "bg-accent/15 text-accent",
};

function KindPill({ kind }: { kind: string }) {
  const cls = KIND_COLORS[kind] ?? "bg-raised text-muted";
  return (
    <span
      className={[
        "inline-block rounded px-1.5 py-0.5 font-mono text-[10px]",
        cls,
      ].join(" ")}
    >
      {kind}
    </span>
  );
}

function fmtTs(ms: number) {
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
