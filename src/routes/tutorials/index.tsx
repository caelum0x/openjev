import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { TUTORIALS } from "@/lib/content/tutorials";
import {
  absUrl,
  breadcrumbLd,
  itemListLd,
  SITE_NAME,
  OG_IMAGE,
} from "@/lib/seo/site";

const PATH = "/tutorials";
const TITLE = `Tutorials — end-to-end build guides for typed decisions · ${SITE_NAME}`;
const DESCRIPTION =
  "Six step-by-step tutorials for building real apps with Choice, Score, and Noul: support ticket router, content moderator, insurance adjudicator, LLM router, RAG answer grader, and agent tool selector.";

export const Route = createFileRoute("/tutorials/")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      {
        name: "keywords",
        content:
          "openjev tutorial, typed decision tutorial, choice score noul, llm decision tutorial, build with openjev",
      },
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
          { name: "Tutorials", path: PATH },
        ]),
      },
      {
        "script:ld+json": itemListLd(
          TUTORIALS.map((t) => ({
            name: t.title,
            path: `/tutorials/${t.slug}`,
          })),
        ),
      },
    ],
    links: [{ rel: "canonical", href: absUrl(PATH) }],
  }),
  component: TutorialsIndex,
});

function TutorialsIndex() {
  return (
    <AppShell>
      <div className="space-y-12">
        <header className="space-y-3">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">
            Tutorials
          </p>
          <h1 className="max-w-3xl text-3xl font-medium tracking-tight md:text-4xl">
            Build something real, step by step.
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            Six end-to-end tutorials, each building a small application that
            uses{" "}
            <span className="text-fg">Choice</span>,{" "}
            <span className="text-fg">Score</span>, and{" "}
            <span className="text-fg">Noul</span> to make typed decisions via{" "}
            <span className="font-mono text-fg">POST /v1/systemone</span>.
            Every tutorial includes numbered steps with real runnable code,
            expected output, and a FAQ.
          </p>
        </header>

        <section className="space-y-4">
          <h2 className="font-mono text-xs uppercase tracking-[0.16em] text-subtle">
            All tutorials
          </h2>
          <div className="grid gap-3 md:grid-cols-2">
            {TUTORIALS.map((t, i) => (
              <Link
                key={t.slug}
                to="/tutorials/$slug"
                params={{ slug: t.slug }}
                className="group flex flex-col rounded-md bg-surface p-5 shadow-[var(--shadow-border)] transition-[box-shadow] duration-150 hover:shadow-[var(--shadow-border-hover)]"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-medium tracking-tight">{t.title}</p>
                  <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                    {i + 1} of {TUTORIALS.length}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  {t.description}
                </p>
                <div className="mt-4 flex items-center justify-between">
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                    {t.readingTime} min · {t.steps.length} steps
                  </span>
                  <span className="font-mono text-xs text-muted transition-colors group-hover:text-fg">
                    Start →
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>

        <section className="space-y-3 rounded-md bg-surface p-5 shadow-[var(--shadow-border)]">
          <h2 className="text-lg font-medium tracking-tight">
            What you will build with
          </h2>
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            Every tutorial calls a single endpoint —{" "}
            <span className="font-mono text-fg">POST /v1/systemone</span> —
            with a shared state object and a map of typed questions. The
            response carries typed answers: a{" "}
            <span className="text-fg">Choice</span> label with a probability
            distribution, a <span className="text-fg">Score</span> level with
            a confidence, or a <span className="text-fg">Noul</span> calibrated
            P(yes). No generated text, no parsing, no retry loops.
          </p>
          <div className="flex flex-wrap gap-x-5 gap-y-2 pt-1 text-sm text-muted">
            <Link to="/guides" className="hover:text-fg">
              Read the guides first →
            </Link>
            <Link to="/playground" className="hover:text-fg">
              Try it in the playground →
            </Link>
            <Link to="/reference" className="hover:text-fg">
              API reference →
            </Link>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
