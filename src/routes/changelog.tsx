import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { pageHead } from "@/lib/seo/site";

export const Route = createFileRoute("/changelog")({
  head: () => pageHead("Changelog", "What changed in OpenJev, release by release."),
  component: ChangelogPage,
});

type Entry = {
  version: string;
  date: string;
  tag: "release" | "feature" | "fix";
  title: string;
  notes: ReadonlyArray<string>;
};

/**
 * Dated release notes for openjev. Newest first. Every line describes
 * something that actually ships in this repo: the 5-backend engine, the
 * POST /v1/systemone contract, the console UI, and the Docker self-host path.
 */
const ENTRIES: ReadonlyArray<Entry> = [
  {
    version: "0.1.0",
    date: "2026-09-22",
    tag: "release",
    title: "Initial open-source release",
    notes: [
      "First public, Apache-2.0 release of OpenJev — an open-source, self-hostable decision engine wire-compatible with the upstream System One v1 API.",
      "Typed-decision API at POST /v1/systemone: send state plus typed questions, get back Choice / Score / Noul answers with probabilities and confidence.",
      "Five interchangeable backends behind one contract: laya-mlx (Apple Silicon), laya-onnx (Linux/CPU), the native C++/Rust kernel in engine/, the zero-dependency pure-TS engine, and optional any-LLM escalation.",
      "Console UI: playground, System One walkthrough, docs, API keys, usage metering, agent skill, and nine runnable cookbooks.",
      "One-command self-host via Docker Compose (Node service + laya-onnx sidecar) — boots with no keys, no weights, and an in-memory PGLite database.",
    ],
  },
  {
    version: "0.1.0-rc.1",
    date: "2026-09-18",
    tag: "feature",
    title: "Self-host packaging",
    notes: [
      "Dockerfile and Dockerfile.laya plus docker-compose.yml that brings up the API and the laya-onnx neural sidecar together.",
      "openjev CLI (bin) with two subcommands: openjev serve (built Node server on PORT/HOST) and openjev laya-download (fetch neural model weights from Hugging Face).",
      "Fully documented .env.example — nothing is required to boot; optional Postgres, LLM escalation, and Better Auth sign-in are all opt-in.",
      "Persistent laya-models volume so downloaded weights survive container restarts.",
    ],
  },
  {
    version: "0.0.5",
    date: "2026-09-12",
    tag: "feature",
    title: "Cookbooks",
    notes: [
      "Nine runnable cookbooks, each an HTTP endpoint and a live demo: parallel questions, SDE cascade, self-consistency, function calling, and the smart-home assistant.",
      "Four pattern cookbooks driven by editable state: speculative fan-out, confidence-gated routing, composite scoring, and intent routing.",
      "Cascade cookbook adds a poison toggle so you can watch per-field P(wrong) nouls fire and escalate to the reasoner.",
    ],
  },
  {
    version: "0.0.4",
    date: "2026-09-05",
    tag: "feature",
    title: "Console UI",
    notes: [
      "TanStack Start console: playground for ad-hoc questions, docs with copyable request examples, API-key management, and per-session usage metering.",
      "AnswerView renders every primitive with its full distribution — choice bars, score legend and level, and calibrated noul.",
      "Same-origin playground calls the API with no key; issued keys use the ots_live_ prefix.",
    ],
  },
  {
    version: "0.0.3",
    date: "2026-08-28",
    tag: "feature",
    title: "Neural and native backends",
    notes: [
      "laya-onnx CPU backend and laya-mlx Apple Silicon backend, both speaking the shared /v1/systemone contract over a sidecar URL.",
      "Native C++/Rust decision kernel in engine/ with a shared gold test suite across implementations.",
      "Optional any-LLM escalation for low-confidence decisions across openai, xai (Grok), and anthropic (Claude) providers, auto-detected from whichever key is present.",
    ],
  },
  {
    version: "0.0.2",
    date: "2026-08-20",
    tag: "feature",
    title: "Score and Noul primitives",
    notes: [
      "Added the Score primitive (2–10 ordered levels with legend, distribution, and confidence) and the Noul primitive (calibrated 0–1 probability, no confidence field).",
      "Confidence became a first-class scalar on Choice and Score for gating without hand-rolling entropy.",
      "Pure-TS engine hardened so the whole API answers with no model weights installed.",
    ],
  },
  {
    version: "0.0.1",
    date: "2026-08-14",
    tag: "release",
    title: "First cut",
    notes: [
      "Established the POST /v1/systemone request/response contract and the Choice primitive.",
      "In-memory PGLite development database with automatic migrations, so the service runs from a fresh clone.",
    ],
  },
];

const TAG_LABEL: Record<Entry["tag"], string> = {
  release: "Release",
  feature: "Feature",
  fix: "Fix",
};

function ChangelogPage() {
  return (
    <AppShell>
      <article className="mx-auto max-w-3xl space-y-10">
        <header className="space-y-3">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">
            Changelog
          </p>
          <h1 className="text-3xl font-medium tracking-tight">
            What shipped in OpenJev
          </h1>
          <p className="text-sm leading-relaxed text-muted">
            Dated release notes for the open-source, Apache-2.0 System One model.
            Newest first. The contract at{" "}
            <span className="font-mono text-fg">POST /v1/systemone</span> is stable
            across releases; backends and the console evolve around it.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Link
              to="/self-hosting"
              className={cn(buttonVariants({ variant: "secondary" }))}
            >
              Self-host it →
            </Link>
            <Link to="/reference" className={cn(buttonVariants({ variant: "ghost" }))}>
              API reference
            </Link>
          </div>
        </header>

        <ol className="space-y-4">
          {ENTRIES.map((e) => (
            <li
              key={e.version}
              className="rounded-md bg-surface p-5 shadow-[var(--shadow-border)]"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <div className="flex items-baseline gap-3">
                  <h2 className="font-mono text-lg tracking-tight text-fg">
                    v{e.version}
                  </h2>
                  <span className="rounded-full bg-inset px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                    {TAG_LABEL[e.tag]}
                  </span>
                </div>
                <time
                  dateTime={e.date}
                  className="font-mono text-xs text-subtle tabular-nums"
                >
                  {e.date}
                </time>
              </div>
              <p className="mt-2 text-sm font-medium tracking-tight text-fg">
                {e.title}
              </p>
              <ul className="mt-3 space-y-2 text-sm leading-relaxed text-muted">
                {e.notes.map((n) => (
                  <li key={n} className="flex gap-2.5">
                    <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-subtle" />
                    <span>{n}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>

        <footer className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-6 text-sm text-muted">
          <Link to="/docs" className="hover:text-fg">
            Documentation
          </Link>
          <Link to="/self-hosting" className="hover:text-fg">
            Self-hosting
          </Link>
          <Link to="/cookbooks" className="hover:text-fg">
            Cookbooks
          </Link>
          <span className="ml-auto font-mono text-[11px] uppercase tracking-[0.14em] text-subtle">
            OpenJev · Apache-2.0
          </span>
        </footer>
      </article>
    </AppShell>
  );
}
