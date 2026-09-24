import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { COMPARISONS, type Edge } from "@/lib/content/compare";
import {
  absUrl,
  breadcrumbLd,
  itemListLd,
  OG_IMAGE,
  SITE_NAME,
} from "@/lib/seo/site";

const PATH = "/compare";
const TITLE = `Compare — typed decisions vs the alternatives · ${SITE_NAME}`;
const DESCRIPTION =
  "Honest comparisons of OpenJev against raw LLMs, JSON mode, OpenAI Structured Outputs, Instructor, Outlines, Guardrails, Pydantic-AI, and LangChain structured output.";

export const Route = createFileRoute("/compare/")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
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
          { name: "Compare", path: PATH },
        ]),
      },
      {
        "script:ld+json": itemListLd(
          COMPARISONS.map((c) => ({
            name: c.title,
            path: `/compare/${c.slug}`,
          })),
        ),
      },
    ],
    links: [{ rel: "canonical", href: absUrl(PATH) }],
  }),
  component: CompareIndex,
});

const EDGE_DOT: Record<Edge, string> = {
  openjev: "bg-ok",
  other: "bg-muted",
  even: "bg-subtle",
};

function CompareIndex() {
  return (
    <AppShell>
      <div className="space-y-10">
        <header className="space-y-3">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">
            Compare
          </p>
          <h1 className="max-w-3xl text-3xl font-medium tracking-tight md:text-4xl">
            How OpenJev compares to the usual alternatives.
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            When you need structured judgments out of natural language, there are
            a few tools you might reach for. These comparisons are honest: they
            name where the alternative is the right pick, because for writing,
            open-ended extraction, and control loops it often is. OpenJev
            wins where you want <span className="text-fg">a confidence you can measure and calibrate</span>,{" "}
            <span className="text-fg">closed-set choices</span>, and full{" "}
            <span className="text-fg">probability distributions</span> — the
            decision itself, not the prose around it.
          </p>
        </header>

        <section className="grid gap-3 md:grid-cols-2">
          {COMPARISONS.map((c) => (
            <Link
              key={c.slug}
              to="/compare/$slug"
              params={{ slug: c.slug }}
              className="group flex flex-col rounded-md bg-surface p-5 shadow-[var(--shadow-border)] transition-[box-shadow] duration-150 hover:shadow-[var(--shadow-border-hover)]"
            >
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-medium tracking-tight">{c.title}</p>
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                  {c.navLabel}
                </span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                {c.tagline}
              </p>
              <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t border-border/60 pt-3">
                {c.rows.slice(0, 4).map((r) => (
                  <span
                    key={r.dimension}
                    className="flex items-center gap-1.5 font-mono text-[11px] text-subtle"
                  >
                    <span
                      className={`inline-block size-1.5 rounded-full ${EDGE_DOT[r.edge]}`}
                      aria-hidden
                    />
                    {r.dimension}
                  </span>
                ))}
              </div>
              <span className="mt-3 font-mono text-xs text-muted transition-colors group-hover:text-fg">
                Read the comparison →
              </span>
            </Link>
          ))}
        </section>

        <section className="space-y-3 rounded-md bg-surface p-5 shadow-[var(--shadow-border)]">
          <h2 className="text-lg font-medium tracking-tight">The short version</h2>
          <ul className="max-w-2xl space-y-2 text-sm leading-relaxed text-muted">
            <li>
              <span className="text-fg">Need generated text, code, or reasoning?</span>{" "}
              Use a raw LLM. OpenJev never writes.
            </li>
            <li>
              <span className="text-fg">
                Extracting rich objects from messy input?
              </span>{" "}
              Use JSON mode or an Instructor-style wrapper.
            </li>
            <li>
              <span className="text-fg">
                Enforcing rules around a generative pipeline?
              </span>{" "}
              Use a guardrails framework — and consider OpenJev as the
              calibrated check inside it.
            </li>
            <li>
              <span className="text-fg">
                Making a decision over a known answer set?
              </span>{" "}
              That is exactly what OpenJev is for.
            </li>
          </ul>
          <div className="flex flex-wrap gap-x-5 gap-y-2 pt-1 text-sm text-muted">
            <Link to="/system-one" className="hover:text-fg">
              What System One is →
            </Link>
            <Link to="/benchmarks" className="hover:text-fg">
              Latency &amp; cost benchmarks →
            </Link>
            <Link to="/models" className="hover:text-fg">
              Models &amp; backends →
            </Link>
            <Link to="/playground" className="hover:text-fg">
              Try it →
            </Link>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
