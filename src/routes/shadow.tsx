import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/jev/browser";
import { pageHead } from "@/lib/seo/site";

type ShadowSummary = {
  window_days: number;
  threshold: number;
  total: number;
  agreed: number;
  agreement: number | null;
  incumbents: string[];
  by_question: Array<{ question_id: string; qtype: string; n: number; agreement: number; avg_confidence: number }>;
  by_confidence: Array<{ label: string; n: number; agreement: number | null }>;
  above_threshold: { n: number; share: number; agreement: number | null };
  disagreements: Array<{
    id: string;
    question_id: string;
    ours: string;
    incumbent: string;
    confidence: number;
    state_excerpt: string;
    created_at: number;
  }>;
  savings: {
    incumbent_input_tokens: number;
    incumbent_output_tokens: number;
    incumbent_cost_usd: number;
    projected_savings_usd: number;
    price_in_usd_per_mtok: number;
    price_out_usd_per_mtok: number;
    price_source: "env" | "default";
  };
};

export const Route = createFileRoute("/shadow")({
  head: () => pageHead("Shadow mode"),
  component: ShadowPage,
});

const CURL = `curl -X POST $OPENJEV_URL/api/v1/shadow \\
  -H "Authorization: Bearer ots_live_..." -H "Content-Type: application/json" \\
  -d '{
    "model": "system-one",
    "state": "Where is my order? It has been two weeks.",
    "questions": { "intent": { "type": "choice", "instructions": "What does the customer want?",
      "criteria": { "refund": "money back", "status": "where is the order" } } },
    "incumbent": { "name": "gpt-4.1-mini", "answers": { "intent": "status" },
                   "usage": { "input_tokens": 412, "output_tokens": 18 } }
  }'`;

function pct(v: number | null): string {
  return v === null ? "n/a" : `${(v * 100).toFixed(1)}%`;
}

function usd(v: number): string {
  return v < 0.01 && v > 0 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`;
}

function ShadowPage() {
  const [days, setDays] = useState(30);
  const [threshold, setThreshold] = useState(0.8);
  const [incumbent, setIncumbent] = useState("");
  const [data, setData] = useState<ShadowSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const q = new URLSearchParams({ days: String(days), threshold: String(threshold) });
      if (incumbent) q.set("incumbent", incumbent);
      const res = await api<{ data: ShadowSummary }>(`/api/v1/shadow?${q.toString()}`);
      setData(res.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load shadow data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, incumbent]);

  return (
    <AppShell>
      <div className="space-y-8">
        <header className="space-y-2">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">Shadow mode</p>
          <h1 className="text-2xl font-medium tracking-tight">Run alongside your current LLM</h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            Send the same state and questions you already give your LLM to{" "}
            <code className="font-mono">POST /api/v1/shadow</code>, with the LLM's answers. Production
            keeps using the LLM; we log where OpenJev agrees, how agreement tracks confidence, and what
            a cascade would have saved. Leave out <code className="font-mono">incumbent.answers</code>{" "}
            and this server asks its own configured LLM (Groq, Ollama, or OpenAI) instead.
          </p>
        </header>

        <section className="flex flex-wrap items-end gap-4">
          <label className="space-y-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">Window</span>
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="block rounded-md bg-inset px-3 py-2 text-sm"
            >
              {[1, 7, 30, 90].map((d) => (
                <option key={d} value={d}>
                  Last {d} day{d === 1 ? "" : "s"}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">Incumbent</span>
            <select
              value={incumbent}
              onChange={(e) => setIncumbent(e.target.value)}
              className="block rounded-md bg-inset px-3 py-2 text-sm"
            >
              <option value="">All</option>
              {(data?.incumbents ?? []).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
              Keep-local threshold: {threshold.toFixed(2)}
            </span>
            <input
              type="range"
              min={0.5}
              max={0.99}
              step={0.01}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              onMouseUp={() => void load()}
              onKeyUp={() => void load()}
              onTouchEnd={() => void load()}
              className="block w-56 accent-[var(--color-accent)]"
            />
          </label>
          <Button size="sm" variant="secondary" disabled={loading} onClick={() => void load()}>
            {loading ? "Loading..." : "Refresh"}
          </Button>
        </section>

        {error ? <p className="text-sm text-danger">{error}</p> : null}

        {data && data.total === 0 ? (
          <section className="space-y-3 rounded-md bg-surface p-5 shadow-[var(--shadow-border)]">
            <h2 className="text-sm font-medium">No shadow traffic yet</h2>
            <p className="text-sm text-muted">Mirror a request to start collecting evidence:</p>
            <pre className="overflow-x-auto rounded-md bg-inset p-3 font-mono text-[12px]">{CURL}</pre>
          </section>
        ) : null}

        {data && data.total > 0 ? (
          <>
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Tile label="Compared answers" value={data.total.toLocaleString("en-US")} />
              <Tile label="Agreement" value={pct(data.agreement)} />
              <Tile
                label={`Served locally at >= ${data.threshold.toFixed(2)}`}
                value={pct(data.above_threshold.share)}
                sub={`agreement there: ${pct(data.above_threshold.agreement)}`}
              />
              <Tile
                label="Projected LLM savings"
                value={usd(data.savings.projected_savings_usd)}
                sub={`of ${usd(data.savings.incumbent_cost_usd)} incumbent spend · ${
                  data.savings.price_source === "env" ? "your prices" : "assumed $0.40/$1.60 per M tokens"
                }`}
              />
            </section>

            <section className="space-y-3">
              <h2 className="text-sm font-medium">Agreement by OpenJev confidence</h2>
              <p className="text-xs text-muted">
                If confidence is trustworthy, agreement rises with it. That is the evidence you need
                before letting the cascade serve high-confidence answers locally.
              </p>
              <div className="space-y-2 rounded-md bg-surface p-4 shadow-[var(--shadow-border)]">
                {data.by_confidence.map((b) => (
                  <div key={b.label} className="flex items-center gap-3 font-mono text-xs">
                    <span className="w-16 text-subtle">{b.label}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-raised">
                      <div
                        className="h-full rounded-full bg-accent"
                        style={{ width: `${Math.round((b.agreement ?? 0) * 100)}%` }}
                      />
                    </div>
                    <span className="w-28 text-right tabular-nums">
                      {pct(b.agreement)} · n={b.n}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="text-sm font-medium">Per question</h2>
              <div className="overflow-x-auto rounded-md bg-surface shadow-[var(--shadow-border)]">
                <table className="w-full min-w-[520px] text-left text-sm">
                  <thead className="border-b border-border font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                    <tr>
                      <th className="px-3 py-2">Question</th>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">Compared</th>
                      <th className="px-3 py-2">Agreement</th>
                      <th className="px-3 py-2">Mean confidence</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono text-xs">
                    {data.by_question.map((q) => (
                      <tr key={q.question_id} className="border-b border-border/60">
                        <td className="px-3 py-2">{q.question_id}</td>
                        <td className="px-3 py-2 text-muted">{q.qtype}</td>
                        <td className="px-3 py-2 tabular-nums">{q.n}</td>
                        <td className="px-3 py-2 tabular-nums">{pct(q.agreement)}</td>
                        <td className="px-3 py-2 tabular-nums">{q.avg_confidence.toFixed(3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="text-sm font-medium">Recent disagreements</h2>
              {data.disagreements.length === 0 ? (
                <p className="text-sm text-muted">None in this window.</p>
              ) : (
                <div className="overflow-x-auto rounded-md bg-surface shadow-[var(--shadow-border)]">
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <thead className="border-b border-border font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                      <tr>
                        <th className="px-3 py-2">Question</th>
                        <th className="px-3 py-2">OpenJev</th>
                        <th className="px-3 py-2">Incumbent</th>
                        <th className="px-3 py-2">Confidence</th>
                        <th className="px-3 py-2">State</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.disagreements.map((d) => (
                        <tr key={d.id} className="border-b border-border/60 align-top">
                          <td className="px-3 py-2 font-mono text-xs">{d.question_id}</td>
                          <td className="px-3 py-2 font-mono text-xs text-accent">{d.ours}</td>
                          <td className="px-3 py-2 font-mono text-xs">{d.incumbent}</td>
                          <td className="px-3 py-2 font-mono text-xs tabular-nums">{d.confidence.toFixed(2)}</td>
                          <td className="px-3 py-2 text-xs text-muted">{d.state_excerpt}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md bg-surface px-4 py-4 shadow-[var(--shadow-border)]">
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">{label}</p>
      <p className="mt-2 font-mono text-lg tabular-nums tracking-tight">{value}</p>
      {sub ? <p className="mt-1 font-mono text-[10px] text-muted">{sub}</p> : null}
    </div>
  );
}
