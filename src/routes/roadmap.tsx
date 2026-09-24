import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { ROADMAP_GROUPS, type RoadmapStatus } from "@/lib/content/roadmap";
import { absUrl, breadcrumbLd, OG_IMAGE, SITE_NAME } from "@/lib/seo/site";

const PATH = "/roadmap";
const TITLE = `Roadmap · ${SITE_NAME}`;
const DESCRIPTION =
  "What is shipped, in progress, planned, and under consideration for OpenJev — the open-source typed-decision engine.";

export const Route = createFileRoute("/roadmap")({
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
          { name: "Roadmap", path: PATH },
        ]),
      },
    ],
    links: [{ rel: "canonical", href: absUrl(PATH) }],
  }),
  component: RoadmapPage,
});

const STATUS_STYLES: Record<
  RoadmapStatus,
  { dot: string; badge: string; label: string }
> = {
  shipped: {
    dot: "bg-ok",
    badge: "bg-ok/10 text-ok",
    label: "Shipped",
  },
  "in-progress": {
    dot: "bg-accent",
    badge: "bg-accent/10 text-accent",
    label: "In progress",
  },
  planned: {
    dot: "bg-muted",
    badge: "bg-raised text-muted",
    label: "Planned",
  },
  considering: {
    dot: "bg-subtle",
    badge: "bg-raised text-subtle",
    label: "Considering",
  },
};

function RoadmapPage() {
  return (
    <AppShell>
      <div className="mx-auto max-w-3xl space-y-12">
        <header className="space-y-3">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">
            Roadmap
          </p>
          <h1 className="text-3xl font-medium tracking-tight md:text-4xl">
            What is built and what is next.
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            OpenJev is Apache-2.0. Items listed as shipped are in the
            current release. In-progress items are actively being built.
            Planned and considering items carry no delivery guarantee.
          </p>
        </header>

        {ROADMAP_GROUPS.map((group) => {
          const style = STATUS_STYLES[group.status];
          return (
            <section key={group.status} className="space-y-4">
              <div className="flex items-center gap-3">
                <span
                  aria-hidden
                  className={`size-2 shrink-0 rounded-full ${style.dot}`}
                />
                <h2 className="text-lg font-medium tracking-tight">
                  {group.label}
                </h2>
              </div>
              <p className="text-sm text-muted">{group.summary}</p>
              <div className="space-y-2">
                {group.items.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-md bg-surface p-4 shadow-[var(--shadow-border)]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-medium tracking-tight text-fg">
                        {item.title}
                      </p>
                      <span
                        className={`shrink-0 rounded-sm px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] ${style.badge}`}
                      >
                        {style.label}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-muted">
                      {item.description}
                    </p>
                    {item.tags.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {item.tags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded-sm bg-raised px-2 py-0.5 font-mono text-[10px] text-subtle"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </AppShell>
  );
}
