import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/jev/browser";
import type { DriftReport, DriftThresholds } from "@/lib/jev/drift";

type Webhook = { id: string; url: string; events: string[]; active: boolean };
type Monitor = {
  id: string;
  calibration_id: string;
  webhook_id: string;
  window_days: number;
  thresholds: DriftThresholds;
  active: boolean;
  last_checked_at: number | null;
  last_status: DriftReport["status"] | null;
  last_report: DriftReport | null;
  last_alert_at: number | null;
};
type Delivery = { ok: boolean; status: number; error?: string };
type CheckResult = { monitor: Monitor; report: DriftReport; delivery: Delivery | null; alerted: boolean };

interface DriftMonitorPanelProps {
  calibrationId: string;
}

const DRIFT_EVENTS = ["calibration.drift", "calibration.drift_resolved"];
const inputCls = "w-full rounded-md bg-inset px-3 py-2 text-sm";
const labelCls = "font-mono text-[10px] uppercase tracking-[0.14em] text-subtle";

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

function fmt(ms: number | null): string {
  return ms ? new Date(ms).toLocaleString() : "never";
}

const STATUS_TEXT: Record<DriftReport["status"], string> = {
  ok: "No drift",
  drift: "Drift detected",
  insufficient: "Not enough traffic yet",
};

function ReportTable({ report }: { report: DriftReport }) {
  if (report.questions.length === 0) {
    return <p className="text-xs text-muted">No calibrated questions or traffic to compare yet.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[620px] text-left text-sm">
        <thead className={labelCls}>
          <tr>
            <th className="py-1 pr-3">Question</th>
            <th className="py-1 pr-3">Status</th>
            <th className="py-1 pr-3">Pairs</th>
            <th className="py-1 pr-3">Labelled</th>
            <th className="py-1 pr-3">Accuracy now / fit</th>
            <th className="py-1 pr-3">Confidence now / fit</th>
            <th className="py-1 pr-3">Signals</th>
          </tr>
        </thead>
        <tbody className="font-mono text-xs tabular-nums">
          {report.questions.map((q) => (
            <tr key={q.question_id} className="border-t border-border/60">
              <td className="py-1.5 pr-3">{q.question_id}</td>
              <td className={`py-1.5 pr-3 ${q.status === "drift" ? "text-danger" : "text-muted"}`}>{q.status}</td>
              <td className="py-1.5 pr-3">{q.n}</td>
              <td className="py-1.5 pr-3">{pct(q.label_share)}</td>
              <td className="py-1.5 pr-3">
                {q.observed ? pct(q.observed.accuracy) : "-"} / {q.baseline ? pct(q.baseline.accuracy) : "-"}
              </td>
              <td className="py-1.5 pr-3">
                {q.observed ? q.observed.avgConfidence.toFixed(3) : "-"} /{" "}
                {q.baseline ? q.baseline.avgConfidence.toFixed(3) : "-"}
              </td>
              <td className="py-1.5 pr-3">
                {q.signals.length ? q.signals.map((s) => `${s.kind} (${s.delta > 0 ? "+" : ""}${s.delta})`).join(", ") : "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DriftMonitorPanel({ calibrationId }: DriftMonitorPanelProps) {
  const [monitor, setMonitor] = useState<Monitor | null>(null);
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [webhookId, setWebhookId] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [windowDays, setWindowDays] = useState(7);
  const [minSamples, setMinSamples] = useState(30);
  const [accDrop, setAccDrop] = useState(10);
  const [confShift, setConfShift] = useState(10);
  const [gap, setGap] = useState(10);
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [check, setCheck] = useState<CheckResult | null>(null);

  function adopt(m: Monitor) {
    setMonitor(m);
    setWebhookId(m.webhook_id);
    setWindowDays(m.window_days);
    setMinSamples(m.thresholds.min_samples);
    setAccDrop(Math.round(m.thresholds.accuracy_drop * 100));
    setConfShift(Math.round(m.thresholds.confidence_shift * 100));
    setGap(Math.round(m.thresholds.calibration_gap * 100));
    setActive(m.active);
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api<{ data: Monitor | null }>(`/api/v1/drift?calibration_id=${encodeURIComponent(calibrationId)}`),
      api<{ data: Webhook[] }>("/api/v1/webhooks"),
    ])
      .then(([m, w]) => {
        if (cancelled) return;
        setWebhooks(w.data);
        if (m.data) adopt(m.data);
        else if (w.data[0]) setWebhookId(w.data[0].id);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load drift monitor");
      });
    return () => {
      cancelled = true;
    };
  }, [calibrationId]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      let target = webhookId;
      if (target === "new") {
        const created = await api<{ data: Webhook & { secret: string } }>("/api/v1/webhooks", {
          method: "POST",
          body: JSON.stringify({ url: newUrl.trim(), events: DRIFT_EVENTS }),
        });
        setWebhooks((prev) => [created.data, ...prev]);
        setNewSecret(created.data.secret);
        setNewUrl("");
        target = created.data.id;
      }
      if (!target) throw new Error("Pick a webhook or add a new URL.");
      const res = await api<{ data: Monitor }>("/api/v1/drift", {
        method: "POST",
        body: JSON.stringify({
          calibration_id: calibrationId,
          webhook_id: target,
          window_days: windowDays,
          active,
          thresholds: {
            min_samples: minSamples,
            accuracy_drop: accDrop / 100,
            confidence_shift: confShift / 100,
            calibration_gap: gap / 100,
          },
        }),
      });
      adopt(res.data);
      setNotice(active ? "Drift monitor saved and on." : "Drift monitor saved (paused).");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function runCheck() {
    if (!monitor) return;
    setError(null);
    setBusy(true);
    try {
      const res = await api<{ data: CheckResult }>(
        `/api/v1/drift?action=check&id=${encodeURIComponent(monitor.id)}`,
        { method: "POST" },
      );
      setCheck(res.data);
      setMonitor(res.data.monitor);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Check failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!monitor || !window.confirm("Remove this drift monitor? Alerts stop immediately.")) return;
    setBusy(true);
    try {
      await api(`/api/v1/drift?id=${encodeURIComponent(monitor.id)}`, { method: "DELETE" });
      setMonitor(null);
      setCheck(null);
      setNotice("Drift monitor removed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  const report = check?.report ?? monitor?.last_report ?? null;

  return (
    <section className="space-y-4 rounded-md bg-surface p-5 shadow-[var(--shadow-border)]">
      <div className="space-y-1">
        <h2 className="text-sm font-medium">Drift alerts</h2>
        <p className="max-w-3xl text-xs leading-relaxed text-muted">
          Send shadow requests with <code className="font-mono">calibration_id: "{calibrationId}"</code> to{" "}
          <code className="font-mono">POST /api/v1/shadow</code>. Each check compares the last window of that
          traffic with this calibration's held-out numbers and POSTs a signed{" "}
          <code className="font-mono">calibration.drift</code> event to your webhook when accuracy drops,
          confidence shifts, or confidence runs ahead of accuracy. Send human labels as{" "}
          <code className="font-mono">incumbent: {"{ kind: \"label\", answers }"}</code> to measure real accuracy;
          agreement with an incumbent LLM is a proxy. Checks run after shadow traffic (at most every 5 minutes)
          and on demand.
        </p>
      </div>

      <form onSubmit={(e) => void save(e)} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="space-y-1.5 sm:col-span-2">
            <span className={labelCls}>Webhook</span>
            <select value={webhookId} onChange={(e) => setWebhookId(e.target.value)} className={inputCls}>
              {webhooks.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.url}
                  {w.active ? "" : " (paused)"}
                  {w.events.length && !w.events.includes("calibration.drift") ? " (not subscribed to drift)" : ""}
                </option>
              ))}
              <option value="new">Add a new webhook URL</option>
            </select>
          </label>
          <label className="space-y-1.5">
            <span className={labelCls}>Window (days)</span>
            <input
              type="number"
              min={1}
              max={90}
              value={windowDays}
              onChange={(e) => setWindowDays(Number(e.target.value))}
              className={inputCls}
            />
          </label>
        </div>
        {webhookId === "new" || webhooks.length === 0 ? (
          <label className="block space-y-1.5">
            <span className={labelCls}>New webhook URL</span>
            <input
              type="url"
              required
              value={newUrl}
              onChange={(e) => {
                setNewUrl(e.target.value);
                if (webhookId !== "new") setWebhookId("new");
              }}
              placeholder="https://example.com/hooks/openjev"
              className={inputCls}
            />
          </label>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-4">
          <label className="space-y-1.5">
            <span className={labelCls}>Min pairs per question</span>
            <input type="number" min={5} value={minSamples} onChange={(e) => setMinSamples(Number(e.target.value))} className={inputCls} />
          </label>
          <label className="space-y-1.5">
            <span className={labelCls}>Accuracy drop (pts)</span>
            <input type="number" min={1} max={100} value={accDrop} onChange={(e) => setAccDrop(Number(e.target.value))} className={inputCls} />
          </label>
          <label className="space-y-1.5">
            <span className={labelCls}>Confidence shift (pts)</span>
            <input type="number" min={1} max={100} value={confShift} onChange={(e) => setConfShift(Number(e.target.value))} className={inputCls} />
          </label>
          <label className="space-y-1.5">
            <span className={labelCls}>Overconfidence gap (pts)</span>
            <input type="number" min={1} max={100} value={gap} onChange={(e) => setGap(Number(e.target.value))} className={inputCls} />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Send alerts
        </label>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        {notice ? <p className="text-sm text-muted">{notice}</p> : null}
        {newSecret ? (
          <p className="rounded-md bg-inset p-3 text-xs">
            Signing secret (shown once, store it to verify <code className="font-mono">X-OTS-Signature</code>):{" "}
            <code className="font-mono break-all">{newSecret}</code>
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" disabled={busy}>
            {monitor ? "Save monitor" : "Turn on drift alerts"}
          </Button>
          {monitor ? (
            <>
              <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void runCheck()}>
                Check now
              </Button>
              <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void remove()}>
                Remove
              </Button>
            </>
          ) : null}
        </div>
      </form>

      {monitor ? (
        <div className="space-y-2">
          <p className="font-mono text-xs text-muted">
            {monitor.last_status ? STATUS_TEXT[monitor.last_status] : "Not checked yet"} · last check{" "}
            {fmt(monitor.last_checked_at)} · last alert {fmt(monitor.last_alert_at)}
          </p>
          {check?.delivery ? (
            <p className={`text-xs ${check.delivery.ok ? "text-muted" : "text-danger"}`}>
              Webhook {check.delivery.ok ? `delivered (HTTP ${check.delivery.status})` : `failed: ${check.delivery.error ?? `HTTP ${check.delivery.status}`}`}
            </p>
          ) : check ? (
            <p className="text-xs text-muted">No alert sent ({STATUS_TEXT[check.report.status].toLowerCase()}, or this drift was already reported in the last 24 hours).</p>
          ) : null}
          {report ? <ReportTable report={report} /> : null}
        </div>
      ) : null}
    </section>
  );
}
