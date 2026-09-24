import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  formatPlanPrice,
  planById,
  PLANS,
  pricePer1kDecisionsUsd,
  type PlanDefinition,
} from "@/lib/jev/plans";
import { pageHead } from "@/lib/seo/site";

type PricingSearch = { checkout_error?: string };

/**
 * Hosted plans (Hosted Free / Calibrate / Team + Creem checkout) are shown only
 * when a deployment operates a hosted service and opts in at build time with
 * VITE_OPENJEV_HOSTED=1. Default: off. There is no official hosted OpenJev
 * service today, so a plain build only advertises self-hosting.
 */
const HOSTED_OFFERING =
  ((import.meta as { env?: Record<string, string | undefined> }).env?.VITE_OPENJEV_HOSTED ?? "") ===
  "1";

const VISIBLE_PLANS = HOSTED_OFFERING ? PLANS : PLANS.filter((p) => p.id === "selfhost");

export const Route = createFileRoute("/pricing")({
  head: () =>
    pageHead(
      "Pricing",
      HOSTED_OFFERING
        ? "OpenJev pricing: self-host free under Apache-2.0, or use the hosted plans."
        : "OpenJev is free and open source under Apache-2.0. Self-host it on your own infrastructure.",
    ),
  validateSearch: (search: Record<string, unknown>): PricingSearch => ({
    checkout_error:
      typeof search.checkout_error === "string" ? search.checkout_error : undefined,
  }),
  component: PricingPage,
});

type Cta = { label: string; to?: "/keys" | "/docs"; href?: string };

function planCta(plan: PlanDefinition): Cta {
  if (plan.id === "selfhost") return { label: "Read the docs", to: "/docs" };
  if (plan.id === "free") return { label: "Create an ots_live_ key", to: "/keys" };
  return { label: `Start ${plan.name}`, href: `/api/v1/checkout?plan=${plan.id}` };
}

function planCadence(plan: PlanDefinition): string {
  if (plan.id === "selfhost") return "forever, unlimited";
  if (plan.monthlyFeeCents === 0) return "per month";
  return "per month";
}

const JEV_PRICE_PER_1K_USD = 0.01;

const COMPARE: ReadonlyArray<{
  feature: string;
  self: string;
  hosted: string;
}> = [
  { feature: "License", self: "Apache-2.0", hosted: "Apache-2.0 core" },
  { feature: "Choice / Score / Noul primitives", self: "Yes", hosted: "Yes" },
  { feature: "Request shape", self: "System One v1 wire-compatible", hosted: "System One v1 wire-compatible" },
  { feature: "Out-of-scope score + abstain", self: "Yes", hosted: "Yes, every plan" },
  { feature: "Per-question calibration on your labels", self: "Yes", hosted: "Calibrate and Team" },
  { feature: "Shadow mode vs your current LLM", self: "Yes", hosted: "Calibrate and Team" },
  { feature: "Auto cascade (local first, LLM when unsure)", self: "Yes, bring any LLM key", hosted: "Calibrate and Team" },
  { feature: "Runs on", self: "Your infra", hosted: "Our infra" },
  { feature: "Price", self: "Free", hosted: "Subscription, overage under Jev" },
];
const DOCKER = `# Self-host with Docker Compose — this is the whole product, free.
git clone https://github.com/caelum0x/openjev
cd openjev && docker compose up --build

# Or run the Node server directly (Apache-2.0)
npm install && npm run build:node && npm run serve

# Then call it — no key needed on same origin
curl -X POST http://localhost:3000/api/v1/systemone \\
  -H 'Content-Type: application/json' \\
  -d '{ "model": "system-one",
        "state": "A hotdog: a sausage in a sliced bun.",
        "questions": { "is_sandwich": { "type": "noul",
          "instructions": "Is this a sandwich?" } } }'`;

function PricingPage() {
  const { checkout_error } = Route.useSearch();
  const failedPlan = checkout_error ? planById(checkout_error) : undefined;
  const overage = pricePer1kDecisionsUsd();
  return (
    <AppShell>
      <article className="mx-auto max-w-4xl space-y-14">
        <header className="space-y-4">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">
            Pricing
          </p>
          <h1 className="max-w-2xl text-3xl font-medium tracking-tight md:text-4xl">
            {HOSTED_OFFERING
              ? "Free to self-host. Pay only for hosted trust tooling."
              : "Free and open source. Self-host everything."}
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            OpenJev is an Apache-2.0, self-hostable decision engine. Every
            primitive, every backend, calibration, shadow mode and the auto
            cascade run free on your own hardware, forever.{" "}
            {HOSTED_OFFERING ? (
              <>
                The hosted plans are a flat subscription for the trust layer, not
                a per-call meter: decisions beyond your allowance cost $
                {overage.toFixed(3)} per 1,000, against roughly $
                {JEV_PRICE_PER_1K_USD.toFixed(2)} per 1,000 on Jev.
              </>
            ) : (
              <>There is no official hosted OpenJev service at this time.</>
            )}
          </p>
          {failedPlan?.checkoutEnv ? (
            <p
              role="alert"
              className="max-w-2xl rounded-md bg-danger/10 px-4 py-3 text-sm text-danger"
            >
              Checkout for {failedPlan.name} is not configured on this
              deployment. The operator must set{" "}
              <code className="font-mono">{failedPlan.checkoutEnv}</code> to a
              Creem checkout link.
            </p>
          ) : null}
        </header>

        <section
          className={cn(
            "grid gap-4",
            HOSTED_OFFERING ? "md:grid-cols-2 lg:grid-cols-4" : "max-w-md",
          )}
        >
          {VISIBLE_PLANS.map((plan) => {
            const t = {
              name: plan.name,
              price: formatPlanPrice(plan.monthlyFeeCents),
              cadence: planCadence(plan),
              highlight: plan.id === "calibrate",
              tagline:
                plan.includedDecisions > 0
                  ? `${plan.includedDecisions.toLocaleString("en-US")} decisions included, then $${overage.toFixed(3)} per 1,000.`
                  : "No account, no quota, no phone-home.",
              points: plan.features,
              cta: planCta(plan),
              ctaVariant: (plan.id === "calibrate" ? "primary" : "secondary") as
                | "primary"
                | "secondary",
            };
            return (
            <div
              key={t.name}
              className={cn(
                "flex flex-col gap-5 rounded-md bg-surface p-6 shadow-[var(--shadow-border)]",
                t.highlight && "ring-1 ring-accent/30",
              )}
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-medium tracking-tight">{t.name}</h2>
                  {t.highlight ? (
                    <span className="rounded-full bg-accent/15 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-accent">
                      Most teams
                    </span>
                  ) : null}
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-3xl tracking-tight text-fg">
                    {t.price}
                  </span>
                  <span className="font-mono text-xs text-subtle">{t.cadence}</span>
                </div>
              </div>
              <p className="text-sm leading-relaxed text-muted">{t.tagline}</p>
              <ul className="space-y-2 text-sm text-muted">
                {t.points.map((p) => (
                  <li key={p} className="flex gap-2">
                    <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-accent" />
                    <span className="leading-relaxed">{p}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-auto pt-1">
                {t.cta.to ? (
                  <Link
                    to={t.cta.to}
                    className={cn(buttonVariants({ variant: t.ctaVariant }))}
                  >
                    {t.cta.label}
                  </Link>
                ) : (
                  <a
                    href={t.cta.href}
                    className={cn(buttonVariants({ variant: t.ctaVariant }))}
                  >
                    {t.cta.label}
                  </a>
                )}
              </div>
            </div>
            );
          })}
        </section>

        {HOSTED_OFFERING ? (
        <section className="space-y-3">
          <h2 className="text-lg font-medium tracking-tight">Feature comparison</h2>
          <div className="overflow-x-auto rounded-md bg-surface shadow-[var(--shadow-border)]">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="border-b border-border font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                <tr>
                  <th className="px-4 py-3">Feature</th>
                  <th className="px-4 py-3">Self-host</th>
                  <th className="px-4 py-3">Hosted</th>
                </tr>
              </thead>
              <tbody className="text-muted">
                {COMPARE.map((row, i) => (
                  <tr
                    key={row.feature}
                    className={i < COMPARE.length - 1 ? "border-b border-border/60" : ""}
                  >
                    <td className="px-4 py-3 text-fg">{row.feature}</td>
                    <td className="px-4 py-3">{row.self}</td>
                    <td className="px-4 py-3">{row.hosted}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        ) : null}

        <section className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-lg font-medium tracking-tight">
              The free path is the default path
            </h2>
            <p className="max-w-2xl text-sm leading-relaxed text-muted">
              There is no gated tier hiding behind a paywall. A self-hosted
              install has every feature, with no account, quota or phone-home.
            </p>
          </div>
          <pre className="overflow-x-auto rounded-md bg-surface p-4 font-mono text-[12px] leading-relaxed text-fg shadow-[var(--shadow-border)]">
            {DOCKER}
          </pre>
        </section>

        <section className="space-y-3 rounded-md bg-inset p-6">
          <h2 className="text-base font-medium tracking-tight">
            Why is it free?
          </h2>
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            Typed decisions belong in the same category as a parser or a regex
            engine — infrastructure, not a product you should rent per call.
            OpenJev exists so you can put typed-decision primitives inside your
            code without a vendor in the request path. Apache-2.0 means you can
            fork it, embed it, ship it in a commercial product, and never pay us
            anything.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Link to="/docs" className={cn(buttonVariants({ variant: "primary" }))}>
              Start self-hosting →
            </Link>
            <Link to="/security" className={cn(buttonVariants({ variant: "secondary" }))}>
              Trust Center
            </Link>
          </div>
        </section>

        <footer className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-6 text-sm text-muted">
          <Link to="/about" className="hover:text-fg">About</Link>
          <Link to="/security" className="hover:text-fg">Trust Center</Link>
          <Link to="/privacy" className="hover:text-fg">Data Policy</Link>
          <Link to="/docs" className="hover:text-fg">Documentation</Link>
          <span className="ml-auto font-mono text-[11px] uppercase tracking-[0.14em] text-subtle">
            OpenJev · Apache-2.0
          </span>
        </footer>
      </article>
    </AppShell>
  );
}
