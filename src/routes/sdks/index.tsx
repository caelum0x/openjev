import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { SDK_GROUPS, SDKS } from "@/lib/content/sdks";
import {
  absUrl,
  breadcrumbLd,
  itemListLd,
  SITE_NAME,
  OG_IMAGE,
} from "@/lib/seo/site";

const PATH = "/sdks";
const TITLE = `SDK & Interface Guides — OpenJev · ${SITE_NAME}`;
const DESCRIPTION =
  "Install and integrate openjev: official JavaScript and Python SDKs, the client-side Python adapter, raw HTTP REST API reference, and CLI tools for serve and laya-download.";

export const Route = createFileRoute("/sdks/")({
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
          { name: "SDKs", path: PATH },
        ]),
      },
      {
        "script:ld+json": itemListLd(
          SDKS.map((s) => ({ name: s.title, path: `/sdks/${s.slug}` })),
        ),
      },
    ],
    links: [{ rel: "canonical", href: absUrl(PATH) }],
  }),
  component: SdksIndex,
});

function SdksIndex() {
  return (
    <AppShell>
      <div className="space-y-12">
        <header className="space-y-3">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">
            SDKs
          </p>
          <h1 className="max-w-3xl text-3xl font-medium tracking-tight md:text-4xl">
            Every way to call openjev.
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            Official SDKs for{" "}
            <span className="text-fg">JavaScript / TypeScript</span> and{" "}
            <span className="text-fg">Python</span>, a client-side{" "}
            <span className="text-fg">Python adapter</span> that needs no
            server, the raw{" "}
            <span className="font-mono text-fg">POST /v1/systemone</span> HTTP
            contract, and the{" "}
            <span className="text-fg">CLI</span> for local development and
            scripting.
          </p>
        </header>

        {SDK_GROUPS.map((group) =>
          group.sdks.length ? (
            <section key={group.kind} className="space-y-4">
              <h2 className="font-mono text-xs uppercase tracking-[0.16em] text-subtle">
                {group.label}
              </h2>
              <div className="grid gap-3 md:grid-cols-2">
                {group.sdks.map((s) => (
                  <Link
                    key={s.slug}
                    to="/sdks/$slug"
                    params={{ slug: s.slug }}
                    className="group flex flex-col rounded-md bg-surface p-5 shadow-[var(--shadow-border)] transition-[box-shadow] duration-150 hover:shadow-[var(--shadow-border-hover)]"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="font-medium tracking-tight">{s.title}</p>
                      <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                        {s.category}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-muted">
                      {s.description}
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
            Not sure which to start with?
          </h2>
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            If you are writing TypeScript or Node.js, start with{" "}
            <Link
              to="/sdks/$slug"
              params={{ slug: "javascript" }}
              className="text-fg hover:underline"
            >
              @caelum/typesafe
            </Link>
            . For Python services and notebooks, use{" "}
            <Link
              to="/sdks/$slug"
              params={{ slug: "python" }}
              className="text-fg hover:underline"
            >
              OpenJev
            </Link>
            . To prototype without running a server, try the{" "}
            <Link
              to="/sdks/$slug"
              params={{ slug: "python-adapter" }}
              className="text-fg hover:underline"
            >
              Python adapter
            </Link>
            . All three speak the same{" "}
            <span className="font-mono text-fg">POST /v1/systemone</span>{" "}
            contract, so switching is a one-line change.
          </p>
          <div className="flex flex-wrap gap-x-5 gap-y-2 pt-1 text-sm text-muted">
            <Link to="/playground" className="hover:text-fg">
              Open the playground →
            </Link>
            <Link to="/guides" className="hover:text-fg">
              Read the guides →
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
