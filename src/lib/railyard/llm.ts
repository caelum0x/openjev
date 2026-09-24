/**
 * Railyard client layer — openjev LLM router (relay/abacus slice).
 *
 * openjev's own any-LLM escalation (src/lib/jev/llm.server.ts) talks to a
 * hosted provider over the OpenAI-compatible `chat/completions` wire. This module
 * centralizes the OPT-IN railyard hop for exactly that shape so its LLM spend can
 * be capped + metered — same precedence as vcglass gtm-llm.ts:
 *
 *   • ABACUS configured (+ an agent id) → wrap the request through
 *     `POST /v1/proxy` so a per-key spend cap is enforced first; a cap breach
 *     (HTTP 402) surfaces as RailyardError("cap_exceeded"). The caller then
 *     degrades to openjev's deterministic local engine — never a silent
 *     retry that spends past the cap.
 *   • RELAY configured → route through `${RELAY_URL}/openai/v1/chat/completions`
 *     with the model rewritten to its TensorZero name.
 *   • NEITHER configured → `railyardLlmEnabled()` is false and the caller keeps
 *     its existing direct-provider path completely unchanged.
 *
 * Nothing here logs an API key. It never throws for "railyard is off" (the caller
 * gates on `railyardLlmEnabled` first); it only throws a RailyardError the caller
 * already knows how to fall back from.
 */

import {
  getAbacusConfig,
  isAbacusEnabled,
  isRelayEnabled,
  type RailyardEnv,
} from "./config";
import { createAbacusClient, type OpenAIChatBody, type OpenAIChatResponse } from "./abacus";
import { relayChatCompletion, toTensorZeroModelName } from "./relay";
import { isRailyardError } from "./errors";

/** Which transport actually served the completion. */
export type RailyardLlmTransport = "abacus" | "relay";

export interface RailyardChatInput {
  /** OpenAI chat body; `model` should already be resolved via `resolveRailyardModel`. */
  body: OpenAIChatBody;
  /** Upstream provider credential Abacus forwards / Relay bearer fallback (never logged). */
  providerKey: string;
  /** Per-key identity for Abacus spend caps; falls back to ABACUS_AGENT_ID. */
  agentId?: string;
  /** Idempotency key forwarded to Abacus as X-Request-Id. */
  requestId?: string;
  env?: RailyardEnv;
}

export interface RailyardChatResult {
  completion: OpenAIChatResponse;
  transport: RailyardLlmTransport;
}

/**
 * True when the railyard LLM hop is opt-in-configured. Callers use this to decide
 * between the railyard route and their existing direct-provider path — when
 * false, they must keep the existing path exactly as-is.
 */
export function railyardLlmEnabled(env: RailyardEnv = process.env): boolean {
  return isRelayEnabled(env) || isAbacusEnabled(env);
}

/**
 * Resolve the model string to send: a TensorZero name when RELAY is the
 * (eventual) gateway, otherwise the plain id. Keying off RELAY — not the
 * transport — is deliberate: Abacus fronting Relay still needs the TensorZero
 * name, while Abacus fronting a provider directly needs the plain id.
 */
export function resolveRailyardModel(model: string, env: RailyardEnv = process.env): string {
  return isRelayEnabled(env) ? toTensorZeroModelName(model) : model;
}

/**
 * Run one OpenAI-compatible chat completion through the configured railyard
 * transport. Only call when `railyardLlmEnabled()` is true. On any failure it
 * throws (RailyardError for railyard-origin failures, incl. "cap_exceeded") so
 * the caller can degrade to its deterministic path.
 */
export async function railyardChat(input: RailyardChatInput): Promise<RailyardChatResult> {
  const env = input.env ?? process.env;

  // ── Abacus (per-key spend cap in front of the gateway) ──────────────────────
  if (isAbacusEnabled(env)) {
    const agentId = input.agentId ?? getAbacusConfig(env).agentId ?? undefined;
    // Abacus needs a per-key identity; without one, fall through to Relay rather
    // than losing the LLM entirely to a misconfiguration.
    if (agentId) {
      try {
        const abacus = createAbacusClient(env);
        const completion = await abacus.proxyChat(input.body, {
          providerKey: input.providerKey,
          agentId,
          requestId: input.requestId,
        });
        return { completion, transport: "abacus" };
      } catch (error: unknown) {
        // A spent cap must stop this key's LLM spend — never retry on Relay.
        if (isRailyardError(error) && error.code === "cap_exceeded") throw error;
        // A missing/misconfigured Abacus gate falls through to Relay.
        if (!(isRailyardError(error) && error.code === "not_configured")) throw error;
      }
    }
  }

  // ── Relay (OpenAI-compatible gateway) ───────────────────────────────────────
  const completion = await relayChatCompletion(env, input.body, {
    providerKey: input.providerKey,
  });
  return { completion, transport: "relay" };
}
