/**
 * Configuration resolution for the OpenJev client.
 *
 * Precedence for every setting is: explicit option, then the canonical
 * `OPENJEV_*` env var, then the pre-rename `OPENTYPESAFE_*` name, then the
 * `TYPESAFE_*` back-compat alias. The
 * client is wire-compatible with any openjev-compatible host (the POST
 * /v1/systemone wire contract is unchanged), and also accepts legacy
 * `TYPESAFE_*` env vars so existing deployments keep working.
 *
 * Zero runtime dependencies: reads `process.env` and validates in-process.
 */

import { OpenJevError } from './errors.ts';
import type { LogLevel } from './logging.ts';
import { parseLogLevel } from './logging.ts';

/** Canonical `OPENJEV_*` env var name plus its legacy and `TYPESAFE_*` aliases. */
interface EnvPair {
  readonly primary: string;
  /** Pre-rename `OPENTYPESAFE_*` name, read after the primary. */
  readonly legacy: string;
  readonly alias: string;
}

export const ENV = {
  apiKey: { primary: 'OPENJEV_API_KEY', legacy: 'OPENTYPESAFE_API_KEY', alias: 'TYPESAFE_API_KEY' },
  baseURL: { primary: 'OPENJEV_BASE_URL', legacy: 'OPENTYPESAFE_BASE_URL', alias: 'TYPESAFE_BASE_URL' },
  model: { primary: 'OPENJEV_MODEL', legacy: 'OPENTYPESAFE_MODEL', alias: 'TYPESAFE_MODEL' },
  logLevel: { primary: 'OPENJEV_LOG_LEVEL', legacy: 'OPENTYPESAFE_LOG_LEVEL', alias: 'TYPESAFE_LOG_LEVEL' },
} as const satisfies Record<string, EnvPair>;

/** Extra lowercase key name kept for the shared `products/.env` convention. */
const LEGACY_API_KEY_ENV = 'typesafe_api_key';

/** Default base URL — points at a local self-hosted openjev instance. Override via OPENJEV_BASE_URL (or TYPESAFE_BASE_URL) for production. */
export const DEFAULT_BASE_URL = 'http://localhost:8080';
export const DEFAULT_MODEL = 'otsone-latest';

/** Accepted API-key prefixes. Unknown prefixes warn instead of throwing. */
export const KNOWN_KEY_PREFIXES: readonly string[] = ['ots_live_', 'ots_test_'];

/** Read a trimmed env value: canonical name first, then the alias. */
function readEnv(pair: EnvPair): string | undefined {
  if (typeof process === 'undefined' || !process.env) return undefined;
  const primary = process.env[pair.primary]?.trim();
  if (primary) return primary;
  const legacy = process.env[pair.legacy]?.trim();
  if (legacy) return legacy;
  const alias = process.env[pair.alias]?.trim();
  return alias || undefined;
}

/** Explicit value if set, otherwise the resolved env value. */
function fromCodeOrEnv(fromCode: string | undefined, pair: EnvPair): string | undefined {
  const explicit = fromCode?.trim();
  if (explicit) return explicit;
  return readEnv(pair);
}

/** User-supplied configuration; every field falls back to env then defaults. */
export interface ResolveConfigOptions {
  /** API key. Falls back to `OPENJEV_API_KEY` / `TYPESAFE_API_KEY` (back-compat alias). */
  apiKey?: string;
  /** API root. Falls back to env, then {@link DEFAULT_BASE_URL}. */
  baseURL?: string;
  /** Default model. Falls back to env, then {@link DEFAULT_MODEL}. */
  model?: string;
  /** Log level. Falls back to env, then `off`. */
  logLevel?: LogLevel;
}

/** Fully-resolved, validated configuration consumed by the transport. */
export interface ResolvedConfig {
  readonly apiKey: string;
  /** Normalized: no trailing slash. */
  readonly baseURL: string;
  readonly model: string;
  readonly logLevel: LogLevel;
}

/** Strip trailing slashes so path joins never double up separators. */
function normalizeBaseURL(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (!trimmed) {
    throw new OpenJevError('`baseURL` must not be empty.');
  }
  try {
    // Validate shape; also rejects obviously malformed inputs early.
    new URL(trimmed);
  } catch {
    throw new OpenJevError(`\`baseURL\` is not a valid URL: ${JSON.stringify(url)}`);
  }
  return trimmed;
}

/**
 * Resolve and validate configuration from explicit options and the environment.
 *
 * Throws {@link OpenJevError} for a missing key or malformed base URL. An
 * unknown key prefix warns through `warn` (default `console.warn`) rather than
 * throwing, so custom/self-hosted keys keep working.
 */
export function resolveConfig(
  options: ResolveConfigOptions = {},
  warn: (message: string) => void = (m) => console.warn(`[openjev] ${m}`),
): ResolvedConfig {
  const apiKey =
    options.apiKey?.trim() ||
    fromCodeOrEnv(undefined, ENV.apiKey) ||
    process.env?.[LEGACY_API_KEY_ENV]?.trim();
  if (!apiKey) {
    throw new OpenJevError(
      `No API key provided. Pass \`apiKey\` or set ${ENV.apiKey.primary} ` +
        `(or ${ENV.apiKey.alias}) in the environment.`,
    );
  }
  if (!KNOWN_KEY_PREFIXES.some((prefix) => apiKey.startsWith(prefix))) {
    warn(
      `API key does not start with a known prefix (${KNOWN_KEY_PREFIXES.join(', ')}); ` +
        'proceeding anyway. Ensure it is a valid OpenJev key.',
    );
  }

  const baseURL = normalizeBaseURL(fromCodeOrEnv(options.baseURL, ENV.baseURL) ?? DEFAULT_BASE_URL);
  const model = fromCodeOrEnv(options.model, ENV.model) ?? DEFAULT_MODEL;

  const logLevel =
    options.logLevel ?? parseLogLevel(readEnv(ENV.logLevel)) ?? 'off';

  return { apiKey, baseURL, model, logLevel };
}
