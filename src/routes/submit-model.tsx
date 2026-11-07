import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { api, getActiveKey } from "@/lib/jev/browser";
import { cn } from "@/lib/utils";
import { pageHead } from "@/lib/seo/site";

// ── Types ──────────────────────────────────────────────────────────────────

type SourceKind = "endpoint" | "answers";

type QuestionTypeBreakdown = {
  qtype: "choice" | "noul" | "score";
  case_count: number;
  accuracy: number;
  avg_confidence: number;
  ece: number;
  adaptive_ece: number;
  mce: number;
  brier: number;
  nll: number;
};

type SubmissionResult = {
  case_count: number;
  accuracy: number;
  strict_pass_rate: number;
  avg_confidence: number;
  ece: number;
  adaptive_ece: number;
  mce: number;
  brier: number;
  nll: number;
  by_type: QuestionTypeBreakdown[];
};

type Submission = {
  id: string;
  model_label: string;
  source_kind: SourceKind;
  status: "pending" | "running" | "completed" | "failed";
  error_message: string | null;
  case_count: number;
  submitted_at: number;
  completed_at: number | null;
  result?: SubmissionResult | null;
};

// ── Route ──────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/submit-model")({
  head: () => pageHead("Submit your model · Leaderboard"),
  component: SubmitPage,
});

function pct(v: number | undefined | null): string {
  return v == null ? "" : `${(v * 100).toFixed(1)}%`;
}

function num(v: number | undefined | null): string {
  return v == null ? "" : v.toFixed(3);
}

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const EXAMPLE_ENDPOINT_CONTRACT = `POST <your endpoint>
{ "state": <same state every OpenJev model gets>, "questions": {...} }

-> 200 { "answers": { "<question id>": { "type": "choice", "choice": "...", "probabilities": {...}, "confidence": 0.0..1.0 }, ... } }`;

// ── Page ───────────────────────────────────────────────────────────────────

function SubmitPage() {
  const [hasKey, setHasKey] = useState(false);
  useEffect(() => setHasKey(Boolean(getActiveKey())), []);

  const [modelLabel, setModelLabel] = useState("");
  const [sourceKind, setSourceKind] = useState<SourceKind>("endpoint");
  const [endpointUrl, setEndpointUrl] = useState("");
  const [answersText, setAnswersText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Submission | null>(null);

  const [history, setHistory] = useState<Submission[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);

  async function loadHistory() {
    try {
      const res = await api<{ data: Submission[] }>("/api/v1/benchmark-submissions");
      setHistory(res.data);
      setHistoryError(null);
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : "Failed to load");
    }
  }

  useEffect(() => {
    if (hasKey) void loadHistory();
  }, [hasKey]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        modelLabel,
        sourceKind,
      };
      if (sourceKind === "endpoint") {
        body.endpointUrl = endpointUrl;
      } else {
        let parsed: unknown;
        try {
          parsed = JSON.parse(answersText);
        } catch {
          throw new Error("answers must be valid JSON");
        }
        body.answers = parsed;
      }
      const res = await api<{ data: Submission }>("/api/v1/benchmark-submissions", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setResult(res.data);
      await loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppShell>
      <article className="mx-auto max-w-3xl space-y-10">
        <header className="space-y-3">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">
            Benchmark submission
          </p>
          <h1 className="text-3xl font-medium tracking-tight">Submit your model</h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            Run the same 93-case gold calibration suite every OpenJev model is scored on (
            <code className="font-mono">src/lib/jev/gold/</code>) against your own typed-decision
            model, and show up on the{" "}
            <Link to="/leaderboard" className="underline decoration-border underline-offset-2">
              leaderboard
            </Link>{" "}
            with real accuracy, strict pass rate, ECE, adaptive ECE, MCE, Brier, and NLL — computed by
            the identical engine (<code className="font-mono">src/lib/jev/calibration.ts</code>) that
            scores every other row, not a self-reported number. This is the same evaluation as{" "}
            <code className="font-mono">otsone eval-external</code>, run inside the real platform
            instead of a local CLI.
          </p>
        </header>

        {!hasKey ? (
          <section className="space-y-2 rounded-md bg-inset p-6">
            <p className="text-sm text-fg">
              Submitting requires an OpenJev API key (free). This runs through the same auth, rate
              limit, and quota system as every other API call.
            </p>
            <Link to="/keys" className={cn(buttonVariants({ variant: "secondary" }))}>
              Get an API key
            </Link>
          </section>
        ) : null}

        <form onSubmit={submit} className="space-y-6 rounded-md bg-surface p-6 shadow-[var(--shadow-border)]">
          <div className="space-y-1.5">
            <label className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
              Model label
            </label>
            <Input
              value={modelLabel}
              onChange={(e) => setModelLabel(e.target.value)}
              placeholder="acme-typed-v1"
              required
              maxLength={120}
            />
          </div>

          <div className="space-y-1.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
              Source
            </span>
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="sourceKind"
                  checked={sourceKind === "endpoint"}
                  onChange={() => setSourceKind("endpoint")}
                />
                Live HTTP endpoint
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="sourceKind"
                  checked={sourceKind === "answers"}
                  onChange={() => setSourceKind("answers")}
                />
                Precomputed answers (JSON)
              </label>
            </div>
          </div>

          {sourceKind === "endpoint" ? (
            <div className="space-y-1.5">
              <label className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                Endpoint URL
              </label>
              <Input
                type="url"
                value={endpointUrl}
                onChange={(e) => setEndpointUrl(e.target.value)}
                placeholder="https://your-model.example.com/predict"
                required
              />
              <p className="font-mono text-[10px] leading-relaxed text-subtle">
                Must be a public http(s) URL. We POST one request per gold case:
              </p>
              <pre className="whitespace-pre-wrap rounded-sm bg-inset p-3 font-mono text-[10px] leading-relaxed text-muted">
                {EXAMPLE_ENDPOINT_CONTRACT}
              </pre>
            </div>
          ) : (
            <div className="space-y-1.5">
              <label className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                Answers JSON
              </label>
              <Textarea
                value={answersText}
                onChange={(e) => setAnswersText(e.target.value)}
                placeholder='{"<gold case id>": {"<question id>": {"type": "choice", "choice": "...", "probabilities": {...}, "confidence": 0.9}}, ...}'
                required
                className="min-h-56 font-mono text-xs"
              />
              <p className="font-mono text-[10px] leading-relaxed text-subtle">
                One entry per gold case id (download the set:{" "}
                <code>GET /api/v1/systemone</code> lists models; the gold suite itself ships in{" "}
                <code>src/lib/jev/gold/</code> in the repo). Every case id must be present.
              </p>
            </div>
          )}

          {error ? <p className="text-sm text-danger">{error}</p> : null}

          <Button type="submit" disabled={submitting || !hasKey}>
            {submitting ? "Running 93 gold cases…" : "Submit and score"}
          </Button>
        </form>

        {result ? <ResultCard submission={result} /> : null}

        {hasKey ? (
          <section className="space-y-3">
            <h2 className="text-lg font-medium tracking-tight">Your submissions</h2>
            {historyError ? <p className="text-sm text-danger">{historyError}</p> : null}
            {history.length === 0 ? (
              <p className="text-sm text-muted">No submissions yet.</p>
            ) : (
              <ul className="space-y-2">
                {history.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center justify-between rounded-md bg-surface px-4 py-3 shadow-[var(--shadow-border)]"
                  >
                    <div>
                      <span className="text-sm text-fg">{s.model_label}</span>
                      <span className="ml-2 font-mono text-[10px] text-subtle">
                        {fmtDate(s.submitted_at)}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 font-mono text-xs">
                      <span className="text-muted">{s.status}</span>
                      {s.result ? <span className="text-fg">{pct(s.result.accuracy)} acc</span> : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}
      </article>
    </AppShell>
  );
}

function ResultCard({ submission }: { submission: Submission }) {
  if (submission.status === "failed") {
    return (
      <section className="space-y-2 rounded-md bg-inset p-6">
        <h2 className="text-base font-medium tracking-tight text-danger">Submission failed</h2>
        <p className="text-sm text-muted">{submission.error_message}</p>
      </section>
    );
  }
  const r = submission.result;
  if (!r) return null;
  return (
    <section className="space-y-4 rounded-md bg-inset p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-medium tracking-tight">Scored: {submission.model_label}</h2>
        <Link to="/leaderboard" className="text-sm underline decoration-border underline-offset-2">
          View on leaderboard
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3 font-mono text-xs tabular-nums sm:grid-cols-4">
        <Stat label="Accuracy" value={pct(r.accuracy)} />
        <Stat label="Strict pass" value={pct(r.strict_pass_rate)} />
        <Stat label="ECE" value={num(r.ece)} />
        <Stat label="Adaptive ECE" value={num(r.adaptive_ece)} />
        <Stat label="MCE" value={num(r.mce)} />
        <Stat label="Brier" value={num(r.brier)} />
        <Stat label="NLL" value={num(r.nll)} />
        <Stat label="Cases" value={String(r.case_count)} />
      </div>
      {r.by_type.length > 0 ? (
        <div className="overflow-x-auto rounded-md bg-surface shadow-[var(--shadow-border)]">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="border-b border-border font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
              <tr>
                <th className="px-3 py-2">Question type</th>
                <th className="px-3 py-2">N</th>
                <th className="px-3 py-2">Accuracy</th>
                <th className="px-3 py-2">ECE</th>
                <th className="px-3 py-2">Brier</th>
                <th className="px-3 py-2">NLL</th>
              </tr>
            </thead>
            <tbody className="font-mono text-xs tabular-nums">
              {r.by_type.map((t) => (
                <tr key={t.qtype} className="border-b border-border/60">
                  <td className="px-3 py-2 text-fg">{t.qtype}</td>
                  <td className="px-3 py-2">{t.case_count}</td>
                  <td className="px-3 py-2">{pct(t.accuracy)}</td>
                  <td className="px-3 py-2">{num(t.ece)}</td>
                  <td className="px-3 py-2">{num(t.brier)}</td>
                  <td className="px-3 py-2">{num(t.nll)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5 rounded-sm bg-surface px-3 py-2 shadow-[var(--shadow-border)]">
      <p className="text-[9px] uppercase tracking-[0.14em] text-subtle">{label}</p>
      <p className="text-fg">{value}</p>
    </div>
  );
}
