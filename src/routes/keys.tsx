import { Fragment, useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CopyButton } from "@/components/copy-button";
import { api, getActiveKey, setActiveKey } from "@/lib/jev/browser";
import { pageHead } from "@/lib/seo/site";

// ── Types ──────────────────────────────────────────────────────────────────

type PublicApiKey = {
  id: string;
  name: string;
  prefix: string;
  created_at: number;
  last_used_at: number | null;
  project_id: string | null;
  scopes: string[];
  revoked_at: number | null;
};

type CreatedKey = PublicApiKey & { secret: string; warning: string };

type Project = {
  id: string;
  name: string;
  slug: string;
  created_at: number;
  archived_at: number | null;
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

type LogsResult = {
  usage: UsageEvent[];
  activity: unknown[];
  filters: Record<string, unknown>;
};

type UsageSummary = {
  window: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  tokens: number;
  by_key: Record<string, { calls: number; tokens: number }>;
  by_model: Record<string, { calls: number; tokens: number }>;
  by_day: Array<{ day: string; calls: number; tokens: number }>;
  p50_latency_ms: number;
  p95_latency_ms: number;
};

type UsagePayload = {
  summary: UsageSummary;
  events: UsageEvent[];
};

type NewKeyBanner = {
  secret: string;
  warning: string;
  name: string;
};

type CreateForm = {
  name: string;
  scopes: string[];
  projectId: string;
};

// ── Scope catalogue ────────────────────────────────────────────────────────

const AVAILABLE_SCOPES: { id: string; desc: string }[] = [
  { id: "decisions:run",    desc: "Execute System One" },
  { id: "decisions:write",  desc: "Save / edit decisions" },
  { id: "usage:read",       desc: "Read usage data" },
  { id: "projects:write",   desc: "Manage projects" },
  { id: "webhooks:write",   desc: "Manage webhooks" },
  { id: "keys:write",       desc: "Create / revoke keys" },
];

// ── Route ──────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/keys")({
  head: () => pageHead("API keys"),
  component: KeysPage,
});

// ── Main page ──────────────────────────────────────────────────────────────

function KeysPage() {
  const [keys, setKeys]               = useState<PublicApiKey[]>([]);
  const [projects, setProjects]       = useState<Project[]>([]);
  const [byKey, setByKey]             = useState<Record<string, { calls: number; tokens: number }>>({});
  const [activeSecret, setActiveSecret] = useState<string | null>(null);
  const [newBanner, setNewBanner]     = useState<NewKeyBanner | null>(null);
  const [creating, setCreating]       = useState(false);
  const [form, setForm]               = useState<CreateForm>({ name: "", scopes: [], projectId: "" });
  const [createBusy, setCreateBusy]   = useState(false);
  const [expandedId, setExpandedId]   = useState<string | null>(null);
  const [keyLogs, setKeyLogs]         = useState<Record<string, UsageEvent[]>>({});
  const [logsLoading, setLogsLoading] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const [confirmRotate, setConfirmRotate] = useState<string | null>(null);
  const [busy, setBusy]               = useState<string | null>(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);

  // ── Data loading ───────────────────────────────────────────────────────

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const [keysRes, projRes, usageRes] = await Promise.all([
        api<{ data: PublicApiKey[] }>("/api/v1/keys"),
        api<{ data: Project[] }>("/api/v1/projects"),
        api<UsagePayload>("/api/v1/usage"),
      ]);
      setKeys(keysRes.data);
      setProjects(projRes.data);
      setByKey(usageRes.summary.by_key ?? {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setActiveSecret(getActiveKey());
    void loadAll();
  }, []);

  // ── Create key ─────────────────────────────────────────────────────────

  async function handleCreate() {
    const name = form.name.trim();
    if (!name) return;
    setCreateBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { name };
      if (form.scopes.length > 0) body.scopes = form.scopes;
      if (form.projectId) body.projectId = form.projectId;
      const res = await api<CreatedKey>("/api/v1/keys", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setNewBanner({ secret: res.secret, warning: res.warning, name: res.name });
      setActiveKey(res.secret);
      setActiveSecret(res.secret);
      setCreating(false);
      setForm({ name: "", scopes: [], projectId: "" });
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setCreateBusy(false);
    }
  }

  // ── Revoke key ─────────────────────────────────────────────────────────

  async function handleRevoke(id: string) {
    setBusy(id);
    setError(null);
    try {
      await api(`/api/v1/keys?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const revokedKey = keys.find((k) => k.id === id);
      if (revokedKey && activeSecret?.startsWith(revokedKey.prefix)) {
        setActiveKey(null);
        setActiveSecret(null);
      }
      setConfirmRevoke(null);
      if (expandedId === id) setExpandedId(null);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Revoke failed");
    } finally {
      setBusy(null);
    }
  }

  // ── Rotate key ─────────────────────────────────────────────────────────

  async function handleRotate(key: PublicApiKey) {
    setBusy(key.id);
    setError(null);
    try {
      await api(`/api/v1/keys?id=${encodeURIComponent(key.id)}`, { method: "DELETE" });
      const body: Record<string, unknown> = { name: key.name };
      if (key.scopes.length > 0) body.scopes = key.scopes;
      if (key.project_id) body.projectId = key.project_id;
      const res = await api<CreatedKey>("/api/v1/keys", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setNewBanner({ secret: res.secret, warning: res.warning, name: res.name });
      if (activeSecret?.startsWith(key.prefix)) {
        setActiveKey(res.secret);
        setActiveSecret(res.secret);
      }
      setConfirmRotate(null);
      setExpandedId(null);
      // Invalidate cached logs for the old key id — new key will have none yet.
      setKeyLogs((prev) => {
        const next = { ...prev };
        delete next[key.id];
        return next;
      });
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rotate failed");
    } finally {
      setBusy(null);
    }
  }

  // ── Expand row / per-key logs ──────────────────────────────────────────

  async function loadKeyLogs(keyId: string) {
    if (keyLogs[keyId] !== undefined) return;
    setLogsLoading(keyId);
    try {
      const res = await api<{ data: LogsResult }>(
        `/api/v1/logs?key=${encodeURIComponent(keyId)}&limit=50`,
      );
      setKeyLogs((prev) => ({ ...prev, [keyId]: res.data.usage }));
    } catch {
      setKeyLogs((prev) => ({ ...prev, [keyId]: [] }));
    } finally {
      setLogsLoading(null);
    }
  }

  function toggleExpand(keyId: string) {
    if (expandedId === keyId) {
      setExpandedId(null);
    } else {
      setExpandedId(keyId);
      void loadKeyLogs(keyId);
    }
  }

  // ── Scope checkbox toggle ──────────────────────────────────────────────

  function toggleScope(scopeId: string) {
    setForm((f) => ({
      ...f,
      scopes: f.scopes.includes(scopeId)
        ? f.scopes.filter((s) => s !== scopeId)
        : [...f.scopes, scopeId],
    }));
  }

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <AppShell>
      <div className="space-y-6">

        {/* ── Header ── */}
        <header className="space-y-2">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">
            API Keys
          </p>
          <h1 className="text-2xl font-medium tracking-tight">Bearer tokens</h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            Send{" "}
            <span className="font-mono text-fg">Authorization: Bearer ots_live_…</span>{" "}
            on HTTP calls. The same-origin playground works without a key.
            Secrets are shown exactly once — copy immediately after creation.
          </p>
        </header>

        {/* ── Global error ── */}
        {error && (
          <p className="text-sm text-danger">{error}</p>
        )}

        {/* ── New-secret banner ── */}
        {newBanner && (
          <div className="rounded-md bg-surface p-4 shadow-[var(--shadow-border)] space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Key ready: {newBanner.name}</p>
                <p className="mt-0.5 text-xs text-muted">{newBanner.warning}</p>
              </div>
              <button
                type="button"
                aria-label="Dismiss"
                className="mt-0.5 shrink-0 text-subtle hover:text-fg transition-colors"
                onClick={() => setNewBanner(null)}
              >
                <X className="size-4" />
              </button>
            </div>
            <p className="break-all rounded bg-raised px-3 py-2 font-mono text-sm leading-relaxed">
              {newBanner.secret}
            </p>
            <div className="flex flex-wrap gap-2">
              <CopyButton text={newBanner.secret} label="Copy secret" />
              <CopyButton
                text={`export OPENJEV_API_KEY=${newBanner.secret}`}
                label="Copy export"
              />
              <CopyButton
                text={`-H "Authorization: Bearer ${newBanner.secret}"`}
                label="Copy curl header"
              />
            </div>
          </div>
        )}

        {/* ── Create panel / New-key button ── */}
        {creating ? (
          <div className="rounded-md bg-surface p-4 shadow-[var(--shadow-border)] space-y-4">
            <p className="text-sm font-medium">New API key</p>

            <div className="grid gap-3 sm:grid-cols-2">
              {/* Name */}
              <div className="space-y-1.5">
                <label className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                  Name *
                </label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. production, ci-bot, staging"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleCreate();
                    if (e.key === "Escape") {
                      setCreating(false);
                      setForm({ name: "", scopes: [], projectId: "" });
                    }
                  }}
                />
              </div>

              {/* Project */}
              <div className="space-y-1.5">
                <label className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                  Project (optional)
                </label>
                <select
                  value={form.projectId}
                  onChange={(e) => setForm((f) => ({ ...f, projectId: e.target.value }))}
                  className="h-11 w-full rounded-sm bg-inset px-3 text-sm text-fg shadow-[var(--shadow-border)] focus-visible:outline-none transition-[box-shadow] duration-150 ease-out"
                >
                  <option value="">No project</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Scopes */}
            <div className="space-y-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                Scopes — leave all unchecked for full access
              </p>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {AVAILABLE_SCOPES.map((s) => (
                  <label
                    key={s.id}
                    className="flex cursor-pointer select-none items-center gap-2"
                  >
                    <input
                      type="checkbox"
                      checked={form.scopes.includes(s.id)}
                      onChange={() => toggleScope(s.id)}
                      className="h-3.5 w-3.5"
                    />
                    <span className="font-mono text-xs">{s.id}</span>
                    <span className="text-xs text-subtle">{s.desc}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => void handleCreate()}
                disabled={!form.name.trim() || createBusy}
              >
                {createBusy ? "Creating…" : "Create key"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setCreating(false);
                  setForm({ name: "", scopes: [], projectId: "" });
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            New key
          </Button>
        )}

        {/* ── Keys table ── */}
        <div className="overflow-x-auto rounded-md bg-surface shadow-[var(--shadow-border)]">
          <table className="w-full min-w-[800px] text-left text-sm">
            <thead className="border-b border-border font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
              <tr>
                <th className="w-6 px-3 py-2" />
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Prefix</th>
                <th className="px-3 py-2">Scopes</th>
                <th className="px-3 py-2">Project</th>
                <th className="px-3 py-2">Created</th>
                <th className="px-3 py-2">Last used</th>
                <th className="px-3 py-2">24h calls</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td className="px-3 py-6 text-sm text-muted" colSpan={9}>
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && keys.length === 0 && (
                <tr>
                  <td className="px-3 py-6 text-sm text-muted" colSpan={9}>
                    No active keys. Create one above to start metering API calls.
                  </td>
                </tr>
              )}

              {keys.map((key) => {
                const isActive       = !!(activeSecret && activeSecret.startsWith(key.prefix));
                const stats          = byKey[key.id];
                const isExpanded     = expandedId === key.id;
                const isConfirmRevoke = confirmRevoke === key.id;
                const isConfirmRotate = confirmRotate === key.id;
                const isBusy         = busy === key.id;
                const project        = projects.find((p) => p.id === key.project_id);
                const logs           = keyLogs[key.id] ?? [];

                return (
                  <Fragment key={key.id}>
                    {/* Main row */}
                    <tr
                      className={[
                        "border-b border-border/60 transition-colors",
                        isExpanded
                          ? "bg-raised/30"
                          : "cursor-pointer hover:bg-raised/20",
                      ].join(" ")}
                      onClick={() => toggleExpand(key.id)}
                    >
                      {/* Expand chevron */}
                      <td className="px-3 py-2.5 text-subtle">
                        {isExpanded ? (
                          <ChevronDown className="size-3.5" />
                        ) : (
                          <ChevronRight className="size-3.5" />
                        )}
                      </td>

                      {/* Name */}
                      <td className="px-3 py-2.5">
                        <span className="font-medium">{key.name}</span>
                        {isActive && (
                          <span className="ml-2 font-mono text-[10px] uppercase tracking-wide text-score">
                            active
                          </span>
                        )}
                      </td>

                      {/* Prefix */}
                      <td className="px-3 py-2.5 font-mono text-xs text-muted">
                        {key.prefix}…
                      </td>

                      {/* Scopes */}
                      <td className="px-3 py-2.5">
                        {key.scopes.length === 0 ? (
                          <span className="text-xs text-subtle">full access</span>
                        ) : (
                          <span className="flex flex-wrap gap-1">
                            {key.scopes.map((s) => (
                              <span
                                key={s}
                                className="rounded bg-raised px-1 py-0.5 font-mono text-[10px] text-muted"
                              >
                                {s}
                              </span>
                            ))}
                          </span>
                        )}
                      </td>

                      {/* Project */}
                      <td className="px-3 py-2.5 text-xs text-muted">
                        {project ? project.name : "—"}
                      </td>

                      {/* Created */}
                      <td className="px-3 py-2.5 font-mono text-xs text-subtle">
                        {fmtDate(key.created_at)}
                      </td>

                      {/* Last used */}
                      <td className="px-3 py-2.5 font-mono text-xs text-subtle">
                        {key.last_used_at ? fmtDate(key.last_used_at) : "—"}
                      </td>

                      {/* 24h stats */}
                      <td className="px-3 py-2.5 font-mono text-xs text-subtle">
                        {stats
                          ? `${stats.calls} · ${fmtNum(stats.tokens)} tok`
                          : "—"}
                      </td>

                      {/* Actions */}
                      <td
                        className="px-3 py-2.5 text-right"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {isBusy ? (
                          <span className="font-mono text-xs text-subtle">…</span>
                        ) : isConfirmRevoke ? (
                          <span className="inline-flex items-center gap-1">
                            <span className="mr-1 text-xs text-danger">Revoke?</span>
                            <Button
                              size="sm"
                              variant="danger"
                              onClick={() => void handleRevoke(key.id)}
                            >
                              Yes
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setConfirmRevoke(null)}
                            >
                              No
                            </Button>
                          </span>
                        ) : isConfirmRotate ? (
                          <span className="inline-flex items-center gap-1">
                            <span className="mr-1 text-xs text-muted">Old key expires —</span>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => void handleRotate(key)}
                            >
                              Confirm rotate
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setConfirmRotate(null)}
                            >
                              Cancel
                            </Button>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              title="Rotate — revoke and re-issue with same name"
                              onClick={() => setConfirmRotate(key.id)}
                            >
                              <RotateCcw className="size-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              title="Revoke permanently"
                              onClick={() => setConfirmRevoke(key.id)}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </span>
                        )}
                      </td>
                    </tr>

                    {/* Expanded detail row */}
                    {isExpanded && (
                      <tr className="border-b border-border/40">
                        <td colSpan={9} className="bg-raised/10 px-5 py-4">
                          {logsLoading === key.id ? (
                            <p className="text-xs text-muted">Loading logs…</p>
                          ) : (
                            <KeyDetail logs={logs} />
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}

// ── Expanded key detail ────────────────────────────────────────────────────

function KeyDetail({ logs }: { logs: UsageEvent[] }) {
  const totalCalls   = logs.length;
  const totalTokens  = logs.reduce((s, e) => s + e.input_tokens + e.output_tokens, 0);
  const avgLatency   = totalCalls > 0
    ? Math.round(logs.reduce((s, e) => s + e.latency_ms, 0) / totalCalls)
    : 0;

  // Group by model for bar chart
  const byModel: Record<string, { calls: number; tokens: number }> = {};
  for (const e of logs) {
    const entry = byModel[e.model] ?? { calls: 0, tokens: 0 };
    byModel[e.model] = {
      calls: entry.calls + 1,
      tokens: entry.tokens + e.input_tokens + e.output_tokens,
    };
  }
  const modelEntries = Object.entries(byModel);
  const maxTok = Math.max(1, ...modelEntries.map(([, v]) => v.tokens));

  return (
    <div className="space-y-4">
      {/* Mini stat tiles */}
      <div className="flex flex-wrap gap-3">
        <MiniStat label="Calls loaded" value={String(totalCalls)} />
        <MiniStat label="Tokens"       value={fmtNum(totalTokens)} />
        <MiniStat label="Avg latency"  value={totalCalls > 0 ? `${avgLatency}ms` : "—"} />
      </div>

      {/* By-model bar chart */}
      {modelEntries.length > 0 && (
        <div className="max-w-sm space-y-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
            By model
          </p>
          {modelEntries.map(([id, v]) => (
            <div key={id} className="space-y-0.5">
              <div className="flex justify-between font-mono text-xs">
                <span className="text-fg">{id}</span>
                <span className="text-subtle">
                  {v.calls} · {fmtNum(v.tokens)} tok
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-raised">
                <div
                  className="h-full rounded-full bg-score"
                  style={{ width: `${Math.round((v.tokens / maxTok) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Recent events table */}
      {logs.length > 0 ? (
        <div className="overflow-x-auto rounded bg-surface shadow-[var(--shadow-border)]">
          <table className="w-full min-w-[520px] text-left">
            <thead className="border-b border-border font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
              <tr>
                <th className="px-2.5 py-1.5">Time</th>
                <th className="px-2.5 py-1.5">Model</th>
                <th className="px-2.5 py-1.5">Path</th>
                <th className="px-2.5 py-1.5">In + Out</th>
                <th className="px-2.5 py-1.5">ms</th>
                <th className="px-2.5 py-1.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {logs.slice(0, 8).map((e) => (
                <tr key={e.id} className="border-b border-border/40">
                  <td className="px-2.5 py-1.5 font-mono text-xs text-subtle">
                    {new Date(e.ts).toLocaleTimeString()}
                  </td>
                  <td className="px-2.5 py-1.5 font-mono text-xs">{e.model}</td>
                  <td className="px-2.5 py-1.5 font-mono text-xs text-subtle">{e.path}</td>
                  <td className="px-2.5 py-1.5 font-mono text-xs">
                    {e.input_tokens}+{e.output_tokens}
                  </td>
                  <td className="px-2.5 py-1.5 font-mono text-xs">{e.latency_ms}</td>
                  <td className="px-2.5 py-1.5 font-mono text-xs">
                    <span className={e.status === "ok" ? "text-score" : "text-danger"}>
                      {e.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-xs text-muted">
          No usage events found for this key in the log window.
        </p>
      )}
    </div>
  );
}

// ── Mini stat tile ─────────────────────────────────────────────────────────

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[88px] rounded bg-raised px-3 py-2">
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
        {label}
      </p>
      <p className="mt-1 font-mono text-lg tabular-nums">{value}</p>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month:  "short",
    day:    "numeric",
    hour:   "2-digit",
    minute: "2-digit",
  });
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
