import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { CopyButton } from "@/components/copy-button";
import { AnswerView, TypePill } from "@/components/answer-view";
import { buttonVariants } from "@/components/ui/button";
import { COOKBOOKS } from "@/lib/jev/cookbooks";
import type { Answer } from "@/lib/jev/types";
import { absUrl, OG_IMAGE, SITE_NAME, softwareLd } from "@/lib/seo/site";
import { cn } from "@/lib/utils";

const HOME_TITLE = `${SITE_NAME} · Typed decisions, not text`;
const HOME_DESCRIPTION =
  "Open-source decision engine, wire-compatible with the System One v1 API. Send state and typed questions; get Choice, Score, and Noul answers with calibrated probabilities instead of generated text.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: HOME_TITLE },
      { name: "description", content: HOME_DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: SITE_NAME },
      { property: "og:title", content: HOME_TITLE },
      { property: "og:description", content: HOME_DESCRIPTION },
      { property: "og:url", content: absUrl("/") },
      { property: "og:image", content: OG_IMAGE },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: HOME_TITLE },
      { name: "twitter:description", content: HOME_DESCRIPTION },
      { name: "twitter:image", content: OG_IMAGE },
      { "script:ld+json": softwareLd() },
    ],
    links: [{ rel: "canonical", href: absUrl("/") }],
  }),
  component: Home,
});

/**
 * Static, illustrative primitive examples — the same shape the engine returns,
 * rendered with the console's own AnswerView so the home page reads exactly
 * like a live answer. No API round-trip required.
 */
const SHOWCASE: ReadonlyArray<{
  type: "noul" | "choice" | "score";
  state: string;
  question: string;
  answer: Answer;
  read: string;
}> = [
  {
    type: "noul",
    state: "A hotdog: a sausage served in a sliced bun.",
    question: "Is a hotdog a sandwich?",
    answer: { type: "noul", noul: 0.58 },
    read: "Calibrated 0–1, not a coin flip. Threshold it in code.",
  },
  {
    type: "choice",
    state: "A clear afternoon sky, no clouds, sun overhead.",
    question: "What color is the sky?",
    answer: {
      type: "choice",
      choice: "blue",
      probabilities: { blue: 0.71, gray: 0.14, orange: 0.09, black: 0.06 },
      confidence: 0.71,
    },
    read: "One of up to ~255 options, with a full distribution.",
  },
  {
    type: "score",
    state: "A chimpanzee dips a brush and drags color across a canvas.",
    question: "Can monkeys create art?",
    answer: {
      type: "score",
      score: 3.66,
      legend: {
        "0": "not art",
        "1": "marks only",
        "2": "decoration",
        "3": "deliberate",
        "4": "expressive",
        "5": "masterwork",
      },
      probabilities: {
        "0": 0.02,
        "1": 0.05,
        "2": 0.14,
        "3": 0.29,
        "4": 0.32,
        "5": 0.18,
      },
      confidence: 0.32,
    },
    read: "A rubric level with the distribution behind it.",
  },
];

const INSTALL = `# 1. Install the OpenJev agent skill
npx skills add openjev/skill
# (or copy SKILL.md — served at GET /api/v1/skill)

# 2. Point the agent at this app
#   POST /api/v1/systemone   typed decisions
#   GET  /api/v1/skill       the skill file
#   GET  /api/v1/models      available profiles`;

const CURL = `curl -X POST http://localhost:3000/api/v1/systemone \\
  -H "Authorization: Bearer $OPENJEV_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "system-one",
    "state": "A hotdog: a sausage in a sliced bun.",
    "questions": {
      "is_sandwich": { "type": "noul", "instructions": "Is this a sandwich?" }
    }
  }'`;

const FOOTER_LINKS: ReadonlyArray<{
  label: string;
  to?:
    | "/docs"
    | "/keys"
    | "/usage"
    | "/use-cases"
    | "/self-hosting"
    | "/changelog"
    | "/models"
    | "/compare"
    | "/pricing"
    | "/privacy"
    | "/security"
    | "/about";
  href?: string;
}> = [
  { label: "Data Policy", to: "/privacy" },
  { label: "Trust Center", to: "/security" },
  { label: "Models", to: "/models" },
  { label: "Pricing", to: "/pricing" },
  { label: "Compare", to: "/compare" },
  { label: "Use cases", to: "/use-cases" },
  { label: "Documentation", to: "/docs" },
  { label: "Self-hosting", to: "/self-hosting" },
  { label: "Changelog", to: "/changelog" },
  { label: "About", to: "/about" },
  { label: "API key", to: "/keys" },
  { label: "Discord", href: "#" },
  { label: "Usage", to: "/usage" },
];

function Home() {
  return (
    <AppShell>
      <div className="space-y-14">
        {/* HERO */}
        <header className="space-y-5 pt-2">
          <p className="inline-flex items-center gap-2 rounded-full bg-surface px-3 py-1 font-mono text-[11px] uppercase tracking-[0.16em] text-subtle shadow-[var(--shadow-border)]">
            <span className="text-fg">SYSTEM ONE</span>
            <span aria-hidden>·</span>
            <span>Choice / Score / Noul</span>
          </p>
          <h1 className="max-w-3xl text-4xl font-medium leading-[1.05] tracking-tight md:text-6xl">
            Learn to openjev.
            <span className="block text-muted">Typed decisions, not text.</span>
          </h1>
          <p className="max-w-2xl text-base leading-relaxed text-muted">
            OpenJev is an open-source decision engine, wire-compatible with
            the upstream System One v1 API. Send state and typed questions; get
            typed judgments and probabilities your code can combine. No
            writer, no parsing — just programmable common sense behind{" "}
            <span className="font-mono text-fg">POST /api/v1/systemone</span>.
            Accuracy and calibration are measured on the{" "}
            <Link to="/leaderboard" className="text-fg underline underline-offset-2">
              public-dataset leaderboard
            </Link>
            .
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Link
              to="/playground"
              className={cn(buttonVariants({ variant: "primary", size: "lg" }))}
            >
              Playground →
            </Link>
            <Link
              to="/system-one"
              className={cn(buttonVariants({ variant: "secondary", size: "lg" }))}
            >
              The model
            </Link>
          </div>
        </header>

        {/* PRIMITIVE SHOWCASE */}
        <section className="space-y-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-medium tracking-tight">
              Three primitives
            </h2>
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-subtle">
              structured output
            </p>
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            {SHOWCASE.map((s) => (
              <div
                key={s.question}
                className="flex flex-col gap-4 rounded-md bg-surface p-5 shadow-[var(--shadow-border)]"
              >
                <div className="flex items-center justify-between gap-2">
                  <TypePill type={s.type} />
                </div>
                <div className="space-y-1">
                  <p className="font-mono text-[11px] leading-relaxed text-subtle">
                    {s.state}
                  </p>
                  <p className="text-sm font-medium tracking-tight text-fg">
                    {s.question}
                  </p>
                </div>
                <div className="mt-auto">
                  <AnswerView answer={s.answer} />
                </div>
                <p className="text-xs leading-relaxed text-muted">{s.read}</p>
              </div>
            ))}
          </div>
        </section>

        {/* OPENJEV IN ACTION */}
        <section className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-lg font-medium tracking-tight">
              OpenJev in action
            </h2>
            <p className="max-w-2xl text-sm leading-relaxed text-muted">
              Patterns that turn the three primitives into real workflows. Each
              cookbook is a runnable example.
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {COOKBOOKS.map((c) => (
              <Link
                key={c.id}
                to="/cookbooks/$id"
                params={{ id: c.id }}
                className="group flex flex-col rounded-md bg-surface p-4 shadow-[var(--shadow-border)] transition-[box-shadow] duration-150 hover:shadow-[var(--shadow-border-hover)]"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-medium tracking-tight">{c.title}</p>
                  <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                    {c.stat}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  {c.blurb}
                </p>
                <span className="mt-3 font-mono text-xs text-muted transition-colors group-hover:text-fg">
                  Open cookbook →
                </span>
              </Link>
            ))}
          </div>
        </section>

        {/* QUICKSTART */}
        <section className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-lg font-medium tracking-tight">Quickstart</h2>
            <p className="max-w-2xl text-sm leading-relaxed text-muted">
              Install the OpenJev skill for your agent, then call the API.
              The request shape is wire-compatible with the upstream System One v1
              API, so the same payload runs on any compatible endpoint.
            </p>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="space-y-3 rounded-md bg-surface p-4 shadow-[var(--shadow-border)]">
              <div className="flex items-center justify-between gap-3">
                <p className="font-mono text-xs uppercase tracking-[0.14em] text-subtle">
                  Install the skill
                </p>
                <CopyButton text={INSTALL} label="Copy" />
              </div>
              <pre className="overflow-x-auto rounded-sm bg-inset p-3 font-mono text-[12px] leading-relaxed text-fg">
                {INSTALL}
              </pre>
              <Link to="/skill" className="text-sm text-muted hover:text-fg">
                View SKILL.md →
              </Link>
            </div>
            <div className="space-y-3 rounded-md bg-surface p-4 shadow-[var(--shadow-border)]">
              <div className="flex items-center justify-between gap-3">
                <p className="font-mono text-xs uppercase tracking-[0.14em] text-subtle">
                  Hit the API
                </p>
                <CopyButton text={CURL} label="Copy curl" />
              </div>
              <pre className="overflow-x-auto rounded-sm bg-inset p-3 font-mono text-[12px] leading-relaxed text-fg">
                {CURL}
              </pre>
              <Link to="/keys" className="text-sm text-muted hover:text-fg">
                Create an ots_live_ key →
              </Link>
            </div>
          </div>
        </section>

        {/* FOOTER */}
        <footer className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-6 text-sm text-muted">
          {FOOTER_LINKS.map((l) =>
            l.to ? (
              <Link key={l.label} to={l.to} className="hover:text-fg">
                {l.label}
              </Link>
            ) : (
              <a key={l.label} href={l.href} className="hover:text-fg">
                {l.label}
              </a>
            ),
          )}
          <span className="ml-auto font-mono text-[11px] uppercase tracking-[0.14em] text-subtle">
            OpenJev · Apache-2.0
          </span>
        </footer>
      </div>
    </AppShell>
  );
}
