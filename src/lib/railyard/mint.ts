/**
 * Railyard client layer — MINT (settlement).
 *
 * Mint is the settlement ledger. Unlike the other services we REUSE its official
 * TypeScript SDK (`@railyard/mint-sdk`) rather than hand-rolling a fetch client.
 * Mint speaks MICRODOLLARS (1 cent = 10,000 micros — see config.centsToMicros).
 *
 * The SDK is an OPTIONAL peer the owner installs separately, so it is imported
 * LAZILY behind the env gate via a computed specifier. This keeps openjev
 * building and typechecking WITHOUT the package present — if Mint is disabled or
 * the SDK is missing, `settleTransfer()` throws a typed RailyardError the caller
 * falls back from; it never crashes the app at import time.
 *
 * Settlement:
 *   new MintClient({ baseUrl, apiKey })
 *   transfer({ from, to, amount_micros, idem_key, ref }) → { receipt, attestation }
 * `idem_key` is a BODY field (≤128 chars) and the receipt+attestation should be
 * persisted as proof of settlement. Accounts must be pre-provisioned by the owner
 * (POST /v1/accounts) — this wrapper does not.
 */

import { getMintConfig, type MintConfig, type RailyardEnv } from "./config";
import { RailyardError } from "./errors";

/** Max length of the Mint idempotency key (enforced before the network call). */
export const MINT_IDEM_KEY_MAX = 128;

export interface MintTransferInput {
  /** Pre-provisioned source account id. */
  from: string;
  /** Pre-provisioned destination account id. */
  to: string;
  /** Amount in integer MICRODOLLARS (use centsToMicros() to convert). */
  amountMicros: number;
  /** Idempotency key — a BODY field, ≤128 chars. Mint dedupes on it. */
  idemKey: string;
  /** Free-form reference (e.g. `systemone:<key>:<txn>`). */
  ref?: string;
}

/** The proof Mint returns — persist BOTH as settlement evidence. */
export interface MintTransferResult {
  receipt: unknown;
  attestation: unknown;
}

// ── Minimal structural types for the SDK (avoids a hard dependency on its d.ts) ─
interface MintSdkTransferArgs {
  from: string;
  to: string;
  amount_micros: number;
  idem_key: string;
  ref?: string;
}
interface MintSdkClient {
  transfer(args: MintSdkTransferArgs): Promise<{ receipt?: unknown; attestation?: unknown }>;
}
interface MintSdkClientCtor {
  new (config: { baseUrl: string; apiKey: string }): MintSdkClient;
}
interface MintSdkModule {
  MintClient?: MintSdkClientCtor;
  default?: { MintClient?: MintSdkClientCtor } | MintSdkClientCtor;
}

// `string` (not a literal) so bundlers/TS do not statically resolve the optional
// package — it is loaded at runtime only when Mint is actually used.
const MINT_SDK_SPECIFIER: string = "@railyard/mint-sdk";

let cachedCtor: MintSdkClientCtor | null = null;

/** Lazily load the MintClient constructor; throws sdk_unavailable when absent. */
async function loadMintClientCtor(): Promise<MintSdkClientCtor> {
  if (cachedCtor) return cachedCtor;
  let mod: MintSdkModule;
  try {
    mod = (await import(/* @vite-ignore */ MINT_SDK_SPECIFIER)) as MintSdkModule;
  } catch (cause) {
    throw new RailyardError(
      "@railyard/mint-sdk is not installed — owner installs it to enable Mint settlement",
      { service: "mint", code: "sdk_unavailable", cause },
    );
  }
  const ctor =
    mod.MintClient ??
    (typeof mod.default === "function"
      ? (mod.default as MintSdkClientCtor)
      : mod.default?.MintClient);
  if (!ctor) {
    throw new RailyardError("@railyard/mint-sdk did not export MintClient", {
      service: "mint",
      code: "sdk_unavailable",
    });
  }
  cachedCtor = ctor;
  return ctor;
}

export interface MintClientWrapper {
  readonly configured: boolean;
  settleTransfer(input: MintTransferInput): Promise<MintTransferResult>;
}

function requireConfigured(
  config: MintConfig,
): asserts config is MintConfig & { apiKey: string } {
  if (!config.configured || !config.apiKey) {
    throw new RailyardError("Mint is not configured", {
      service: "mint",
      code: "not_configured",
    });
  }
}

/**
 * Build a lazy Mint wrapper bound to the given env. Construction never touches
 * the SDK; the first `settleTransfer()` loads it. Safe to construct when Mint is
 * disabled — branch on `.configured` or catch the RailyardError.
 */
export function createMintClient(env: RailyardEnv = process.env): MintClientWrapper {
  const config = getMintConfig(env);
  let instance: MintSdkClient | null = null;

  async function getInstance(): Promise<MintSdkClient> {
    requireConfigured(config);
    if (instance) return instance;
    const Ctor = await loadMintClientCtor();
    instance = new Ctor({ baseUrl: config.baseUrl, apiKey: config.apiKey });
    return instance;
  }

  return {
    configured: config.configured,

    async settleTransfer(input) {
      requireConfigured(config);

      const amountMicros = Math.trunc(input.amountMicros);
      if (!Number.isFinite(amountMicros) || amountMicros <= 0) {
        throw new RailyardError("Mint transfer amount_micros must be a positive integer", {
          service: "mint",
          code: "bad_response",
        });
      }
      const idemKey = input.idemKey?.trim();
      if (!idemKey) {
        throw new RailyardError("Mint transfer requires a non-empty idem_key", {
          service: "mint",
          code: "bad_response",
        });
      }
      if (idemKey.length > MINT_IDEM_KEY_MAX) {
        throw new RailyardError(
          `Mint idem_key exceeds ${MINT_IDEM_KEY_MAX} chars (was ${idemKey.length})`,
          { service: "mint", code: "bad_response" },
        );
      }

      const client = await getInstance();
      let raw: { receipt?: unknown; attestation?: unknown };
      try {
        raw = await client.transfer({
          from: input.from,
          to: input.to,
          amount_micros: amountMicros,
          idem_key: idemKey,
          ...(input.ref ? { ref: input.ref } : {}),
        });
      } catch (cause) {
        // The SDK surfaces its own HTTP/transport failures — wrap them so callers
        // see one error type, without leaking the api key held inside the client.
        const message = cause instanceof Error ? cause.message : "mint transfer failed";
        throw new RailyardError(`Mint settlement failed: ${message}`, {
          service: "mint",
          code: "http_error",
          cause,
        });
      }

      if (raw?.receipt === undefined && raw?.attestation === undefined) {
        throw new RailyardError("Mint transfer returned no receipt/attestation", {
          service: "mint",
          code: "bad_response",
        });
      }
      return { receipt: raw.receipt, attestation: raw.attestation };
    },
  };
}
