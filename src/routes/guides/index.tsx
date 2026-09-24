import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { GUIDE_GROUPS, GUIDES } from "@/lib/content/guides";
import {
  absUrl,
  breadcrumbLd,
  itemListLd,
  SITE_NAME,
  OG_IMAGE,
} from "@/lib/seo/site";

const PATH = "/guides";
const TITLE = `Guides — typed decisions & structured output · ${SITE_NAME}`;
const DESCRIPTION =
  "Long-form guides on typed LLM decisions: calibrated confidence, closed-set choice vs free text, replacing JSON mode, and deep dives on Choice, Score, and Noul.";

export const Route = createFileRoute("/guides/")({
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
          { name: "Guides", path: PATH },
        ]),
      },
      {
        "script:ld+json": itemListLd(
          GUIDES.map((g) => ({ name: g.title, path: `/guides/${g.slug}` })),
        ),
      },
    ],
    links: [{ rel: "canonical", href: absUrl(PATH) }],
  }),
  component: GuidesIndex,
});

function GuidesIndex() {
  return (
    <AppShell>
      <div className="space-y-12">
        <header className="space-y-3">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">
            Guides
          </p>
          <h1 className="max-w-3xl text-3xl font-medium tracking-tight md:text-4xl">
            Typed decisions, in depth.
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            Practical guides for getting structured judgments out of natural
            language — what a{" "}
            <span className="text-fg">typed decision</span> is, why{" "}
            <span className="text-fg">calibrated confidence</span> matters, when
            to constrain the answer to a closed set, and how to use{" "}
            <span className="text-fg">Choice</span>,{" "}
            <span className="text-fg">Score</span>, and{" "}
            <span className="text-fg">Noul</span> in agents, backends, and data
            pipelines.
          </p>
        </header>

        {GUIDE_GROUPS.map((group) =>
          group.guides.length ? (
            <section key={group.kind} className="space-y-4">
              <h2 className="font-mono text-xs uppercase tracking-[0.16em] text-subtle">
                {group.label}
              </h2>
              <div className="grid gap-3 md:grid-cols-2">
                {group.guides.map((g) => (
                  <Link
                    key={g.slug}
                    to="/guides/$slug"
                    params={{ slug: g.slug }}
                    className="group flex flex-col rounded-md bg-surface p-5 shadow-[var(--shadow-border)] transition-[box-shadow] duration-150 hover:shadow-[var(--shadow-border-hover)]"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="font-medium tracking-tight">{g.title}</p>
                      <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                        {g.category}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-muted">
                      {g.description}
                    </p>
                    <span className="mt-4 font-mono text-xs text-muted transition-colors group-hover:text-fg">
                      Read the guide →
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          ) : null,
        )}

        <section className="space-y-3 rounded-md bg-surface p-5 shadow-[var(--shadow-border)]">
          <h2 className="text-lg font-medium tracking-tight">
            Ready to try it?
          </h2>
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            Every guide is a pattern you can run today — one{" "}
            <span className="font-mono text-fg">POST /api/v1/systemone</span>{" "}
            with a state and typed questions, on any of the five backends.
          </p>
          <div className="flex flex-wrap gap-x-5 gap-y-2 pt-1 text-sm text-muted">
            <Link to="/playground" className="hover:text-fg">
              Open the playground →
            </Link>
            <Link to="/compare" className="hover:text-fg">
              Compare the alternatives →
            </Link>
            <Link to="/docs" className="hover:text-fg">
              Read the docs →
            </Link>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
