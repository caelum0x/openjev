import { MEASURED_LATENCY as ML } from "@/lib/content/benchmarks";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { buttonVariants } from "@/components/ui/button";
import {
  MODEL_CARDS,
  MODEL_FAMILIES,
  DEFAULT_MODEL,
  type ModelBackend,
  type ModelCard,
} from "@/lib/jev/models";
import {
  MEASURED_PROFILES,
  TUNING_PROFILES,
  PROFILE_EVAL_PROVENANCE,
  BASELINE_PROFILE_ID,
  type MeasuredProfile,
} from "@/lib/jev/model-cards";
import { cn } from "@/lib/utils";
import { LinkedText } from "@/components/linked-text";
import { ActiveEngineNumbers } from "@/components/engine-numbers";
import { pageHead } from "@/lib/seo/site";

export const Route = createFileRoute("/models/")({
  head: () =>
    pageHead("Models", "The model families that serve the OpenJev System One contract, with measured accuracy and calibration."),
  component: ModelsPage,
});

/**
 * Per-model presentation metadata, keyed by the registry id in
 * src/lib/jev/models.ts. The registry stays the source of truth for id / label /
 * family / backend / blurb; this map only adds the human-facing detail a model
 * card wants (platform, latency ballpark, aliases, when to reach for it).
 */
type ModelMeta = {
  aliases: string[];
  platform: string;
  latency: string;
  outputTokens: string;
  whenToUse: string;
};

const META: Record<string, ModelMeta> = {
  auto: {
    aliases: ["cascade", "openjev-auto"],
    platform: "Local tier anywhere; escalation via Groq, Ollama, or any keyed LLM",
    latency: "Local tier as System One; escalated questions add LLM time (not measured)",
    outputTokens: "0 locally; generated only for escalated questions",
    whenToUse:
      "Production default when you have an LLM available. Confident questions stay local; low-confidence or out-of-scope ones escalate, and the response lists exactly which did and why.",
  },
  "system-one": {
    aliases: ["jev-latest", "openjev-fast", "jev", "systemone"],
    platform: "Any JS runtime (Node, Bun, Deno, edge)",
    latency: ML.embedding1 + " embedding engine; " + ML.lexical1 + " lexical fallback",
    outputTokens: "0",
    whenToUse:
      "The default. Structured criteria, field-path focus, contrastive Choice / Score / Noul. Start here for every decision.",
  },
  "jev-v13": {
    aliases: ["jev-1.12"],
    platform: "Any JS runtime",
    latency: ML.lexical1 + " (lexical engine)",
    outputTokens: "0",
    whenToUse:
      "The previous flagship profile — slightly more peaked distributions, identical primitives. Pin it when you calibrated thresholds against V13.",
  },
  decisive: {
    aliases: ["rlhf"],
    platform: "Any JS runtime",
    latency: ML.lexical1 + " (lexical engine)",
    outputTokens: "0",
    whenToUse:
      "Coldest temperature (tempScale 0.72): most confident argmax, least hedging. Same answers as Balanced on the gold suite — it changes conviction, not the decision. A tuning profile, not a preference-learning run.",
  },
  contrastive: {
    aliases: ["rlcd"],
    platform: "Any JS runtime",
    latency: ML.lexical1 + " (lexical engine)",
    outputTokens: "0",
    whenToUse:
      "Down-weights surface overlap, up-weights distinctive tokens and the not_for penalty (dist 2.5, neg 1.8). Use when options overlap and the answer turns on a distinguishing detail or an explicit exclusion. Feature re-weighting, not contrastive distillation.",
  },
  "laya-mlx": {
    aliases: ["laya", "laya-multilingual"],
    platform: "Apple Silicon, macOS (MLX runtime)",
    latency: ML.notMeasured,
    outputTokens: "0",
    whenToUse:
      "Open-weight neural typed-decision model on Apple MLX. Native bidirectional Choice / Score / Noul — stronger on nuance and multilingual state than the lexical engine, still 0 output tokens.",
  },
  "laya-onnx": {
    aliases: [],
    platform: "Linux / CPU (ONNX Runtime)",
    latency: ML.notMeasured,
    outputTokens: "0",
    whenToUse:
      "The same Laya weights on the portable ONNX/CPU runtime. Use in Linux containers and CI where MLX is unavailable — local, no cloud API.",
  },
  "otsone-1": {
    aliases: ["otsone", "otsone-base", "openjev-one"],
    platform: "otsone / ONNX sidecar (OTSONE_MODEL_URL)",
    latency: ML.notMeasured,
    outputTokens: "0",
    whenToUse:
      "Our own neural typed-decision model (otsone-base), trained in-house via the laya-mlx pipeline. Native bidirectional Choice / Score / Noul. Measured model card lands with the first release; until the sidecar is up it health-gates to the local engine.",
  },
  "otsone-mini": {
    aliases: ["openjev-mini"],
    platform: "otsone / ONNX sidecar (OTSONE_MODEL_URL)",
    latency: ML.notMeasured,
    outputTokens: "0",
    whenToUse:
      "A smaller, faster otsone checkpoint for CPU-bound and high-throughput serving. Same typed contract as otsone-1; measured card pending.",
  },
  "openjev-grok": {
    aliases: ["openjev-llm", "escalate", "grok", "llm"],
    platform: "Hosted LLM (OpenAI / xAI Grok / Anthropic)",
    latency: ML.notMeasured,
    outputTokens: "generated (constrained)",
    whenToUse:
      "Escalation only. Hand the same typed questions to a frontier LLM when local confidence is thin. Slower and metered — gate it behind a confidence check.",
  },
};

const BACKEND_LABEL: Record<ModelBackend, string> = {
  auto: "Cascade (local + LLM)",
  local: "Local engine",
  laya: "Laya (open-weight)",
  otsone: "OpenJev (otsone)",
  llm: "Any-LLM escalation",
  cloud: "OpenJev Cloud",
};

/** Honest per-model availability requirement, derived from its backend. */
const BACKEND_REQUIREMENT: Record<ModelBackend, string> = {
  auto: "Always available; escalates only when an LLM is configured",
  local: "Always available",
  otsone: "Requires the otsone sidecar",
  laya: "Requires the Laya sidecar",
  llm: "Requires an LLM provider key",
  cloud: "Requires OPENJEV_API_KEY",
};

/** Tone for the availability badge: local is on, everything else is gated. */
function requirementTone(backend: ModelBackend): string {
  return backend === "local" || backend === "auto" ? "text-ok" : "text-subtle";
}

type BackendCard = {
  id: string;
  name: string;
  runtime: string;
  latency: string;
  detail: string;
};

/** The backends any model can resolve to, ordered fastest → most capable. */
const BACKENDS: ReadonlyArray<BackendCard> = [
  {
    id: "native",
    name: "native",
    runtime: "C++ / Rust kernel sidecar",
    latency: ML.notMeasured,
    detail:
      "The System One engine compiled to a native kernel, served over a local HTTP sidecar (OPENJEV_ENGINE_URL, default :8091). Same wire contract, same answers as the TS engine — just the hot path in native code for high-throughput serving. Falls through to the local engine when the sidecar is not running.",
  },
  {
    id: "local",
    name: "local",
    runtime: "Pure-TypeScript engine",
    latency: ML.lexical1,
    detail:
      "Zero-dependency lexical + contrastive engine that ships in the app itself. Runs anywhere JavaScript runs — Node, Bun, Deno, or the edge — with no model download and no network. This is what the same-origin playground calls. It is the reference implementation of System One.",
  },
  {
    id: "laya-mlx",
    name: "laya-mlx",
    runtime: "Apple MLX, macOS / Apple Silicon",
    latency: ML.notMeasured,
    detail:
      "Open-weight neural typed-decision model on Apple's MLX. Predicts Choice / Score / Noul bidirectionally on-device, so it reads nuance and non-English state better than the lexical engine while still emitting 0 output tokens. Auto-selected on darwin.",
  },
  {
    id: "laya-onnx",
    name: "laya-onnx",
    runtime: "ONNX Runtime, Linux / CPU",
    latency: ML.notMeasured,
    detail:
      "The identical Laya weights exported to ONNX for portable CPU inference. Use it in Linux containers, CI, and anywhere without Apple Silicon. Local sidecar (LAYA_ENGINE_URL, default :8092); no cloud API, no data leaves the box.",
  },
  {
    id: "otsone",
    name: "otsone",
    runtime: "otsone / ONNX sidecar",
    latency: ML.notMeasured,
    detail:
      "OUR OWN neural model: otsone-base, trained in-house via the laya-mlx pipeline and served over the otsone / ONNX sidecar (OTSONE_MODEL_URL; defaults to the Laya sidecar in onnx mode serving models/otsone-base). Native bidirectional Choice / Score / Noul, 0 output tokens. Health-gated — falls back to the local engine under an honest fallback marker when the sidecar is down.",
  },
  {
    id: "any-llm",
    name: "any-LLM",
    runtime: "Hosted OpenAI / xAI / Anthropic",
    latency: ML.notMeasured,
    detail:
      "The escalation backend. When local confidence is thin, the same typed questions are handed to a frontier LLM behind constrained decoding, then mapped back into strict Choice / Score / Noul. Metered and slower — meant to be gated behind a confidence check, not the default.",
  },
];

function backendTone(backend: ModelBackend): string {
  if (backend === "laya" || backend === "otsone") return "text-accent";
  if (backend === "llm") return "text-muted";
  return "text-fg";
}

/** Percent from a 0–1 metric, e.g. 0.8557 -> "85.6%". */
function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

/** A signed delta with fixed precision, e.g. +0.015 / -0.010 / "±0". */
function signed(x: number, digits = 4): string {
  if (x === 0) return "±0";
  const s = x.toFixed(digits);
  return x > 0 ? `+${s}` : s;
}

/** Tone for a delta where LOWER is better (ECE, Brier). */
function lowerBetterTone(x: number): string {
  if (x === 0) return "text-subtle";
  return x < 0 ? "text-accent" : "text-muted";
}

const PROFILE_SPEC_BY_ID = new Map(TUNING_PROFILES.map((p) => [p.id, p]));

function ProfileMeasuredRow({ m }: { m: MeasuredProfile }) {
  const spec = PROFILE_SPEC_BY_ID.get(m.id);
  const isBaseline = m.id === BASELINE_PROFILE_ID;
  return (
    <div className="space-y-3 rounded-md bg-surface p-5 shadow-[var(--shadow-border)]">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="space-y-0.5">
          <p className="font-medium tracking-tight">{m.label}</p>
          <p className="font-mono text-xs text-subtle">{m.id}</p>
        </div>
        {isBaseline ? (
          <span className="shrink-0 rounded-full bg-raised px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-fg">
            baseline
          </span>
        ) : null}
      </div>

      {spec ? (
        <p className="text-sm leading-relaxed text-muted">{spec.tagline}</p>
      ) : null}

      {/* Headline measured metrics */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border/60 pt-3 text-xs sm:grid-cols-4">
        <div className="space-y-0.5">
          <dt className="font-mono uppercase tracking-[0.12em] text-subtle">
            Accuracy
          </dt>
          <dd className="font-mono text-fg">{pct(m.accuracy)}</dd>
        </div>
        <div className="space-y-0.5">
          <dt className="font-mono uppercase tracking-[0.12em] text-subtle">
            Avg conf
          </dt>
          <dd className="font-mono text-fg">
            {m.avgConfidence.toFixed(3)}
            {!isBaseline ? (
              <span className="ml-1 text-subtle">
                ({signed(m.deltaVsBaseline.avgConfidence)})
              </span>
            ) : null}
          </dd>
        </div>
        <div className="space-y-0.5">
          <dt className="font-mono uppercase tracking-[0.12em] text-subtle">
            ECE
          </dt>
          <dd className="font-mono text-fg">
            {m.ece.toFixed(3)}
            {!isBaseline ? (
              <span className={cn("ml-1", lowerBetterTone(m.deltaVsBaseline.ece))}>
                ({signed(m.deltaVsBaseline.ece)})
              </span>
            ) : null}
          </dd>
        </div>
        <div className="space-y-0.5">
          <dt className="font-mono uppercase tracking-[0.12em] text-subtle">
            Brier
          </dt>
          <dd className="font-mono text-fg">
            {m.brier.toFixed(3)}
            {!isBaseline ? (
              <span
                className={cn("ml-1", lowerBetterTone(m.deltaVsBaseline.brier))}
              >
                ({signed(m.deltaVsBaseline.brier)})
              </span>
            ) : null}
          </dd>
        </div>
      </dl>

      {/* Per-question-type accuracy / confidence */}
      <div className="space-y-1 border-t border-border/60 pt-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
          By question type (accuracy · avg conf · n)
        </p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-muted">
          {m.byType.map((t) => (
            <span key={t.qtype}>
              <span className="text-fg">{t.qtype}</span> {pct(t.accuracy)} ·{" "}
              {t.avgConfidence.toFixed(3)} · n{t.n}
            </span>
          ))}
        </div>
      </div>

      {/* What the scalars change */}
      {spec && spec.paramChanges.length ? (
        <div className="space-y-1 border-t border-border/60 pt-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
            What it changes vs baseline
          </p>
          <ul className="space-y-1 text-xs leading-relaxed text-muted">
            {spec.paramChanges.map((c) => (
              <li key={c.param}>
                <span className="font-mono text-fg">
                  {c.param} {c.from} → {c.to}
                </span>{" "}
                — {c.effect}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** One model card inside a family group. */
function ModelCardView({ m }: { m: ModelCard }) {
  const meta = META[m.id];
  return (
    <div className="flex flex-col gap-3 rounded-md bg-surface p-5 shadow-[var(--shadow-border)]">
      <div className="flex items-baseline justify-between gap-3">
        <div className="space-y-0.5">
          <p className="font-medium tracking-tight">{m.label}</p>
          <p className="font-mono text-xs text-subtle">{m.id}</p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full bg-raised px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em]",
            backendTone(m.backend),
          )}
        >
          {BACKEND_LABEL[m.backend]}
        </span>
      </div>

      {/* Honest availability badge — local is always on; the rest are gated. */}
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            "inline-block size-1.5 shrink-0 rounded-full",
            m.backend === "local" ? "bg-ok" : "bg-muted",
          )}
        />
        <span
          className={cn(
            "font-mono text-[11px] tracking-tight",
            requirementTone(m.backend),
          )}
        >
          {BACKEND_REQUIREMENT[m.backend]}
        </span>
      </div>

      <p className="text-sm leading-relaxed text-muted"><LinkedText text={m.blurb} /></p>

      {meta ? (
        <>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border/60 pt-3 text-xs">
            <div className="space-y-0.5">
              <dt className="font-mono uppercase tracking-[0.12em] text-subtle">
                Platform
              </dt>
              <dd className="text-fg">{meta.platform}</dd>
            </div>
            <div className="space-y-0.5">
              <dt className="font-mono uppercase tracking-[0.12em] text-subtle">
                Latency
              </dt>
              <dd className="text-fg">{meta.latency}</dd>
            </div>
            <div className="space-y-0.5">
              <dt className="font-mono uppercase tracking-[0.12em] text-subtle">
                Output tokens
              </dt>
              <dd className="font-mono text-fg">{meta.outputTokens}</dd>
            </div>
            <div className="space-y-0.5">
              <dt className="font-mono uppercase tracking-[0.12em] text-subtle">
                Tier
              </dt>
              <dd className="text-fg">{m.family}</dd>
            </div>
          </dl>

          <p className="text-sm leading-relaxed text-muted">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
              When to use ·{" "}
            </span>
            {meta.whenToUse}
          </p>

          {meta.aliases.length ? (
            <p className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                Aliases
              </span>
              {meta.aliases.map((a) => (
                <span
                  key={a}
                  className="rounded-sm bg-inset px-1.5 py-0.5 font-mono text-[11px] text-muted"
                >
                  {a}
                </span>
              ))}
            </p>
          ) : null}
        </>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1">
        {m.playground ? (
          <Link
            to="/playground"
            className="font-mono text-xs text-muted transition-colors hover:text-fg"
          >
            Open in playground →
          </Link>
        ) : (
          <Link
            to="/system-one"
            className="font-mono text-xs text-muted transition-colors hover:text-fg"
          >
            Escalation is opt-in — read how →
          </Link>
        )}
        <Link
          to="/models/$id"
          params={{ id: m.id }}
          className="font-mono text-xs text-subtle transition-colors hover:text-fg"
        >
          View detail card →
        </Link>
      </div>
    </div>
  );
}

function ModelsPage() {
  return (
    <AppShell>
      <div className="space-y-12">
        <header className="space-y-3">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">
            Models &amp; backends
          </p>
          <h1 className="max-w-3xl text-3xl font-medium tracking-tight md:text-4xl">
            One typed contract. Three model families.
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            Every model here speaks the same{" "}
            <span className="font-mono text-fg">POST /api/v1/systemone</span>{" "}
            contract — send a state and typed questions, get Choice / Score /
            Noul back. Choose from three families:{" "}
            <span className="font-mono text-fg">OpenJev</span> (our own
            otsone model plus its always-on local tier),{" "}
            <span className="font-mono text-fg">Laya</span> (open-weight neural
            model on a sidecar), and{" "}
            <span className="font-mono text-fg">cloud</span> (the hosted
            OpenJev cloud endpoint). Pick by id; the response shape never changes.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Link
              to="/playground"
              className={cn(buttonVariants({ variant: "primary" }))}
            >
              Try a model in the playground →
            </Link>
            <Link
              to="/docs"
              className={cn(buttonVariants({ variant: "secondary" }))}
            >
              API reference
            </Link>
          </div>
        </header>

        {/* BACKENDS */}
        <section className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-lg font-medium tracking-tight">The backends</h2>
            <p className="max-w-2xl text-sm leading-relaxed text-muted">
              The engine resolves each model id to one of these. Local backends
              answer in milliseconds with 0 output tokens and no data leaving the
              machine; the LLM backend is the metered escalation for thin
              confidence.
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {BACKENDS.map((b) => (
              <div
                key={b.id}
                className="space-y-2 rounded-md bg-surface p-4 shadow-[var(--shadow-border)]"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-mono text-sm text-fg">{b.name}</p>
                  <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                    {b.latency}
                  </span>
                </div>
                <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-subtle">
                  {b.runtime}
                </p>
                <p className="text-sm leading-relaxed text-muted">{b.detail}</p>
              </div>
            ))}
          </div>
          <p className="text-xs leading-relaxed text-subtle">
            Self-host all of it: the app and local engine ship in one container
            (<span className="font-mono">docker run openjev</span>), and the
            Laya sidecars are optional add-ons. Nothing is required to reach a
            cloud provider unless you enable the any-LLM escalation.
          </p>
        </section>

        {/* ACTIVE ENGINE */}
        <section className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-lg font-medium tracking-tight">
              The default engine, measured
            </h2>
            <p className="max-w-2xl text-sm leading-relaxed text-muted">
              system-one runs the sentence-embedding engine when its encoder is
              installed and the lexical engine otherwise. Every response says
              which one answered in its <span className="font-mono">engine</span>{" "}
              field.
            </p>
          </div>
          <ActiveEngineNumbers />
        </section>

        {/* MODEL FAMILIES */}
        <section className="space-y-8">
          <div className="space-y-1">
            <h2 className="text-lg font-medium tracking-tight">
              Three model families
            </h2>
            <p className="max-w-2xl text-sm leading-relaxed text-muted">
              Pick a family, then a model inside it. Default model:{" "}
              <span className="font-mono text-fg">{DEFAULT_MODEL}</span> (alias{" "}
              <span className="font-mono text-fg">jev-latest</span>,{" "}
              <span className="font-mono text-fg">openjev-latest</span>) — the
              always-on deterministic tier of the OpenJev family. Pass{" "}
              <span className="font-mono text-fg">model</span> in the request body
              to switch. Availability is honest: a family that needs a key or a
              sidecar is shown as such, never silently answered by the local
              engine.
            </p>
          </div>

          {MODEL_FAMILIES.map((fam) => {
            const cards = MODEL_CARDS.filter((c) => c.familyId === fam.id);
            return (
              <div key={fam.id} className="space-y-4">
                <div className="space-y-1.5 border-t border-border pt-6">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <h3 className="text-base font-medium tracking-tight">
                      {fam.label}
                    </h3>
                    <span
                      className={cn(
                        "shrink-0 rounded-full bg-raised px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em]",
                        fam.availability === "always"
                          ? "text-ok"
                          : "text-subtle",
                      )}
                    >
                      {fam.requirement}
                    </span>
                  </div>
                  <p className="max-w-2xl text-sm leading-relaxed text-muted">
                    {fam.blurb}
                  </p>
                </div>

                <div className="grid gap-3 lg:grid-cols-2">
                  {cards.map((m) => (
                    <ModelCardView key={m.id} m={m} />
                  ))}
                </div>
              </div>
            );
          })}
        </section>

        {/* MEASURED TUNING PROFILES */}
        <section className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-lg font-medium tracking-tight">
              Tuning profiles — measured, not marketed
            </h2>
            <p className="max-w-2xl text-sm leading-relaxed text-muted">
              The four local models are one deterministic engine run with
              different scalar weights — no separate training runs, no reward
              model, no checkpoint hashes. The names below describe what the
              scalars do. Every number here is a real run of the{" "}
              <span className="font-mono text-fg">
                {PROFILE_EVAL_PROVENANCE.caseCount}
              </span>
              -case gold suite (
              <span className="font-mono text-fg">
                {PROFILE_EVAL_PROVENANCE.predictionCount}
              </span>{" "}
              labelled predictions) through{" "}
              <span className="font-mono text-fg">evalProfiles()</span>.
              Accuracy is identical across all four — they change how confident
              and well-calibrated the decision is, not which option wins.
              These rows measure the lexical (TF-IDF) engine the profiles
              tune; the default system-one answers with the embedding engine
              when its model is installed. The gold suite is small, in-repo,
              and the lexical engine was tuned on it, so these are not
              held-out accuracy numbers — for measured
              accuracy and calibration on public data (Banking77, CLINC150 +
              out-of-scope, AG News) see the{" "}
              <Link to="/leaderboard" className="text-fg underline underline-offset-2">
                public-dataset leaderboard
              </Link>
              .
            </p>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {MEASURED_PROFILES.map((m) => (
              <ProfileMeasuredRow key={m.id} m={m} />
            ))}
          </div>
          <p className="text-xs leading-relaxed text-subtle">
            ECE = expected calibration error, Brier = mean squared error of the
            confidence — both lower-is-better. Deltas are vs the{" "}
            <span className="font-mono">{BASELINE_PROFILE_ID}</span> baseline.
            Reproduce:{" "}
            <span className="font-mono text-muted">
              {PROFILE_EVAL_PROVENANCE.harness}
            </span>
            . {PROFILE_EVAL_PROVENANCE.note}
          </p>
        </section>

        {/* FOOTER */}
        <footer className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-6 text-sm text-muted">
          <Link to="/compare" className="hover:text-fg">
            Compare approaches
          </Link>
          <Link to="/docs" className="hover:text-fg">
            Documentation
          </Link>
          <Link to="/playground" className="hover:text-fg">
            Playground
          </Link>
          <span className="ml-auto font-mono text-[11px] uppercase tracking-[0.14em] text-subtle">
            OpenJev · Apache-2.0
          </span>
        </footer>
      </div>
    </AppShell>
  );
}
