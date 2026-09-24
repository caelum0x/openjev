/**
 * Railyard client layer — ABACUS (per-key LLM spend caps).
 *
 * Abacus is an optional front-end to Relay that enforces a per-key spend cap
 * before proxying an OpenAI-shaped chat request upstream. It only makes sense to
 * stack in front of Relay when the Abacus deployment's UPSTREAM_BASE_URL points
 * at Relay; otherwise use relay.ts directly.
 *
 * Contract:
 *   POST {ABACUS_URL}/v1/proxy
 *   Headers:
 *     X-API-Key:      <ABACUS_API_KEY>
 *     X-Abacus-Agent: agent_<id>            (per-key identity — the thing that's capped)
 *     Authorization:  Bearer <provider-key> (the upstream provider credential)
 *     X-Request-Id:   <idempotency key>
 *   Body: a verbatim OpenAI chat.completions request
 *   Success: { "success": true, "data": <openai response> }  → we UNWRAP `.data`
 *   Cap breach: HTTP 402                                       → stop using that key
 *
 * Entirely OPT-IN and never a silent failure: a cap breach surfaces as
 * RailyardError("cap_exceeded") so the caller can drop that key and fall back.
 * API keys are never logged.
 */

import { getAbacusConfig, type AbacusConfig, type RailyardEnv } from "./config";
import { RailyardError, truncateDetail } from "./errors";
import { railyardFetch } from "./http";

/** Minimal OpenAI chat.completions request shape (passed through verbatim). */
export interface OpenAIChatBody {
  model: string;
  messages: Array<{ role: string; content: unknown }>;
  [key: string]: unknown;
}

/** Minimal OpenAI chat.completions response shape (unwrapped from `.data`). */
export interface OpenAIChatResponse {
  id?: string;
  model?: string;
  choices?: Array<{
    index?: number;
    message?: { role?: string; content?: string | null };
    finish_reason?: string;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  [key: string]: unknown;
}

export interface AbacusProxyOptions {
  /** The upstream provider credential Abacus forwards (e.g. an OpenAI key). */
  providerKey: string;
  /** Per-key identity to charge/cap against; falls back to ABACUS_AGENT_ID. */
  agentId?: string;
  /** Idempotency key sent as X-Request-Id; generated when omitted. */
  requestId?: string;
  timeoutMs?: number;
}

export interface AbacusClient {
  readonly configured: boolean;
  proxyChat(body: OpenAIChatBody, options: AbacusProxyOptions): Promise<OpenAIChatResponse>;
}

interface AbacusEnvelope {
  success?: boolean;
  data?: OpenAIChatResponse;
  error?: string;
  message?: string;
}

function requireConfigured(
  config: AbacusConfig,
): asserts config is AbacusConfig & { apiKey: string } {
  if (!config.configured || !config.apiKey) {
    throw new RailyardError("Abacus is not configured", {
      service: "abacus",
      code: "not_configured",
    });
  }
}

/** Normalize an agent id to the `agent_<id>` form Abacus expects. */
function formatAgentHeader(agentId: string): string {
  return agentId.startsWith("agent_") ? agentId : `agent_${agentId}`;
}

/**
 * Build an Abacus client bound to the given env. Construction never throws; the
 * gate is enforced per-call.
 */
export function createAbacusClient(env: RailyardEnv = process.env): AbacusClient {
  const config = getAbacusConfig(env);

  return {
    configured: config.configured,

    async proxyChat(body, options) {
      requireConfigured(config);

      const agentId = options.agentId ?? config.agentId;
      if (!agentId) {
        throw new RailyardError(
          "Abacus requires an agent id (options.agentId / ABACUS_AGENT_ID)",
          {
            service: "abacus",
            code: "not_configured",
          },
        );
      }
      if (!options.providerKey) {
        throw new RailyardError("Abacus requires an upstream providerKey", {
          service: "abacus",
          code: "not_configured",
        });
      }

      const endpoint = "/v1/proxy";
      const requestId =
        options.requestId ?? `ots-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

      const { status, data } = await railyardFetch<AbacusEnvelope>({
        service: "abacus",
        method: "POST",
        url: `${config.baseUrl}${endpoint}`,
        endpoint,
        headers: {
          "X-API-Key": config.apiKey,
          "X-Abacus-Agent": formatAgentHeader(agentId),
          Authorization: `Bearer ${options.providerKey}`,
          "X-Request-Id": requestId,
        },
        body,
        timeoutMs: options.timeoutMs,
        // 402 means the per-key cap is spent — surface it as a typed error rather
        // than a generic http_error so callers can stop using that key.
        passthroughStatus: 402,
      });

      if (status === 402) {
        throw new RailyardError("Abacus per-key spend cap exceeded (HTTP 402)", {
          service: "abacus",
          code: "cap_exceeded",
          status: 402,
          endpoint,
          detail: truncateDetail(data.error ?? data.message ?? "cap exceeded"),
        });
      }

      // Success envelope: { success: true, data: <openai response> } → unwrap.
      if (data.success !== true || !data.data) {
        throw new RailyardError("Abacus response was not a success envelope", {
          service: "abacus",
          code: "bad_response",
          status,
          endpoint,
          detail: truncateDetail(
            data.error ?? data.message ?? JSON.stringify(data).slice(0, 200),
          ),
        });
      }

      return data.data;
    },
  };
}
