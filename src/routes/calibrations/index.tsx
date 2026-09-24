import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/jev/browser";
import { ImportError, parseExamples } from "@/lib/jev/label-import";
import { MODEL_CARDS } from "@/lib/jev/models";
import {
  CalibrationEngineCell,
  RefitButton,
  type CalibrationEngineFields,
} from "@/components/calibration-engine";
import { pageHead } from "@/lib/seo/site";

type CalibrationSummary = CalibrationEngineFields & {
  id: string;
  name: string;
  model: string;
  method: string;
  source: "upload" | "eval_run";
  eval_run_id: string | null;
  sample_count: number;
  question_ids: string[];
  created_at: number;
};

export const Route = createFileRoute("/calibrations/")({
  head: () => pageHead("Calibrations"),
  component: CalibrationsPage,
});

const FIT_MODELS = MODEL_CARDS.filter(
  (m) => m.backend === "local" || m.backend === "otsone" || m.backend === "laya",
);

const EXAMPLE_QUESTIONS = `{
  "intent": {
    "type": "choice",
    "instructions": "What does the customer want?",
    "criteria": {
      "refund": "Wants money back",
      "exchange": "Wants a different size or item",
      "status": "Asks where the order is"
    }
  }
}`;

const EXAMPLE_ROWS = `state,intent
"I want my money back for these shoes",refund
"Can I swap this for a size 10?",exchange
"Where is my package? It has been a week",status`;

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function CalibrationsPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<CalibrationSummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState("");
  const [model, setModel] = useState("system-one");
  const [method, setMethod] = useState<"auto" | "temperature" | "isotonic">("auto");
  const [target, setTarget] = useState(0.95);
  const [questions, setQuestions] = useState(EXAMPLE_QUESTIONS);
  const [rows, setRows] = useState(EXAMPLE_ROWS);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function load() {
    try {
      const res = await api<{ data: CalibrationSummary[] }>("/api/v1/calibrations");
      setItems(res.data);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load calibrations");
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setRows(await file.text());
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    let parsedQuestions: unknown;
    try {
      parsedQuestions = JSON.parse(questions);
    } catch {
      setFormError("Questions must be valid JSON (the same map you send to /v1/systemone).");
      return;
    }
    let examples;
    try {
      examples = parseExamples(rows);
    } catch (err) {
      setFormError(err instanceof ImportError ? err.message : "Could not read the labelled rows.");
      return;
    }
    setBusy(true);
    try {
      const res = await api<{ data: { id: string } }>("/api/v1/calibrations", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim() || `Calibration ${new Date().toISOString().slice(0, 10)}`,
          model,
          method,
          target_precision: target,
          questions: parsedQuestions,
          examples,
        }),
      });
      await navigate({ to: "/calibrations/$id", params: { id: res.data.id } });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Calibration failed");
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <div className="space-y-8">
        <header className="space-y-2">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">Calibrations</p>
          <h1 className="text-2xl font-medium tracking-tight">Calibrate on your own labels</h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            Upload labelled examples. Each one is answered by the model you pick and graded, and a
            per-question map (temperature scaling, or isotonic regression once a question has 50+
            labels) turns raw confidence into the probability of being right on your data. Pass the
            resulting <code className="font-mono">calibration_id</code> on{" "}
            <code className="font-mono">/v1/systemone</code> to apply it. Each question needs at
            least 10 labels; questions with fewer share a pooled map. With 20 or more labels a
            quarter are held out, so the before/after numbers are measured on labels the map never saw.
          </p>
        </header>

        <section className="space-y-4 rounded-md bg-surface p-5 shadow-[var(--shadow-border)]">
          <h2 className="text-sm font-medium">New calibration</h2>
          <form onSubmit={(e) => void submit(e)} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-4">
              <label className="space-y-1.5 sm:col-span-2">
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">Name</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={120}
                  placeholder="Support intents, Sept labels"
                  className="w-full rounded-md bg-inset px-3 py-2 text-sm"
                />
              </label>
              <label className="space-y-1.5">
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">Model</span>
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full rounded-md bg-inset px-3 py-2 text-sm"
                >
                  {FIT_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">Method</span>
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value as typeof method)}
                  className="w-full rounded-md bg-inset px-3 py-2 text-sm"
                >
                  <option value="auto">Auto</option>
                  <option value="temperature">Temperature</option>
                  <option value="isotonic">Isotonic</option>
                </select>
              </label>
            </div>
            <label className="block space-y-1.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                Target precision for the recommended threshold: {(target * 100).toFixed(0)}%
              </span>
              <input
                type="range"
                min={0.5}
                max={0.999}
                step={0.005}
                value={target}
                onChange={(e) => setTarget(Number(e.target.value))}
                className="w-full max-w-md accent-[var(--color-accent)]"
              />
            </label>
            <div className="grid gap-4 lg:grid-cols-2">
              <label className="space-y-1.5">
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                  Questions (JSON)
                </span>
                <textarea
                  value={questions}
                  onChange={(e) => setQuestions(e.target.value)}
                  rows={14}
                  spellCheck={false}
                  className="w-full rounded-md bg-inset px-3 py-2 font-mono text-xs"
                />
              </label>
              <div className="space-y-1.5">
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                  Labelled rows (CSV, JSONL, or JSON array)
                </span>
                <textarea
                  value={rows}
                  onChange={(e) => setRows(e.target.value)}
                  rows={12}
                  spellCheck={false}
                  aria-label="Labelled rows"
                  className="w-full rounded-md bg-inset px-3 py-2 font-mono text-xs"
                />
                <input
                  type="file"
                  accept=".csv,.jsonl,.json,text/csv,application/json"
                  onChange={(e) => void onFile(e.target.files?.[0])}
                  className="text-xs text-muted"
                />
              </div>
            </div>
            {formError ? <p className="text-sm text-danger">{formError}</p> : null}
            <Button type="submit" disabled={busy}>
              {busy ? "Fitting..." : "Fit calibration"}
            </Button>
          </form>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-medium">Your calibrations</h2>
          {loadError ? <p className="text-sm text-danger">{loadError}</p> : null}
          {!loaded ? <p className="text-sm text-muted">Loading calibrations…</p> : null}
          {loaded && items.length === 0 && !loadError ? (
            <p className="text-sm text-muted">
              No calibrations yet. Fit one above, or open an eval run and use "Fit calibration from
              this run".
            </p>
          ) : null}
          {items.length > 0 ? (
            <div className="overflow-x-auto rounded-md bg-surface shadow-[var(--shadow-border)]">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="border-b border-border font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                  <tr>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Model</th>
                    <th className="px-3 py-2">Labels</th>
                    <th className="px-3 py-2">Questions</th>
                    <th className="px-3 py-2">Engine</th>
                    <th className="px-3 py-2">Fitted</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((c) => (
                    <tr key={c.id} className="border-b border-border/60">
                      <td className="px-3 py-2">
                        <Link to="/calibrations/$id" params={{ id: c.id }} className="hover:underline">
                          {c.name}
                        </Link>
                        <p className="font-mono text-[10px] text-subtle">{c.id}</p>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{c.model}</td>
                      <td className="px-3 py-2 font-mono text-xs tabular-nums">{c.sample_count}</td>
                      <td className="px-3 py-2 font-mono text-xs">{c.question_ids.join(", ")}</td>
                      <td className="px-3 py-2">
                        <CalibrationEngineCell cal={c} />
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-muted">
                        {fmtDate(c.fitted_at)}
                        {c.refit_count > 0 ? (
                          <span className="block text-[10px] text-subtle">
                            re-fitted {c.refit_count}x
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        {c.engine_mismatch ? <RefitButton cal={c} onDone={load} /> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      </div>
    </AppShell>
  );
}
