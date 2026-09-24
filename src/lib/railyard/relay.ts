/**
 * Railyard client layer — RELAY (LLM gateway).
 *
 * Relay is a TensorZero-based gateway exposing an OpenAI-compatible surface at
 * `${RELAY_URL}/openai/v1`. Because it speaks the OpenAI wire protocol, and
 * openjev's own LLM escalation (src/lib/jev/llm.server.ts) is already a
 * dependency-light `fetch` against `/chat/completions`, this client is a plain
 * `fetch` helper too — NO OpenAI SDK dependency is introduced.
 *
 * The one twist: through Relay the `model` field must be a TensorZero model name
 * (`tensorzero::model_name::openai::gpt-4o`, `::openai::gpt-4o-mini`,
 * `::anthropic::claude-...`) or a function (`tensorzero::function_name::chat`).
 * `toTensorZeroModelName()` maps plain OpenAI model ids to that form.
 *
 * Entirely OPT-IN: `relayChatCompletion()` throws RailyardError("not_configured")
 * when RELAY_URL is unset so the caller can keep its existing direct-provider
 * path. gateway.auth is off by default, so there is no Relay credential today;
 * the request still needs a bearer token, so we pass RELAY_API_KEY (if the owner
 * later enables auth) → the provider key → a harmless placeholder Relay ignores.
 */

import { getRelayConfig, type RailyardEnv } from "./config";
import { RailyardError } from "./errors";
import { railyardFetch } from "./http";
import type { OpenAIChatBody, OpenAIChatResponse } from "./abacus";

export type TensorZeroProvider = "openai" | "anthropic";

export interface TensorZeroModelOptions {
  /** Route by TensorZero function instead of a model name (e.g. "chat"). */
  functionName?: string;
  /** Force the provider namespace; inferred from the model id when omitted. */
  provider?: TensorZeroProvider;
}

const TENSORZERO_PREFIX = "tensorzero::";

/** Infer the TensorZero provider namespace from a plain model id. */
function inferProvider(model: string): TensorZeroProvider {
  return /^claude/i.test(model.trim()) ? "anthropic" : "openai";
}

/**
 * Map a plain model id (or TensorZero name) to the model string Relay expects.
 *
 * - already-`tensorzero::…` strings pass through untouched;
 * - `{ functionName }` → `tensorzero::function_name::<fn>`;
 * - otherwise → `tensorzero::model_name::<provider>::<model>` with the provider
 *   inferred from the id (claude* → anthropic, else openai) unless overridden.
 */
export function toTensorZeroModelName(
  model: string,
  options: TensorZeroModelOptions = {},
): string {
  if (options.functionName) {
    return `${TENSORZERO_PREFIX}function_name::${options.functionName}`;
  }
  const trimmed = model.trim();
  if (trimmed.startsWith(TENSORZERO_PREFIX)) return trimmed;
  const provider = options.provider ?? inferProvider(trimmed);
  return `${TENSORZERO_PREFIX}model_name::${provider}::${trimmed}`;
}

export interface RelayChatOptions {
  /** Upstream provider credential forwarded as the bearer token when no RELAY_API_KEY is set. */
  providerKey?: string;
  timeoutMs?: number;
}

/**
 * POST an OpenAI-compatible chat.completions request through Relay.
 *
 * The `body.model` must already be the TensorZero name (map it with
 * `toTensorZeroModelName`). Throws RailyardError("not_configured") when RELAY_URL
 * is unset — the caller keeps its existing direct-provider path in that case.
 */
export async function relayChatCompletion(
  env: RailyardEnv,
  body: OpenAIChatBody,
  options: RelayChatOptions = {},
): Promise<OpenAIChatResponse> {
  const relay = getRelayConfig(env);
  if (!relay.configured || !relay.openaiBaseUrl) {
    throw new RailyardError("Relay is not configured", {
      service: "relay",
      code: "not_configured",
    });
  }
  const endpoint = "/openai/v1/chat/completions";
  const bearer = relay.apiKey ?? options.providerKey ?? "railyard-relay";
  const { data } = await railyardFetch<OpenAIChatResponse>({
    service: "relay",
    method: "POST",
    url: `${relay.openaiBaseUrl}/chat/completions`,
    endpoint,
    headers: { Authorization: `Bearer ${bearer}` },
    body,
    timeoutMs: options.timeoutMs,
  });
  return data;
}
