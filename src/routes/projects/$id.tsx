import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/jev/browser";
import { ArrowLeft, FolderKanban, KeyRound, TriangleAlert } from "lucide-react";
import { pageHead } from "@/lib/seo/site";

type ProjectStats = {
  keys: number;
  calls_24h: number;
  calls_total: number;
  tokens_total: number;
  last_used_at: number | null;
};

type Project = {
  id: string;
  name: string;
  slug: string;
  created_at: number;
  archived_at: number | null;
  stats: ProjectStats;
};

type ApiKey = {
  id: string;
  name: string;
  prefix: string;
  created_at: number;
  last_used_at: number | null;
  project_id: string | null;
  scopes: string[];
  revoked_at: number | null;
};

export const Route = createFileRoute("/projects/$id")({
  head: () => pageHead("Project"),
  component: ProjectDetailPage,
});

function ProjectDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();

  const [project, setProject] = useState<Project | null>(null);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // rename form
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renameSaving, setRenameSaving] = useState(false);

  // archive
  const [archiveConfirm, setArchiveConfirm] = useState(false);
  const [archiving, setArchiving] = useState(false);

  async function load() {
    try {
      const [projRes, keysRes] = await Promise.all([
        api<{ data: Project[] }>("/api/v1/projects"),
        api<{ data: ApiKey[] }>("/api/v1/keys"),
      ]);
      const found = projRes.data.find((p) => p.id === id) ?? null;
      setProject(found);
      setKeys(keysRes.data.filter((k) => k.project_id === id));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load project");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [id]);

  function startRename() {
    if (!project) return;
    setNewName(project.name);
    setNewSlug(project.slug);
    setRenameError(null);
    setRenaming(true);
  }

  async function saveRename(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setRenameSaving(true);
    setRenameError(null);
    try {
      await api<{ data: Project }>(
        "/api/v1/projects?id=" + encodeURIComponent(id),
        {
          method: "PATCH",
          body: JSON.stringify({ name: newName.trim(), slug: newSlug.trim() || undefined }),
        },
      );
      setRenaming(false);
      await load();
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : "Rename failed");
    } finally {
      setRenameSaving(false);
    }
  }

  async function doArchive() {
    setArchiving(true);
    try {
      await api("/api/v1/projects?id=" + encodeURIComponent(id), {
        method: "DELETE",
      });
      void navigate({ to: "/projects" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Archive failed");
      setArchiving(false);
      setArchiveConfirm(false);
    }
  }

  if (loading) {
    return (
      <AppShell>
        <div className="py-12 text-center text-sm text-muted">Loading…</div>
      </AppShell>
    );
  }

  if (!project) {
    return (
      <AppShell>
        <div className="space-y-4">
          <Link
            to="/projects"
            className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg"
          >
            <ArrowLeft className="size-3.5" /> Projects
          </Link>
          <p className="text-sm text-danger">
            {error ?? "Project not found or has been archived."}
          </p>
        </div>
      </AppShell>
    );
  }

  const s = project.stats;

  return (
    <AppShell>
      <div className="space-y-8">
        {/* Back + header */}
        <div className="space-y-3">
          <Link
            to="/projects"
            className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg"
          >
            <ArrowLeft className="size-3.5" /> Projects
          </Link>
          <div className="flex items-center gap-2.5">
            <FolderKanban className="size-5 text-subtle" />
            <div>
              <h1 className="text-2xl font-medium tracking-tight">{project.name}</h1>
              <p className="font-mono text-xs text-subtle">{project.slug}</p>
            </div>
          </div>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
        </div>

        {/* Stats overview */}
        <section className="space-y-3">
          <h2 className="text-sm font-medium">Overview</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="API Keys" value={String(s.keys)} />
            <Stat label="Calls (24 h)" value={fmt(s.calls_24h)} />
            <Stat label="Calls (total)" value={fmt(s.calls_total)} />
            <Stat label="Tokens (total)" value={fmtK(s.tokens_total)} />
          </div>
          {s.last_used_at ? (
            <p className="font-mono text-[10px] text-subtle">
              Last activity {new Date(s.last_used_at).toLocaleString()}
            </p>
          ) : (
            <p className="font-mono text-[10px] text-subtle">
              No API activity yet
            </p>
          )}
        </section>

        {/* Rename */}
        <section className="space-y-3 rounded-md bg-surface p-4 shadow-[var(--shadow-border)]">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">Settings</h2>
            {!renaming && (
              <Button type="button" variant="secondary" size="sm" onClick={startRename}>
                Rename
              </Button>
            )}
          </div>
          {renaming ? (
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => void saveRename(e)}
            >
              <div className="flex flex-col gap-1.5 sm:max-w-sm">
                <label className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                  Name
                </label>
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Project name"
                  required
                  autoFocus
                />
              </div>
              <div className="flex flex-col gap-1.5 sm:max-w-[220px]">
                <label className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                  Slug
                </label>
                <Input
                  value={newSlug}
                  onChange={(e) => setNewSlug(e.target.value)}
                  placeholder="project-slug"
                />
              </div>
              {renameError ? (
                <p className="text-sm text-danger">{renameError}</p>
              ) : null}
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={renameSaving || !newName.trim()}>
                  {renameSaving ? "Saving…" : "Save"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setRenaming(false)}
                  disabled={renameSaving}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <div className="space-y-1">
              <p className="text-sm">
                <span className="text-muted">Name: </span>
                <span>{project.name}</span>
              </p>
              <p className="text-sm">
                <span className="text-muted">Slug: </span>
                <span className="font-mono text-xs">{project.slug}</span>
              </p>
              <p className="text-sm">
                <span className="text-muted">Created: </span>
                <span className="font-mono text-xs">
                  {new Date(project.created_at).toLocaleString()}
                </span>
              </p>
            </div>
          )}
        </section>

        {/* Project API keys */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">API Keys</h2>
            <Link
              to="/keys"
              className="text-xs text-muted hover:text-fg"
            >
              Manage all keys
            </Link>
          </div>
          <div className="overflow-x-auto rounded-md bg-surface shadow-[var(--shadow-border)]">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead className="border-b border-border font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Prefix</th>
                  <th className="px-3 py-2">Created</th>
                  <th className="px-3 py-2">Last used</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id} className="border-b border-border/60">
                    <td className="px-3 py-2">{k.name}</td>
                    <td className="px-3 py-2 font-mono text-xs text-muted">
                      {k.prefix}…
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-muted">
                      {new Date(k.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-muted">
                      {k.last_used_at
                        ? relTime(k.last_used_at)
                        : "never"}
                    </td>
                  </tr>
                ))}
                {keys.length === 0 ? (
                  <tr>
                    <td
                      className="px-3 py-6 text-sm text-muted"
                      colSpan={4}
                    >
                      <div className="flex items-center gap-2">
                        <KeyRound className="size-4 shrink-0 text-subtle" />
                        <span>
                          No keys scoped to this project. Create keys on the{" "}
                          <Link to="/keys" className="underline underline-offset-2">
                            API Keys
                          </Link>{" "}
                          page.
                        </span>
                      </div>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        {/* Usage sparkline */}
        {s.calls_total > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-medium">Token distribution</h2>
            <div className="rounded-md bg-surface p-4 shadow-[var(--shadow-border)]">
              <InlineBar
                segments={[
                  { label: "Calls (24 h)", value: s.calls_24h, total: s.calls_total },
                  { label: "Remaining", value: s.calls_total - s.calls_24h, total: s.calls_total },
                ]}
              />
              <p className="mt-3 font-mono text-[10px] text-subtle">
                {fmt(s.calls_24h)} of {fmt(s.calls_total)} calls in the last 24 h
              </p>
            </div>
          </section>
        )}

        {/* Danger zone */}
        <section className="space-y-3 rounded-md border border-danger/30 bg-danger/5 p-4">
          <div className="flex items-center gap-2">
            <TriangleAlert className="size-4 text-danger" />
            <h2 className="text-sm font-medium text-danger">Danger zone</h2>
          </div>
          <p className="text-sm text-muted">
            Archiving a project hides it from this list but does not delete keys or usage
            data. This action cannot be undone from the console.
          </p>
          {archiveConfirm ? (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="danger"
                size="sm"
                disabled={archiving}
                onClick={() => void doArchive()}
              >
                {archiving ? "Archiving…" : "Confirm archive"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={archiving}
                onClick={() => setArchiveConfirm(false)}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="danger"
              size="sm"
              onClick={() => setArchiveConfirm(true)}
            >
              Archive project
            </Button>
          )}
        </section>
      </div>
    </AppShell>
  );
}

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

function InlineBar({
  segments,
}: {
  segments: { label: string; value: number; total: number }[];
}) {
  const total = Math.max(1, segments.reduce((a, s) => a + s.value, 0));
  const colors = ["bg-score", "bg-raised"];
  return (
    <div className="space-y-2">
      <div className="flex h-3 overflow-hidden rounded-full">
        {segments.map((seg, i) => (
          <div
            key={seg.label}
            className={colors[i % colors.length]}
            style={{ width: `${Math.round((seg.value / total) * 100)}%` }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {segments.map((seg, i) => (
          <div key={seg.label} className="flex items-center gap-1.5">
            <div
              className={`size-2 rounded-full ${colors[i % colors.length]}`}
            />
            <span className="font-mono text-[10px] text-subtle">
              {seg.label}: {fmt(seg.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function fmt(n: number) {
  return n.toLocaleString();
}

function fmtK(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

function relTime(ms: number) {
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
