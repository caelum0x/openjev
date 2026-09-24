import { getSql } from "@/lib/db";

/**
 * DB-backed, user-scoped usage metering (Foundation-1). Replaces the old
 * in-memory ring buffer. Every System One call is persisted as one
 * `usage_events` row and read back scoped to the authenticated user.
 */

/** One usage row as returned to the /usage page. `ts` is epoch millis. */
export type UsageEvent = {
  id: string;
  ts: number;
  model: string;
  key: string; // key_id, or "anon" for unsigned same-origin calls
  questions: number;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
  path: string;
  status: string;
};

/** Input to `recordUsage`. `userId` is required; the rest describe the call. */
export type RecordUsageInput = {
  userId: string;
  keyId?: string | null;
  projectId?: string | null;
  model: string;
  path: string;
  questions: number;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
  status?: string;
  ts?: number; // epoch millis; defaults to now() server-side
};

type Bucket = { calls: number; tokens: number };

export type UsageSummary = {
  window: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  tokens: number;
  by_model: Record<string, Bucket>;
  by_key: Record<string, Bucket>;
  by_day: Array<{ day: string; calls: number; tokens: number }>;
  p50_latency_ms: number;
  p95_latency_ms: number;
};

// 24h rolling window for the headline totals/breakdowns.
const WINDOW_SQL = `ts > now() - interval '24 hours'`;

function suffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Persist one usage event. Requires an authenticated `userId`. */
export async function recordUsage(event: RecordUsageInput): Promise<void> {
  const sql = await getSql();
  const id = `u_${Date.now().toString(36)}_${suffix()}`;
  await sql.query(
    `insert into usage_events
       (id, user_id, key_id, project_id, ts, model, path,
        questions, input_tokens, output_tokens, latency_ms, status)
     values ($1, $2, $3, $4, to_timestamp($5 / 1000.0),
        $6, $7, $8, $9, $10, $11, $12)`,
    [
      id,
      event.userId,
      event.keyId ?? null,
      event.projectId ?? null,
      event.ts ?? Date.now(),
      event.model,
      event.path,
      event.questions,
      event.input_tokens,
      event.output_tokens,
      event.latency_ms,
      event.status ?? "ok",
    ],
  );
}

/** Recent usage rows for a user, newest first (default 200, max 1000). */
export async function listUsage(opts: {
  userId: string;
  limit?: number;
}): Promise<UsageEvent[]> {
  const sql = await getSql();
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);
  return sql.query<UsageEvent>(
    `select id,
            (extract(epoch from ts) * 1000)::bigint as ts,
            model,
            coalesce(key_id, 'anon') as key,
            questions, input_tokens, output_tokens, latency_ms, path, status
     from usage_events
     where user_id = $1
     order by ts desc
     limit $2`,
    [opts.userId, limit],
  );
}

/**
 * Aggregated usage for a user over the last 24h: totals, p50/p95 latency,
 * per-model and per-key breakdowns, plus a 14-day daily series.
 */
export async function usageSummary(opts: { userId: string }): Promise<UsageSummary> {
  const sql = await getSql();
  const userId = opts.userId;

  const totalsRows = await sql.query<{
    calls: number;
    input_tokens: number;
    output_tokens: number;
    p50: number;
    p95: number;
  }>(
    `select count(*)::int as calls,
            coalesce(sum(input_tokens), 0)::bigint as input_tokens,
            coalesce(sum(output_tokens), 0)::bigint as output_tokens,
            coalesce(round(percentile_cont(0.5) within group (order by latency_ms)), 0)::int as p50,
            coalesce(round(percentile_cont(0.95) within group (order by latency_ms)), 0)::int as p95
     from usage_events
     where user_id = $1 and ${WINDOW_SQL}`,
    [userId],
  );
  const totals = totalsRows[0];

  const byModelRows = await sql.query<{ model: string; calls: number; tokens: number }>(
    `select model, count(*)::int as calls,
            coalesce(sum(input_tokens + output_tokens), 0)::bigint as tokens
     from usage_events
     where user_id = $1 and ${WINDOW_SQL}
     group by model
     order by tokens desc`,
    [userId],
  );

  const byKeyRows = await sql.query<{ key: string; calls: number; tokens: number }>(
    `select coalesce(key_id, 'anon') as key, count(*)::int as calls,
            coalesce(sum(input_tokens + output_tokens), 0)::bigint as tokens
     from usage_events
     where user_id = $1 and ${WINDOW_SQL}
     group by key_id
     order by tokens desc`,
    [userId],
  );

  const byDay = await sql.query<{ day: string; calls: number; tokens: number }>(
    `with days as (
       select generate_series(
         (now() - interval '13 days')::date, now()::date, interval '1 day'
       )::date as day
     )
     select to_char(days.day, 'YYYY-MM-DD') as day,
            count(u.id)::int as calls,
            coalesce(sum(u.input_tokens + u.output_tokens), 0)::bigint as tokens
     from days
     left join usage_events u
       on u.user_id = $1 and u.ts::date = days.day
     group by days.day
     order by days.day`,
    [userId],
  );

  const by_model: Record<string, Bucket> = {};
  for (const r of byModelRows) by_model[r.model] = { calls: r.calls, tokens: r.tokens };
  const by_key: Record<string, Bucket> = {};
  for (const r of byKeyRows) by_key[r.key] = { calls: r.calls, tokens: r.tokens };

  return {
    window: "24h",
    calls: totals.calls,
    input_tokens: totals.input_tokens,
    output_tokens: totals.output_tokens,
    tokens: totals.input_tokens + totals.output_tokens,
    by_model,
    by_key,
    by_day: byDay,
    p50_latency_ms: totals.p50,
    p95_latency_ms: totals.p95,
  };
}

/** Extract the bearer token from a request, or "anon" when absent. */
export function parseBearer(request: Request): string {
  const h =
    request.headers.get("authorization") ?? request.headers.get("Authorization");
  if (!h) return "anon";
  const m = /^Bearer\s+(\S+)/i.exec(h);
  const token = m?.[1]?.trim();
  return token && token.length > 0 ? token : "anon";
}
