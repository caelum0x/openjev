import { createFileRoute } from "@tanstack/react-router";
import { getSql, dbSource } from "@/lib/db";
import { layaHealth, layaBackend } from "@/lib/jev/laya.server";
import { nativeHealth } from "@/lib/jev/native.server";

/** Semver version of the running OpenJev deployment. */
const VERSION = "0.1.0";

type BackendEntry = {
  ok: boolean;
  reason?: string;
};

type LayaEntry = BackendEntry & {
  /** Active backend variant served by the sidecar, e.g. "onnx" | "mlx". */
  backend?: string;
};

type LlmEntry = BackendEntry & {
  /** Provider inferred from the set key (openai | xai | anthropic). */
  provider?: string;
};

type HealthResponse = {
  object: "health";
  /** "ok" = every always-on component healthy; "degraded" = DB unreachable. */
  status: "ok" | "degraded";
  version: string;
  db: {
    source: "neon" | "pglite";
    ok: boolean;
    latency_ms: number;
    reason?: string;
  };
  backends: {
    /** Local in-process engine — always available. */
    local: BackendEntry;
    /** Optional native sidecar (same engine, accelerated). */
    native: BackendEntry;
    /** Optional Laya neural sidecar (laya-onnx / laya-mlx). */
    laya: LayaEntry;
    /** LLM escalation path (provider key configured). */
    llm: LlmEntry;
    /** Hosted TypeSafe / Jev cloud backend. */
    cloud: BackendEntry;
  };
  /** ISO-8601 timestamp of when this health check was performed. */
  checkedAt: string;
};

async function checkDb(): Promise<{
  ok: boolean;
  latency_ms: number;
  reason?: string;
}> {
  const start = Date.now();
  try {
    const sql = await getSql();
    await sql`select 1`;
    return { ok: true, latency_ms: Date.now() - start };
  } catch (err) {
    return {
      ok: false,
      latency_ms: Date.now() - start,
      reason: err instanceof Error ? err.message : "db_unreachable",
    };
  }
}

function detectLlmProvider(): string | undefined {
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.XAI_API_KEY) return "xai";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  return undefined;
}

/**
 * GET /api/v1/health
 *
 * Deep health check: verifies the database, optional sidecars, and infers
 * which optional backend paths are configured. Distinct from GET /api/v1/status
 * (which is model-catalog focused); this endpoint is infrastructure-focused and
 * suitable for liveness/readiness probes.
 *
 * Response status:
 *   200 — all always-on components healthy (local engine + DB reachable)
 *   503 — a required component is unhealthy (DB unreachable)
 *
 * Note: optional sidecars (native, laya) and optional integrations (llm, cloud)
 * being unavailable does NOT degrade the status — they are not on the critical
 * path for the core System One engine.
 */
export const Route = createFileRoute("/api/v1/health")({
  server: {
    handlers: {
      GET: async () => {
        // Run all probes in parallel — a slow sidecar must not serialize the DB check.
        const [db, laya, native] = await Promise.all([
          checkDb(),
          layaHealth(),
          nativeHealth(),
        ]);

        const activeLaya = layaBackend();
        const llmProvider = detectLlmProvider();
        const cloudConfigured = Boolean(process.env.TYPESAFE_API_KEY);

        const backends: HealthResponse["backends"] = {
          local: { ok: true },
          native: {
            ok: native.ok === true,
            ...(native.ok !== true && { reason: "native_sidecar_unreachable" }),
          },
          laya: {
            ok: laya.ok === true,
            ...(activeLaya ? { backend: activeLaya } : {}),
            ...(laya.ok !== true && { reason: "laya_sidecar_unreachable" }),
          },
          llm: {
            ok: llmProvider !== undefined,
            ...(llmProvider ? { provider: llmProvider } : {}),
            ...(llmProvider === undefined && { reason: "no_llm_provider_key" }),
          },
          cloud: {
            ok: cloudConfigured,
            ...(!cloudConfigured && { reason: "no_typesafe_api_key" }),
          },
        };

        // Only the in-process engine and the DB are on the critical path. A
        // missing optional sidecar is expected on a fresh install and must not
        // cause a 503 that breaks readiness probes.
        const status: HealthResponse["status"] = db.ok ? "ok" : "degraded";

        const response: HealthResponse = {
          object: "health",
          status,
          version: VERSION,
          db: { source: dbSource, ...db },
          backends,
          checkedAt: new Date().toISOString(),
        };

        return Response.json(response, {
          status: status === "ok" ? 200 : 503,
          headers: { "Cache-Control": "no-store" },
        });
      },
    },
  },
});
