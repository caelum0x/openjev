import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { api } from "@/lib/jev/browser";
import type { BackendStatusResponse } from "@/lib/jev/models";
import type { SystemOneResponse } from "@/lib/jev/types";
import { cn } from "@/lib/utils";

type EngineInfo = SystemOneResponse["engine"] | null | undefined;

/** Human label for the engine that answered a response. */
function engineText(engine: EngineInfo, model: string): string {
  if (engine?.kind === "embedding") return `Embedding engine · ${engine.encoder}`;
  if (engine?.kind === "lexical") return "Lexical engine (TF-IDF)";
  return `Backend · ${model}`;
}

/**
 * Which engine answered THIS response. Every playground and cookbook run goes
 * through the server, so this is the engine the API would use for the same call.
 */
export function EngineBadge({
  engine,
  model,
  className,
}: {
  engine: EngineInfo;
  model: string;
  className?: string;
}) {
  const lexicalFallback = engine?.kind === "lexical";
  return (
    <div className={cn("space-y-1", className)}>
      <span
        className={cn(
          "inline-flex h-7 items-center gap-2 rounded-sm px-2.5 font-mono text-[11px]",
          lexicalFallback ? "bg-inset text-muted" : "bg-raised text-fg",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "size-1.5 rounded-full",
            engine?.kind === "embedding" ? "bg-accent" : "bg-subtle",
          )}
        />
        {engineText(engine, model)}
      </span>
      {lexicalFallback && engine.reason ? (
        <p className="text-[11px] leading-snug text-subtle">
          Embedding engine not used: {engine.reason}
        </p>
      ) : null}
    </div>
  );
}

/** The engine this deployment serves `system-one` with, from GET /api/v1/status. */
export function useServingEngine(): BackendStatusResponse["local"] | null {
  const [local, setLocal] = useState<BackendStatusResponse["local"] | null>(null);
  useEffect(() => {
    let cancelled = false;
    api<BackendStatusResponse>("/api/v1/status")
      .then((s) => {
        if (!cancelled) setLocal(s.local);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return local;
}

/** One line: which engine answers `system-one` runs on this page, before running. */
export function ServingEngineNote({ className }: { className?: string }) {
  const local = useServingEngine();
  if (!local) return null;
  return (
    <p className={cn("text-xs leading-relaxed text-muted", className)}>
      Runs go through the server API.{" "}
      {local.engine === "embedding" ? (
        <>
          <span className="font-mono text-fg">system-one</span> is served by the embedding engine
          (<span className="font-mono">{local.encoder}</span>) on this deployment.
        </>
      ) : (
        <>
          <span className="font-mono text-fg">system-one</span> is served by the lexical engine on
          this deployment ({local.reason ?? "embedding model not installed"}).
        </>
      )}{" "}
      <Link to="/leaderboard" className="text-fg underline-offset-2 hover:underline">
        Measured accuracy
      </Link>
    </p>
  );
}

/** The `thresholds` block every gated cookbook response carries. */
export type ThresholdsInfo = {
  set: "embedding" | "default" | "override";
  fitted_on: string | null;
  values: Record<string, number>;
};

/**
 * Which gate set decided a cookbook result. Thresholds are per engine (see
 * docs/COOKBOOK-THRESHOLDS.md): the embedding engine uses gates tuned on it,
 * every other backend uses the hand-set defaults.
 */
export function ThresholdSetNote({
  thresholds,
  className,
}: {
  thresholds: ThresholdsInfo | null | undefined;
  className?: string;
}) {
  if (!thresholds) return null;
  const values = Object.entries(thresholds.values)
    .map(([k, v]) => `${k} ${v}`)
    .join(" · ");
  const label =
    thresholds.set === "embedding"
      ? `Gates tuned on the embedding engine (${thresholds.fitted_on ?? "unrecorded"})`
      : thresholds.set === "override"
        ? "Gates overridden for this run"
        : "Hand-set default gates (not re-measured for this engine)";
  return (
    <p className={cn("font-mono text-[11px] leading-relaxed text-subtle", className)}>
      {label}: {values}
    </p>
  );
}
