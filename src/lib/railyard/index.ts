/**
 * Railyard client layer — public surface.
 *
 * The shared, server-only client layer openjev uses to reach the standalone
 * railyard Rust services. Every hop is OPT-IN and env-gated (see config.ts); when
 * a service is unconfigured openjev keeps working exactly as today (pure-TS
 * decision engine, direct-provider LLM escalation, no metering). Nothing here
 * logs API keys, and money is integer end-to-end (Rago = cents, Mint =
 * microdollars — convert with centsToMicros / microsToCents).
 *
 *   config.ts — env gates + money conversion + readiness snapshot
 *   errors.ts — RailyardError + type guards
 *   http.ts   — shared JSON fetch (timeout + structured errors)
 *   rago.ts   — usage-metering REST client
 *   relay.ts  — OpenAI-compatible LLM gateway fetch client + TensorZero mapping
 *   abacus.ts — per-key LLM spend-cap proxy (unwraps .data, 402 = cap_exceeded)
 *   llm.ts    — openjev LLM router over relay/abacus (opt-in hop)
 *   meter.ts  — Rago systemone_call metering + allowance + usage helpers
 *   mint.ts   — lazy @railyard/mint-sdk settlement wrapper
 */

export * from "./config";
export * from "./errors";
export * from "./rago";
export * from "./relay";
export * from "./abacus";
export * from "./llm";
export * from "./meter";
export * from "./mint";
