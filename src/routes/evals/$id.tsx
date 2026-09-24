import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { ReliabilityChart } from "@/components/reliability-chart";
import { ThresholdPicker } from "@/components/threshold-picker";
import { api } from "@/lib/jev/browser";
import { buildReliability } from "@/lib/jev/calibration";
import { evalRunSamples, pooledSamples } from "@/lib/jev/eval-samples";
import type { Answer, ChoiceAnswer, NoulAnswer, ScoreAnswer } from "@/lib/jev/types";
import { pageHead } from "@/lib/seo/site";

// ---- types ------------------------------------------------------------------

type GoldExpect = {
  choice?: { id: string; value: string; minP?: number };
  noul?: { id: string; min?: number; max?: number };
  score?: { id: string; min: number; max: number };
};

type EvalCaseResult = {
  id: string;
  name: string;
  pass: boolean;
  expected: GoldExpect[];
  got: Record<string, Answer>;
};

type EvalRunDetail = {
  id: string;
  decision_id: string | null;
  backend: string;
  model: string;
  total: number;
  passed: number;
  failed: number;
  created_at: number;
  cases: EvalCaseResult[];
};

// ---- route ------------------------------------------------------------------

export const Route = createFileRoute("/evals/$id")({
  head: () => pageHead("Eval run"),
  component: EvalDetailPage,
});

// ---- helpers ----------------------------------------------------------------

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function PassBadge({ pass }: { pass: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] ${
        pass
          ? "bg-score/15 text-score"
          : "bg-danger/15 text-danger"
      }`}
    >
      {pass ? "pass" : "fail"}
    </span>
  );
}

function AnswerCell({ id, answer }: { id: string; answer: Answer | undefined }) {
  if (!answer) {
    return <span className="font-mono text-xs text-subtle">—</span>;
  }
  if (answer.type === "choice") {
    const a = answer as ChoiceAnswer;
    const topP = a.probabilities[a.choice] ?? 0;
    return (
      <span className="font-mono text-xs">
        <span className="text-accent">{a.choice}</span>
        <span className="ml-1.5 text-subtle">
          p={topP.toFixed(2)} conf={a.confidence.toFixed(2)}
        </span>
      </span>
    );
  }
  if (answer.type === "noul") {
    const a = answer as NoulAnswer;
    return (
      <span className="font-mono text-xs">
        <span className="text-noul">{a.noul.toFixed(3)}</span>
      </span>
    );
  }
  if (answer.type === "score") {
    const a = answer as ScoreAnswer;
    return (
      <span className="font-mono text-xs">
        <span className="text-score">{a.score.toFixed(3)}</span>
        <span className="ml-1.5 text-subtle">conf={a.confidence.toFixed(2)}</span>
      </span>
    );
  }
  return <span className="font-mono text-xs text-subtle">unknown</span>;
}

function ExpectCell({ expects }: { expects: GoldExpect[] }) {
  if (expects.length === 0) {
    return <span className="font-mono text-xs text-subtle">—</span>;
  }
  return (
    <div className="space-y-0.5">
      {expects.map((e, i) => {
        if (e.choice) {
          const min = e.choice.minP != null ? ` minP=${e.choice.minP}` : "";
          return (
            <p key={i} className="font-mono text-xs">
              <span className="text-subtle">{e.choice.id}=</span>
              <span className="text-accent">{e.choice.value}</span>
              {min ? <span className="text-subtle">{min}</span> : null}
            </p>
          );
        }
        if (e.noul) {
          const parts: string[] = [];
          if (e.noul.min != null) parts.push(`min=${e.noul.min}`);
          if (e.noul.max != null) parts.push(`max=${e.noul.max}`);
          return (
            <p key={i} className="font-mono text-xs">
              <span className="text-subtle">{e.noul.id}</span>
              {parts.length > 0 ? (
                <span className="text-noul"> [{parts.join(", ")}]</span>
              ) : null}
            </p>
          );
        }
        if (e.score) {
          return (
            <p key={i} className="font-mono text-xs">
              <span className="text-subtle">{e.score.id}</span>
              <span className="text-score">
                {" "}
                [{e.score.min}, {e.score.max}]
              </span>
            </p>
          );
        }
        return null;
      })}
    </div>
  );
}

function GotCell({ expects, got }: { expects: GoldExpect[]; got: Record<string, Answer> }) {
  const ids = new Set<string>();
  for (const e of expects) {
    if (e.choice) ids.add(e.choice.id);
    if (e.noul) ids.add(e.noul.id);
    if (e.score) ids.add(e.score.id);
  }
  // If no expectations declared, show all answers
  const keys = ids.size > 0 ? Array.from(ids) : Object.keys(got);
  if (keys.length === 0) {
    return <span className="font-mono text-xs text-subtle">—</span>;
  }
  return (
    <div className="space-y-0.5">
      {keys.map((id) => (
        <div key={id} className="flex gap-1.5 font-mono text-xs">
          <span className="shrink-0 text-subtle">{id}</span>
          <AnswerCell id={id} answer={got[id]} />
        </div>
      ))}
    </div>
  );
}

// inline SVG pass-rate gauge
function PassGauge({ passed, total }: { passed: number; total: number }) {
  const pct = total > 0 ? passed / total : 0;
  const r = 20;
  const circ = 2 * Math.PI * r;
  const dash = circ * pct;
  const color = pct >= 0.9 ? "var(--color-score)" : pct >= 0.6 ? "var(--color-noul)" : "var(--color-danger)";
  return (
    <div className="flex items-center gap-3">
      <svg width="52" height="52" viewBox="0 0 52 52" aria-hidden="true">
        <circle cx="26" cy="26" r={r} fill="none" strokeWidth="6" stroke="var(--color-border)" />
        <circle
          cx="26"
          cy="26"
          r={r}
          fill="none"
          strokeWidth="6"
          stroke={color}
          strokeDasharray={`${dash} ${circ - dash}`}
          strokeLinecap="round"
          transform="rotate(-90 26 26)"
        />
      </svg>
      <div>
        <p className="font-mono text-2xl tabular-nums tracking-tight">
          {passed}/{total}
        </p>
        <p className="font-mono text-xs text-subtle">
          {total > 0 ? Math.round(pct * 100) : 0}% passed
        </p>
      </div>
    </div>
  );
}

// ---- page -------------------------------------------------------------------

function EvalDetailPage() {
  const { id } = Route.useParams();
  const [run, setRun] = useState<EvalRunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api<{ data: EvalRunDetail }>(`/api/v1/evals?id=${encodeURIComponent(id)}`)
      .then((res) => {
        if (!cancelled) {
          setRun(res.data);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load run");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <Link
            to="/evals"
            className="font-mono text-xs text-muted hover:text-fg"
          >
            &larr; Evals
          </Link>
        </div>

        <header className="space-y-2">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">
            Eval run
          </p>
          <h1 className="break-all font-mono text-lg tracking-tight text-muted">
            {id}
          </h1>
        </header>

        {loading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : error ? (
          <p className="text-sm text-danger">{error}</p>
        ) : run ? (
          <>
            {/* summary */}
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="col-span-2 flex items-center rounded-md bg-surface px-5 py-4 shadow-[var(--shadow-border)] sm:col-span-1">
                <PassGauge passed={run.passed} total={run.total} />
              </div>
              <StatTile label="Model" value={run.model} />
              <StatTile label="Backend" value={run.backend} />
              <StatTile label="Run at" value={fmtDate(run.created_at)} />
            </div>

            <TrustSection run={run} />

            {/* cases table */}
            <section className="space-y-3">
              <div className="flex items-baseline justify-between">
                <h2 className="text-sm font-medium">Cases</h2>
                <span className="font-mono text-xs text-muted">
                  {run.failed > 0 ? (
                    <span className="text-danger">{run.failed} failed</span>
                  ) : (
                    <span className="text-score">all passed</span>
                  )}
                  {" · "}
                  {run.total} total
                </span>
              </div>
              <div className="overflow-x-auto rounded-md bg-surface shadow-[var(--shadow-border)]">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="border-b border-border font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                    <tr>
                      <th className="px-3 py-2 w-6"></th>
                      <th className="px-3 py-2">Case</th>
                      <th className="px-3 py-2">Expected</th>
                      <th className="px-3 py-2">Got</th>
                    </tr>
                  </thead>
                  <tbody>
                    {run.cases.map((c) => (
                      <tr
                        key={c.id}
                        className={`border-b border-border/60 align-top ${
                          c.pass ? "" : "bg-danger/[0.03]"
                        }`}
                      >
                        <td className="px-3 py-3">
                          <PassBadge pass={c.pass} />
                        </td>
                        <td className="px-3 py-3 font-mono text-xs font-medium">
                          {c.name}
                        </td>
                        <td className="px-3 py-3">
                          <ExpectCell expects={c.expected} />
                        </td>
                        <td className="px-3 py-3">
                          <GotCell expects={c.expected} got={c.got} />
                        </td>
                      </tr>
                    ))}
                    {run.cases.length === 0 ? (
                      <tr>
                        <td
                          colSpan={4}
                          className="px-3 py-6 text-sm text-muted"
                        >
                          No cases in this run.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}

/**
 * Calibration view of a run: reliability diagram, ECE/Brier, the threshold
 * picker, and a one-click "fit a calibration from these labels".
 */
function TrustSection({ run }: { run: EvalRunDetail }) {
  const navigate = useNavigate();
  const [fitting, setFitting] = useState(false);
  const [fitError, setFitError] = useState<string | null>(null);
  const samples = useMemo(() => pooledSamples(evalRunSamples(run.cases)), [run.cases]);
  const report = useMemo(
    () =>
      buildReliability(
        samples.map((s, i) => ({
          caseId: String(i),
          questionId: "*",
          qtype: "choice" as const,
          features: [],
          confidence: s.confidence,
          correct: s.correct,
          soft: false,
        })),
        10,
      ),
    [samples],
  );

  async function fit() {
    setFitting(true);
    setFitError(null);
    try {
      const res = await api<{ data: { id: string } }>("/api/v1/calibrations", {
        method: "POST",
        body: JSON.stringify({ name: `From eval ${run.id}`, eval_run_id: run.id }),
      });
      await navigate({ to: "/calibrations/$id", params: { id: res.data.id } });
    } catch (err) {
      setFitError(err instanceof Error ? err.message : "Calibration failed");
      setFitting(false);
    }
  }

  if (samples.length === 0) return null;
  return (
    <section className="space-y-4 rounded-md bg-surface p-5 shadow-[var(--shadow-border)]">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-sm font-medium">Calibration and thresholds</h2>
          <p className="text-xs text-muted">
            {samples.length} graded answers · accuracy {(report.overallAccuracy * 100).toFixed(1)}% ·
            ECE {report.ece.toFixed(3)} · Brier {report.brier.toFixed(3)}
          </p>
        </div>
        <Button size="sm" variant="secondary" disabled={fitting} onClick={() => void fit()}>
          {fitting ? "Fitting..." : "Fit calibration from this run"}
        </Button>
      </div>
      {fitError ? <p className="text-sm text-danger">{fitError}</p> : null}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_1fr]">
        <ReliabilityChart bins={report.bins} title="Reliability (bars = accuracy, dots = confidence)" />
        <ThresholdPicker samples={samples} />
      </div>
    </section>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-surface px-4 py-4 shadow-[var(--shadow-border)]">
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
        {label}
      </p>
      <p className="mt-2 truncate font-mono text-sm tabular-nums tracking-tight">
        {value}
      </p>
    </div>
  );
}
