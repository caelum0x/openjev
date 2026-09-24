import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { ThresholdPicker } from "@/components/threshold-picker";
import { DriftMonitorPanel } from "@/components/drift-monitor-panel";
import { AuditReportPanel } from "@/components/audit-report-panel";
import { api } from "@/lib/jev/browser";
import type { ThresholdPoint } from "@/lib/jev/calibration-fit";
import {
  CalibrationEngineNotice,
  RefitButton,
  type CalibrationEngineFields,
} from "@/components/calibration-engine";
import { engineLabel } from "@/lib/jev/engine-id";
import { pageHead } from "@/lib/seo/site";

type Stats = { accuracy: number; ece: number; brier: number; avgConfidence: number };
type QuestionMetrics = {
  n: number;
  method: "temperature" | "isotonic";
  evaluation?: "held_out" | "in_sample";
  train_n?: number;
  heldout_n?: number;
  curve_on?: "held_out" | "all_labels";
  before: Stats;
  after: Stats;
  curve: ThresholdPoint[];
  recommended: ThresholdPoint | null;
  target_precision: number;
};
type CalibrationDetail = CalibrationEngineFields & {
  name: string;
  model: string;
  method: string;
  source: "upload" | "eval_run";
  eval_run_id: string | null;
  sample_count: number;
  created_at: number;
  maps: Record<string, { method: string; temperature?: number; knots?: Array<[number, number]> }>;
  metrics: Record<string, QuestionMetrics>;
  skipped: Record<string, string>;
};

export const Route = createFileRoute("/calibrations/$id")({
  head: () => pageHead("Calibration"),
  component: CalibrationDetailPage,
});

function questionLabel(qid: string): string {
  return qid === "*" ? "All other questions (pooled)" : qid;
}

function evaluationNote(m: QuestionMetrics): string {
  if (m.evaluation === "held_out") {
    const curve =
      m.curve_on === "held_out"
        ? "The threshold curve below is drawn on the held-out labels too."
        : "The held-out slice is small, so the threshold curve below uses all labels (optimistic).";
    return `Fitted on ${m.train_n} labels; raw and calibrated numbers are measured on ${m.heldout_n} held-out labels the map never saw. ${curve}`;
  }
  if (m.evaluation === "in_sample") {
    return `Only ${m.n} labels, too few to hold any out: numbers are measured on the labels the map was fitted on (in-sample, optimistic). Add labels (20+ per question) for a held-out measurement, and confirm on fresh traffic with shadow mode.`;
  }
  return "Measured on the labels this map was fitted on (in-sample; fitted before held-out evaluation). Refit to get held-out numbers.";
}

function CalibrationDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [cal, setCal] = useState<CalibrationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<{ data: CalibrationDetail }>(`/api/v1/calibrations?id=${encodeURIComponent(id)}`)
      .then((r) => {
        if (!cancelled) setCal(r.data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load calibration");
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function reload() {
    const r = await api<{ data: CalibrationDetail }>(
      `/api/v1/calibrations?id=${encodeURIComponent(id)}`,
    );
    setCal(r.data);
  }

  async function remove() {
    if (!window.confirm("Delete this calibration? Requests that pass its id will start failing.")) return;
    setDeleting(true);
    try {
      await api(`/api/v1/calibrations?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      await navigate({ to: "/calibrations" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
      setDeleting(false);
    }
  }

  const snippet = cal
    ? JSON.stringify(
        {
          model: cal.model,
          calibration_id: cal.id,
          state: "...",
          questions: "{ same schema you calibrated }",
        },
        null,
        2,
      )
    : "";

  return (
    <AppShell>
      <div className="space-y-6">
        <Link to="/calibrations" className="font-mono text-xs text-muted hover:text-fg">
          &larr; Calibrations
        </Link>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        {!cal && !error ? <p className="text-sm text-muted">Loading...</p> : null}
        {cal ? (
          <>
            <header className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-1">
                <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">Calibration</p>
                <h1 className="text-2xl font-medium tracking-tight">{cal.name}</h1>
                <p className="font-mono text-xs text-muted">
                  {cal.id} · {cal.model} · {cal.sample_count} labels ·{" "}
                  {cal.source === "eval_run" ? `from eval ${cal.eval_run_id}` : "uploaded"}
                </p>
                <p className="font-mono text-xs text-muted">
                  {engineLabel(cal.engine)} · fitted{" "}
                  {new Date(cal.fitted_at).toLocaleString()}
                  {cal.refit_count > 0 ? ` · re-fitted ${cal.refit_count}x` : ""}
                </p>
              </div>
              <div className="flex items-start gap-2">
                <RefitButton cal={cal} onDone={reload} />
                <Button variant="secondary" size="sm" disabled={deleting} onClick={() => void remove()}>
                  {deleting ? "Deleting..." : "Delete"}
                </Button>
              </div>
            </header>

            <CalibrationEngineNotice cal={cal} />

            <section className="space-y-2 rounded-md bg-surface p-5 shadow-[var(--shadow-border)]">
              <h2 className="text-sm font-medium">Apply it</h2>
              <pre className="overflow-x-auto rounded-md bg-inset p-3 font-mono text-[12px]">
                {`POST /api/v1/systemone\n${snippet}`}
              </pre>
              <p className="text-xs text-muted">
                Answers come back with calibrated confidence and{" "}
                <code className="font-mono">calibrated: true</code>. With{" "}
                <code className="font-mono">model: "auto"</code> the map is applied to the local tier
                before the escalation threshold is checked.
              </p>
            </section>

            <DriftMonitorPanel calibrationId={cal.id} />

            <AuditReportPanel calibrationId={cal.id} />

            {Object.keys(cal.skipped).length > 0 ? (
              <p className="text-sm text-muted">
                Not individually fitted (too few labels):{" "}
                {Object.entries(cal.skipped)
                  .map(([q, why]) => `${q} (${why})`)
                  .join("; ")}
              </p>
            ) : null}

            {Object.entries(cal.metrics).map(([qid, m]) => (
              <section key={qid} className="space-y-4 rounded-md bg-surface p-5 shadow-[var(--shadow-border)]">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="font-mono text-sm">{questionLabel(qid)}</h2>
                  <span className="font-mono text-xs text-muted">
                    {m.method} · {m.n} labels
                    {m.evaluation === "held_out" ? ` · ${m.heldout_n} held out` : ""}
                    {cal.maps[qid]?.temperature !== undefined
                      ? ` · T=${cal.maps[qid]!.temperature}`
                      : ""}
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[420px] text-left text-sm">
                    <thead className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                      <tr>
                        <th className="py-1 pr-4"></th>
                        <th className="py-1 pr-4">Accuracy</th>
                        <th className="py-1 pr-4">Mean confidence</th>
                        <th className="py-1 pr-4">ECE</th>
                        <th className="py-1 pr-4">Brier</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono text-xs tabular-nums">
                      {(["before", "after"] as const).map((k) => (
                        <tr key={k}>
                          <td className="py-1 pr-4 text-subtle">
                            {k === "before" ? "Raw" : "Calibrated"}
                            {m.evaluation === "held_out" ? " (held-out)" : ""}
                          </td>
                          <td className="py-1 pr-4">{(m[k].accuracy * 100).toFixed(1)}%</td>
                          <td className="py-1 pr-4">{m[k].avgConfidence.toFixed(3)}</td>
                          <td className="py-1 pr-4">{m[k].ece.toFixed(3)}</td>
                          <td className="py-1 pr-4">{m[k].brier.toFixed(3)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-muted">{evaluationNote(m)}</p>
                <ThresholdPicker curve={m.curve} initialTarget={m.target_precision} />
              </section>
            ))}
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
