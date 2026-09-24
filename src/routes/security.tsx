import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { pageHead } from "@/lib/seo/site";

export const Route = createFileRoute("/security")({
  head: () =>
    pageHead("Trust Center", "How OpenJev handles security, data, and responsible disclosure."),
  component: SecurityPage,
});

const PILLARS: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: "Self-host means your infrastructure",
    body: "openjev is Apache-2.0 software you run yourself. In the default deployment there is no openjev-operated service in the request path. State, questions, answers, and keys stay inside the process and network you control. There is nothing to trust us about because we are not there.",
  },
  {
    title: "No training on your data",
    body: "The System One backends (laya-mlx, laya-onnx, native) are inference-only. They read the state you send, return a Choice / Score / Noul, and keep no copy. There is no feedback loop, no fine-tuning on your traffic, no telemetry that ships prompts off the box. When you point the any-LLM backend at a third party, that provider's policy applies — you choose it explicitly.",
  },
  {
    title: "Keys are yours to mint and revoke",
    body: "ots_live_ keys are generated, hashed, and stored by your instance. They are shown once at creation and never again. A same-origin playground request needs no key at all. Delete a key and it stops working immediately — no propagation delay across our systems, because there are no other systems.",
  },
  {
    title: "Small, auditable surface",
    body: "One endpoint does the work: POST /api/v1/systemone. Text in, typed judgment out — no code execution, no tool calls, no outbound network from the primitives themselves. The whole engine is open source, so you can read exactly what it does before you run it.",
  },
];

const DATA_FLOW: ReadonlyArray<{ step: string; detail: string }> = [
  {
    step: "Request",
    detail: "Your code POSTs a state and a map of typed questions to your instance over HTTP(S) you terminate.",
  },
  {
    step: "Inference",
    detail: "The configured backend evaluates each question independently in-process. No question is sent anywhere the backend config doesn't name.",
  },
  {
    step: "Response",
    detail: "Answers come back under the same keys with probabilities and token usage. The engine retains nothing beyond in-memory usage counters you can disable.",
  },
  {
    step: "Retention",
    detail: "Preview usage metering lives in memory and resets on restart. Persistent logging is opt-in and writes only to storage you provision.",
  },
];

const THREATS: ReadonlyArray<{ threat: string; mitigation: string }> = [
  {
    threat: "Prompt/state exfiltration to a vendor",
    mitigation: "Default backends are local and inference-only. Nothing leaves the box unless you select the any-LLM backend and name the endpoint.",
  },
  {
    threat: "Leaked API key",
    mitigation: "Keys are hashed at rest and shown once. Scope keys per service, rotate on a schedule, and revoke instantly from the Keys console.",
  },
  {
    threat: "Prompt injection via untrusted state",
    mitigation: "System One never executes instructions inside state — it only judges it against your criteria. Treat state as data; validate it at your boundary before sending.",
  },
  {
    threat: "Over-trusting a single answer",
    mitigation: "Probabilities are calibrated but individual answers are not guarantees. Gate irreversible actions on confidence thresholds and keep a human in the loop for low-confidence outcomes.",
  },
  {
    threat: "Supply-chain tampering",
    mitigation: "Source is public and Apache-2.0. Pin the image digest or build from a tagged commit; verify dependencies with your own SCA tooling.",
  },
  {
    threat: "Denial of service",
    mitigation: "Self-host is bounded by your hardware — put the endpoint behind your own rate limiter and auth gateway. Hosted keys carry per-key limits.",
  },
];

function SecurityPage() {
  return (
    <AppShell>
      <article className="mx-auto max-w-3xl space-y-14">
        <header className="space-y-4">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">
            Trust Center
          </p>
          <h1 className="max-w-2xl text-3xl font-medium tracking-tight md:text-4xl">
            Security &amp; data handling
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            OpenJev is designed to be run by you, on your own
            infrastructure. The most important security property is architectural:
            in the default deployment, your data never touches a machine we
            operate. This page describes how the engine handles state, keys, and
            inference, and the threats we design against.
          </p>
        </header>

        <section className="grid gap-3 sm:grid-cols-2">
          {PILLARS.map((p) => (
            <div
              key={p.title}
              className="space-y-2 rounded-md bg-surface p-5 shadow-[var(--shadow-border)]"
            >
              <h2 className="text-base font-medium tracking-tight text-fg">
                {p.title}
              </h2>
              <p className="text-sm leading-relaxed text-muted">{p.body}</p>
            </div>
          ))}
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-medium tracking-tight">
            How data flows through a request
          </h2>
          <ol className="space-y-3">
            {DATA_FLOW.map((f, i) => (
              <li
                key={f.step}
                className="flex gap-4 rounded-md bg-surface p-4 shadow-[var(--shadow-border)]"
              >
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-raised font-mono text-xs text-fg">
                  {i + 1}
                </span>
                <div className="space-y-0.5">
                  <p className="font-mono text-xs uppercase tracking-[0.14em] text-subtle">
                    {f.step}
                  </p>
                  <p className="text-sm leading-relaxed text-muted">{f.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-medium tracking-tight">Key handling</h2>
          <ul className="space-y-2 text-sm leading-relaxed text-muted">
            <li className="flex gap-2">
              <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-accent" />
              <span>
                <span className="font-mono text-fg">ots_live_</span> keys are
                generated by your instance, stored hashed, and returned in full
                exactly once.
              </span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-accent" />
              <span>Same-origin playground and console calls need no key.</span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-accent" />
              <span>
                Pass keys as{" "}
                <span className="font-mono text-fg">Authorization: Bearer ots_live_…</span>{" "}
                — never in a URL or query string.
              </span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-accent" />
              <span>
                Revocation is immediate. Manage keys from the{" "}
                <Link to="/keys" className="text-fg underline underline-offset-2 hover:text-accent">
                  Keys console
                </Link>
                .
              </span>
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-medium tracking-tight">Threat model</h2>
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            What we design against, and what stays your responsibility as the
            operator.
          </p>
          <div className="overflow-x-auto rounded-md bg-surface shadow-[var(--shadow-border)]">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="border-b border-border font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                <tr>
                  <th className="px-4 py-3">Threat</th>
                  <th className="px-4 py-3">Mitigation</th>
                </tr>
              </thead>
              <tbody className="text-muted">
                {THREATS.map((t, i) => (
                  <tr
                    key={t.threat}
                    className={i < THREATS.length - 1 ? "border-b border-border/60" : ""}
                  >
                    <td className="px-4 py-3 text-fg">{t.threat}</td>
                    <td className="px-4 py-3 leading-relaxed">{t.mitigation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-3 rounded-md bg-inset p-6">
          <h2 className="text-base font-medium tracking-tight">
            Reporting a vulnerability
          </h2>
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            Because OpenJev is open source, security review is welcome and
            expected. Report suspected vulnerabilities privately through the
            project&apos;s GitHub Security Advisories rather than a public issue,
            and give us a reasonable window to ship a fix before disclosure. Fixes
            land in the public repository under Apache-2.0.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Link to="/privacy" className={cn(buttonVariants({ variant: "primary" }))}>
              Data Policy →
            </Link>
            <Link to="/reference" className={cn(buttonVariants({ variant: "secondary" }))}>
              API reference
            </Link>
          </div>
        </section>

        <footer className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-6 text-sm text-muted">
          <Link to="/about" className="hover:text-fg">About</Link>
          <Link to="/pricing" className="hover:text-fg">Pricing</Link>
          <Link to="/privacy" className="hover:text-fg">Data Policy</Link>
          <Link to="/docs" className="hover:text-fg">Documentation</Link>
          <span className="ml-auto font-mono text-[11px] uppercase tracking-[0.14em] text-subtle">
            OpenJev · Apache-2.0
          </span>
        </footer>
      </article>
    </AppShell>
  );
}
