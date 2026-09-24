import { getSql } from "@/lib/db";
import type { UsageEvent } from "./usage.server";
import type { ActivityRow } from "./activity.server";

/**
 * DB-backed, user-scoped log feed (Foundation-2). A filtered view over
 * `usage_events` (the metered System One calls) and `activity_log` (the
 * human-readable audit trail) for the console logs surface. Scoped to a
 * server-resolved `userId`.
 */

/** Filters for `listLogs`. All optional except `userId`. */
export type LogFilters = {
  userId: string;
  model?: string; // exact usage_events.model
  key?: string; // matches key_id, or 'anon' for unsigned calls
  kind?: string; // exact activity_log.kind
  from?: number; // epoch millis, inclusive lower bound on ts
  to?: number; // epoch millis, inclusive upper bound on ts
  limit?: number; // per feed, default 200, max 1000
};

export type LogsResult = {
  usage: UsageEvent[];
  activity: ActivityRow[];
  filters: {
    model: string | null;
    key: string | null;
    kind: string | null;
    from: number | null;
    to: number | null;
    limit: number;
  };
};

/**
 * Filtered usage + activity, newest first. `model`/`key` narrow the usage feed;
 * `kind` narrows the activity feed; `from`/`to` bound both by timestamp.
 */
export async function listLogs(f: LogFilters): Promise<LogsResult> {
  const sql = await getSql();
  const limit = Math.min(Math.max(f.limit ?? 200, 1), 1000);
  const model = f.model?.trim() || null;
  const key = f.key?.trim() || null;
  const kind = f.kind?.trim() || null;
  const from = typeof f.from === "number" && Number.isFinite(f.from) ? f.from : null;
  const to = typeof f.to === "number" && Number.isFinite(f.to) ? f.to : null;

  // ── Usage feed ──────────────────────────────────────────────────────────────
  const usageParams: unknown[] = [f.userId];
  const usageWhere: string[] = ["user_id = $1"];
  const push = (value: unknown): string => {
    usageParams.push(value);
    return `$${usageParams.length}`;
  };
  if (model) usageWhere.push(`model = ${push(model)}`);
  if (key) usageWhere.push(`coalesce(key_id, 'anon') = ${push(key)}`);
  if (from !== null) usageWhere.push(`ts >= to_timestamp(${push(from)} / 1000.0)`);
  if (to !== null) usageWhere.push(`ts <= to_timestamp(${push(to)} / 1000.0)`);
  const usageLimit = push(limit);

  const usage = await sql.query<UsageEvent>(
    `select id,
            (extract(epoch from ts) * 1000)::bigint as ts,
            model,
            coalesce(key_id, 'anon') as key,
            questions, input_tokens, output_tokens, latency_ms, path, status
     from usage_events
     where ${usageWhere.join(" and ")}
     order by ts desc
     limit ${usageLimit}`,
    usageParams,
  );

  // ── Activity feed ───────────────────────────────────────────────────────────
  const actParams: unknown[] = [f.userId];
  const actWhere: string[] = ["user_id = $1"];
  const pushA = (value: unknown): string => {
    actParams.push(value);
    return `$${actParams.length}`;
  };
  if (kind) actWhere.push(`kind = ${pushA(kind)}`);
  if (from !== null) actWhere.push(`ts >= to_timestamp(${pushA(from)} / 1000.0)`);
  if (to !== null) actWhere.push(`ts <= to_timestamp(${pushA(to)} / 1000.0)`);
  const actLimit = pushA(limit);

  const activityRows = await sql.query<{
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
     where ${actWhere.join(" and ")}
     order by ts desc
     limit ${actLimit}`,
    actParams,
  );

  const activity: ActivityRow[] = activityRows.map((r) => ({
    id: r.id,
    ts: r.ts,
    kind: r.kind,
    summary: r.summary,
    meta:
      typeof r.meta === "string"
        ? (JSON.parse(r.meta || "{}") as Record<string, unknown>)
        : ((r.meta ?? {}) as Record<string, unknown>),
  }));

  return {
    usage,
    activity,
    filters: { model, key, kind, from, to, limit },
  };
}
