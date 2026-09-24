import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { CopyButton } from "@/components/copy-button";
import { buttonVariants } from "@/components/ui/button";
import { getActiveKey, setActiveKey } from "@/lib/jev/browser";
import { MODEL_CARDS } from "@/lib/jev/models";
import {
  absUrl,
  breadcrumbLd,
  softwareLd,
  SITE_NAME,
  OG_IMAGE,
} from "@/lib/seo/site";
import { cn } from "@/lib/utils";
import type { Answer, SystemOneResponse } from "@/lib/jev/types";

const PATH = "/api-explorer";
const TITLE = `API Explorer · ${SITE_NAME}`;
const DESCRIPTION =
  "Interactive console for the OpenJev System One API. Pick a model and ready-made example, edit state and typed questions, fire a live request, and inspect Choice / Score / Noul answers with latency and fallback info.";

export const Route = createFileRoute("/api-explorer")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      {
        name: "keywords",
        content:
          "api explorer, systemone api, typed decisions, choice score noul, api console, OpenJev interactive",
      },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:url", content: absUrl(PATH) },
      { property: "og:image", content: OG_IMAGE },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESCRIPTION },
      {
        "script:ld+json": breadcrumbLd([
          { name: "Home", path: "/" },
          { name: "API Explorer", path: PATH },
        ]),
      },
      { "script:ld+json": softwareLd() },
    ],
    links: [{ rel: "canonical", href: absUrl(PATH) }],
  }),
  component: ApiExplorerPage,
});

// ---------------------------------------------------------------------------
// Example payloads — each maps directly to the POST /api/v1/systemone wire
// format so the raw JSON can be copy-pasted as a curl body without changes.
// ---------------------------------------------------------------------------

type Example = {
  readonly label: string;
  readonly desc: string;
  readonly state: Record<string, unknown>;
  readonly questions: Record<string, unknown>;
};

const EXAMPLES: readonly Example[] = [
  {
    label: "Ticket triage",
    desc: "Choice routing + Score severity + Noul anger check over one support ticket.",
    state: {
      ticket:
        "I was charged twice for order #4821. This is completely unacceptable — please refund the duplicate charge immediately.",
    },
    questions: {
      category: {
        type: "choice",
        instructions: "Main request type in `ticket`?",
        criteria: {
          refund: "Wants money returned or a charge reversed.",
          rebooking: "Wants to change a booking or scheduled item.",
          info: "Asking for information only; no action required.",
        },
      },
      severity: {
        type: "score",
        instructions: "Urgency of `ticket` (0 = not urgent, 5 = critical)?",
        criteria: [
          "Not urgent at all",
          "Low priority",
          "Moderate urgency",
          "High urgency",
          "Very high urgency",
          "Critical",
        ],
      },
      is_angry: {
        type: "noul",
        instructions: "Does `ticket` express anger or strong frustration?",
      },
    },
  },
  {
    label: "Content moderation",
    desc: "Noul checklist — spam, PII request, policy violation — over a single user reply.",
    state: {
      reply:
        "Check out my site free-stuff-giveaway.xyz — sign up and win big! Enter your SSN to verify age.",
    },
    questions: {
      is_spam: {
        type: "noul",
        instructions:
          "Is `reply` unsolicited promotional content or a spam message?",
      },
      requests_pii: {
        type: "noul",
        instructions:
          "Does `reply` solicit personal data from the reader (SSN, credit card, address, login credentials)?",
      },
      violates_no_solicitation: {
        type: "noul",
        instructions:
          "Does `reply` violate a no-solicitation community policy by promoting an external site or product?",
      },
    },
  },
  {
    label: "Lead routing",
    desc: "Score lead quality and Choose the CRM queue for an inbound sales email.",
    state: {
      email:
        "Hi, we are a 500-person SaaS company evaluating typed-decision infrastructure for our compliance pipeline. Can we get pricing for 10M decisions per month?",
    },
    questions: {
      quality: {
        type: "score",
        instructions: "Lead quality of `email` (1 = poor, 4 = excellent)?",
        criteria: [
          "Poor fit or spam",
          "Weak signal — interested but not qualified",
          "Qualified interest — clear use case",
          "High-value opportunity — enterprise or strategic fit",
        ],
      },
      queue: {
        type: "choice",
        instructions: "Which CRM queue should `email` land in?",
        criteria: {
          enterprise:
            "Large accounts needing custom pricing, SLAs, or security review.",
          smb: "Small or medium business with standard self-serve needs.",
          nurture:
            "Interested but not ready to buy; schedule a follow-up sequence.",
          disqualify: "Not a genuine lead; mark closed.",
        },
      },
    },
  },
  {
    label: "Agent routing",
    desc: "Tool-selection Choice for an agent loop step — which tool best advances the goal?",
    state: {
      userGoal:
        "Find the current price of AAPL and calculate what 150 shares would cost.",
      lastResult: null,
      availableTools: ["search", "calculate", "respond"],
    },
    questions: {
      next_tool: {
        type: "choice",
        instructions: "Which tool best advances `userGoal` right now?",
        criteria: {
          search: "Look up external or real-time information from the web.",
          calculate:
            "Do arithmetic or data transforms on values already available.",
          respond:
            "All required information is known; give the user the final answer.",
        },
      },
    },
  },
  {
    label: "Compliance check",
    desc: "Noul checklist verifying four GDPR-relevant clauses in a privacy policy.",
    state: {
      policy:
        "We collect your name and email to send newsletters. You can unsubscribe at any time by clicking the link in any email. We do not share your data with third parties for marketing purposes.",
    },
    questions: {
      defines_personal_data: {
        type: "noul",
        instructions:
          "Does `policy` define or enumerate what personal data is collected?",
      },
      states_lawful_basis: {
        type: "noul",
        instructions:
          "Does `policy` state the lawful basis for processing (consent, legitimate interest, contract, etc.)?",
      },
      breach_notification: {
        type: "noul",
        instructions:
          "Does `policy` mention a data breach notification procedure or required timeline?",
      },
      allows_opt_out: {
        type: "noul",
        instructions:
          "Does `policy` explain how a data subject can withdraw consent, opt out, or request deletion?",
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Answer display
// ---------------------------------------------------------------------------

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

function ConfidenceBar({
  value,
  active,
}: {
  value: number;
  active: boolean;
}) {
  return (
    <div className="h-1.5 flex-1 rounded-full bg-raised">
      <div
        className={cn(
          "h-full rounded-full transition-all",
          active ? "bg-ok" : "bg-border",
        )}
        style={{ width: pct(value) }}
      />
    </div>
  );
}

function AnswerCard({ label, answer }: { label: string; answer: Answer }) {
  if (answer.type === "choice") {
    const sorted = [...Object.entries(answer.probabilities)].sort(
      ([, a], [, b]) => b - a,
    );
    return (
      <div className="space-y-3 rounded-md bg-surface p-4 shadow-[var(--shadow-border)]">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-sm text-fg">{label}</span>
          <span className="rounded-full bg-raised px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
            choice
          </span>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-sm font-medium text-fg">{answer.choice}</span>
          <span className="font-mono text-xs text-muted">
            conf {answer.confidence.toFixed(3)}
          </span>
        </div>
        <div className="space-y-1.5">
          {sorted.map(([option, prob]) => (
            <div key={option} className="flex items-center gap-2 text-xs">
              <span
                className={cn(
                  "w-28 shrink-0 truncate font-mono",
                  option === answer.choice ? "text-fg" : "text-muted",
                )}
              >
                {option}
              </span>
              <ConfidenceBar value={prob} active={option === answer.choice} />
              <span className="w-10 shrink-0 font-mono text-right text-subtle">
                {pct(prob)}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (answer.type === "score") {
    const sorted = [...Object.entries(answer.probabilities)].sort(
      ([a], [b]) => Number(a) - Number(b),
    );
    return (
      <div className="space-y-3 rounded-md bg-surface p-4 shadow-[var(--shadow-border)]">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-sm text-fg">{label}</span>
          <span className="rounded-full bg-raised px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
            score
          </span>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-sm font-medium text-fg">
            {answer.score}
          </span>
          <span className="font-mono text-xs text-muted">
            conf {answer.confidence.toFixed(3)}
          </span>
        </div>
        <div className="space-y-1.5">
          {sorted.map(([level, prob]) => {
            const active = Number(level) === answer.score;
            return (
              <div key={level} className="flex items-center gap-2 text-xs">
                <span
                  className={cn(
                    "w-6 shrink-0 font-mono text-center",
                    active ? "text-fg" : "text-muted",
                  )}
                >
                  {level}
                </span>
                <ConfidenceBar value={prob} active={active} />
                <span className="w-10 shrink-0 font-mono text-right text-subtle">
                  {pct(prob)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // noul
  const isYes = answer.noul >= 0.5;
  return (
    <div className="space-y-3 rounded-md bg-surface p-4 shadow-[var(--shadow-border)]">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-sm text-fg">{label}</span>
        <span className="rounded-full bg-raised px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
          noul
        </span>
      </div>
      <div className="flex items-center gap-3">
        <ConfidenceBar value={answer.noul} active={isYes} />
        <span className="w-14 shrink-0 font-mono text-sm text-fg">
          {answer.noul.toFixed(3)}
        </span>
        <span
          className={cn(
            "w-6 shrink-0 font-mono text-xs",
            isYes ? "text-ok" : "text-muted",
          )}
        >
          {isYes ? "yes" : "no"}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function ApiExplorerPage() {
  const [exampleIdx, setExampleIdx] = useState(0);
  const [model, setModel] = useState("system-one");
  const [stateJson, setStateJson] = useState(
    JSON.stringify(EXAMPLES[0].state, null, 2),
  );
  const [questionsJson, setQuestionsJson] = useState(
    JSON.stringify(EXAMPLES[0].questions, null, 2),
  );
  const [apiKey, setApiKeyLocal] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SystemOneResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [roundtripMs, setRoundtripMs] = useState<number | null>(null);

  useEffect(() => {
    const k = getActiveKey();
    if (k) setApiKeyLocal(k);
  }, []);

  useEffect(() => {
    const ex = EXAMPLES[exampleIdx];
    if (!ex) return;
    setStateJson(JSON.stringify(ex.state, null, 2));
    setQuestionsJson(JSON.stringify(ex.questions, null, 2));
    setResult(null);
    setErrorMsg(null);
    setRoundtripMs(null);
  }, [exampleIdx]);

  function handleKeyChange(v: string) {
    setApiKeyLocal(v);
    setActiveKey(v.trim() || null);
  }

  async function fire() {
    setLoading(true);
    setErrorMsg(null);
    setResult(null);
    setRoundtripMs(null);

    let stateVal: unknown;
    let questionsVal: unknown;

    try {
      stateVal = JSON.parse(stateJson);
    } catch {
      setErrorMsg("State is not valid JSON.");
      setLoading(false);
      return;
    }

    try {
      questionsVal = JSON.parse(questionsJson);
    } catch {
      setErrorMsg("Questions is not valid JSON.");
      setLoading(false);
      return;
    }

    const body = JSON.stringify({ model, state: stateVal, questions: questionsVal });
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const trimmedKey = apiKey.trim();
    if (trimmedKey) headers["Authorization"] = `Bearer ${trimmedKey}`;

    const t0 = performance.now();
    try {
      const res = await fetch("/api/v1/systemone", {
        method: "POST",
        headers,
        body,
      });
      const ms = Math.round(performance.now() - t0);
      setRoundtripMs(ms);
      const json = (await res.json()) as unknown;
      if (!res.ok) {
        const e = json as { error?: { message?: string } };
        setErrorMsg(e?.error?.message ?? `Request failed (${res.status})`);
      } else {
        setResult(json as SystemOneResponse);
      }
    } catch (err) {
      setRoundtripMs(Math.round(performance.now() - t0));
      setErrorMsg(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  const requestPreview = (() => {
    try {
      return JSON.stringify(
        {
          model,
          state: JSON.parse(stateJson),
          questions: JSON.parse(questionsJson),
        },
        null,
        2,
      );
    } catch {
      return `{ "model": "${model}", "state": ..., "questions": ... }`;
    }
  })();

  return (
    <AppShell>
      <div className="space-y-8">
        {/* Header */}
        <header className="space-y-3">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">
            API Explorer
          </p>
          <h1 className="text-3xl font-medium tracking-tight md:text-4xl">
            Interactive System One console
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            Pick a ready-made example or write your own JSON. Fire a live
            request against{" "}
            <span className="font-mono text-fg">POST /api/v1/systemone</span>{" "}
            and inspect typed Choice / Score / Noul answers with server latency
            and fallback status.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Link
              to="/docs/$slug"
              params={{ slug: "api-reference" }}
              className={cn(buttonVariants({ variant: "secondary" }))}
            >
              API reference
            </Link>
            <Link
              to="/models"
              className={cn(buttonVariants({ variant: "secondary" }))}
            >
              Models
            </Link>
          </div>
        </header>

        {/* Example picker */}
        <section className="space-y-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
            Ready-made examples
          </p>
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((ex, i) => (
              <button
                key={ex.label}
                type="button"
                onClick={() => setExampleIdx(i)}
                className={cn(
                  "rounded-md px-3 py-1.5 font-mono text-xs transition-colors",
                  i === exampleIdx
                    ? "bg-raised text-fg shadow-[var(--shadow-border)]"
                    : "text-muted hover:text-fg",
                )}
              >
                {ex.label}
              </button>
            ))}
          </div>
          {EXAMPLES[exampleIdx] ? (
            <p className="text-xs leading-relaxed text-subtle">
              {EXAMPLES[exampleIdx].desc}
            </p>
          ) : null}
        </section>

        {/* Main grid: inputs left, response right */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* ── Inputs ── */}
          <div className="space-y-4">
            {/* Model selector */}
            <div className="space-y-1.5">
              <label
                htmlFor="model-select"
                className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle"
              >
                Model
              </label>
              <select
                id="model-select"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm text-fg focus:outline-none focus:ring-1 focus:ring-border"
              >
                {MODEL_CARDS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id} — {m.label}
                  </option>
                ))}
              </select>
            </div>

            {/* State JSON */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="state-input"
                  className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle"
                >
                  State (JSON)
                </label>
                <CopyButton text={stateJson} />
              </div>
              <textarea
                id="state-input"
                value={stateJson}
                onChange={(e) => setStateJson(e.target.value)}
                spellCheck={false}
                rows={6}
                className="w-full resize-y rounded-md border border-border bg-inset p-3 font-mono text-[12px] leading-relaxed text-fg focus:outline-none focus:ring-1 focus:ring-border"
              />
            </div>

            {/* Questions JSON */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="questions-input"
                  className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle"
                >
                  Questions (JSON)
                </label>
                <CopyButton text={questionsJson} />
              </div>
              <textarea
                id="questions-input"
                value={questionsJson}
                onChange={(e) => setQuestionsJson(e.target.value)}
                spellCheck={false}
                rows={16}
                className="w-full resize-y rounded-md border border-border bg-inset p-3 font-mono text-[12px] leading-relaxed text-fg focus:outline-none focus:ring-1 focus:ring-border"
              />
            </div>

            {/* API key */}
            <div className="space-y-1.5">
              <label
                htmlFor="api-key"
                className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle"
              >
                API key (optional — anonymous calls are allowed)
              </label>
              <input
                id="api-key"
                type="password"
                value={apiKey}
                onChange={(e) => handleKeyChange(e.target.value)}
                placeholder="sk-..."
                autoComplete="off"
                className="w-full rounded-md border border-border bg-inset px-3 py-2 font-mono text-sm text-fg placeholder:text-subtle focus:outline-none focus:ring-1 focus:ring-border"
              />
            </div>

            {/* Send */}
            <button
              type="button"
              onClick={fire}
              disabled={loading}
              className={cn(
                buttonVariants({ variant: "primary" }),
                "w-full",
                loading && "opacity-60",
              )}
            >
              {loading ? "Sending..." : "Send request →"}
            </button>

            {/* Full request payload (collapsed) */}
            <details className="rounded-md bg-surface p-4 shadow-[var(--shadow-border)]">
              <summary className="flex cursor-pointer items-center justify-between gap-2">
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                  Full request payload
                </span>
                <CopyButton text={requestPreview} />
              </summary>
              <pre className="mt-3 overflow-x-auto rounded-sm bg-inset p-3 font-mono text-[11px] leading-relaxed text-fg">
                {requestPreview}
              </pre>
            </details>
          </div>

          {/* ── Response ── */}
          <div className="space-y-4">
            {/* Empty state */}
            {!result && !errorMsg && !loading ? (
              <div className="flex h-48 items-center justify-center rounded-md border border-border/40 bg-surface/40">
                <p className="text-sm text-subtle">
                  Response will appear here
                </p>
              </div>
            ) : null}

            {/* Loading state */}
            {loading ? (
              <div className="flex h-48 items-center justify-center rounded-md border border-border/40 bg-surface/40">
                <p className="font-mono text-sm text-subtle">Sending...</p>
              </div>
            ) : null}

            {/* Error */}
            {errorMsg ? (
              <div className="rounded-md bg-surface p-4 shadow-[var(--shadow-border)]">
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
                  Error
                </p>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">
                  {errorMsg}
                </p>
              </div>
            ) : null}

            {/* Fallback banner */}
            {result?.fallback ? (
              <div className="rounded-md bg-surface p-4 shadow-[var(--shadow-border)]">
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                  Backend fallback
                </p>
                <p className="mt-1.5 text-xs leading-relaxed text-muted">
                  Requested{" "}
                  <span className="font-mono text-fg">
                    {result.fallback.requested}
                  </span>
                  {" — "}served by{" "}
                  <span className="font-mono text-fg">
                    {result.fallback.served}
                  </span>
                  .{" "}
                  {result.fallback.detail}
                </p>
              </div>
            ) : null}

            {/* Response metadata */}
            {result ? (
              <div className="flex flex-wrap gap-x-6 gap-y-3 rounded-md bg-surface p-4 shadow-[var(--shadow-border)]">
                <div className="space-y-0.5">
                  <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-subtle">
                    Model
                  </p>
                  <p className="font-mono text-sm text-fg">{result.model}</p>
                </div>
                <div className="space-y-0.5">
                  <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-subtle">
                    Server latency
                  </p>
                  <p className="font-mono text-sm text-fg">
                    {result.latency_ms} ms
                  </p>
                </div>
                {roundtripMs !== null ? (
                  <div className="space-y-0.5">
                    <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-subtle">
                      Round-trip
                    </p>
                    <p className="font-mono text-sm text-fg">
                      {roundtripMs} ms
                    </p>
                  </div>
                ) : null}
                <div className="space-y-0.5">
                  <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-subtle">
                    Tokens in / out
                  </p>
                  <p className="font-mono text-sm text-fg">
                    {result.usage.input_tokens} / {result.usage.output_tokens}
                  </p>
                </div>
              </div>
            ) : null}

            {/* Answers */}
            {result ? (
              <div className="space-y-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                  Answers ({Object.keys(result.answers).length})
                </p>
                {Object.entries(result.answers).map(([key, answer]) => (
                  <AnswerCard key={key} label={key} answer={answer} />
                ))}
              </div>
            ) : null}

            {/* Raw JSON (collapsed) */}
            {result ? (
              <details className="rounded-md bg-surface p-4 shadow-[var(--shadow-border)]">
                <summary className="flex cursor-pointer items-center justify-between gap-2">
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                    Raw JSON response
                  </span>
                  <CopyButton text={JSON.stringify(result, null, 2)} />
                </summary>
                <pre className="mt-3 overflow-x-auto rounded-sm bg-inset p-3 font-mono text-[11px] leading-relaxed text-fg">
                  {JSON.stringify(result, null, 2)}
                </pre>
              </details>
            ) : null}
          </div>
        </div>

        {/* Footer */}
        <footer className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-6 text-sm text-muted">
          <Link to="/docs/$slug" params={{ slug: "api-reference" }} className="hover:text-fg">
            API reference
          </Link>
          <Link to="/models" className="hover:text-fg">
            Models
          </Link>
          <Link to="/playground" className="hover:text-fg">
            Playground
          </Link>
          <Link to="/guides" className="hover:text-fg">
            Guides
          </Link>
          <span className="ml-auto font-mono text-[11px] uppercase tracking-[0.14em] text-subtle">
            OpenJev · Apache-2.0
          </span>
        </footer>
      </div>
    </AppShell>
  );
}
