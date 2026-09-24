/**
 * Optional structured logging for the TypeSafe client.
 *
 * No-op by default: unless a level is configured (via option or the
 * `TYPESAFE_LOG_LEVEL` / `OPENJEV_LOG_LEVEL` env var) nothing is emitted.
 * Every line is prefixed with `[openjev]`. Secrets are never logged: use
 * {@link redactHeaders} before logging request headers.
 *
 * Zero runtime dependencies: writes through the global `console`.
 */

/** Log levels from most to least verbose; `off` silences everything. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'off';

/** Sink the client logs through. Args follow the message, console-style. */
export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

export const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error', 'off'];

/** No-op by default so the client is silent unless explicitly configured. */
export const DEFAULT_LOG_LEVEL: LogLevel = 'off';

const RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3, off: 4 };

const PREFIX = '[openjev]';

const isLogLevel = (value: string): value is LogLevel =>
  (LOG_LEVELS as readonly string[]).includes(value);

/** Normalize a log-level string, or `undefined` when unrecognized. */
export function parseLogLevel(value: string | undefined): LogLevel | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  return isLogLevel(normalized) ? normalized : undefined;
}

const noop = (): void => {};

/** A logger that discards every message. */
export const silentLogger: Logger = {
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
};

/** Default sink: the global `console`, each line prefixed with `[openjev]`. */
export const consoleLogger: Logger = {
  debug: (message, ...args) => console.debug(`${PREFIX} ${message}`, ...args),
  info: (message, ...args) => console.info(`${PREFIX} ${message}`, ...args),
  warn: (message, ...args) => console.warn(`${PREFIX} ${message}`, ...args),
  error: (message, ...args) => console.error(`${PREFIX} ${message}`, ...args),
};

/**
 * Wrap a sink so calls below `level` are dropped. At `off` every method is a
 * no-op. Returns {@link silentLogger} directly when silenced for zero overhead.
 */
export function createLogger(level: LogLevel, sink: Logger = consoleLogger): Logger {
  if (level === 'off') return silentLogger;
  const enabled = (at: LogLevel): boolean => RANK[at] >= RANK[level];
  return {
    debug: enabled('debug') ? (m, ...a) => sink.debug(m, ...a) : noop,
    info: enabled('info') ? (m, ...a) => sink.info(m, ...a) : noop,
    warn: enabled('warn') ? (m, ...a) => sink.warn(m, ...a) : noop,
    error: enabled('error') ? (m, ...a) => sink.error(m, ...a) : noop,
  };
}

// ---------------------------------------------------------------------------
// Redaction — never log secrets.
// ---------------------------------------------------------------------------

/** Credential headers reduced to a scheme + short suffix for identification. */
const KEY_HEADERS: ReadonlySet<string> = new Set([
  'authorization',
  'proxy-authorization',
  'x-api-key',
]);

/** Headers whose values are removed entirely. */
const OPAQUE_HEADERS: ReadonlySet<string> = new Set(['cookie', 'set-cookie']);

/** Mask a credential, keeping its scheme and the last 4 chars of long secrets. */
function redactKey(value: string): string {
  const spaced = value.includes(' ');
  const [scheme, secret] = spaced ? value.split(/\s+/, 2) : [undefined, value];
  const tail = secret && secret.length > 8 ? secret.slice(-4) : '';
  return `${scheme ? `${scheme} ` : ''}***${tail}`;
}

function redactValue(name: string, value: string): string {
  const lower = name.toLowerCase();
  if (KEY_HEADERS.has(lower)) return redactKey(value);
  if (OPAQUE_HEADERS.has(lower)) return '***';
  return value;
}

/** Copy a header record with credential values masked. Accepts a plain record or `Headers`. */
export function redactHeaders(headers: Record<string, string> | Headers): Record<string, string> {
  const entries =
    headers instanceof Headers ? [...headers.entries()] : Object.entries(headers);
  const out: Record<string, string> = {};
  for (const [name, value] of entries) out[name] = redactValue(name, value);
  return out;
}
