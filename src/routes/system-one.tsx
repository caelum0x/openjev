import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { AnswerView, TypePill } from "@/components/answer-view";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button";
import { CopyButton } from "@/components/copy-button";
import { api } from "@/lib/jev/browser";
import { evalGold } from "@/lib/jev/gold";
import type { Answer, SystemOneResponse } from "@/lib/jev/types";
import { cn } from "@/lib/utils";
import { pageHead } from "@/lib/seo/site";

export const Route = createFileRoute("/system-one")({
  head: () =>
    pageHead("System One", "The System One engine: typed Choice, Score and Noul judgments with calibrated probabilities."),
  component: SystemOnePage,
});

const REFUND_STATE = {
  ticket_message: "My flight was cancelled. Can I get a refund?",
  transactions: [{ id: "A-104", amount_usd: 240, status: "captured" }],
  refund_policy: "Cancelled flights are eligible for a full refund.",
};

const REFUND_QUESTIONS = {
  refund_requested: {
    type: "noul" as const,
    instructions: "Does `ticket_message` request a refund?",
  },
  request_type: {
    type: "choice" as const,
    instructions: "What is the main request in `ticket_message`?",
    criteria: {
      refund: "The customer wants money returned.",
      rebooking: "The customer wants a replacement flight.",
      information: "The customer is asking for information only.",
    },
  },
  frustration: {
    type: "score" as const,
    instructions: "How frustrated does the customer appear in `ticket_message`?",
    criteria: [
      "Calm and neutral.",
      "Concerned but civil.",
      "Very angry or using strong language.",
    ],
  },
};

const CURL = `curl -X POST /api/v1/systemone \\
  -H 'Content-Type: application/json' \\
  -H 'Authorization: Bearer $OPENJEV_API_KEY' \\
  -d '{
    "model": "system-one",
    "state": { "ticket_message": "My flight was cancelled. Can I get a refund?" },
    "questions": {
      "refund_requested": {
        "type": "noul",
        "instructions": "Does ticket_message request a refund?"
      }
    }
  }'`;

function SystemOnePage() {
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<SystemOneResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const gold = useMemo(() => evalGold("system-one"), []);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<SystemOneResponse>("/api/v1/systemone", {
        method: "POST",
        body: JSON.stringify({
          model: "system-one",
          state: REFUND_STATE,
          questions: REFUND_QUESTIONS,
        }),
      });
      setOut(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const route = out ? decideRefund(out.answers) : null;

  return (
    <AppShell>
      <article className="space-y-12">
        <header className="space-y-3">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">
            System One
          </p>
          <h1 className="max-w-3xl text-3xl font-medium tracking-tight md:text-4xl">
            Fast, structured decisions software can use directly.
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            A System One model evaluates a state and returns typed answers and
            probabilities. It understands natural language. It does not write
            replies, produce code, or explain itself. You define the possible
            answers through primitives.
          </p>
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            Text only. Strings, JSON objects, arrays of text. No images, audio,
            or video.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => void run()} disabled={busy}>
              {busy ? "Judging…" : "Run the refund example"}
            </Button>
            <Link
              to="/playground"
              className={cn(buttonVariants({ variant: "secondary" }))}
            >
              Open playground
            </Link>
          </div>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
        </header>

        <section className="space-y-3">
          <h2 className="text-lg font-medium tracking-tight">
            How it differs from an LLM
          </h2>
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            Probabilities can be calibrated against your labelled outcomes, and
            their calibration (ECE) on public data is measured on the{" "}
            <Link to="/leaderboard" className="text-fg underline underline-offset-2">
              leaderboard
            </Link>
            . An individual answer is not a guarantee. System One never generates prose — you get a
            Choice, a Score, or a Noul.
          </p>
          <div className="overflow-x-auto rounded-md bg-surface shadow-[var(--shadow-border)]">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-border font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                <tr>
                  <th className="px-3 py-2">Primitive</th>
                  <th className="px-3 py-2">Question</th>
                  <th className="px-3 py-2">Answer space</th>
                  <th className="px-3 py-2">Output</th>
                </tr>
              </thead>
              <tbody className="text-muted">
                <tr className="border-b border-border/60">
                  <td className="px-3 py-3 font-mono text-fg">Choice</td>
                  <td className="px-3 py-3">What is the main request?</td>
                  <td className="px-3 py-3">refund, rebooking, information</td>
                  <td className="px-3 py-3 font-mono text-fg">
                    {out?.answers.request_type?.type === "choice"
                      ? `choice: "${out.answers.request_type.choice}"`
                      : 'choice: "refund"'}
                  </td>
                </tr>
                <tr className="border-b border-border/60">
                  <td className="px-3 py-3 font-mono text-fg">Score</td>
                  <td className="px-3 py-3">How frustrated is this customer?</td>
                  <td className="px-3 py-3">0 calm · 1 concerned · 2 angry</td>
                  <td className="px-3 py-3 font-mono text-fg">
                    {out?.answers.frustration?.type === "score"
                      ? `score: ${out.answers.frustration.score.toFixed(1)}`
                      : "score: 1.4"}
                  </td>
                </tr>
                <tr>
                  <td className="px-3 py-3 font-mono text-fg">Noul</td>
                  <td className="px-3 py-3">Does this message request a refund?</td>
                  <td className="px-3 py-3">true or false</td>
                  <td className="px-3 py-3 font-mono text-fg">
                    {out?.answers.refund_requested?.type === "noul"
                      ? `noul: ${out.answers.refund_requested.noul.toFixed(2)}`
                      : "noul: 0.95"}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs leading-relaxed text-subtle">
            The name is Kahneman's: System 1 is fast and intuitive. System 2
            is slower and deliberate. Here the emphasis is fast, focused
            judgments.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-medium tracking-tight">
            Fast judgments inside a larger workflow
          </h2>
          <ol className="max-w-2xl list-decimal space-y-2 pl-5 text-sm leading-relaxed text-muted">
            <li>
              Build a state: the customer message, the transactions, the refund
              policy.
            </li>
            <li>
              Ask independent questions together: refund requested, request type,
              frustration.
            </li>
            <li>
              Combine the answers with deterministic checks in code, then route.
            </li>
          </ol>
          {out ? (
            <div className="grid gap-3 md:grid-cols-2">
              {Object.entries(out.answers).map(([id, ans]) => (
                <div
                  key={id}
                  className="space-y-3 rounded-md bg-surface p-4 shadow-[var(--shadow-border)]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-mono text-xs">{id}</p>
                    <TypePill type={ans.type} />
                  </div>
                  <AnswerView answer={ans} />
                </div>
              ))}
              {route ? (
                <div className="space-y-2 rounded-md bg-surface p-4 shadow-[var(--shadow-border)] md:col-span-2">
                  <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                    Your code
                  </p>
                  <p className="font-mono text-lg tracking-tight">{route.label}</p>
                  <p className="text-sm text-muted">{route.detail}</p>
                  <p className="font-mono text-xs text-subtle">
                    {out.model} · {out.latency_ms} ms · {out.usage.input_tokens} in /{" "}
                    {out.usage.output_tokens} out
                  </p>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted">
              Run the refund example to fill the table with a live{" "}
              <span className="font-mono text-fg">system-one</span> response.
            </p>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-medium tracking-tight">Confidence</h2>
          <ul className="max-w-2xl space-y-2 text-sm leading-relaxed text-muted">
            <li>
              Confidence is a single number (0–1) for how peaked a Choice or Score
              distribution is. Noul has no confidence field — threshold the noul
              itself.
            </li>
            <li>
              Probability is the distribution. Confidence collapses it so you can
              gate without hand-rolling entropy.
            </li>
            <li>
              Under 0.5: escalate. Medium: proceed with a confirm. 0.85+ before
              anything irreversible.
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-medium tracking-tight">Gold eval</h2>
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            Published gold examples plus calibration cases. The model is
            lexical and contrastive — structured <span className="font-mono">what</span>
            /<span className="font-mono">not_for</span>/
            <span className="font-mono">examples</span>, field-path focus, negation
            clash. Not a writer. The engine was tuned on these cases, so a
            high pass rate here is a regression check, not an accuracy claim —
            see the{" "}
            <Link to="/leaderboard" className="text-fg underline underline-offset-2">
              public-dataset leaderboard
            </Link>{" "}
            for measured accuracy.
          </p>
          <p className="font-mono text-sm">
            {gold.passed}/{gold.passed + gold.failed} passed
          </p>
          <ul className="divide-y divide-border overflow-hidden rounded-md bg-surface shadow-[var(--shadow-border)]">
            {gold.hits.map((h) => (
              <li
                key={h.id}
                className="flex items-baseline justify-between gap-3 px-3 py-2 font-mono text-xs"
              >
                <span className="truncate text-fg">{h.id}</span>
                <span className={h.ok ? "text-ok" : "text-danger"}>
                  {h.ok ? "pass" : "fail"} · {h.detail}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-medium tracking-tight">Call the model</h2>
            <CopyButton text={CURL} label="Copy curl" />
          </div>
          <pre className="overflow-x-auto rounded-md bg-surface p-4 font-mono text-[12px] leading-relaxed shadow-[var(--shadow-border)]">
            {CURL}
          </pre>
          <p className="text-sm text-muted">
            <span className="font-mono text-fg">POST /api/v1/systemone</span> · model{" "}
            <span className="font-mono text-fg">system-one</span> (alias{" "}
            <span className="font-mono text-fg">openjev-latest</span>). Same-origin
            playground needs no key.
          </p>
        </section>
      </article>
    </AppShell>
  );
}

function decideRefund(answers: Record<string, Answer>): {
  label: string;
  detail: string;
} {
  const noul =
    answers.refund_requested?.type === "noul"
      ? answers.refund_requested.noul
      : 0;
  const choice =
    answers.request_type?.type === "choice" ? answers.request_type : null;
  const score =
    answers.frustration?.type === "score" ? answers.frustration.score : 0;
  if (choice && choice.confidence < 0.5) {
    return {
      label: "escalate",
      detail: "Topic confidence under 0.5 — human review.",
    };
  }
  if (noul >= 0.7 && choice?.choice === "refund") {
    return {
      label: "refund",
      detail: `noul ${noul.toFixed(2)} · frustration ${score.toFixed(2)} · policy check stays in code.`,
    };
  }
  return {
    label: "review",
    detail: "Signals mixed. Keep the workflow in code.",
  };
}
