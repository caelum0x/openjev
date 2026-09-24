import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/input";
import { api } from "@/lib/jev/browser";
import {
  ArrowLeft,
  Save,
  Play,
  ChevronDown,
  ChevronRight,
  RotateCcw,
} from "lucide-react";
import type { Answer, ChoiceAnswer, NoulAnswer, ScoreAnswer } from "@/lib/jev/types";
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

type RunResult = {
  decisionId: string;
  version: number;
  model: string;
  response: {
    model: string;
    answers: Record<string, Answer>;
    usage: { input_tokens: number; output_tokens: number };
    latency_ms: number;
  };
};

type Project = { id: string; name: string };

// ── Route ────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/decisions/$id")({
  head: () => pageHead("Decision"),
  component: DecisionEditorPage,
});

// ── Page ─────────────────────────────────────────────────────────────────────

function DecisionEditorPage() {
  const { id } = Route.useParams();

  const [decision, setDecision] = useState<SavedDecision | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // editor fields
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState("");
  const [stateText, setStateText] = useState("");
  const [questionsText, setQuestionsText] = useState("");

  // dirty tracking
  const savedRef = useRef<{ name: string; description: string; projectId: string; stateText: string; questionsText: string } | null>(null);

  // save
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);

  // run
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [runStateText, setRunStateText] = useState<string>("");
  const [showRunPanel, setShowRunPanel] = useState(false);
  const [useCustomState, setUseCustomState] = useState(false);

  // version history panel
  const [showHistory, setShowHistory] = useState(false);

  async function load() {
    try {
      const [dRes, pRes] = await Promise.all([
        api<{ data: SavedDecision }>("/api/v1/decisions?id=" + encodeURIComponent(id)),
        api<{ data: Project[] }>("/api/v1/projects"),
      ]);
      const d = dRes.data;
      setDecision(d);
      setProjects(pRes.data);
      const st = pretty(d.state);
      const qt = pretty(d.questions);
      setName(d.name);
      setDescription(d.description ?? "");
      setProjectId(d.project_id ?? "");
      setStateText(st);
      setQuestionsText(qt);
      setRunStateText(st);
      savedRef.current = {
        name: d.name,
        description: d.description ?? "",
        projectId: d.project_id ?? "",
        stateText: st,
        questionsText: qt,
      };
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load decision");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [id]);

  const isDirty = savedRef.current !== null && (
    name !== savedRef.current.name ||
    description !== savedRef.current.description ||
    projectId !== savedRef.current.projectId ||
    stateText !== savedRef.current.stateText ||
    questionsText !== savedRef.current.questionsText
  );

  async function save(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setSaveError(null);
    setSaveOk(false);
    let state: unknown;
    let questions: unknown;
    try {
      state = JSON.parse(stateText);
    } catch {
      setSaveError("State is not valid JSON");
      return;
    }
    try {
      questions = JSON.parse(questionsText);
    } catch {
      setSaveError("Questions is not valid JSON");
      return;
    }
    if (!name.trim()) {
      setSaveError("Name is required");
      return;
    }
    setSaving(true);
    try {
      const res = await api<{ data: SavedDecision }>(
        "/api/v1/decisions?id=" + encodeURIComponent(id),
        {
          method: "PATCH",
          body: JSON.stringify({
            name: name.trim(),
            description: description.trim() || null,
            projectId: projectId || null,
            state,
            questions,
          }),
        },
      );
      const d = res.data;
      setDecision(d);
      const st = pretty(d.state);
      const qt = pretty(d.questions);
      setStateText(st);
      setQuestionsText(qt);
      savedRef.current = {
        name: d.name,
        description: d.description ?? "",
        projectId: d.project_id ?? "",
        stateText: st,
        questionsText: qt,
      };
      setSaveOk(true);
      setTimeout(() => setSaveOk(false), 2000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function run() {
    setRunError(null);
    setRunning(true);
    setRunResult(null);
    let stateOverride: unknown = undefined;
    if (useCustomState) {
      try {
        stateOverride = JSON.parse(runStateText);
      } catch {
        setRunError("Run state is not valid JSON");
        setRunning(false);
        return;
      }
    }
    try {
      const body: Record<string, unknown> = { id };
      if (stateOverride !== undefined) body.state = stateOverride;
      const res = await api<{ data: RunResult }>(
        "/api/v1/decisions?id=" + encodeURIComponent(id),
        {
          method: "POST",
          body: JSON.stringify(body),
        },
      );
      setRunResult(res.data);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Run failed");
    } finally {
      setRunning(false);
    }
  }

  function resetToSaved() {
    if (!savedRef.current) return;
    setName(savedRef.current.name);
    setDescription(savedRef.current.description);
    setProjectId(savedRef.current.projectId);
    setStateText(savedRef.current.stateText);
    setQuestionsText(savedRef.current.questionsText);
    setSaveError(null);
  }

  if (loading) {
    return (
      <AppShell>
        <div className="py-20 text-center text-sm text-muted">Loading…</div>
      </AppShell>
    );
  }

  if (loadError || !decision) {
    return (
      <AppShell>
        <div className="space-y-4">
          <Link
            to="/decisions"
            className="flex items-center gap-1 text-sm text-muted hover:text-fg"
          >
            <ArrowLeft className="size-3.5" /> Back to decisions
          </Link>
          <p className="text-sm text-danger">{loadError ?? "Decision not found"}</p>
        </div>
      </AppShell>
    );
  }

  const questionKeys = (() => {
    try {
      const q = JSON.parse(questionsText);
      if (typeof q === "object" && q !== null && !Array.isArray(q)) {
        return Object.keys(q as Record<string, unknown>);
      }
    } catch {
      // invalid JSON — ignore
    }
    return [];
  })();

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Breadcrumb */}
        <Link
          to="/decisions"
          className="flex items-center gap-1 text-sm text-muted hover:text-fg"
        >
          <ArrowLeft className="size-3.5" /> Decisions
        </Link>

        {/* Header */}
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">
              Decision
            </p>
            <h1 className="text-2xl font-medium tracking-tight">{decision.name}</h1>
            <p className="font-mono text-[11px] text-subtle">
              v{decision.version} · updated {relTime(decision.updated_at)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {isDirty ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={resetToSaved}
              >
                <RotateCcw className="size-3.5" />
                Revert
              </Button>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setShowRunPanel((v) => !v)}
            >
              <Play className="size-3.5" />
              Test run
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={saving || !isDirty}
              onClick={() => void save()}
            >
              <Save className="size-3.5" />
              {saving ? "Saving…" : saveOk ? "Saved" : "Save"}
            </Button>
          </div>
        </header>

        {saveError ? <p className="text-sm text-danger">{saveError}</p> : null}

        {/* Editor */}
        <form onSubmit={(e) => void save(e)} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                Name
              </label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            {projects.length > 0 ? (
              <div className="space-y-1.5">
                <label className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                  Project
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
              Description
            </label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
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
                className="min-h-56 font-mono text-xs"
                spellCheck={false}
              />
            </div>
            <div className="space-y-1.5">
              <label className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                Questions (JSON) — {questionKeys.length} question{questionKeys.length !== 1 ? "s" : ""}
              </label>
              <Textarea
                value={questionsText}
                onChange={(e) => setQuestionsText(e.target.value)}
                className="min-h-56 font-mono text-xs"
                spellCheck={false}
              />
            </div>
          </div>
        </form>

        {/* Questions schema preview */}
        {questionKeys.length > 0 ? (
          <section className="space-y-3">
            <h2 className="text-sm font-medium">Schema preview</h2>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {questionKeys.map((key) => {
                let qType = "unknown";
                try {
                  const q = JSON.parse(questionsText) as Record<string, { type?: string }>;
                  qType = q[key]?.type ?? "unknown";
                } catch {
                  // invalid JSON — ignore
                }
                return <QuestionChip key={key} qkey={key} type={qType} />;
              })}
            </div>
          </section>
        ) : null}

        {/* Version history */}
        <section className="rounded-md bg-surface shadow-[var(--shadow-border)]">
          <button
            type="button"
            className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium hover:bg-raised/40"
            onClick={() => setShowHistory((v) => !v)}
          >
            <span>Version history</span>
            {showHistory ? (
              <ChevronDown className="size-4 text-subtle" />
            ) : (
              <ChevronRight className="size-4 text-subtle" />
            )}
          </button>
          {showHistory ? (
            <div className="border-t border-border/60 px-4 py-3">
              <p className="text-sm text-muted">
                Currently at version{" "}
                <span className="font-mono text-fg">v{decision.version}</span>. Every
                save bumps the version. Full audit via{" "}
                <Link
                  to="/logs"
                  className="text-accent underline-offset-2 hover:underline"
                >
                  Logs
                </Link>
                .
              </p>
              <div className="mt-3 space-y-1.5">
                <HistoryRow
                  label={`v${decision.version} (current)`}
                  ts={decision.updated_at}
                  isCurrent
                />
                {decision.version > 1 ? (
                  <p className="font-mono text-[10px] text-subtle">
                    Earlier versions are tracked in the activity log.
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
        </section>

        {/* Test run panel */}
        {showRunPanel ? (
          <section className="space-y-4 rounded-md bg-surface p-5 shadow-[var(--shadow-border)]">
            <h2 className="text-sm font-medium">Test run</h2>
            <p className="text-xs text-muted">
              Run the saved questions against a state. By default uses the stored
              state; override below to test a different input.
            </p>

            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-muted">
                <input
                  type="checkbox"
                  checked={useCustomState}
                  onChange={(e) => setUseCustomState(e.target.checked)}
                  className="h-4 w-4 accent-[var(--color-accent)]"
                />
                Override state
              </label>
            </div>

            {useCustomState ? (
              <div className="space-y-1.5">
                <label className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                  State override (JSON)
                </label>
                <Textarea
                  value={runStateText}
                  onChange={(e) => setRunStateText(e.target.value)}
                  className="min-h-28 font-mono text-xs"
                  spellCheck={false}
                />
              </div>
            ) : null}

            {runError ? (
              <p className="text-sm text-danger">{runError}</p>
            ) : null}

            <Button
              type="button"
              onClick={() => void run()}
              disabled={running}
            >
              <Play className="size-3.5" />
              {running ? "Running…" : "Run now"}
            </Button>

            {running ? (
              <p className="text-xs text-muted">
                Calling System One — may take a moment…
              </p>
            ) : null}

            {runResult ? <RunResultPanel result={runResult} /> : null}
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function QuestionChip({ qkey, type }: { qkey: string; type: string }) {
  const color =
    type === "choice"
      ? "text-accent"
      : type === "score"
        ? "text-score"
        : type === "noul"
          ? "text-noul"
          : "text-subtle";
  return (
    <div className="flex items-center gap-2 rounded-sm bg-raised px-3 py-2">
      <span className={`font-mono text-[10px] uppercase ${color}`}>{type}</span>
      <span className="truncate font-mono text-xs text-fg">{qkey}</span>
    </div>
  );
}

function HistoryRow({
  label,
  ts,
  isCurrent,
}: {
  label: string;
  ts: number;
  isCurrent?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span
        className={`text-sm ${isCurrent ? "font-medium" : "text-muted"}`}
      >
        {label}
      </span>
      <span className="font-mono text-[10px] text-subtle">
        {new Date(ts).toLocaleString()}
      </span>
    </div>
  );
}

function RunResultPanel({ result }: { result: RunResult }) {
  const answers = result.response.answers;
  const keys = Object.keys(answers);

  return (
    <div className="space-y-4 rounded-md bg-raised p-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-border/60 pb-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
          Model
        </span>
        <span className="font-mono text-xs">{result.model}</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
          Latency
        </span>
        <span className="font-mono text-xs">{result.response.latency_ms} ms</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
          Tokens
        </span>
        <span className="font-mono text-xs">
          {result.response.usage.input_tokens}+{result.response.usage.output_tokens}
        </span>
      </div>

      <div className="space-y-3">
        {keys.map((key) => (
          <AnswerCard key={key} qkey={key} answer={answers[key]} />
        ))}
      </div>
    </div>
  );
}

function AnswerCard({ qkey, answer }: { qkey: string; answer: Answer }) {
  if (answer.type === "choice") {
    return <ChoiceCard qkey={qkey} answer={answer as ChoiceAnswer} />;
  }
  if (answer.type === "score") {
    return <ScoreCard qkey={qkey} answer={answer as ScoreAnswer} />;
  }
  if (answer.type === "noul") {
    return <NoulCard qkey={qkey} answer={answer as NoulAnswer} />;
  }
  return null;
}

function ChoiceCard({ qkey, answer }: { qkey: string; answer: ChoiceAnswer }) {
  const entries = Object.entries(answer.probabilities).sort(([, a], [, b]) => b - a);
  const max = Math.max(...entries.map(([, v]) => v), 0.001);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] uppercase text-accent">choice</span>
        <span className="font-mono text-xs text-fg">{qkey}</span>
        <span className="ml-auto font-mono text-xs font-medium">{answer.choice}</span>
      </div>
      <div className="space-y-1">
        {entries.map(([label, prob]) => (
          <div key={label} className="flex items-center gap-2">
            <span
              className={`w-24 shrink-0 truncate font-mono text-[10px] ${label === answer.choice ? "text-fg" : "text-subtle"}`}
            >
              {label}
            </span>
            <div className="flex-1 overflow-hidden rounded-full bg-surface" style={{ height: 6 }}>
              <div
                className={`h-full rounded-full ${label === answer.choice ? "bg-accent/70" : "bg-raised"}`}
                style={{ width: `${Math.round((prob / max) * 100)}%` }}
              />
            </div>
            <span className="w-10 text-right font-mono text-[10px] text-subtle">
              {pct(prob)}
            </span>
          </div>
        ))}
      </div>
      <p className="font-mono text-[10px] text-subtle">
        confidence {pct(answer.confidence)}
      </p>
    </div>
  );
}

function ScoreCard({ qkey, answer }: { qkey: string; answer: ScoreAnswer }) {
  const entries = Object.entries(answer.probabilities).sort(
    ([a], [b]) => Number(a) - Number(b),
  );
  const max = Math.max(...entries.map(([, v]) => v), 0.001);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] uppercase text-score">score</span>
        <span className="font-mono text-xs text-fg">{qkey}</span>
        <span className="ml-auto font-mono text-lg font-medium tabular-nums">
          {answer.score.toFixed(2)}
        </span>
      </div>
      <div className="space-y-1">
        {entries.map(([label, prob]) => (
          <div key={label} className="flex items-center gap-2">
            <span className="w-5 shrink-0 font-mono text-[10px] text-subtle">{label}</span>
            <div className="flex-1 overflow-hidden rounded-full bg-surface" style={{ height: 6 }}>
              <div
                className="h-full rounded-full bg-score/60"
                style={{ width: `${Math.round((prob / max) * 100)}%` }}
              />
            </div>
            <span className="w-10 text-right font-mono text-[10px] text-subtle">
              {pct(prob)}
            </span>
          </div>
        ))}
      </div>
      <p className="font-mono text-[10px] text-subtle">
        confidence {pct(answer.confidence)}
      </p>
    </div>
  );
}

function NoulCard({ qkey, answer }: { qkey: string; answer: NoulAnswer }) {
  const val = answer.noul;
  const pctVal = Math.round(val * 100);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] uppercase text-noul">noul</span>
        <span className="font-mono text-xs text-fg">{qkey}</span>
        <span className="ml-auto font-mono text-lg font-medium tabular-nums">
          {val.toFixed(3)}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span className="font-mono text-[10px] text-subtle">false</span>
        <div
          className="relative flex-1 overflow-hidden rounded-full bg-surface"
          style={{ height: 8 }}
        >
          <div
            className="h-full rounded-full bg-noul/70"
            style={{ width: `${pctVal}%` }}
          />
        </div>
        <span className="font-mono text-[10px] text-subtle">true</span>
      </div>
      <p className="font-mono text-[10px] text-subtle">{pctVal}% probability of true</p>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function pretty(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function pct(n: number): string {
  return (n * 100).toFixed(1) + "%";
}

function relTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  const days = Math.floor(diff / 86_400_000);
  return `${days}d ago`;
}
