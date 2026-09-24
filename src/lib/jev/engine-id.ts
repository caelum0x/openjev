/**
 * Engine identity: which engine (and which version of it) produced a response.
 *
 * A calibration map rewrites the confidences of ONE engine. The model id alone
 * is not enough: `system-one` is served by the sentence-embedding engine when
 * its encoder is installed and by the lexical engine otherwise, and the two
 * produce very different confidence distributions. Calibration maps record the
 * engine they were fitted on and are only applied to answers from the same one.
 *
 * Client-safe (no server imports).
 */
import { resolveModel } from "./models.ts";
import type { SystemOneResponse } from "./types.ts";

export type EngineKind = "embedding" | "lexical" | "neural" | "cloud" | "llm";

export type EngineId = { kind: EngineKind; version: string };

/** Version of the lexical (TF-IDF) engine. Bump when its scoring changes. */
export const LEXICAL_ENGINE_VERSION = "tfidf-1";

/** The engine that produced `out` (for `auto`, pass the local-tier response). */
export function engineIdOf(out: Pick<SystemOneResponse, "model" | "engine">): EngineId {
  if (out.engine?.kind === "embedding") {
    return { kind: "embedding", version: out.engine.version ?? out.engine.encoder };
  }
  if (out.engine?.kind === "lexical") return { kind: "lexical", version: LEXICAL_ENGINE_VERSION };
  const backend = resolveModel(out.model).backend;
  if (backend === "laya" || backend === "otsone") return { kind: "neural", version: out.model };
  if (backend === "cloud") return { kind: "cloud", version: out.model };
  if (backend === "llm") return { kind: "llm", version: out.model };
  // Local weight presets (and the native kernel) are the lexical engine.
  return { kind: "lexical", version: LEXICAL_ENGINE_VERSION };
}

export function sameEngine(a: EngineId, b: EngineId): boolean {
  return a.kind === b.kind && a.version === b.version;
}

export function engineLabel(e: EngineId | null | undefined): string {
  if (!e) return "engine not recorded";
  switch (e.kind) {
    case "embedding":
      return `embedding engine (${e.version})`;
    case "lexical":
      return `lexical engine (${e.version})`;
    case "neural":
      return `neural sidecar (${e.version})`;
    case "cloud":
      return `hosted cloud (${e.version})`;
    case "llm":
      return `LLM (${e.version})`;
  }
}

/**
 * Why a calibration fitted on `fitted` must not be applied to answers from
 * `served`, or null when it may. `fitted` is null for maps created before
 * engine tracking existed and whose engine could not be inferred.
 */
export function calibrationEngineMismatch(
  fitted: EngineId | null,
  served: EngineId,
): string | null {
  if (!fitted) return `engine_unrecorded_refit_on_${served.kind}`;
  if (fitted.kind !== served.kind) return `fitted_on_${fitted.kind}_engine_served_by_${served.kind}`;
  if (fitted.version !== served.version) {
    return `fitted_on_${fitted.version}_served_by_${served.version}`;
  }
  return null;
}
