/**
 * Railyard client layer — configuration + env gates.
 *
 * openjev reaches the standalone railyard Rust services, each entirely
 * OPT-IN and env-gated. When a service's env vars are unset, `isXEnabled()`
 * returns false and openjev keeps running exactly as today (pure-TS
 * decision engine, LLM escalation straight to the provider, no metering). The
 * railyard hop is never a hard dependency and never a silent failure — a caller
 * either sees a disabled gate up front or a structured RailyardError it can fall
 * back from.
 *
 * Services + env (ALL optional → no-op when unset):
 *   RAGO   (usage metering)       RAGO_URL      + RAGO_API_KEY    money = CENTS
 *   RELAY  (LLM gateway)          RELAY_URL     (+ optional RELAY_API_KEY)
 *   ABACUS (per-key LLM caps)     ABACUS_URL    + ABACUS_API_KEY  (+ ABACUS_AGENT_ID)
 *   MINT   (settlement)           MINT_BASE_URL + MINT_API_KEY    money = MICRODOLLARS
 *
 * The default ports below mirror each service's own default so an owner can set
 * just the host; they are NOT auto-enabled — a service is only "enabled" when
 * its required env is explicitly present.
 */

export type RailyardEnv = NodeJS.ProcessEnv | Record<string, string | undefined>;

/** Documented service defaults (mirror each Rust server's own default bind). */
export const RAILYARD_DEFAULTS = {
  ragoUrl: "http://127.0.0.1:3000",
  abacusUrl: "http://127.0.0.1:8100",
  mintBaseUrl: "http://127.0.0.1:8080",
} as const;

/** Default per-request timeout for railyard HTTP calls (ms). */
export const RAILYARD_HTTP_TIMEOUT_MS = 15_000;

function read(env: RailyardEnv, key: string): string | undefined {
  const raw = env[key];
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Strip a trailing slash so we can safely append paths. */
function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

// ── RAGO (usage metering) ─────────────────────────────────────────────────────
export interface RagoConfig {
  configured: boolean;
  baseUrl: string;
  apiKey: string | null;
  note: string;
}

export function getRagoConfig(env: RailyardEnv = process.env): RagoConfig {
  const url = read(env, "RAGO_URL");
  const apiKey = read(env, "RAGO_API_KEY") ?? null;
  if (!url || !apiKey) {
    return {
      configured: false,
      baseUrl: normalizeBaseUrl(url ?? RAILYARD_DEFAULTS.ragoUrl),
      apiKey: null,
      note: "Rago disabled — set RAGO_URL + RAGO_API_KEY to meter usage via railyard.",
    };
  }
  return {
    configured: true,
    baseUrl: normalizeBaseUrl(url),
    apiKey,
    note: "Rago configured.",
  };
}

export function isRagoEnabled(env: RailyardEnv = process.env): boolean {
  return getRagoConfig(env).configured;
}

// ── RELAY (LLM gateway) ───────────────────────────────────────────────────────
// gateway.auth is OFF by default, so there is no client credential today. Enabled
// on RELAY_URL alone; an optional RELAY_API_KEY is forwarded as a Bearer token if
// the owner later turns gateway auth on.
export interface RelayConfig {
  configured: boolean;
  baseUrl: string | null;
  /** OpenAI-compatible base URL: `${RELAY_URL}/openai/v1`. */
  openaiBaseUrl: string | null;
  apiKey: string | null;
  note: string;
}

export function getRelayConfig(env: RailyardEnv = process.env): RelayConfig {
  const url = read(env, "RELAY_URL");
  const apiKey = read(env, "RELAY_API_KEY") ?? null;
  if (!url) {
    return {
      configured: false,
      baseUrl: null,
      openaiBaseUrl: null,
      apiKey: null,
      note: "Relay disabled — set RELAY_URL to route LLM escalation through the railyard gateway.",
    };
  }
  const baseUrl = normalizeBaseUrl(url);
  return {
    configured: true,
    baseUrl,
    openaiBaseUrl: `${baseUrl}/openai/v1`,
    apiKey,
    note: "Relay configured.",
  };
}

export function isRelayEnabled(env: RailyardEnv = process.env): boolean {
  return getRelayConfig(env).configured;
}

// ── ABACUS (per-key LLM spend caps) ───────────────────────────────────────────
export interface AbacusConfig {
  configured: boolean;
  baseUrl: string;
  apiKey: string | null;
  /** Per-key agent identity, sent as `X-Abacus-Agent: agent_<id>`. */
  agentId: string | null;
  note: string;
}

export function getAbacusConfig(env: RailyardEnv = process.env): AbacusConfig {
  const url = read(env, "ABACUS_URL");
  const apiKey = read(env, "ABACUS_API_KEY") ?? null;
  const agentId = read(env, "ABACUS_AGENT_ID") ?? null;
  if (!url || !apiKey) {
    return {
      configured: false,
      baseUrl: normalizeBaseUrl(url ?? RAILYARD_DEFAULTS.abacusUrl),
      apiKey: null,
      agentId,
      note: "Abacus disabled — set ABACUS_URL + ABACUS_API_KEY to cap per-key LLM spend.",
    };
  }
  return {
    configured: true,
    baseUrl: normalizeBaseUrl(url),
    apiKey,
    agentId,
    note: "Abacus configured.",
  };
}

export function isAbacusEnabled(env: RailyardEnv = process.env): boolean {
  return getAbacusConfig(env).configured;
}

// ── MINT (settlement) ─────────────────────────────────────────────────────────
export interface MintConfig {
  configured: boolean;
  baseUrl: string;
  apiKey: string | null;
  note: string;
}

export function getMintConfig(env: RailyardEnv = process.env): MintConfig {
  const url = read(env, "MINT_BASE_URL");
  const apiKey = read(env, "MINT_API_KEY") ?? null;
  if (!url || !apiKey) {
    return {
      configured: false,
      baseUrl: normalizeBaseUrl(url ?? RAILYARD_DEFAULTS.mintBaseUrl),
      apiKey: null,
      note: "Mint disabled — set MINT_BASE_URL + MINT_API_KEY to settle via railyard.",
    };
  }
  return {
    configured: true,
    baseUrl: normalizeBaseUrl(url),
    apiKey,
    note: "Mint configured.",
  };
}

export function isMintEnabled(env: RailyardEnv = process.env): boolean {
  return getMintConfig(env).configured;
}

// ── Money conversion (integer-safe) ───────────────────────────────────────────
// Rago speaks CENTS; Mint speaks MICRODOLLARS. 1 cent = 10,000 microdollars.
// Keep every amount an integer end-to-end; round only when narrowing micros→cents.
export const MICROS_PER_CENT = 10_000;
export const MICROS_PER_DOLLAR = 1_000_000;

/** Convert integer cents to integer microdollars (exact). */
export function centsToMicros(cents: number): number {
  if (!Number.isFinite(cents)) throw new RangeError("centsToMicros: non-finite cents");
  return Math.trunc(cents) * MICROS_PER_CENT;
}

/** Convert integer microdollars to integer cents (rounded to nearest cent). */
export function microsToCents(micros: number): number {
  if (!Number.isFinite(micros)) throw new RangeError("microsToCents: non-finite micros");
  return Math.round(micros / MICROS_PER_CENT);
}

/** Aggregate railyard readiness snapshot for a status/integrations surface. */
export interface RailyardStatus {
  rago: boolean;
  relay: boolean;
  abacus: boolean;
  mint: boolean;
}

export function getRailyardStatus(env: RailyardEnv = process.env): RailyardStatus {
  return {
    rago: isRagoEnabled(env),
    relay: isRelayEnabled(env),
    abacus: isAbacusEnabled(env),
    mint: isMintEnabled(env),
  };
}
