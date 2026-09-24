/**
 * Database stand-in for the leaderboard harness. The harness never persists
 * anything; the only DB touch on its code paths is the LLM rate limiter, which
 * fails open (and logs) when the database is unavailable. Aliased over
 * "@/lib/db" by scripts/leaderboard.mjs so the Vite-only PGLite bootstrap
 * (import.meta.glob) is never loaded outside Vite.
 */
export async function getSql() {
  throw new Error("The leaderboard harness runs without a database.");
}
export async function ensureDbReady() {}
export const dbSource = "none";
