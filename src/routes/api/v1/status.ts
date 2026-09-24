import { createFileRoute } from "@tanstack/react-router";
import {
  MODEL_CARDS,
  type BackendStatusResponse,
  type ModelAvailability,
} from "@/lib/jev/models";
import { layaHealth, layaBackend, layaEngineUrl } from "@/lib/jev/laya.server";
import {
  otsoneHealth,
  otsoneBackend,
  otsoneEngineUrl,
} from "@/lib/jev/otsone.server";
import { nativeHealth, engineUrl } from "@/lib/jev/native.server";
import { cloudConfigured } from "@/lib/jev/cloud.server";
import { embedCapability } from "@/lib/jev/embed/encoder.server";

/**
 * GET /api/v1/status — honest backend/sidecar health.
 *
 * The playground and any external caller use this to know which models can
 * actually be served on THIS deployment. Neural (Laya) and native backends are
 * optional local sidecars that are absent on a fresh install; without this
 * probe the UI would list them as selectable even though a request would fall
 * back to the local engine. Every model in the catalog gets an `available` flag
 * and, when unavailable, a `reason` + an `install` hint.
 */
function providerConfigured(): boolean {
  return Boolean(
    process.env.OPENAI_API_KEY ||
      process.env.XAI_API_KEY ||
      process.env.ANTHROPIC_API_KEY,
  );
}

async function buildStatus(): Promise<BackendStatusResponse> {
  // Probe all sidecars in parallel so an absent one doesn't serialize timeouts.
  const [laya, otsone, native, embed] = await Promise.all([
    layaHealth(),
    otsoneHealth(),
    nativeHealth(),
    embedCapability(),
  ]);
  const activeLaya = layaBackend();
  const activeOtsone = otsoneBackend();
  const llmOk = providerConfigured();
  const cloudOk = cloudConfigured();

  const layaInstall =
    "Requires the Laya sidecar. Start it with scripts/laya-sidecar-start.sh " +
    "or `docker compose up laya-onnx` (see SELF-HOSTING.md).";

  const models: ModelAvailability[] = MODEL_CARDS.map((card) => {
    if (card.backend === "laya") {
      const variant = card.id === "laya-onnx" ? "onnx" : "mlx";
      // A single sidecar serves whichever variant this host runs (layaBackend()).
      const available = laya.ok && activeLaya === variant;
      if (available) return { id: card.id, backend: card.backend, available };
      const reason = !laya.ok
        ? "laya_sidecar_unreachable"
        : `laya_sidecar_serves_${activeLaya}_not_${variant}`;
      return {
        id: card.id,
        backend: card.backend,
        available,
        reason,
        install: !laya.ok
          ? layaInstall
          : `This host's Laya sidecar runs the ${activeLaya} backend. Set ` +
            `LAYA_BACKEND=${variant} and restart the sidecar to serve ${card.id}.`,
      };
    }
    if (card.backend === "otsone") {
      // OUR OWN otsone neural sidecar. Health-gate exactly like Laya: unavailable
      // otsone models are reported as such (never silently served as local).
      if (otsone.ok) return { id: card.id, backend: card.backend, available: true };
      return {
        id: card.id,
        backend: card.backend,
        available: false,
        reason: "otsone_sidecar_unreachable",
        install:
          "Requires the otsone sidecar serving otsone-base. Start the Laya " +
          "sidecar with LAYA_BACKEND=onnx pointing at models/otsone-base, or set " +
          "OTSONE_MODEL_URL to a dedicated otsone sidecar (see SELF-HOSTING.md).",
      };
    }
    if (card.backend === "llm") {
      if (llmOk) return { id: card.id, backend: card.backend, available: true };
      return {
        id: card.id,
        backend: card.backend,
        available: false,
        reason: "no_llm_provider_key",
        install:
          "Set LLM_PROVIDER and the matching provider key " +
          "(OPENAI_API_KEY / XAI_API_KEY / ANTHROPIC_API_KEY).",
      };
    }
    if (card.backend === "cloud") {
      if (cloudOk) return { id: card.id, backend: card.backend, available: true };
      return {
        id: card.id,
        backend: card.backend,
        available: false,
        reason: "no_cloud_credentials",
        install:
          "Set OPENJEV_API_KEY and OPENJEV_BASE_URL to use the hosted " +
          "OpenJev cloud.",
      };
    }
    // Local backend: the always-on in-process engine.
    return { id: card.id, backend: card.backend, available: true };
  });

  return {
    object: "backend_status",
    local: embed.available
      ? { available: true, engine: "embedding", encoder: embed.model }
      : { available: true, engine: "lexical", reason: embed.reason },
    native: {
      available: native.ok === true,
      url: engineUrl(),
      engine: native.engine,
    },
    laya: {
      available: laya.ok === true,
      backend: activeLaya,
      url: layaEngineUrl(),
      engine: laya.engine,
    },
    otsone: {
      available: otsone.ok === true,
      backend: activeOtsone,
      url: otsoneEngineUrl(),
      engine: otsone.engine,
    },
    llm: { available: llmOk },
    cloud: { available: cloudOk },
    models,
  };
}

export const Route = createFileRoute("/api/v1/status")({
  server: {
    handlers: {
      GET: async () => {
        const status = await buildStatus();
        return Response.json(status, {
          headers: { "Cache-Control": "no-store" },
        });
      },
    },
  },
});
