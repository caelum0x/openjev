import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { pageHead } from "@/lib/seo/site";

export const Route = createFileRoute("/privacy")({
  head: () =>
    pageHead("Data Policy", "What data OpenJev stores, for how long, and how to delete it."),
  component: PrivacyPage,
});

type Section = { id: string; heading: string; body: ReadonlyArray<string> };

const SELF_HOST: ReadonlyArray<Section> = [
  {
    id: "controller",
    heading: "You are the data controller",
    body: [
      "openjev is Apache-2.0 software you deploy and operate. When you self-host, the operator of the instance — you — is the data controller for everything that passes through it. The OpenJev project provides the code; it does not receive, store, or process the state you send to your own instance.",
      "This policy therefore describes two things: how the software handles data by default (which applies wherever it runs), and how the optional hosted endpoint handles data (which applies only if you choose to use it).",
    ],
  },
  {
    id: "what",
    heading: "What the engine processes",
    body: [
      "A request contains a state (text, JSON, or arrays) and a map of typed questions. The engine reads them, evaluates each question with the configured backend, and returns Choice / Score / Noul answers plus token usage. State is treated as data to be judged — never as instructions to execute.",
      "The primitives make no outbound network calls on their own. The only exception is the any-LLM backend, which sends the request to the third-party endpoint you explicitly configure; that provider's privacy terms then apply to that traffic.",
    ],
  },
  {
    id: "retention",
    heading: "Retention and logging",
    body: [
      "Preview usage metering is in-memory only and resets when the process restarts. It records counts — calls, tokens, latency, model — not the content of your states or answers.",
      "Any persistent logging is opt-in and writes to storage you provision. The project ships no default that persists prompt content off the machine. If you enable request logging, you own that log and its retention schedule.",
    ],
  },
  {
    id: "training",
    heading: "No training on your data",
    body: [
      "None of the local backends (laya-mlx, laya-onnx, native) learn from your traffic. Inference is one-directional: state in, judgment out, nothing retained for model improvement. There is no telemetry that returns your prompts or answers to the OpenJev project.",
    ],
  },
];

const HOSTED: ReadonlyArray<Section> = [
  {
    id: "hosted-scope",
    heading: "When it applies",
    body: [
      "This section applies only if you use the optional hosted endpoint with an ots_live_ key. Self-hosted deployments never touch it.",
    ],
  },
  {
    id: "hosted-data",
    heading: "What the hosted endpoint stores",
    body: [
      "To operate the service we store account and key metadata (a hashed key, its label, creation time, and per-key usage counters) and short-lived operational logs needed for reliability, abuse prevention, and billing.",
      "Request states and answers are processed to produce a response and are not used to train models. Content is retained only as long as needed to serve the request and support debugging, then discarded on our standard schedule. You can export and move to self-host at any time — there is no lock-in.",
    ],
  },
  {
    id: "hosted-rights",
    heading: "Your rights and deletion",
    body: [
      "You can revoke a key instantly, which stops all traffic under it. You can request deletion of your account metadata. Because the core is Apache-2.0 and portable, the strongest privacy guarantee is always available to you: run it yourself and keep every byte on your own infrastructure.",
    ],
  },
];

function Block({ sections }: { sections: ReadonlyArray<Section> }) {
  return (
    <div className="space-y-8">
      {sections.map((s) => (
        <section key={s.id} className="space-y-2">
          <h3 className="text-base font-medium tracking-tight text-fg">
            {s.heading}
          </h3>
          {s.body.map((p, i) => (
            <p key={i} className="max-w-2xl text-sm leading-relaxed text-muted">
              {p}
            </p>
          ))}
        </section>
      ))}
    </div>
  );
}

function PrivacyPage() {
  return (
    <AppShell>
      <article className="mx-auto max-w-3xl space-y-12">
        <header className="space-y-4">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">
            Data Policy
          </p>
          <h1 className="max-w-2xl text-3xl font-medium tracking-tight md:text-4xl">
            Privacy &amp; data policy
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            The short version: when you self-host OpenJev, your data stays
            on your infrastructure and we never see it. The engine does not train
            on your traffic and keeps no persistent copy of your states by
            default. The rest of this page spells that out, plus how the optional
            hosted endpoint handles data if you choose to use it.
          </p>
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-subtle">
            Last updated 2026-09-22
          </p>
        </header>

        <section className="space-y-4">
          <h2 className="text-lg font-medium tracking-tight">
            Self-hosted deployments
          </h2>
          <Block sections={SELF_HOST} />
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-medium tracking-tight">
            The optional hosted endpoint
          </h2>
          <Block sections={HOSTED} />
        </section>

        <section className="space-y-3 rounded-md bg-inset p-6">
          <h2 className="text-base font-medium tracking-tight">
            Want the strongest guarantee?
          </h2>
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            Self-host. It&apos;s free, Apache-2.0, and keeps every state and
            answer inside your own network. See the Trust Center for the security
            architecture and threat model behind these promises.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Link to="/security" className={cn(buttonVariants({ variant: "primary" }))}>
              Trust Center →
            </Link>
            <Link to="/pricing" className={cn(buttonVariants({ variant: "secondary" }))}>
              Pricing
            </Link>
          </div>
        </section>

        <footer className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-6 text-sm text-muted">
          <Link to="/about" className="hover:text-fg">About</Link>
          <Link to="/security" className="hover:text-fg">Trust Center</Link>
          <Link to="/pricing" className="hover:text-fg">Pricing</Link>
          <Link to="/docs" className="hover:text-fg">Documentation</Link>
          <span className="ml-auto font-mono text-[11px] uppercase tracking-[0.14em] text-subtle">
            OpenJev · Apache-2.0
          </span>
        </footer>
      </article>
    </AppShell>
  );
}
