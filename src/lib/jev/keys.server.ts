import { createHash, randomBytes } from "node:crypto";
import { getSql } from "@/lib/db";

/**
 * DB-backed, user-scoped API keys (Foundation-1). Replaces the old in-memory
 * Map. Only a sha256 hash of the secret is ever stored; the plaintext secret is
 * returned exactly once by `createKey`. Every read/write is scoped to a
 * `userId` resolved server-side (see src/lib/auth/verify.server.ts).
 */

/** Public shape returned to the /keys page and the /api/v1/keys route. */
export type PublicApiKey = {
  id: string;
  name: string;
  prefix: string;
  created_at: number; // epoch millis
  last_used_at: number | null; // epoch millis
  project_id: string | null;
  scopes: string[];
  revoked_at: number | null; // epoch millis (null while active)
};

/** `createKey` result: the public shape plus the ONE-TIME plaintext secret. */
export type CreatedApiKey = PublicApiKey & { secret: string };

/** What `lookupBySecret` returns for auth: the public shape plus the owner id. */
export type KeyRecord = PublicApiKey & { user_id: string };

// Timestamptz -> epoch-millis number so the wire shape stays JSON-safe and
// matches the numeric `created_at`/`last_used_at` the pages already consume.
// `::bigint` lands on the OID_INT8 parser (Number) on both Neon and PGLite.
const PUBLIC_COLS = `
  id, name, prefix, project_id, scopes,
  (extract(epoch from created_at) * 1000)::bigint   as created_at,
  (extract(epoch from last_used_at) * 1000)::bigint as last_used_at,
  (extract(epoch from revoked_at) * 1000)::bigint   as revoked_at`;

function token(n: number): string {
  // Over-generate then trim: base64 drops ~25% to the alnum filter, so ask for
  // 2n bytes to guarantee at least n usable characters.
  return randomBytes(n * 2)
    .toString("base64")
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, n)
    .toLowerCase();
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

// Render a JS string[] as a Postgres array literal (e.g. `{"read","write"}`),
// passed as a single `$n::text[]` param so both drivers bind it identically
// without relying on driver-specific array parameter encoding.
function toPgTextArray(values: string[]): string {
  if (values.length === 0) return "{}";
  const escaped = values.map((v) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);
  return `{${escaped.join(",")}}`;
}

/**
 * Mint a new API key for `userId`. Returns the public row PLUS the plaintext
 * `secret` — surface it to the caller once and never persist it (only the hash
 * is stored). `name` is trimmed and defaults to "default".
 */
export async function createKey(
  userId: string,
  name: string,
  opts?: { projectId?: string | null; scopes?: string[] },
): Promise<CreatedApiKey> {
  const sql = await getSql();
  const id = `key_${Date.now().toString(36)}${token(6)}`;
  const secret = `ots_live_${token(40)}`;
  const rows = await sql.query<PublicApiKey>(
    `insert into api_keys (id, user_id, project_id, name, prefix, secret_hash, scopes)
     values ($1, $2, $3, $4, $5, $6, $7::text[])
     returning ${PUBLIC_COLS}`,
    [
      id,
      userId,
      opts?.projectId ?? null,
      name.trim() || "default",
      secret.slice(0, 12),
      sha256(secret),
      toPgTextArray(opts?.scopes ?? []),
    ],
  );
  return { ...rows[0], secret };
}

/** All of a user's active (non-revoked) keys, newest first. */
export async function listKeys(userId: string): Promise<PublicApiKey[]> {
  const sql = await getSql();
  return sql.query<PublicApiKey>(
    `select ${PUBLIC_COLS} from api_keys
     where user_id = $1 and revoked_at is null
     order by created_at desc`,
    [userId],
  );
}

/**
 * Soft-revoke a key (sets `revoked_at`). Scoped to `userId` so one user can
 * never revoke another's key. Returns whether a row was affected.
 */
export async function revokeKey(userId: string, id: string): Promise<boolean> {
  const sql = await getSql();
  const rows = await sql.query<{ id: string }>(
    `update api_keys set revoked_at = now()
     where id = $1 and user_id = $2 and revoked_at is null
     returning id`,
    [id, userId],
  );
  return rows.length > 0;
}

/** Stamp `last_used_at = now()` on a key by its id. Best-effort. */
export async function touchKey(keyId: string): Promise<void> {
  const sql = await getSql();
  await sql.query(`update api_keys set last_used_at = now() where id = $1`, [keyId]);
}

/**
 * Resolve a plaintext bearer secret to its (active) key record for auth. Hashes
 * the secret and matches on `secret_hash`; revoked keys never match. Returns
 * `null` when unknown. Callers get `user_id` + `id` to attribute usage.
 */
export async function lookupBySecret(secret: string): Promise<KeyRecord | null> {
  const sql = await getSql();
  const rows = await sql.query<KeyRecord>(
    `select ${PUBLIC_COLS}, user_id from api_keys
     where secret_hash = $1 and revoked_at is null
     limit 1`,
    [sha256(secret)],
  );
  return rows[0] ?? null;
}

/** Drop the one-time `secret` field, leaving the public shape. */
export function publicKey(row: CreatedApiKey): PublicApiKey {
  const { secret: _secret, ...rest } = row;
  return rest;
}
