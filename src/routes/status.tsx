import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { AppShell } from "@/components/app-shell";
import { cn } from "@/lib/utils";
import { ActiveEngineNumbers } from "@/components/engine-numbers";
import {
  absUrl,
  breadcrumbLd,
  SITE_NAME,
  OG_IMAGE,
} from "@/lib/seo/site";

// ── Types matching GET /api/v1/status ─────────────────────────────────────

interface BackendDetail {
  available: boolean;
  url?: string | null;
  engine?: string | null;
  backend?: string | null;
}

interface ModelAvailability {
  id: string;
  backend: string;
  available: boolean;
  reason?: string;
  install?: string;
}

interface StatusData {
  object: string;
  local: { available: boolean; engine?: "embedding" | "lexical"; encoder?: string; reason?: string };
  native: BackendDetail;
  laya: BackendDetail;
  otsone: BackendDetail;
  llm: { available: boolean };
  cloud: { available: boolean };
  models: ModelAvailability[];
}

// ── Route ─────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/status")({
  head: () => {
    const path = "/status";
    const title = `System Status · ${SITE_NAME}`;
    const description =
      "Live backend health: local in-process engine, native sidecar, neural (Laya MLX/ONNX), any-LLM bridge, and OpenJev cloud — plus per-model availability.";
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:type", content: "website" },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:url", content: absUrl(path) },
        { property: "og:image", content: OG_IMAGE },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
        {
          "script:ld+json": breadcrumbLd([
            { name: "Home", path: "/" },
            { name: "Status", path },
          ]),
        },
      ],
      links: [{ rel: "canonical", href: absUrl(path) }],
    };
  },
  component: StatusPage,
});

// ── Static metadata ────────────────────────────────────────────────────────

const BACKEND_META: Record<
  string,
  { label: string; blurb: string }
> = {
  local: {
    label: "Local (in-process)",
    blurb:
      "The system-one engine inside the server process. Always available: the sentence-embedding engine when its 33 MB encoder is installed, else the lexical (TF-IDF) engine.",
  },
  native: {
    label: "Native sidecar",
    blurb:
      "Optional native kernel sidecar. Same deterministic results as local; faster on large batches.",
  },
  laya: {
    label: "Neural (Laya)",
    blurb:
      "Local neural backend — laya-mlx on Apple silicon, laya-onnx on CPU. Requires the neural sidecar (Laya).",
  },
  otsone: {
    label: "OpenJev (otsone)",
    blurb:
      "Our own neural backend — the otsone-base model served over the otsone / ONNX sidecar. Requires the otsone sidecar.",
  },
  llm: {
    label: "Any-LLM bridge",
    blurb:
      "Routes escalations to a configured LLM provider (OpenAI, xAI, Anthropic). Requires an API key env var.",
  },
  cloud: {
    label: "OpenJev cloud",
    blurb:
      "Hosted OpenJev cloud endpoint. Requires OPENJEV_API_KEY (back-compat: TYPESAFE_API_KEY).",
  },
};

// ── Small components ──────────────────────────────────────────────────────

function StatusDot({
  ok,
  loading,
}: {
  ok: boolean;
  loading: boolean;
}) {
  if (loading) {
    return (
      <span className="inline-block size-2.5 animate-pulse rounded-full bg-muted" />
    );
  }
  return (
    <span
      className={cn(
        "inline-block size-2.5 rounded-full",
        ok ? "bg-ok" : "bg-destructive",
      )}
    />
  );
}

function StatusLabel({
  ok,
  loading,
}: {
  ok: boolean;
  loading: boolean;
}) {
  if (loading)
    return (
      <span className="font-mono text-xs text-muted">Checking...</span>
    );
  return (
    <span
      className={cn(
        "font-mono text-xs",
        ok ? "text-ok" : "text-destructive",
      )}
    >
      {ok ? "Operational" : "Unavailable"}
    </span>
  );
}

interface BackendCardProps {
  id: string;
  detail: { available: boolean; url?: string | null; engine?: string | null; backend?: string | null };
  loading: boolean;
}

function BackendCard({ id, detail, loading }: BackendCardProps) {
  const meta = BACKEND_META[id];
  if (!meta) return null;

  const url = detail.url;
  const engine = detail.engine;
  const variant = detail.backend;

  return (
    <div className="space-y-3 rounded-md bg-surface p-5 shadow-[var(--shadow-border)]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <StatusDot ok={detail.available} loading={loading} />
          <p className="font-medium tracking-tight text-fg">{meta.label}</p>
        </div>
        <StatusLabel ok={detail.available} loading={loading} />
      </div>
      <p className="text-sm leading-relaxed text-muted">{meta.blurb}</p>
      {url ? (
        <p className="font-mono text-[11px] text-subtle">
          {url}
          {engine ? <> &middot; {engine}</> : null}
          {variant ? <> ({variant})</> : null}
        </p>
      ) : engine ? (
        <p className="font-mono text-[11px] text-fg">Serving: {engine}</p>
      ) : null}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

function StatusPage() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFetchError(null);

    fetch("/api/v1/status")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<StatusData>;
      })
      .then((data) => {
        if (!cancelled) {
          setStatus(data);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setFetchError(err instanceof Error ? err.message : "Failed to fetch");
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Build backend list — fall back to empty/offline during loading.
  const backends: BackendCardProps[] = status
    ? [
        {
          id: "local",
          detail: {
            available: status.local.available,
            engine:
              status.local.engine === "embedding"
                ? `embedding engine (${status.local.encoder ?? "encoder"})`
                : status.local.engine === "lexical"
                  ? `lexical engine${status.local.reason ? `: ${status.local.reason}` : ""}`
                  : null,
          },
          loading,
        },
        { id: "native", detail: status.native, loading },
        { id: "laya", detail: status.laya, loading },
        { id: "otsone", detail: status.otsone, loading },
        { id: "llm", detail: { available: status.llm.available }, loading },
        { id: "cloud", detail: { available: status.cloud.available }, loading },
      ]
    : Object.keys(BACKEND_META).map((id) => ({
        id,
        detail: { available: false },
        loading: true,
      }));

  const allOperational =
    !loading &&
    !fetchError &&
    status !== null &&
    status.local.available;

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl space-y-12">
        <header className="space-y-3">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">
            System
          </p>
          <h1 className="text-3xl font-medium tracking-tight md:text-4xl">
            Status
          </h1>
          <p className="max-w-xl text-base leading-relaxed text-muted">
            Live health for every backend on this deployment. The local
            in-process engine is always available; optional backends require a
            running sidecar or a configured API key.
          </p>
        </header>

        {fetchError ? (
          <div className="rounded-md bg-surface p-4 shadow-[var(--shadow-border)]">
            <p className="text-sm text-destructive">
              Could not reach /api/v1/status: {fetchError}
            </p>
          </div>
        ) : null}

        {/* Backends ─────────────────────────────────────────────────── */}
        <section className="space-y-4">
          <h2 className="text-lg font-medium tracking-tight">Backends</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {backends.map(({ id, detail, loading: l }) => (
              <BackendCard key={id} id={id} detail={detail} loading={l} />
            ))}
          </div>
        </section>

        {/* Engine ───────────────────────────────────────────────────── */}
        <section className="space-y-4">
          <h2 className="text-lg font-medium tracking-tight">Engine and measured accuracy</h2>
          <ActiveEngineNumbers />
        </section>

        {/* Models ───────────────────────────────────────────────────── */}
        <section className="space-y-4">
          <h2 className="text-lg font-medium tracking-tight">Models</h2>
          {loading ? (
            <div className="rounded-md bg-surface p-4 shadow-[var(--shadow-border)]">
              <p className="text-sm text-muted">Loading model availability...</p>
            </div>
          ) : status ? (
            <div className="overflow-x-auto rounded-md bg-surface shadow-[var(--shadow-border)]">
              <table className="w-full min-w-[480px] text-left text-sm">
                <thead className="border-b border-border font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
                  <tr>
                    <th className="px-4 py-3">Model</th>
                    <th className="px-4 py-3">Backend</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Note</th>
                  </tr>
                </thead>
                <tbody className="text-muted">
                  {status.models.map((m) => (
                    <tr
                      key={m.id}
                      className="border-b border-border/60 last:border-0"
                    >
                      <td className="px-4 py-3 font-mono text-xs text-fg">
                        {m.id}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{m.backend}</td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 text-xs",
                            m.available ? "text-ok" : "text-destructive",
                          )}
                        >
                          <span
                            className={cn(
                              "inline-block size-1.5 shrink-0 rounded-full",
                              m.available ? "bg-ok" : "bg-destructive",
                            )}
                          />
                          {m.available ? "Available" : "Unavailable"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs leading-relaxed">
                        {m.install ?? m.reason ?? null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>

        {/* Incidents ───────────────────────────────────────────────── */}
        <section className="space-y-4">
          <h2 className="text-lg font-medium tracking-tight">Incidents</h2>
          <div className="rounded-md bg-surface p-5 shadow-[var(--shadow-border)]">
            <div className="flex items-center gap-2.5">
              <span
                className={cn(
                  "inline-block size-2.5 rounded-full",
                  allOperational ? "bg-ok" : "bg-muted",
                )}
              />
              <p className="text-sm font-medium tracking-tight text-fg">
                {allOperational
                  ? "All systems operational"
                  : "No known incidents"}
              </p>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              This page reflects live backend health at the time of load. The
              local engine is always on; sidecar and cloud backends depend on
              your deployment configuration. Check the{" "}
              <a
                href="/changelog"
                className="text-fg underline decoration-border underline-offset-2 hover:decoration-fg"
              >
                changelog
              </a>{" "}
              for release notes and known issues.
            </p>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
