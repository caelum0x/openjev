import { MEASURED_LATENCY as ML } from "@/lib/content/benchmarks";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ContentNotFound } from "@/components/content-not-found";
import { AppShell } from "@/components/app-shell";
import { buttonVariants } from "@/components/ui/button";
import { MODEL_CARDS, MODEL_FAMILIES, familyInfo } from "@/lib/jev/models";
import {
  MEASURED_PROFILES,
  TUNING_PROFILES,
  PARAM_GLOSSARY,
  BASELINE_PROFILE_ID,
  PROFILE_EVAL_PROVENANCE,
  type MeasuredProfile,
  type TuningProfileSpec,
} from "@/lib/jev/model-cards";
import {
  absUrl,
  articleLd,
  breadcrumbLd,
  faqLd,
  SITE_NAME,
  OG_IMAGE,
} from "@/lib/seo/site";
import { cn } from "@/lib/utils";
import { ActiveEngineNumbers, ModelPublicNumbers } from "@/components/engine-numbers";
import { LinkedText } from "@/components/linked-text";

// ---------------------------------------------------------------------------
// Extended presentation data not carried by MODEL_CARDS or model-cards.ts.
// Mirrors the META object in models.tsx but is kept local to this page so
// models.tsx remains unchanged.
// ---------------------------------------------------------------------------

type ExtendedMeta = {
  readonly platform: string;
  readonly latency: string;
  readonly outputTokens: string;
  readonly aliases: readonly string[];
  readonly whenToUse: string;
};

const EXTENDED_META: Record<string, ExtendedMeta> = {
  auto: {
    platform: "Local tier anywhere; escalation via Groq, Ollama, or any keyed LLM",
    latency: "Local tier as System One; escalated questions add LLM time (not measured)",
    outputTokens: "0 locally; generated only for escalated questions",
    aliases: ["cascade", "openjev-auto"],
    whenToUse:
      "Production default when you have an LLM available. Confident questions stay local; low-confidence or out-of-scope ones escalate (threshold: escalate_below, default 0.6), and the response's escalation block records which did and why.",
  },
  "system-one": {
    platform: "Any JS runtime (Node, Bun, Deno, edge)",
    latency: ML.embedding1 + " embedding engine; " + ML.lexical1 + " lexical fallback",
    outputTokens: "0",
    aliases: ["jev-latest", "openjev-fast", "jev", "systemone", "balanced"],
    whenToUse:
      "The default for every decision. Neutral temperature and balanced feature weights — a well-calibrated middle the other profiles are described relative to. Start here and only switch if you have a measured reason.",
  },
  "jev-v13": {
    platform: "Any JS runtime (Node, Bun, Deno, edge)",
    latency: ML.lexical1 + " (lexical engine)",
    outputTokens: "0",
    aliases: ["jev-1.12", "sharp"],
    whenToUse:
      "Pin it only if you calibrated thresholds against these slightly-sharper distributions. Otherwise prefer System One (Balanced).",
  },
  decisive: {
    platform: "Any JS runtime (Node, Bun, Deno, edge)",
    latency: ML.lexical1 + " (lexical engine)",
    outputTokens: "0",
    aliases: ["rlhf"],
    whenToUse:
      "Coldest temperature (tempScale 0.72): most confident argmax, least hedging. Same answers as Balanced on the gold suite — it changes conviction, not the decision. The id `rlhf` still resolves here (backward compat).",
  },
  contrastive: {
    platform: "Any JS runtime (Node, Bun, Deno, edge)",
    latency: ML.lexical1 + " (lexical engine)",
    outputTokens: "0",
    aliases: ["rlcd"],
    whenToUse:
      "Down-weights surface overlap, up-weights distinctive tokens and the not_for penalty (dist 2.5, neg 1.8). Use when options overlap and the answer turns on a distinguishing detail or an explicit exclusion. The id `rlcd` still resolves here (backward compat).",
  },
  "laya-mlx": {
    platform: "Apple Silicon, macOS (MLX runtime)",
    latency: ML.notMeasured,
    outputTokens: "0",
    aliases: ["laya", "laya-multilingual"],
    whenToUse:
      "Open-weight neural typed-decision model on Apple MLX. Native bidirectional Choice / Score / Noul — stronger on nuance and multilingual state than the lexical engine, still 0 output tokens.",
  },
  "laya-onnx": {
    platform: "Linux / CPU (ONNX Runtime)",
    latency: ML.notMeasured,
    outputTokens: "0",
    aliases: [],
    whenToUse:
      "The same neural (Laya) weights on the portable ONNX/CPU runtime. Use in Linux containers and CI where MLX is unavailable — local, no cloud API.",
  },
  "otsone-1": {
    platform: "otsone / ONNX sidecar (OTSONE_MODEL_URL)",
    latency: ML.notMeasured,
    outputTokens: "0",
    aliases: ["otsone", "otsone-base", "openjev-one"],
    whenToUse:
      "Our own neural typed-decision model (otsone-base), trained in-house via the laya-mlx pipeline and served over the otsone / ONNX sidecar. Native bidirectional Choice / Score / Noul. Measured model card lands with the first release; until the sidecar is up it health-gates to the local engine under an honest fallback marker.",
  },
  "otsone-mini": {
    platform: "otsone / ONNX sidecar (OTSONE_MODEL_URL)",
    latency: ML.notMeasured,
    outputTokens: "0",
    aliases: ["openjev-mini"],
    whenToUse:
      "A smaller, faster otsone checkpoint for CPU-bound and high-throughput serving. Same typed contract and sidecar as otsone-1; measured card pending.",
  },
  "openjev-grok": {
    platform: "Hosted LLM (OpenAI / xAI Grok / Anthropic)",
    latency: ML.notMeasured,
    outputTokens: "generated (constrained)",
    aliases: ["openjev-llm", "escalate", "grok", "llm"],
    whenToUse:
      "Escalation only. Hand the same typed questions to a frontier LLM when local confidence is thin. Slower and metered — gate it behind a confidence check.",
  },
  "system-one-cloud": {
    platform: "OpenJev Cloud (your configured cloud endpoint)",
    latency: ML.notMeasured,
    outputTokens: "0",
    aliases: ["jev-cloud"],
    whenToUse:
      "Proxies typed questions to the hosted OpenJev cloud API. Requires OPENJEV_API_KEY (back-compat: TYPESAFE_API_KEY); degrades to the local engine when unset.",
  },
};

// ---------------------------------------------------------------------------
// SEO helpers
// ---------------------------------------------------------------------------

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

function signed(x: number, digits = 4): string {
  if (x === 0) return "±0";
  const s = x.toFixed(digits);
  return x > 0 ? `+${s}` : s;
}

function lowerBetterTone(x: number): string {
  if (x === 0) return "text-subtle";
  return x < 0 ? "text-ok" : "text-muted";
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const Route = createFileRoute("/models/$id")({
  loader: ({ params }) => {
    if (!MODEL_CARDS.find((c) => c.id === params.id)) throw notFound();
  },
  notFoundComponent: () => (
    <ContentNotFound kind="Model" backTo="/models" backLabel="All models" />
  ),
  head: ({ params }) => {
    const id = params.id;
    const card = MODEL_CARDS.find((c) => c.id === id);
    if (!card) return {};

    const spec: TuningProfileSpec | undefined = TUNING_PROFILES.find(
      (p) => p.id === id,
    );
    const measured: MeasuredProfile | undefined = MEASURED_PROFILES.find(
      (m) => m.id === id,
    );

    const rawDescription = spec
      ? `${spec.tagline} ${spec.whenToUse}`
      : card.blurb;
    const description = rawDescription.slice(0, 160);
    const title = `${card.label} · Models · ${SITE_NAME}`;
    const path = `/models/${id}`;

    const measuredFaqs = measured
      ? [
          {
            q: `What is the accuracy of ${card.label}?`,
            a: `${card.label} achieves ${pct(measured.accuracy)} accuracy on the gold suite (${measured.strictPassed}/${measured.strictTotal} strict assertions passed). Accuracy is identical across all local tuning profiles — they vary confidence and calibration, not which option wins. The gold suite is small, in-repo, and the engine was tuned on it, so this is not a held-out number; measured accuracy on public data (Banking77, CLINC150 + out-of-scope, AG News) is on the /leaderboard page.`,
          },
          {
            q: `What is the ECE for ${card.label}?`,
            a: `On the in-repo gold suite, ECE (expected calibration error) is ${measured.ece.toFixed(4)} and Brier score is ${measured.brier.toFixed(4)} — both lower is better. The ${signed(measured.deltaVsBaseline.ece)} ECE delta vs the Balanced baseline indicates ${measured.deltaVsBaseline.ece < 0 ? "better" : "worse"} calibration. Public-dataset ECE is on the /leaderboard page.`,
          },
          {
            q: `When should I use ${card.label} instead of ${BASELINE_PROFILE_ID}?`,
            a: spec?.whenToUse ?? card.blurb,
          },
        ]
      : [];

    const meta = [
      { title },
      { name: "description", content: description },
      {
        name: "keywords",
        content: `${id}, OpenJev model, typed decision model, ${card.family}, model card`,
      },
      { property: "og:type", content: "article" },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:url", content: absUrl(path) },
      { property: "og:image", content: OG_IMAGE },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
      {
        "script:ld+json": articleLd({
          headline: card.label,
          description,
          path,
          dateModified: "2026-09-23",
          keywords: [id, "typed decision", "model card", card.family.toLowerCase()],
        }),
      },
      {
        "script:ld+json": breadcrumbLd([
          { name: "Home", path: "/" },
          { name: "Models", path: "/models" },
          { name: card.label, path },
        ]),
      },
    ];

    if (measuredFaqs.length) {
      meta.push({
        "script:ld+json": faqLd(measuredFaqs),
      } as unknown as (typeof meta)[number]);
    }

    return {
      meta,
      links: [{ rel: "canonical", href: absUrl(path) }],
    };
  },
  component: ModelDetailPage,
});

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function ModelDetailPage() {
  const { id } = Route.useParams();

  const card = MODEL_CARDS.find((c) => c.id === id);

  if (!card) {
    return (
      <AppShell>
        <div className="mx-auto max-w-2xl space-y-4">
          <h1 className="text-2xl font-medium tracking-tight">Unknown model</h1>
          <p className="text-sm text-muted">
            No model is registered with id{" "}
            <span className="font-mono text-fg">{id}</span>. Check that you are
            using a canonical model id, not an alias.
          </p>
          <Link
            to="/models"
            className={cn(buttonVariants({ variant: "secondary" }))}
          >
            All models
          </Link>
        </div>
      </AppShell>
    );
  }

  const spec: TuningProfileSpec | undefined = TUNING_PROFILES.find(
    (p) => p.id === id,
  );
  const measured: MeasuredProfile | undefined = MEASURED_PROFILES.find(
    (m) => m.id === id,
  );
  const meta = EXTENDED_META[id];
  const isBaseline = id === BASELINE_PROFILE_ID;

  const allAliases = [
    ...new Set([
      ...(spec?.aliases ?? []),
      ...(meta?.aliases ?? []),
    ]),
  ];

  return (
    <AppShell>
      <article className="mx-auto max-w-3xl space-y-10">
        {/* Header */}
        <header className="space-y-3">
          <Link
            to="/models"
            className="font-mono text-xs uppercase tracking-[0.18em] text-subtle hover:text-fg"
          >
            ← Models
          </Link>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 pt-1">
            <h1 className="text-3xl font-medium tracking-tight md:text-4xl">
              {card.label}
            </h1>
            {isBaseline ? (
              <span className="rounded-full bg-raised px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-fg">
                baseline
              </span>
            ) : null}
          </div>
          <p className="font-mono text-xs text-subtle">{card.id}</p>
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            <LinkedText text={card.blurb} />
          </p>
        </header>

        {/* Model family — which of the three, and how it differs */}
        <section className="space-y-3 rounded-md bg-surface p-5 shadow-[var(--shadow-border)]">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
            Model family · {familyInfo(card.familyId).label}
          </h2>
          <p className="text-sm leading-relaxed text-muted">
            {familyInfo(card.familyId).blurb}
          </p>
          <p className="text-sm leading-relaxed text-muted">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
              Availability ·{" "}
            </span>
            {familyInfo(card.familyId).requirement}.
          </p>
          <div className="space-y-1 border-t border-border/60 pt-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
              How the three families differ
            </p>
            <ul className="space-y-1 text-sm leading-relaxed text-muted">
              {MODEL_FAMILIES.map((fam) => (
                <li key={fam.id}>
                  <span
                    className={cn(
                      "font-mono text-xs",
                      fam.id === card.familyId ? "text-fg" : "text-subtle",
                    )}
                  >
                    {fam.label}
                    {fam.id === card.familyId ? " (this model)" : ""}
                  </span>{" "}
                  — {fam.requirement.toLowerCase()}.
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Core metadata table */}
        <section className="space-y-3 rounded-md bg-surface p-5 shadow-[var(--shadow-border)]">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
            Specification
          </h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
            <div className="space-y-0.5">
              <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-subtle">
                Family
              </dt>
              <dd className="text-fg">{card.family}</dd>
            </div>
            <div className="space-y-0.5">
              <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-subtle">
                Backend
              </dt>
              <dd className="font-mono text-fg">{card.backend}</dd>
            </div>
            {meta ? (
              <>
                <div className="space-y-0.5">
                  <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-subtle">
                    Output tokens
                  </dt>
                  <dd className="font-mono text-fg">{meta.outputTokens}</dd>
                </div>
                <div className="space-y-0.5 sm:col-span-2">
                  <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-subtle">
                    Platform
                  </dt>
                  <dd className="text-fg">{meta.platform}</dd>
                </div>
                <div className="space-y-0.5">
                  <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-subtle">
                    Latency
                  </dt>
                  <dd className="font-mono text-fg">{meta.latency}</dd>
                </div>
              </>
            ) : null}
          </dl>
        </section>

        {/* When to use */}
        {(spec?.whenToUse ?? meta?.whenToUse) ? (
          <section className="space-y-2">
            <h2 className="text-lg font-medium tracking-tight">When to use</h2>
            <p className="text-sm leading-relaxed text-muted">
              <LinkedText text={spec?.whenToUse ?? meta?.whenToUse ?? ""} />
            </p>
          </section>
        ) : null}

        {/* Measured public-dataset numbers */}
        <section className="space-y-3">
          <h2 className="text-lg font-medium tracking-tight">Measured on public datasets</h2>
          {card.id === "system-one" ? (
            <>
              <p className="text-sm leading-relaxed text-muted">
                system-one is served by one of two engines. Which one is answering on this
                deployment is checked live; both have measured numbers.
              </p>
              <ActiveEngineNumbers />
            </>
          ) : (
            <ModelPublicNumbers modelId={card.id} />
          )}
        </section>

        {/* Tuning profile spec */}
        {spec ? (
          <section className="space-y-4">
            <h2 className="text-lg font-medium tracking-tight">
              What the scalars change
            </h2>
            <p className="text-sm leading-relaxed text-muted">
              {spec.whatChanges}
            </p>
            {spec.paramChanges.length > 0 ? (
              <div className="rounded-md bg-surface p-5 shadow-[var(--shadow-border)]">
                <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                  Parameter changes vs {BASELINE_PROFILE_ID} (Balanced baseline)
                </p>
                <ul className="space-y-2">
                  {spec.paramChanges.map((c) => (
                    <li key={c.param} className="text-sm leading-relaxed">
                      <span className="font-mono text-fg">
                        {c.param} {c.from} → {c.to}
                      </span>
                      <span className="text-muted"> — {c.effect}</span>
                      {PARAM_GLOSSARY[c.param] ? (
                        <span className="ml-1 text-xs text-subtle">
                          ({PARAM_GLOSSARY[c.param]})
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-sm text-subtle">
                This is the baseline. All other profiles state their deltas
                relative to this one.
              </p>
            )}
          </section>
        ) : null}

        {/* Measured metrics */}
        {measured ? (
          <section className="space-y-4">
            <div className="space-y-1">
              <h2 className="text-lg font-medium tracking-tight">
                Measured performance
              </h2>
              <p className="text-sm leading-relaxed text-muted">
                Real numbers from running the{" "}
                <span className="font-mono text-fg">
                  {PROFILE_EVAL_PROVENANCE.caseCount}
                </span>
                -case gold suite (
                <span className="font-mono text-fg">
                  {PROFILE_EVAL_PROVENANCE.predictionCount}
                </span>{" "}
                labelled predictions) through{" "}
                <span className="font-mono text-fg">evalProfiles()</span>.
                Accuracy is identical across all local profiles — these numbers
                show confidence and calibration, not which option wins. These
                are lexical-engine numbers (the default system-one uses the
                embedding engine when its model is installed), and the lexical
                engine was tuned on this in-repo suite, so these are not
                held-out numbers — see the{" "}
                <Link to="/leaderboard" className="text-fg underline underline-offset-2">
                  public-dataset leaderboard
                </Link>{" "}
                for Banking77, CLINC150 + out-of-scope and AG News.
              </p>
            </div>

            {/* Headline metrics */}
            <div className="rounded-md bg-surface p-5 shadow-[var(--shadow-border)]">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-xs sm:grid-cols-4">
                <div className="space-y-0.5">
                  <dt className="font-mono uppercase tracking-[0.12em] text-subtle">
                    Accuracy
                  </dt>
                  <dd className="font-mono text-fg">{pct(measured.accuracy)}</dd>
                </div>
                <div className="space-y-0.5">
                  <dt className="font-mono uppercase tracking-[0.12em] text-subtle">
                    Avg conf
                  </dt>
                  <dd className="font-mono text-fg">
                    {measured.avgConfidence.toFixed(3)}
                    {!isBaseline ? (
                      <span className="ml-1.5 text-subtle">
                        ({signed(measured.deltaVsBaseline.avgConfidence)})
                      </span>
                    ) : null}
                  </dd>
                </div>
                <div className="space-y-0.5">
                  <dt className="font-mono uppercase tracking-[0.12em] text-subtle">
                    ECE
                  </dt>
                  <dd className="font-mono text-fg">
                    {measured.ece.toFixed(4)}
                    {!isBaseline ? (
                      <span
                        className={cn(
                          "ml-1.5",
                          lowerBetterTone(measured.deltaVsBaseline.ece),
                        )}
                      >
                        ({signed(measured.deltaVsBaseline.ece)})
                      </span>
                    ) : null}
                  </dd>
                </div>
                <div className="space-y-0.5">
                  <dt className="font-mono uppercase tracking-[0.12em] text-subtle">
                    Brier
                  </dt>
                  <dd className="font-mono text-fg">
                    {measured.brier.toFixed(4)}
                    {!isBaseline ? (
                      <span
                        className={cn(
                          "ml-1.5",
                          lowerBetterTone(measured.deltaVsBaseline.brier),
                        )}
                      >
                        ({signed(measured.deltaVsBaseline.brier)})
                      </span>
                    ) : null}
                  </dd>
                </div>
                <div className="space-y-0.5 sm:col-span-2">
                  <dt className="font-mono uppercase tracking-[0.12em] text-subtle">
                    Strict assertions
                  </dt>
                  <dd className="font-mono text-fg">
                    {measured.strictPassed} / {measured.strictTotal} passed
                  </dd>
                </div>
                <div className="space-y-0.5">
                  <dt className="font-mono uppercase tracking-[0.12em] text-subtle">
                    MCE
                  </dt>
                  <dd className="font-mono text-fg">
                    {measured.mce.toFixed(4)}
                  </dd>
                </div>
              </dl>
            </div>

            {/* Per-question-type breakdown */}
            <div className="space-y-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                By question type (accuracy · avg confidence · n)
              </p>
              <div className="overflow-x-auto rounded-md bg-surface shadow-[var(--shadow-border)]">
                <table className="w-full min-w-[360px] text-left text-xs">
                  <thead className="border-b border-border font-mono uppercase tracking-[0.12em] text-subtle">
                    <tr>
                      <th className="px-4 py-2.5">Type</th>
                      <th className="px-4 py-2.5">Accuracy</th>
                      <th className="px-4 py-2.5">Avg conf</th>
                      <th className="px-4 py-2.5">n</th>
                    </tr>
                  </thead>
                  <tbody className="text-muted">
                    {measured.byType.map((t) => (
                      <tr
                        key={t.qtype}
                        className="border-b border-border/60 last:border-0"
                      >
                        <td className="px-4 py-3 font-mono text-fg">
                          {t.qtype}
                        </td>
                        <td className="px-4 py-3 font-mono">
                          {pct(t.accuracy)}
                        </td>
                        <td className="px-4 py-3 font-mono">
                          {t.avgConfidence.toFixed(3)}
                        </td>
                        <td className="px-4 py-3 font-mono">{t.n}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <p className="text-xs leading-relaxed text-subtle">
              ECE = expected calibration error, MCE = maximum calibration error,
              Brier = mean squared error of the confidence — all lower-is-better.
              Deltas ({"{delta}"}
              ) are vs the{" "}
              <span className="font-mono">{BASELINE_PROFILE_ID}</span> baseline.
              Green delta = better than baseline. Reproduce via:{" "}
              <span className="font-mono text-muted">
                {PROFILE_EVAL_PROVENANCE.harness}
              </span>
              .
            </p>
          </section>
        ) : null}

        {/* Aliases — backward-compat note */}
        {allAliases.length > 0 ? (
          <section className="space-y-3 rounded-md bg-surface p-5 shadow-[var(--shadow-border)]">
            <h2 className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
              Backward-compatible aliases
            </h2>
            <p className="text-sm leading-relaxed text-muted">
              The following ids all resolve to{" "}
              <span className="font-mono text-fg">{card.id}</span>. They are
              kept for backward compatibility — existing integrations that pin
              any of these aliases continue to work and will receive the same
              engine. The canonical id is{" "}
              <span className="font-mono text-fg">{card.id}</span>.
            </p>
            <div className="flex flex-wrap gap-2">
              {allAliases.map((a) => (
                <span
                  key={a}
                  className="rounded-sm bg-inset px-2 py-1 font-mono text-xs text-muted"
                >
                  {a}
                </span>
              ))}
            </div>
          </section>
        ) : null}

        {/* Other models */}
        <section className="space-y-3 border-t border-border pt-8">
          <h2 className="text-lg font-medium tracking-tight">Other models</h2>
          <div className="flex flex-wrap gap-2">
            {MODEL_CARDS.filter((c) => c.id !== card.id).map((c) => (
              <Link
                key={c.id}
                to="/models/$id"
                params={{ id: c.id }}
                className="rounded-sm bg-raised px-3 py-2 font-mono text-xs text-muted transition-colors hover:text-fg"
              >
                {c.id}
              </Link>
            ))}
          </div>
        </section>

        {/* CTA */}
        <div className="flex flex-wrap gap-2 border-t border-border pt-6">
          <Link
            to="/api-explorer"
            className={cn(buttonVariants({ variant: "primary" }))}
          >
            Try it in the API Explorer →
          </Link>
          <Link
            to="/models"
            className={cn(buttonVariants({ variant: "secondary" }))}
          >
            All models
          </Link>
          <Link
            to="/playground"
            className={cn(buttonVariants({ variant: "secondary" }))}
          >
            Playground
          </Link>
        </div>
      </article>
    </AppShell>
  );
}
