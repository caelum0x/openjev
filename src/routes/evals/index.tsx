import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { EvalLabelImport } from "@/components/eval-label-import";
import type { ImportedCase } from "@/lib/jev/eval-import";
import type { Questions } from "@/lib/jev/types";
import { api } from "@/lib/jev/browser";
import { MODEL_CARDS } from "@/lib/jev/models";
import { pageHead } from "@/lib/seo/site";

// ---- types ------------------------------------------------------------------

type EvalRun = {
  id: string;
  decision_id: string | null;
  backend: string;
  model: string;
  total: number;
  passed: number;
  failed: number;
  created_at: number;
};

type SavedDecision = {
  id: string;
  name: string;
  project_id: string | null;
  questions?: Questions;
};

type Suite = "gold" | "custom" | "labels";

const SUITE_LABEL: Record<Suite, string> = {
  gold: "Gold (built-in)",
  custom: "Saved decision",
  labels: "Import labels (CSV)",
};

// ---- route ------------------------------------------------------------------

export const Route = createFileRoute("/evals/")({
  head: () => pageHead("Evals"),
  component: EvalsPage,
});

// ---- helpers ----------------------------------------------------------------

const PLAYGROUND_MODELS = MODEL_CARDS.filter((m) => m.playground);

function passColor(rate: number): string {
  if (rate >= 0.9) return "bg-score";
  if (rate >= 0.6) return "bg-noul";
  return "bg-danger";
}

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function PassBar({ passed, total }: { passed: number; total: number }) {
  const pct = total > 0 ? Math.round((passed / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-raised">
        <div
          className={`h-full rounded-full ${passColor(pct / 100)}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="font-mono text-xs tabular-nums text-muted">
        {passed}/{total}
      </span>
    </div>
  );
}

// ---- page -------------------------------------------------------------------

function EvalsPage() {
  const navigate = useNavigate();
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [decisions, setDecisions] = useState<SavedDecision[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // form state
  const [suite, setSuite] = useState<Suite>("gold");
  const [decisionId, setDecisionId] = useState<string>("");
  const [model, setModel] = useState("system-one");
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  async function load() {
    try {
      const [runsRes, decisionsRes] = await Promise.all([
        api<{ data: EvalRun[] }>("/api/v1/evals"),
        api<{ data: SavedDecision[] }>("/api/v1/decisions"),
      ]);
      setRuns(runsRes.data);
      setDecisions(decisionsRes.data);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function runEval(e: React.FormEvent) {
    e.preventDefault();
    setRunError(null);
    setRunning(true);
    try {
      const body: Record<string, unknown> = { model };
      if (suite === "custom" && decisionId) {
        body.decisionId = decisionId;
      }
      const res = await api<{ data: EvalRun }>("/api/v1/evals", {
        method: "POST",
        body: JSON.stringify(body),
      });
      await navigate({ to: "/evals/$id", params: { id: res.data.id } });
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Run failed");
      setRunning(false);
    }
  }

  async function runImport(input: { cases: ImportedCase[]; decisionId: string | null }) {
    setRunError(null);
    setRunning(true);
    try {
      const res = await api<{ data: EvalRun }>("/api/v1/evals", {
        method: "POST",
        body: JSON.stringify({ model, suite: "custom", decisionId: input.decisionId, cases: input.cases }),
      });
      await navigate({ to: "/evals/$id", params: { id: res.data.id } });
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Run failed");
      setRunning(false);
    }
  }

  return (
    <AppShell>
      <div className="space-y-8">
        <header className="space-y-2">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">
            Evals
          </p>
          <h1 className="text-2xl font-medium tracking-tight">Eval runs</h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            Run the built-in gold calibration suite, a saved decision, or your own
            labelled rows (CSV / JSONL) against any model. Results are stored; click a
            run to inspect per-case expected vs got, or fit a calibration from it.
          </p>
        </header>

        {/* new run form */}
        <section className="space-y-4 rounded-md bg-surface p-5 shadow-[var(--shadow-border)]">
          <h2 className="text-sm font-medium">New run</h2>
          <form onSubmit={(e) => void runEval(e)} className="space-y-4">
            {/* suite picker */}
            <div className="space-y-1.5">
              <label className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                Suite
              </label>
              <div className="flex gap-2">
                {(["gold", "custom", "labels"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      setSuite(s);
                      if (s !== "custom") setDecisionId("");
                    }}
                    className={`rounded-sm px-3 py-1.5 text-sm font-medium transition-colors duration-150 ${
                      suite === s
                        ? "bg-accent text-accent-fg shadow-[var(--shadow-border)]"
                        : "bg-raised text-muted hover:text-fg"
                    }`}
                  >
                    {SUITE_LABEL[s]}
                  </button>
                ))}
              </div>
            </div>

            {/* decision picker (custom only) */}
            {suite === "custom" ? (
              <div className="space-y-1.5">
                <label className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                  Decision
                </label>
                {decisions.length === 0 ? (
                  <p className="text-sm text-muted">
                    No saved decisions yet.{" "}
                    <Link
                      to="/system-one"
                      className="text-accent underline-offset-2 hover:underline"
                    >
                      Create one from the playground.
                    </Link>
                  </p>
                ) : (
                  <select
                    value={decisionId}
                    onChange={(e) => setDecisionId(e.target.value)}
                    className="h-11 w-full max-w-xs rounded-sm bg-inset px-3 text-sm text-fg shadow-[var(--shadow-border)] focus-visible:outline-none focus-visible:shadow-[var(--shadow-border-hover)]"
                    required
                  >
                    <option value="">— pick a decision —</option>
                    {decisions.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            ) : null}

            {/* model picker */}
            <div className="space-y-1.5">
              <label className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                Model
              </label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="h-11 w-full max-w-xs rounded-sm bg-inset px-3 text-sm text-fg shadow-[var(--shadow-border)] focus-visible:outline-none focus-visible:shadow-[var(--shadow-border-hover)]"
              >
                {PLAYGROUND_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>

            {suite === "labels" ? (
              <EvalLabelImport
                decisions={decisions}
                running={running}
                onRun={(input) => void runImport(input)}
              />
            ) : null}

            {runError ? (
              <p className="text-sm text-danger">{runError}</p>
            ) : null}

            {suite !== "labels" ? (
              <Button
                type="submit"
                disabled={running || (suite === "custom" && !decisionId)}
              >
                {running ? "Running…" : "Run eval"}
              </Button>
            ) : null}

            {running ? (
              <p className="text-xs text-muted">
                Running cases against the engine — this may take a few seconds.
              </p>
            ) : null}
          </form>
        </section>

        {/* runs list */}
        <section className="space-y-3">
          <h2 className="text-sm font-medium">History</h2>
          {loadError ? (
            <p className="text-sm text-danger">{loadError}</p>
          ) : null}
          <div className="overflow-x-auto rounded-md bg-surface shadow-[var(--shadow-border)]">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="border-b border-border font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Model</th>
                  <th className="px-3 py-2">Backend</th>
                  <th className="px-3 py-2">Pass rate</th>
                  <th className="px-3 py-2 text-right">Cases</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr
                    key={r.id}
                    className="cursor-pointer border-b border-border/60 hover:bg-raised/40"
                    onClick={() =>
                      void navigate({ to: "/evals/$id", params: { id: r.id } })
                    }
                  >
                    <td className="px-3 py-2.5 font-mono text-xs text-muted">
                      {fmtDate(r.created_at)}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs">{r.model}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-muted">
                      {r.backend}
                    </td>
                    <td className="px-3 py-2.5">
                      <PassBar passed={r.passed} total={r.total} />
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs text-muted">
                      {r.total}
                    </td>
                  </tr>
                ))}
                {runs.length === 0 && !loadError ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-3 py-6 text-sm text-muted"
                    >
                      {loaded
                        ? "No eval runs yet. Run the gold suite to calibrate the model."
                        : "Loading eval runs…"}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
