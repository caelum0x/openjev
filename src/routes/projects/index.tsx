import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/jev/browser";
import { FolderKanban, ArrowRight, Archive } from "lucide-react";
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

export const Route = createFileRoute("/projects/")({
  head: () => pageHead("Projects"),
  component: ProjectsPage,
});

function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // create form
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // archive confirm
  const [archiving, setArchiving] = useState<string | null>(null);

  async function load() {
    try {
      const res = await api<{ data: Project[] }>("/api/v1/projects");
      setProjects(res.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load projects");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      await api<{ data: Project }>("/api/v1/projects", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), slug: slug.trim() || undefined }),
      });
      setName("");
      setSlug("");
      await load();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setCreating(false);
    }
  }

  async function archive(id: string) {
    setArchiving(id);
    try {
      await api("/api/v1/projects?id=" + encodeURIComponent(id), {
        method: "DELETE",
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Archive failed");
    } finally {
      setArchiving(null);
    }
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <header className="space-y-2">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">
            Projects
          </p>
          <h1 className="text-2xl font-medium tracking-tight">Organize work</h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            Group API keys and usage by project. Each project tracks calls, tokens, and
            key activity independently.
          </p>
        </header>

        <form
          className="flex flex-col gap-2 sm:flex-row sm:items-end"
          onSubmit={(e) => void create(e)}
        >
          <div className="flex flex-col gap-1.5 sm:max-w-xs">
            <label className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
              Name
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My project"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5 sm:max-w-[180px]">
            <label className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
              Slug (optional)
            </label>
            <Input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="my-project"
            />
          </div>
          <Button type="submit" disabled={creating || !name.trim()}>
            {creating ? "Creating…" : "New project"}
          </Button>
        </form>

        {createError ? (
          <p className="text-sm text-danger">{createError}</p>
        ) : null}

        {error ? <p className="text-sm text-danger">{error}</p> : null}

        {loading ? (
          <div className="py-10 text-center text-sm text-muted">Loading…</div>
        ) : projects.length === 0 ? (
          <div className="rounded-md bg-surface px-6 py-10 text-center shadow-[var(--shadow-border)]">
            <FolderKanban className="mx-auto mb-3 size-8 text-subtle" />
            <p className="text-sm text-muted">
              No projects yet. Create one to start grouping keys and usage.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <ProjectCard
                key={p.id}
                project={p}
                archiving={archiving === p.id}
                onArchive={() => void archive(p.id)}
              />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function ProjectCard({
  project: p,
  archiving,
  onArchive,
}: {
  project: Project;
  archiving: boolean;
  onArchive: () => void;
}) {
  const [confirmArchive, setConfirmArchive] = useState(false);

  return (
    <div className="group relative flex flex-col rounded-md bg-surface p-4 shadow-[var(--shadow-border)]">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium">{p.name}</p>
          <p className="font-mono text-[11px] text-subtle">{p.slug}</p>
        </div>
        <FolderKanban className="mt-0.5 size-4 shrink-0 text-subtle" />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-x-4 gap-y-2">
        <MiniStat label="Keys" value={String(p.stats.keys)} />
        <MiniStat label="Calls 24 h" value={fmt(p.stats.calls_24h)} />
        <MiniStat label="Calls total" value={fmt(p.stats.calls_total)} />
        <MiniStat label="Tokens" value={fmtK(p.stats.tokens_total)} />
      </div>

      {p.stats.last_used_at ? (
        <p className="mb-3 font-mono text-[10px] text-subtle">
          Last used {relTime(p.stats.last_used_at)}
        </p>
      ) : (
        <p className="mb-3 font-mono text-[10px] text-subtle">No usage yet</p>
      )}

      <div className="mt-auto flex items-center justify-between gap-2">
        <Link
          to="/projects/$id"
          params={{ id: p.id }}
          className="flex items-center gap-1 text-sm text-muted hover:text-fg"
        >
          View <ArrowRight className="size-3.5" />
        </Link>

        {confirmArchive ? (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted">Archive?</span>
            <Button
              type="button"
              variant="danger"
              size="sm"
              disabled={archiving}
              onClick={onArchive}
            >
              {archiving ? "…" : "Yes"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setConfirmArchive(false)}
            >
              No
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setConfirmArchive(true)}
            className="opacity-0 transition-opacity group-hover:opacity-100"
          >
            <Archive className="size-3.5" />
            Archive
          </Button>
        )}
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-subtle">
        {label}
      </p>
      <p className="font-mono text-sm tabular-nums">{value}</p>
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
