/**
 * Environment variable names for client configuration. Explicit options take precedence.
 *
 * The `OPENJEV_*` names are the primary source for self-hosted openjev deployments.
 * The `TYPESAFE_*` aliases in {@link ENV_ALIASES} are read as a fallback so existing setups
 * pointing at `https://api.typesafe.ai` with a `TYPESAFE_API_KEY` keep working unchanged.
 */
export const ENV = {
  /** Required API key; used when `apiKey` is omitted. */
  apiKey: "OPENJEV_API_KEY",
  /** API root; defaults to `http://localhost:8080`. Point this at any openjev host URL. */
  baseURL: "OPENJEV_BASE_URL",
  /** Default model name; defaults to `otsone-latest`. */
  defaultModel: "OPENJEV_DEFAULT_MODEL",
  /** Log level; defaults to `warn`. */
  logLevel: "OPENJEV_LOG_LEVEL",
} as const;

export type EnvVar = (typeof ENV)[keyof typeof ENV];

/**
 * Back-compat `TYPESAFE_*` aliases, read only when the canonical `OPENJEV_*` variable is
 * unset. Keeps the SDK usable for users migrating from the original TypeSafe API without
 * requiring immediate variable renames.
 */
export const ENV_ALIASES: Readonly<Record<EnvVar, string>> = {
  OPENJEV_API_KEY: "TYPESAFE_API_KEY",
  OPENJEV_BASE_URL: "TYPESAFE_BASE_URL",
  OPENJEV_DEFAULT_MODEL: "TYPESAFE_DEFAULT_MODEL",
  OPENJEV_LOG_LEVEL: "TYPESAFE_LOG_LEVEL",
};

/**
 * Pre-rename `OPENTYPESAFE_*` names (the project was called opentypesafe before it became
 * OpenJev). Read after the canonical `OPENJEV_*` name and before the `TYPESAFE_*` alias.
 */
export const ENV_LEGACY: Readonly<Record<EnvVar, string>> = {
  OPENJEV_API_KEY: "OPENTYPESAFE_API_KEY",
  OPENJEV_BASE_URL: "OPENTYPESAFE_BASE_URL",
  OPENJEV_DEFAULT_MODEL: "OPENTYPESAFE_DEFAULT_MODEL",
  OPENJEV_LOG_LEVEL: "OPENTYPESAFE_LOG_LEVEL",
};

/**
 * Read a trimmed environment value, returning `undefined` for missing or blank values.
 * The canonical `OPENJEV_*` name wins; the `TYPESAFE_*` alias is a back-compat fallback.
 */
export const readEnv = (name: EnvVar): string | undefined => {
  if (typeof process === "undefined" || !process.env) return undefined;
  const primary = process.env[name]?.trim() || undefined;
  if (primary !== undefined) return primary;
  const legacy = process.env[ENV_LEGACY[name]]?.trim() || undefined;
  if (legacy !== undefined) return legacy;
  const alias = ENV_ALIASES[name];
  return alias ? process.env[alias]?.trim() || undefined : undefined;
};

/** Return the explicit value, falling back to the environment. */
export const fromCodeOrEnv = (fromCode: string | undefined, envVar: EnvVar): string | undefined =>
  fromCode ?? readEnv(envVar);
