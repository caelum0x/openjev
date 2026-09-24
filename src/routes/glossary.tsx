import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { GLOSSARY_SORTED, termBySlug } from "@/lib/content/glossary";
import { absUrl, breadcrumbLd, OG_IMAGE, SITE_NAME } from "@/lib/seo/site";
import { LinkedText } from "@/components/linked-text";

const PATH = "/glossary";
const TITLE = `Glossary · ${SITE_NAME}`;
const DESCRIPTION =
  "Definitions for every term in openjev: Choice, Score, Noul, calibration, ECE, isotonic regression, temperature scaling, otsone, and more.";

export const Route = createFileRoute("/glossary")({
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
          { name: "Glossary", path: PATH },
        ]),
      },
    ],
    links: [{ rel: "canonical", href: absUrl(PATH) }],
  }),
  component: GlossaryPage,
});

function GlossaryPage() {
  return (
    <AppShell>
      <div className="mx-auto max-w-3xl space-y-10">
        <header className="space-y-3">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">
            Glossary
          </p>
          <h1 className="text-3xl font-medium tracking-tight md:text-4xl">
            Terms and definitions.
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            Canonical definitions for the primitives, calibration metrics,
            engine concepts, and protocol terms used across openjev. See
            also the{" "}
            <Link
              to="/guides"
              className="text-fg underline underline-offset-2 hover:no-underline"
            >
              guides
            </Link>{" "}
            for deeper explanations of each concept.
          </p>

          {/* Alphabetical jump links */}
          <nav
            aria-label="Jump to letter"
            className="flex flex-wrap gap-x-2 gap-y-1 pt-1"
          >
            {buildLetterIndex().map(({ letter, slug }) => (
              <a
                key={letter}
                href={`#${slug}`}
                className="font-mono text-xs text-muted hover:text-fg"
              >
                {letter}
              </a>
            ))}
          </nav>
        </header>

        <div className="space-y-4">
          {GLOSSARY_SORTED.map((term) => (
            <div
              key={term.slug}
              id={term.slug}
              className="scroll-mt-20 rounded-md bg-surface p-5 shadow-[var(--shadow-border)]"
            >
              <h2 className="text-base font-medium tracking-tight text-fg">
                {term.term}
              </h2>
              <p className="mt-0.5 font-mono text-[11px] text-subtle">
                {term.short}
              </p>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                <LinkedText text={term.body} />
              </p>
              {term.seeAlso.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-subtle">
                    See also
                  </span>
                  {term.seeAlso.map((slug) => {
                    const related = termBySlug(slug);
                    if (!related) return null;
                    return (
                      <a
                        key={slug}
                        href={`#${slug}`}
                        className="rounded-sm bg-raised px-2 py-0.5 font-mono text-xs text-muted hover:text-fg"
                      >
                        {related.term}
                      </a>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>

        <footer className="flex flex-wrap gap-x-4 gap-y-2 border-t border-border pt-6 text-sm text-muted">
          <Link to="/guides" className="hover:text-fg">
            Guides
          </Link>
          <Link to="/faq" className="hover:text-fg">
            FAQ
          </Link>
          <Link to="/docs" className="hover:text-fg">
            Documentation
          </Link>
        </footer>
      </div>
    </AppShell>
  );
}

/** Return one representative slug per starting letter for jump navigation. */
function buildLetterIndex(): Array<{ letter: string; slug: string }> {
  const seen = new Set<string>();
  const result: Array<{ letter: string; slug: string }> = [];
  for (const term of GLOSSARY_SORTED) {
    const letter = term.term[0]?.toUpperCase() ?? "";
    if (!letter || seen.has(letter)) continue;
    seen.add(letter);
    result.push({ letter, slug: term.slug });
  }
  return result;
}
