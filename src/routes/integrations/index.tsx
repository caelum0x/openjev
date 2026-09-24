import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { INTEGRATION_GROUPS, INTEGRATIONS } from "@/lib/content/integrations";
import {
  absUrl,
  breadcrumbLd,
  itemListLd,
  SITE_NAME,
  OG_IMAGE,
} from "@/lib/seo/site";

const PATH = "/integrations";
const TITLE = `Integrations — typed decisions in every stack · ${SITE_NAME}`;
const DESCRIPTION =
  "Step-by-step guides for wiring OpenJev typed decisions into Next.js, Express, FastAPI, Django, LangChain, Vercel AI SDK, Cloudflare Workers, Deno Deploy, and Supabase Edge Functions.";

export const Route = createFileRoute("/integrations/")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { name: "keywords", content: "openjev integration, llm decision nextjs, langchain typed decision, fastapi llm, cloudflare workers llm classification" },
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
          { name: "Integrations", path: PATH },
        ]),
      },
      {
        "script:ld+json": itemListLd(
          INTEGRATIONS.map((i) => ({
            name: i.title,
            path: `/integrations/${i.slug}`,
          })),
        ),
      },
    ],
    links: [{ rel: "canonical", href: absUrl(PATH) }],
  }),
  component: IntegrationsIndex,
});

function IntegrationsIndex() {
  return (
    <AppShell>
      <div className="space-y-12">
        <header className="space-y-3">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">
            Integrations
          </p>
          <h1 className="max-w-3xl text-3xl font-medium tracking-tight md:text-4xl">
            Typed decisions in every stack.
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            Real, runnable examples showing where a{" "}
            <span className="text-fg">typed OpenJev decision</span> fits in
            your framework — install, client init, a working example, and
            production gotchas. One{" "}
            <span className="font-mono text-fg">POST /api/v1/systemone</span>{" "}
            with a state and typed questions, the same request shape on every
            stack.
          </p>
        </header>

        {INTEGRATION_GROUPS.map((group) =>
          group.integrations.length ? (
            <section key={group.kind} className="space-y-4">
              <h2 className="font-mono text-xs uppercase tracking-[0.16em] text-subtle">
                {group.label}
              </h2>
              <div className="grid gap-3 md:grid-cols-2">
                {group.integrations.map((i) => (
                  <Link
                    key={i.slug}
                    to="/integrations/$slug"
                    params={{ slug: i.slug }}
                    className="group flex flex-col rounded-md bg-surface p-5 shadow-[var(--shadow-border)] transition-[box-shadow] duration-150 hover:shadow-[var(--shadow-border-hover)]"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="font-medium tracking-tight">{i.navLabel}</p>
                      <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                        {i.category}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-muted">
                      {i.description}
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
            Same API, every runtime.
          </h2>
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            The wire format is identical across all stacks: a JSON{" "}
            <span className="font-mono text-fg">state</span> object and a map of
            typed questions. Self-host the engine to keep decisions inside your
            own infra, or point at the hosted endpoint — the payload never
            changes.
          </p>
          <div className="flex flex-wrap gap-x-5 gap-y-2 pt-1 text-sm text-muted">
            <Link to="/reference" className="hover:text-fg">
              API reference →
            </Link>
            <Link to="/guides" className="hover:text-fg">
              Read the guides →
            </Link>
            <Link to="/playground" className="hover:text-fg">
              Try the playground →
            </Link>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
