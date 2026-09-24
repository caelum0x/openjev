import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { FAQ_GROUPS, FAQS } from "@/lib/content/faq";
import {
  absUrl,
  breadcrumbLd,
  faqLd,
  OG_IMAGE,
  SITE_NAME,
} from "@/lib/seo/site";
import { LinkedText } from "@/components/linked-text";

const PATH = "/faq";
const TITLE = `FAQ · ${SITE_NAME}`;
const DESCRIPTION =
  "Answers to common questions about typed decisions, calibrated confidence, self-hosting, pricing, backends, and API keys in openjev.";

export const Route = createFileRoute("/faq")({
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
        "script:ld+json": faqLd(FAQS.map((f) => ({ q: f.q, a: f.a }))),
      },
      {
        "script:ld+json": breadcrumbLd([
          { name: "Home", path: "/" },
          { name: "FAQ", path: PATH },
        ]),
      },
    ],
    links: [{ rel: "canonical", href: absUrl(PATH) }],
  }),
  component: FaqPage,
});

function FaqPage() {
  return (
    <AppShell>
      <div className="mx-auto max-w-3xl space-y-12">
        <header className="space-y-3">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">
            FAQ
          </p>
          <h1 className="text-3xl font-medium tracking-tight md:text-4xl">
            Frequently asked questions.
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            Questions about typed decisions, calibration, self-hosting, pricing,
            backends, and API keys. For deeper reading, see the{" "}
            <Link
              to="/guides"
              className="text-fg underline underline-offset-2 hover:no-underline"
            >
              guides
            </Link>{" "}
            and the{" "}
            <Link
              to="/glossary"
              className="text-fg underline underline-offset-2 hover:no-underline"
            >
              glossary
            </Link>
            .
          </p>
        </header>

        {FAQ_GROUPS.map((group) => (
          <section key={group.category} className="space-y-4">
            <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">
              {group.label}
            </h2>
            <div className="space-y-3">
              {group.items.map((item) => (
                <div
                  key={item.id}
                  id={item.id}
                  className="space-y-2 rounded-md bg-surface p-5 shadow-[var(--shadow-border)]"
                >
                  <p className="text-sm font-medium tracking-tight text-fg">
                    {item.q}
                  </p>
                  <p className="text-sm leading-relaxed text-muted"><LinkedText text={item.a} /></p>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </AppShell>
  );
}
