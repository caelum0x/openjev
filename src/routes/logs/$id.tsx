import { useEffect, useState, type ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
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
};

type Resolved =
  | { type: "usage"; entry: UsageEvent; activity: ActivityRow | null }
  | { type: "activity"; entry: ActivityRow };

export const Route = createFileRoute("/logs/$id")({
  head: () => pageHead("Log entry"),
  component: LogDetailPage,
});

function LogDetailPage() {
  const { id } = Route.useParams();
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        // Fetch a broad window to locate this entry by ID. 500 rows is enough
        // for any active console; both tables use short-code primary keys.
        const res = await api<{ data: LogsResult }>("/api/v1/logs?limit=500");
        if (cancelled) return;
        const data = res.data;

        const usageEntry = data.usage.find((e) => e.id === id);
        if (usageEntry) {
          // Try to pair with a matching activity row: a "decision" entry whose
          // meta.path matches and whose timestamp is within 5 s of the call.
          const paired =
            data.activity.find(
              (a) =>
                a.kind === "decision" &&
                (a.meta as { path?: string }).path === usageEntry.path &&
                Math.abs(a.ts - usageEntry.ts) < 5000,
            ) ?? null;
          setResolved({ type: "usage", entry: usageEntry, activity: paired });
          return;
        }

        const actEntry = data.activity.find((a) => a.id === id);
        if (actEntry) {
          setResolved({ type: "activity", entry: actEntry });
          return;
        }

        setError("Entry not found. It may have scrolled out of the last 500 rows.");
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <AppShell>
      <div className="space-y-6">
        <header className="space-y-2">
          <Link
            to="/logs"
            className="inline-flex items-center gap-1 font-mono text-xs text-muted hover:text-fg"
          >
            ← Logs
          </Link>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">
            {resolved?.type === "activity" ? "Event" : "Request"} inspector
          </p>
          <h1 className="break-all font-mono text-lg tracking-tight text-subtle">
            {id}
          </h1>
        </header>

        {loading ? <p className="text-sm text-muted">Loading…</p> : null}
        {error ? <p className="text-sm text-danger">{error}</p> : null}

        {resolved?.type === "usage" ? (
          <UsageDetail entry={resolved.entry} activity={resolved.activity} />
        ) : resolved?.type === "activity" ? (
          <ActivityDetail entry={resolved.entry} />
        ) : null}
      </div>
    </AppShell>
  );
}

/* ── Usage event inspector ───────────────────────────────────────────────── */

function UsageDetail({
  entry,
  activity,
}: {
  entry: UsageEvent;
  activity: ActivityRow | null;
}) {
  const totalTokens = entry.input_tokens + entry.output_tokens;

  return (
    <div className="space-y-4">
      {/* Headline stats */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Latency" value={`${entry.latency_ms} ms`} />
        <Stat label="Total tokens" value={entry.input_tokens + entry.output_tokens > 0 ? String(totalTokens) : "—"} />
        <Stat label="Questions" value={String(entry.questions)} />
      </div>

      {/* Core fields */}
      <div className="rounded-md bg-surface shadow-[var(--shadow-border)]">
        <div className="border-b border-border px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
            Call details
          </p>
        </div>
        <dl className="divide-y divide-border/60">
          <Field label="Time" value={fmtFull(entry.ts)} />
          <Field label="Model" value={entry.model} mono />
          <Field label="Path" value={entry.path} mono />
          <Field label="Key" value={entry.key} mono />
          <Field label="Status">
            <StatusPill status={entry.status} />
          </Field>
          <Field label="Input tokens" value={String(entry.input_tokens)} mono />
          <Field label="Output tokens" value={String(entry.output_tokens)} mono />
          <Field label="Latency" value={`${entry.latency_ms} ms`} mono />
          <Field label="Questions" value={String(entry.questions)} mono />
        </dl>
      </div>

      {/* Token split inline-SVG bar */}
      {totalTokens > 0 ? (
        <TokenBar input={entry.input_tokens} output={entry.output_tokens} />
      ) : null}

      {/* Linked activity meta */}
      {activity ? (
        <div className="rounded-md bg-surface shadow-[var(--shadow-border)]">
          <div className="border-b border-border px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
              Activity log
            </p>
          </div>
          <dl className="divide-y divide-border/60">
            <Field label="Kind" value={activity.kind} mono />
            <Field label="Summary" value={activity.summary} />
          </dl>
          {Object.keys(activity.meta).length > 0 ? (
            <div className="border-t border-border/60 px-4 py-3">
              <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                Meta
              </p>
              <MetaView meta={activity.meta} />
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Note about raw payload */}
      <p className="text-xs text-subtle">
        Raw state, questions, and answers are not retained after the call completes
        (privacy by design). The metrics above are the durable record.
      </p>
    </div>
  );
}

/* ── Activity event inspector ────────────────────────────────────────────── */

function ActivityDetail({ entry }: { entry: ActivityRow }) {
  return (
    <div className="space-y-4">
      <div className="rounded-md bg-surface shadow-[var(--shadow-border)]">
        <div className="border-b border-border px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
            Event details
          </p>
        </div>
        <dl className="divide-y divide-border/60">
          <Field label="Time" value={fmtFull(entry.ts)} />
          <Field label="Kind">
            <KindPill kind={entry.kind} />
          </Field>
          <Field label="Summary" value={entry.summary} />
        </dl>
      </div>

      {Object.keys(entry.meta).length > 0 ? (
        <div className="rounded-md bg-surface shadow-[var(--shadow-border)]">
          <div className="border-b border-border px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
              Meta
            </p>
          </div>
          <div className="px-4 py-3">
            <MetaView meta={entry.meta} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ── Token bar (inline SVG) ──────────────────────────────────────────────── */

function TokenBar({ input, output }: { input: number; output: number }) {
  const total = input + output;
  const inPct = Math.round((input / total) * 100);
  const outPct = 100 - inPct;
  return (
    <div className="rounded-md bg-surface p-4 shadow-[var(--shadow-border)]">
      <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
        Token split
      </p>
      <svg width="100%" height="24" aria-label="Token split">
        <rect x="0" y="4" width={`${inPct}%`} height="16" rx="3" fill="var(--color-accent)" opacity="0.7" />
        <rect x={`${inPct}%`} y="4" width={`${outPct}%`} height="16" rx="3" fill="var(--color-score)" opacity="0.7" />
      </svg>
      <div className="mt-2 flex gap-4 font-mono text-xs text-muted">
        <span>
          <span className="mr-1 inline-block size-2 rounded-sm bg-accent/70 align-middle" />
          in {input.toLocaleString()} ({inPct}%)
        </span>
        <span>
          <span className="mr-1 inline-block size-2 rounded-sm bg-score/70 align-middle" />
          out {output.toLocaleString()} ({outPct}%)
        </span>
      </div>
    </div>
  );
}

/* ── Meta key-value view ─────────────────────────────────────────────────── */

function MetaView({ meta }: { meta: Record<string, unknown> }) {
  return (
    <dl className="space-y-1">
      {Object.entries(meta).map(([k, v]) => (
        <div key={k} className="flex gap-3">
          <dt className="w-40 shrink-0 font-mono text-xs text-subtle">{k}</dt>
          <dd className="min-w-0 font-mono text-xs text-fg">
            {v === null || v === undefined
              ? <span className="text-subtle">null</span>
              : typeof v === "object"
              ? <span className="break-all">{JSON.stringify(v)}</span>
              : <span>{String(v)}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* ── Shared primitives ───────────────────────────────────────────────────── */

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-surface px-4 py-4 shadow-[var(--shadow-border)]">
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
        {label}
      </p>
      <p className="mt-2 font-mono text-2xl tabular-nums tracking-tight">{value}</p>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
  children,
}: {
  label: string;
  value?: string;
  mono?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-4 px-4 py-2.5">
      <dt className="w-36 shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
        {label}
      </dt>
      <dd className={["text-sm", mono ? "font-mono" : ""].join(" ")}>
        {children ?? value}
      </dd>
    </div>
  );
}

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
  "project.archived": "bg-raised text-muted",
  "eval.run": "bg-accent/15 text-accent",
};

function KindPill({ kind }: { kind: string }) {
  const cls = KIND_COLORS[kind] ?? "bg-raised text-muted";
  return (
    <span className={["inline-block rounded px-1.5 py-0.5 font-mono text-[10px]", cls].join(" ")}>
      {kind}
    </span>
  );
}

function fmtFull(ms: number) {
  return new Date(ms).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
