/**
 * Self-hosted Better Auth for the openjev console (server-only).
 *
 * Auth is OPT-IN. With `VITE_AUTH_ENABLED` unset or anything but `"true"` the
 * console runs keyless: `requireUserId` resolves a single local dev user (see
 * `verify.server.ts`), which is the right mode for `npm run dev` and for a
 * private single-operator install.
 *
 * With `VITE_AUTH_ENABLED=true` the app runs its own Better Auth at
 * `/api/auth/*` (mounted by `src/routes/api/auth/$.ts`) with email/password
 * accounts, persisted in the same database as the console data:
 *   - `DATABASE_URL` set   -> real Postgres (node-postgres pool).
 *   - `DATABASE_URL` unset -> the embedded PGLite fallback (in-memory; accounts
 *                             reset on restart — fine for evaluation only).
 * The schema lives in `migrations/0001_auth.sql` and is applied with the rest of
 * the migrations. `BETTER_AUTH_SECRET` is required in production; set
 * `BETTER_AUTH_URL` to the public origin when serving behind a proxy.
 *
 * NEVER import this from client code — it pulls in `pg` and the signing secret.
 * The browser uses `@/lib/auth/client`; route handlers resolve the caller via
 * `@/lib/auth/verify.server`.
 */
import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { ensureDbReady, getPglite } from "../db";
import { pgliteDialect } from "./pglite-dialect";

/** Read an env var, treating empty/whitespace as unset. */
const env = (key: string): string | undefined => {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
};

/** True when sign-in is enforced (`VITE_AUTH_ENABLED=true`). */
export const authConfigured = env("VITE_AUTH_ENABLED") === "true";

const isProduction = process.env.NODE_ENV === "production";
const explicitSecret = env("BETTER_AUTH_SECRET");

if (authConfigured && isProduction && !explicitSecret) {
  throw new Error(
    "[auth] VITE_AUTH_ENABLED=true requires BETTER_AUTH_SECRET in production " +
      "(generate one with `openssl rand -hex 32`).",
  );
}

/**
 * Development-only signing secret. Kept on `globalThis` so a Vite HMR re-eval
 * of this module does not mint a new secret and invalidate every session.
 */
const globalAuthRef = globalThis as typeof globalThis & {
  __openjevDevAuthSecret__?: string;
};
function devAuthSecret(): string {
  globalAuthRef.__openjevDevAuthSecret__ ??= randomBytes(32).toString("hex");
  return globalAuthRef.__openjevDevAuthSecret__;
}

// Kick (and share) PGLite bootstrap early when auth will query it.
if (authConfigured) void ensureDbReady();

// Loopback origins for `npm run dev` / `openjev serve`. Browsers may send
// any of these for the same server, so trust all of them locally.
const LOCAL_ORIGINS: string[] = [
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

const explicitBaseURL = env("BETTER_AUTH_URL");
const baseURL = explicitBaseURL ?? {
  allowedHosts: ["localhost", "127.0.0.1", "localhost:*", "127.0.0.1:*"],
  protocol: "auto" as const,
  fallback: "http://localhost:8080",
};
const trustedOrigins: string[] = explicitBaseURL
  ? [explicitBaseURL, ...(isProduction ? [] : LOCAL_ORIGINS)]
  : LOCAL_ORIGINS;

const databaseUrl = env("DATABASE_URL");
const database = databaseUrl
  ? new Pool({ connectionString: databaseUrl })
  : { dialect: pgliteDialect(() => getPglite()), type: "postgres" as const };

export const auth = betterAuth({
  baseURL,
  secret: explicitSecret ?? devAuthSecret(),
  database,
  trustedOrigins,
  emailAndPassword: { enabled: authConfigured },
  // Cache the session in a short-lived signed cookie so `/get-session` reads
  // skip the database.
  session: { cookieCache: { enabled: true, maxAge: 300 } },
  advanced: { cookiePrefix: "openjev" },
  plugins: [
    // Accept `Authorization: Bearer <session-token>` for non-browser clients.
    bearer(),
    // Bridges Better Auth's Set-Cookie into TanStack Start responses. MUST be
    // last so it runs after every other plugin's hooks.
    tanstackStartCookies(),
  ],
});
