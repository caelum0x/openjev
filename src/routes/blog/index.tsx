import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { POSTS } from "@/lib/content/blog";
import {
  absUrl,
  breadcrumbLd,
  itemListLd,
  SITE_NAME,
  OG_IMAGE,
} from "@/lib/seo/site";

const PATH = "/blog";
const TITLE = `Blog — typed LLM decisions & structured output · ${SITE_NAME}`;
const DESCRIPTION =
  "Opinionated technical writing on typed LLM decisions: Choice, Score, and Noul primitives, confidence calibration, self-hosting, and replacing JSON mode with calibrated structured output.";

export const Route = createFileRoute("/blog/")({
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
          { name: "Blog", path: PATH },
        ]),
      },
      {
        "script:ld+json": itemListLd(
          POSTS.map((p) => ({ name: p.title, path: `/blog/${p.slug}` })),
        ),
      },
    ],
    links: [{ rel: "canonical", href: absUrl(PATH) }],
  }),
  component: BlogIndex,
});

function BlogIndex() {
  // Reverse-chronological order.
  const posts = [...POSTS].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );

  return (
    <AppShell>
      <div className="space-y-12">
        <header className="space-y-3">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">
            Blog
          </p>
          <h1 className="max-w-3xl text-3xl font-medium tracking-tight md:text-4xl">
            Typed decisions, written up.
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            Opinionated technical posts on typed LLM decisions — why{" "}
            <span className="text-fg">calibrated confidence</span> beats
            self-reported certainty, how to pick between the{" "}
            <span className="text-fg">five backends</span>, when{" "}
            <span className="text-fg">Noul</span> outperforms a boolean, and
            what the{" "}
            <span className="text-fg">benchmarks</span> actually show.
          </p>
        </header>

        <section className="space-y-4">
          <h2 className="font-mono text-xs uppercase tracking-[0.16em] text-subtle">
            All posts
          </h2>
          <div className="space-y-3">
            {posts.map((p) => (
              <Link
                key={p.slug}
                to="/blog/$slug"
                params={{ slug: p.slug }}
                className="group flex flex-col rounded-md bg-surface p-5 shadow-[var(--shadow-border)] transition-[box-shadow] duration-150 hover:shadow-[var(--shadow-border-hover)]"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <p className="font-medium tracking-tight">{p.title}</p>
                  <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                    {p.date} · {p.readingMinutes} min
                  </span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  {p.excerpt}
                </p>
                <span className="mt-4 font-mono text-xs text-muted transition-colors group-hover:text-fg">
                  Read the post →
                </span>
              </Link>
            ))}
          </div>
        </section>

        <section className="space-y-3 rounded-md bg-surface p-5 shadow-[var(--shadow-border)]">
          <h2 className="text-lg font-medium tracking-tight">Want to go deeper?</h2>
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            The guides section has longer, more structured treatments of every
            concept — from the{" "}
            <span className="font-mono text-fg">Choice / Score / Noul</span>{" "}
            primitives to full migration walkthroughs and per-role deep dives.
          </p>
          <div className="flex flex-wrap gap-x-5 gap-y-2 pt-1 text-sm text-muted">
            <Link to="/guides" className="hover:text-fg">
              Read the guides →
            </Link>
            <Link to="/playground" className="hover:text-fg">
              Open the playground →
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
