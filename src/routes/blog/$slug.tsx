import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ContentNotFound } from "@/components/content-not-found";
import { AppShell } from "@/components/app-shell";
import { CopyButton } from "@/components/copy-button";
import { buttonVariants } from "@/components/ui/button";
import { type BlogPost, POSTS, postBySlug } from "@/lib/content/blog";
import {
  absUrl,
  articleLd,
  breadcrumbLd,
  faqLd,
  OG_IMAGE,
  SITE_NAME,
} from "@/lib/seo/site";
import { cn } from "@/lib/utils";
import { LinkedText } from "@/components/linked-text";

export const Route = createFileRoute("/blog/$slug")({
  loader: ({ params }) => {
    if (!postBySlug(params.slug)) throw notFound();
  },
  notFoundComponent: () => (
    <ContentNotFound kind="Post" backTo="/blog" backLabel="All posts" />
  ),
  head: ({ params }) => {
    const post = postBySlug(params.slug);
    if (!post) return {};
    const path = `/blog/${post.slug}`;
    const title = `${post.title} · ${SITE_NAME}`;
    return {
      meta: [
        { title },
        { name: "description", content: post.excerpt },
        { name: "keywords", content: post.keywords.join(", ") },
        { property: "og:type", content: "article" },
        { property: "og:title", content: title },
        { property: "og:description", content: post.excerpt },
        { property: "og:url", content: absUrl(path) },
        { property: "og:image", content: OG_IMAGE },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: post.excerpt },
        {
          "script:ld+json": articleLd({
            headline: post.title,
            description: post.excerpt,
            path,
            datePublished: post.date,
            dateModified: post.date,
            keywords: post.keywords,
          }),
        },
        {
          "script:ld+json": breadcrumbLd([
            { name: "Home", path: "/" },
            { name: "Blog", path: "/blog" },
            { name: post.title, path },
          ]),
        },
        { "script:ld+json": faqLd(post.faq) },
      ],
      links: [{ rel: "canonical", href: absUrl(path) }],
    };
  },
  component: BlogPostPage,
});

function BlogPostPage() {
  const { slug } = Route.useParams();
  const post = postBySlug(slug);

  if (!post) {
    return (
      <AppShell>
        <div className="mx-auto max-w-2xl space-y-4">
          <h1 className="text-2xl font-medium tracking-tight">Unknown post</h1>
          <p className="text-sm text-muted">
            No blog post is registered at{" "}
            <span className="font-mono text-fg">/blog/{slug}</span>.
          </p>
          <Link
            to="/blog"
            className={cn(buttonVariants({ variant: "secondary" }))}
          >
            All posts
          </Link>
        </div>
      </AppShell>
    );
  }

  // Suggest up to 3 other posts (excluding the current one).
  const more: BlogPost[] = POSTS.filter((p) => p.slug !== post.slug).slice(
    0,
    3,
  );

  return (
    <AppShell>
      <article className="mx-auto max-w-3xl space-y-12">
        <header className="space-y-3">
          <Link
            to="/blog"
            className="font-mono text-xs uppercase tracking-[0.18em] text-subtle hover:text-fg"
          >
            ← Blog
          </Link>
          <div className="space-y-1 pt-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
              {post.date} · {post.readingMinutes} min read
            </span>
          </div>
          <h1 className="text-3xl font-medium tracking-tight md:text-4xl">
            {post.title}
          </h1>
          <p className="max-w-2xl text-base leading-relaxed text-muted">
            <LinkedText text={post.intro} />
          </p>
        </header>

        {post.sections.map((s) => (
          <section key={s.heading} className="space-y-3">
            <h2 className="text-lg font-medium tracking-tight">{s.heading}</h2>
            <p className="text-sm leading-relaxed text-muted"><LinkedText text={s.body} /></p>
            {s.bullets ? (
              <ul className="space-y-2 text-sm leading-relaxed text-muted">
                {s.bullets.map((b) => (
                  <li key={b} className="flex gap-2">
                    <span className="mt-1.5 inline-block size-1.5 shrink-0 rounded-full bg-muted" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {s.code ? (
              <div className="space-y-2 rounded-md bg-surface p-4 shadow-[var(--shadow-border)]">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                    {s.code.lang ?? "code"}
                  </p>
                  <CopyButton text={s.code.code} />
                </div>
                <pre className="overflow-x-auto rounded-sm bg-inset p-3 font-mono text-[12px] leading-relaxed text-fg">
                  {s.code.code}
                </pre>
              </div>
            ) : null}
          </section>
        ))}

        <section className="space-y-3">
          <h2 className="text-lg font-medium tracking-tight">
            Frequently asked
          </h2>
          <div className="space-y-3">
            {post.faq.map((f) => (
              <div
                key={f.q}
                className="space-y-1.5 rounded-md bg-surface p-4 shadow-[var(--shadow-border)]"
              >
                <p className="text-sm font-medium tracking-tight text-fg">
                  {f.q}
                </p>
                <p className="text-sm leading-relaxed text-muted"><LinkedText text={f.a} /></p>
              </div>
            ))}
          </div>
        </section>

        <div className="flex flex-wrap gap-2">
          <Link
            to="/playground"
            className={cn(buttonVariants({ variant: "primary" }))}
          >
            Try it in the playground →
          </Link>
          <Link
            to="/guides"
            className={cn(buttonVariants({ variant: "secondary" }))}
          >
            Read the guides
          </Link>
        </div>

        {more.length ? (
          <section className="space-y-3 border-t border-border pt-8">
            <h2 className="text-lg font-medium tracking-tight">More posts</h2>
            <div className="space-y-3">
              {more.map((p) => (
                <Link
                  key={p.slug}
                  to="/blog/$slug"
                  params={{ slug: p.slug }}
                  className="group flex flex-col rounded-md bg-surface p-4 shadow-[var(--shadow-border)] transition-[box-shadow] duration-150 hover:shadow-[var(--shadow-border-hover)]"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <p className="text-sm font-medium tracking-tight">
                      {p.title}
                    </p>
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                      {p.date}
                    </span>
                  </div>
                  <span className="mt-2 font-mono text-xs text-muted transition-colors group-hover:text-fg">
                    Read →
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ) : null}
      </article>
    </AppShell>
  );
}
