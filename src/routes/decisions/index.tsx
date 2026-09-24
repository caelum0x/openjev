import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/input";
import { api } from "@/lib/jev/browser";
import { Boxes, ArrowRight, Trash2, Copy, Plus } from "lucide-react";
import { pageHead } from "@/lib/seo/site";

// ── Types ────────────────────────────────────────────────────────────────────

type SavedDecision = {
  id: string;
  project_id: string | null;
  name: string;
  description: string | null;
  state: unknown;
  questions: unknown;
  version: number;
  created_at: number;
  updated_at: number;
};

type Project = { id: string; name: string; slug: string };

// ── Route ────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/decisions/")({
  head: () => pageHead("Decisions"),
  component: DecisionsPage,
});

// ── Page ─────────────────────────────────────────────────────────────────────

const STARTER_STATE = `{
  "text": "This is the input the model will reason about."
}`;

const STARTER_QUESTIONS = `{
  "sentiment": {
    "type": "choice",
    "instructions": "What is the overall sentiment?",
    "criteria": {
      "positive": "Clearly optimistic, enthusiastic, or favorable",
      "neutral": "Neither positive nor negative",
      "negative": "Pessimistic, critical, or unfavorable"
    }
  },
  "confidence": {
    "type": "score",
    "instructions": "How confident are you in the answer?",
    "criteria": ["Very uncertain", "Somewhat uncertain", "Neutral", "Fairly confident", "Very confident"]
  }
}`;

function DecisionsPage() {
  const navigate = useNavigate();
  const [decisions, setDecisions] = useState<SavedDecision[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // create form
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState<string>("");
  const [stateText, setStateText] = useState(STARTER_STATE);
  const [questionsText, setQuestionsText] = useState(STARTER_QUESTIONS);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // delete confirm
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // duplicate in flight
  const [duplicating, setDuplicating] = useState<string | null>(null);

  async function load() {
    try {
      const [dRes, pRes] = await Promise.all([
        api<{ data: SavedDecision[] }>("/api/v1/decisions"),
        api<{ data: Project[] }>("/api/v1/projects"),
      ]);
      setDecisions(dRes.data);
      setProjects(pRes.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load decisions");
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
    setCreateError(null);
    let state: unknown;
    let questions: unknown;
    try {
      state = JSON.parse(stateText);
    } catch {
      setCreateError("State is not valid JSON");
      return;
    }
    try {
      questions = JSON.parse(questionsText);
    } catch {
      setCreateError("Questions is not valid JSON");
      return;
    }
    setCreating(true);
    try {
      const res = await api<{ data: SavedDecision }>("/api/v1/decisions", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          projectId: projectId || null,
          state,
          questions,
        }),
      });
      setShowForm(false);
      setName("");
      setDescription("");
      setProjectId("");
      setStateText(STARTER_STATE);
      setQuestionsText(STARTER_QUESTIONS);
      await navigate({ to: "/decisions/$id", params: { id: res.data.id } });
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setCreating(false);
    }
  }

  async function duplicate(d: SavedDecision) {
    setDuplicating(d.id);
    try {
      const res = await api<{ data: SavedDecision }>("/api/v1/decisions", {
        method: "POST",
        body: JSON.stringify({
          name: `${d.name} (copy)`,
          description: d.description,
          projectId: d.project_id,
          state: d.state,
          questions: d.questions,
        }),
      });
      await navigate({ to: "/decisions/$id", params: { id: res.data.id } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Duplicate failed");
      setDuplicating(null);
    }
  }

  async function del(id: string) {
    setDeleting(id);
    try {
      await api("/api/v1/decisions?id=" + encodeURIComponent(id), {
        method: "DELETE",
      });
      setConfirmDelete(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header */}
        <header className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">
              Decisions
            </p>
            <h1 className="text-2xl font-medium tracking-tight">Decision library</h1>
            <p className="max-w-2xl text-sm leading-relaxed text-muted">
              Save System One schemas — a named state + typed questions pair — then
              re-run, version, or share them across projects.
            </p>
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setShowForm((v) => !v)}
            className="shrink-0"
          >
            <Plus className="size-3.5" />
            New decision
          </Button>
        </header>

        {error ? <p className="text-sm text-danger">{error}</p> : null}

        {/* Create form */}
        {showForm ? (
          <section className="space-y-4 rounded-md bg-surface p-5 shadow-[var(--shadow-border)]">
            <h2 className="text-sm font-medium">New decision</h2>
            <form onSubmit={(e) => void create(e)} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                    Name
                  </label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Sentiment classifier"
                    required
                  />
                </div>
                {projects.length > 0 ? (
                  <div className="space-y-1.5">
                    <label className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                      Project (optional)
                    </label>
                    <select
                      value={projectId}
                      onChange={(e) => setProjectId(e.target.value)}
                      className="h-11 w-full rounded-sm bg-inset px-3 text-sm text-fg shadow-[var(--shadow-border)] focus-visible:outline-none focus-visible:shadow-[var(--shadow-border-hover)]"
                    >
                      <option value="">— none —</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <label className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                  Description (optional)
                </label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What does this decision do?"
                />
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                    State (JSON)
                  </label>
                  <Textarea
                    value={stateText}
                    onChange={(e) => setStateText(e.target.value)}
                    className="min-h-36 font-mono text-xs"
                    spellCheck={false}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                    Questions (JSON)
                  </label>
                  <Textarea
                    value={questionsText}
                    onChange={(e) => setQuestionsText(e.target.value)}
                    className="min-h-36 font-mono text-xs"
                    spellCheck={false}
                  />
                </div>
              </div>

              {createError ? (
                <p className="text-sm text-danger">{createError}</p>
              ) : null}

              <div className="flex gap-2">
                <Button type="submit" disabled={creating || !name.trim()}>
                  {creating ? "Saving…" : "Save decision"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setShowForm(false);
                    setCreateError(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </section>
        ) : null}

        {/* List */}
        {loading ? (
          <div className="py-10 text-center text-sm text-muted">Loading…</div>
        ) : decisions.length === 0 ? (
          <div className="rounded-md bg-surface px-6 py-10 text-center shadow-[var(--shadow-border)]">
            <Boxes className="mx-auto mb-3 size-8 text-subtle" />
            <p className="text-sm text-muted">
              No decisions yet. Create one to save a reusable System One schema.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {decisions.map((d) => {
              const qCount = Object.keys(
                typeof d.questions === "object" && d.questions !== null
                  ? (d.questions as Record<string, unknown>)
                  : {},
              ).length;
              const proj = projects.find((p) => p.id === d.project_id);
              return (
                <div
                  key={d.id}
                  className="group relative flex flex-col rounded-md bg-surface p-4 shadow-[var(--shadow-border)]"
                >
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{d.name}</p>
                      {d.description ? (
                        <p className="mt-0.5 truncate text-xs text-muted">
                          {d.description}
                        </p>
                      ) : null}
                    </div>
                    <Boxes className="mt-0.5 size-4 shrink-0 text-subtle" />
                  </div>

                  <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1">
                    <span className="font-mono text-[10px] text-subtle">
                      v{d.version}
                    </span>
                    <span className="font-mono text-[10px] text-subtle">
                      {qCount} question{qCount !== 1 ? "s" : ""}
                    </span>
                    {proj ? (
                      <span className="font-mono text-[10px] text-subtle">
                        {proj.name}
                      </span>
                    ) : null}
                  </div>

                  <p className="mb-4 font-mono text-[10px] text-subtle">
                    Updated {relTime(d.updated_at)}
                  </p>

                  <div className="mt-auto flex items-center justify-between gap-2">
                    <Link
                      to="/decisions/$id"
                      params={{ id: d.id }}
                      className="flex items-center gap-1 text-sm text-muted hover:text-fg"
                    >
                      Edit <ArrowRight className="size-3.5" />
                    </Link>

                    <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={duplicating === d.id}
                        onClick={() => void duplicate(d)}
                        title="Duplicate"
                      >
                        <Copy className="size-3.5" />
                      </Button>

                      {confirmDelete === d.id ? (
                        <>
                          <span className="text-xs text-muted">Delete?</span>
                          <Button
                            type="button"
                            variant="danger"
                            size="sm"
                            disabled={deleting === d.id}
                            onClick={() => void del(d.id)}
                          >
                            {deleting === d.id ? "…" : "Yes"}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setConfirmDelete(null)}
                          >
                            No
                          </Button>
                        </>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setConfirmDelete(d.id)}
                          title="Delete"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function relTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  const days = Math.floor(diff / 86_400_000);
  return `${days}d ago`;
}
