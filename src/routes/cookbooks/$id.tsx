import { useState, type ReactNode } from "react";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ContentNotFound } from "@/components/content-not-found";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AnswerView, TypePill } from "@/components/answer-view";
import { CopyButton } from "@/components/copy-button";
import { COOKBOOKS } from "@/lib/jev/cookbooks";
import { patternById } from "@/lib/jev/cookbooks/patterns";
import { PatternDemo } from "@/components/pattern-demo";
import { api } from "@/lib/jev/browser";
import type { Answer, SystemOneResponse } from "@/lib/jev/types";
import { FUNCTION_EXAMPLES } from "@/lib/jev/cookbooks/function-calling";
import { SmarthomeDemo } from "@/components/smarthome-demo";
import {
  EngineBadge,
  ServingEngineNote,
  ThresholdSetNote,
  type ThresholdsInfo,
} from "@/components/engine-badge";
import { cn } from "@/lib/utils";
import { pageHead } from "@/lib/seo/site";

type EngineInfo = SystemOneResponse["engine"] | null;

export const Route = createFileRoute("/cookbooks/$id")({
  loader: ({ params }) => {
    if (!COOKBOOKS.find((c) => c.id === params.id)) throw notFound();
  },
  notFoundComponent: () => (
    <ContentNotFound kind="Cookbook" backTo="/cookbooks" backLabel="All cookbooks" />
  ),
  head: ({ params }) => {
    const meta = COOKBOOKS.find((c) => c.id === params.id);
    return meta ? pageHead(`${meta.title} · Cookbooks`, meta.blurb) : pageHead("Unknown cookbook");
  },
  component: CookbookPage,
});

/**
 * Per-cookbook "How it works" steps and the endpoint each demo below actually
 * POSTs to. Pattern cookbooks (fan-out / confidence / composite / intent) send
 * their questions to /api/v1/systemone; the bespoke cookbooks have their own
 * /api/v1/cookbooks/{id} endpoint that wraps the same engine with glue code.
 */
const RECIPES: Record<string, { endpoint: string; steps: ReadonlyArray<string> }> = {
  "fan-out": {
    endpoint: "POST /api/v1/systemone",
    steps: [
      "Build one state: the ticket message, the refund policy, and the order charges.",
      "Ask every question a branch might need in a single call — refund requested, duplicate charge, policy support, request type, frustration, needs-human.",
      "Keep the slice your branch needs; the questions you throw away barely move latency.",
      "Combine the typed answers in code: escalate if needs_human is high, refund when requested and policy are both clear.",
    ],
  },
  confidence: {
    endpoint: "POST /api/v1/systemone",
    steps: [
      "Send the customer message as the state.",
      "Ask a Choice for the department and a Choice for the tone.",
      "Read the Choice confidence, not just the winning label.",
      "Under 0.5 → human review; under 0.85 → route with a confirm; 0.85+ → auto-route.",
    ],
  },
  composite: {
    endpoint: "POST /api/v1/systemone",
    steps: [
      "Pass the suspicious message as the state.",
      "Ask three atomic Noul questions: credential request, unexpected reward, fake urgency.",
      "Combine them with weights you own in code (0.45 / 0.30 / 0.25).",
      "Threshold the weighted risk: ≥0.6 quarantine, ≥0.35 review, otherwise deliver.",
    ],
  },
  intent: {
    endpoint: "POST /api/v1/systemone",
    steps: [
      "Send the inbound message as the state.",
      "Ask a Choice over a fixed candidate set (billing / technical / account) with what / not_for / examples, plus a Noul for urgency.",
      "Never let the model invent the option list — the candidates come from code.",
      "Gate on confidence, then set the SLA from urgency and route.",
    ],
  },
  parallel: {
    endpoint: "POST /api/v1/cookbooks/parallel",
    steps: [
      "Load a GDPR excerpt as the state.",
      "Fan 13 independent questions into one System One call.",
      "Extra questions are cheap; extra round-trips are not — batching is the whole trick.",
      "Render all 13 typed answers from a single response.",
    ],
  },
  cascade: {
    endpoint: "POST /api/v1/cookbooks/cascade",
    steps: [
      "Extract a commercial invoice into a typed record with a cheap mini pass.",
      "Verify every field with a per-field Noul — P(wrong).",
      "Escalate a field to the expensive reasoner only when its Noul fires above the threshold.",
      "Get most of a reasoner's quality at a fraction of the cost. Toggle poison to force a fire.",
    ],
  },
  consistency: {
    endpoint: "POST /api/v1/cookbooks/consistency",
    steps: [
      "Pass an auto-insurance claim as the state.",
      "Score it against a 15-question adjudication rubric in one pass.",
      "Writer-model answers wander run to run; System One returns stable noul probabilities.",
      "Gate pay / deny / human-review on the rubric nouls in code.",
    ],
  },
  "function-calling": {
    endpoint: "POST /api/v1/cookbooks/function-calling",
    steps: [
      "Take a natural-language trading request.",
      "Ask System One for the function name and each closed-set argument as typed questions — speculative fan-out.",
      "Code owns the real functions and defaults; omit low-probability arguments.",
      "Dispatch the typed call with a confidence and the weakest argument surfaced.",
    ],
  },
  smarthome: {
    endpoint: "POST /api/v1/cookbooks/smarthome",
    steps: [
      "One System One call asks every question a house might need — category, domain, device, and a speculative action per device type.",
      "Code keeps only the slice that matches the resolved device.",
      "Compound requests split (writer if available, heuristic otherwise).",
      "Conversation and general information fall through to a short writer reply; device status stays in code.",
    ],
  },
};

function Recipe({ id }: { id: string }) {
  const recipe = RECIPES[id];
  if (!recipe) return null;
  return (
    <section className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-start">
      <div className="space-y-3 rounded-md bg-surface p-5 shadow-[var(--shadow-border)]">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
          How it works
        </p>
        <ol className="space-y-2 text-sm leading-relaxed text-muted">
          {recipe.steps.map((s, i) => (
            <li key={s} className="flex gap-3">
              <span className="mt-0.5 font-mono text-xs text-subtle tabular-nums">
                {i + 1}.
              </span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
      </div>
      <div className="flex items-center gap-2 rounded-md bg-surface px-4 py-3 shadow-[var(--shadow-border)]">
        <span className="font-mono text-xs text-fg">{recipe.endpoint}</span>
        <CopyButton text={recipe.endpoint} label="" />
      </div>
    </section>
  );
}

function CookbookPage() {
  const { id } = Route.useParams();
  const meta = COOKBOOKS.find((c) => c.id === id);

  if (!meta) {
    return (
      <AppShell>
        <p className="text-sm text-muted">Unknown cookbook.</p>
        <Link to="/cookbooks" className="mt-3 inline-block text-sm text-fg">
          All cookbooks
        </Link>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <header className="space-y-2">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">
            {meta.stat}
          </p>
          <h1 className="text-2xl font-medium tracking-tight">{meta.title}</h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            {meta.blurb}
          </p>
        </header>
        <Recipe id={id} />
        <ServingEngineNote />
        {id === "parallel" ? <ParallelDemo /> : null}
        {id === "cascade" ? <CascadeDemo /> : null}
        {id === "consistency" ? <ConsistencyDemo /> : null}
        {id === "function-calling" ? <FunctionDemo /> : null}
        {id === "smarthome" ? <SmarthomeDemo /> : null}
        {(() => {
          const pattern = patternById(id);
          return pattern ? <PatternDemo pattern={pattern} /> : null;
        })()}
      </div>
    </AppShell>
  );
}

function ParallelDemo() {
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<(SystemOneResponse & { questions?: number }) | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setOut(
        await api("/api/v1/cookbooks/parallel", {
          method: "POST",
          body: "{}",
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Button type="button" onClick={() => void run()} disabled={busy}>
        {busy ? "Running 13 questions…" : "Run GDPR briefing"}
      </Button>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {out ? (
        <div className="space-y-3">
          <EngineBadge engine={out.engine} model={out.model} />
          <p className="font-mono text-xs text-subtle">
            {out.questions ?? Object.keys(out.answers).length} questions · one call ·{" "}
            {out.latency_ms} ms · {out.usage.input_tokens} in / {out.usage.output_tokens}{" "}
            out
          </p>
          <AnswerGrid answers={out.answers} />
        </div>
      ) : null}
    </div>
  );
}

function CascadeDemo() {
  const [poison, setPoison] = useState(false);
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<null | {
    stages: {
      mini: { record: Record<string, unknown> };
      verify: {
        escalate: boolean;
        max_wrong: number;
        fire_threshold: number;
        thresholds?: ThresholdsInfo;
        flags: Array<{ id: string; noul: number; fire: boolean }>;
      };
      reasoning: { escalated: boolean; reason?: string };
    };
    final: Record<string, unknown>;
    model: string;
    engine: EngineInfo;
    latency_ms: number;
  }>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setOut(
        await api("/api/v1/cookbooks/cascade", {
          method: "POST",
          body: JSON.stringify({ poison }),
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <label className="flex h-11 items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={poison}
          onChange={(e) => setPoison(e.target.checked)}
          className="size-4 accent-fg"
        />
        Poison the mini extract (wrong total, IBAN, buyer)
      </label>
      <Button type="button" onClick={() => void run()} disabled={busy}>
        {busy ? "Verifying…" : "Run cascade"}
      </Button>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {out ? <EngineBadge engine={out.engine} model={out.model} /> : null}
      {out ? <ThresholdSetNote thresholds={out.stages.verify.thresholds} /> : null}
      {out ? (
        <div className="grid gap-3 md:grid-cols-3">
          <Stage title="1. Mini extract">
            <pre className="overflow-x-auto font-mono text-[11px] leading-relaxed">
              {JSON.stringify(out.stages.mini.record, null, 2)}
            </pre>
          </Stage>
          <Stage title="2. Verify (noul)">
            <p className="font-mono text-xs text-muted">
              max P(wrong) {out.stages.verify.max_wrong} · fire {">"}{" "}
              {out.stages.verify.fire_threshold}
            </p>
            <ul className="mt-2 space-y-1">
              {out.stages.verify.flags.slice(0, 8).map((f) => (
                <li
                  key={f.id}
                  className={cn(
                    "flex justify-between gap-2 font-mono text-[11px]",
                    f.fire ? "text-danger" : "text-muted",
                  )}
                >
                  <span className="truncate">{f.id}</span>
                  <span>{f.noul.toFixed(2)}</span>
                </li>
              ))}
            </ul>
          </Stage>
          <Stage title="3. Reasoner">
            <p className="text-sm">
              {out.stages.verify.escalate
                ? `Escalated. ${out.stages.reasoning.reason ?? ""}`
                : "Kept mini extract. No field fired."}
            </p>
            <pre className="mt-2 overflow-x-auto font-mono text-[11px] leading-relaxed">
              {JSON.stringify(out.final, null, 2)}
            </pre>
          </Stage>
        </div>
      ) : null}
    </div>
  );
}

function ConsistencyDemo() {
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<null | {
    decision: string;
    gates: Record<string, number>;
    thresholds?: ThresholdsInfo;
    note: string;
    latency_ms: number;
    rows: Array<{
      id: string;
      typesafe: number;
      llm_mean: number;
      llm_std: number;
      llm_range: [number, number];
    }>;
    model: string;
    engine: EngineInfo;
  }>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setOut(
        await api("/api/v1/cookbooks/consistency", {
          method: "POST",
          body: "{}",
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Button type="button" onClick={() => void run()} disabled={busy}>
        {busy ? "Scoring rubric…" : "Adjudicate claim"}
      </Button>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {out ? (
        <div className="space-y-4">
          <EngineBadge engine={out.engine} model={out.model} />
          <ThresholdSetNote thresholds={out.thresholds} />
          <p className="text-sm text-muted">{out.note}</p>
          <p className="font-mono text-sm">
            Decision: <span className="text-fg">{out.decision}</span>
            <span className="ml-3 text-subtle">
              pay {out.gates.pay.toFixed(2)} · deny {out.gates.deny.toFixed(2)} ·
              human {out.gates.human_review.toFixed(2)}
            </span>
          </p>
          <div className="overflow-x-auto rounded-md bg-surface shadow-[var(--shadow-border)]">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-border font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                <tr>
                  <th className="px-3 py-2">Question</th>
                  <th className="px-3 py-2">TypeSafe noul</th>
                  <th className="px-3 py-2">LLM mean</th>
                  <th className="px-3 py-2">LLM σ</th>
                </tr>
              </thead>
              <tbody>
                {out.rows.map((r) => (
                  <tr key={r.id} className="border-b border-border/60">
                    <td className="px-3 py-2 font-mono text-xs">{r.id}</td>
                    <td className="px-3 py-2 font-mono text-xs tabular-nums">
                      {r.typesafe.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs tabular-nums text-muted">
                      {r.llm_mean.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs tabular-nums text-muted">
                      {r.llm_std.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FunctionDemo() {
  const [command, setCommand] = useState(FUNCTION_EXAMPLES[0]!);
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<null | {
    call: {
      name: string;
      confidence: number;
      weakest: string;
      arguments: Record<
        string,
        { value: unknown; omitted: boolean; probability: number }
      >;
    };
    questions_asked: number;
    latency_ms: number;
    model: string;
    engine: EngineInfo;
  }>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setOut(
        await api("/api/v1/cookbooks/function-calling", {
          method: "POST",
          body: JSON.stringify({ command }),
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {FUNCTION_EXAMPLES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCommand(c)}
            className={cn(
              "h-11 rounded-sm px-3 text-left text-xs",
              command === c ? "bg-raised text-fg" : "text-muted hover:text-fg",
            )}
          >
            {c}
          </button>
        ))}
      </div>
      <Input value={command} onChange={(e) => setCommand(e.target.value)} />
      <Button type="button" onClick={() => void run()} disabled={busy}>
        {busy ? "Dispatching…" : "Dispatch"}
      </Button>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {out ? <EngineBadge engine={out.engine} model={out.model} /> : null}
      {out ? (
        <div className="space-y-3 rounded-md bg-surface p-4 shadow-[var(--shadow-border)]">
          <p className="font-mono text-sm">
            {out.call.name}(
            {Object.entries(out.call.arguments)
              .filter(([, a]) => !a.omitted)
              .map(([k, a]) => `${k}=${JSON.stringify(a.value)}`)
              .join(", ")}
            )
          </p>
          <p className="font-mono text-xs text-subtle">
            confidence {out.call.confidence.toFixed(2)} · weakest {out.call.weakest} ·{" "}
            {out.questions_asked} questions batched · {out.latency_ms} ms
          </p>
          <ul className="space-y-1">
            {Object.entries(out.call.arguments).map(([k, a]) => (
              <li key={k} className="flex justify-between gap-3 font-mono text-xs">
                <span className={a.omitted ? "text-subtle" : "text-fg"}>
                  {k}
                  {a.omitted ? " (omitted)" : ""}
                </span>
                <span className="text-muted">
                  {a.omitted ? "default" : JSON.stringify(a.value)} · p{" "}
                  {a.probability.toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Stage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-2 rounded-md bg-surface p-4 shadow-[var(--shadow-border)]">
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
        {title}
      </p>
      {children}
    </div>
  );
}

function AnswerGrid({ answers }: { answers: Record<string, Answer> }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {Object.entries(answers).map(([id, ans]) => (
        <div
          key={id}
          className="space-y-3 rounded-md bg-surface p-4 shadow-[var(--shadow-border)]"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="truncate font-mono text-xs">{id}</p>
            <TypePill type={ans.type} />
          </div>
          <AnswerView answer={ans} />
        </div>
      ))}
    </div>
  );
}
