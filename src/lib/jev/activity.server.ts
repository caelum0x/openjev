import { getSql } from "@/lib/db";

/**
 * DB-backed, user-scoped activity feed (Foundation-1). A human-readable audit
 * trail — one row per notable event (a decision, a key created/revoked, …).
 */

/** Input to `logActivity`. `meta` is stored as jsonb (defaults to `{}`). */
export type ActivityEntry = {
  userId: string;
  kind: string;
  summary: string;
  meta?: Record<string, unknown>;
};

/** One activity row as returned to callers. `ts` is epoch millis. */
export type ActivityRow = {
  id: string;
  ts: number;
  kind: string;
  summary: string;
  meta: Record<string, unknown>;
};

function suffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Append one activity entry for a user. Best-effort; requires `userId`. */
export async function logActivity(entry: ActivityEntry): Promise<void> {
  const sql = await getSql();
  const id = `a_${Date.now().toString(36)}_${suffix()}`;
  await sql.query(
    `insert into activity_log (id, user_id, kind, summary, meta_json)
     values ($1, $2, $3, $4, $5::jsonb)`,
    [id, entry.userId, entry.kind, entry.summary, JSON.stringify(entry.meta ?? {})],
  );
}

/** Recent activity for a user, newest first (default 50, max 500). */
export async function listActivity(opts: {
  userId: string;
  limit?: number;
}): Promise<ActivityRow[]> {
  const sql = await getSql();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const rows = await sql.query<{
    id: string;
    ts: number;
    kind: string;
    summary: string;
    meta: unknown;
  }>(
    `select id,
            (extract(epoch from ts) * 1000)::bigint as ts,
            kind, summary, meta_json as meta
     from activity_log
     where user_id = $1
     order by ts desc
     limit $2`,
    [opts.userId, limit],
  );
  // jsonb comes back parsed on both drivers, but tolerate a text fallback.
  return rows.map((r) => ({
    id: r.id,
    ts: r.ts,
    kind: r.kind,
    summary: r.summary,
    meta:
      typeof r.meta === "string"
        ? (JSON.parse(r.meta || "{}") as Record<string, unknown>)
        : ((r.meta ?? {}) as Record<string, unknown>),
  }));
}
