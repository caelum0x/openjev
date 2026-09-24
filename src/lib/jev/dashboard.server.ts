import { getSql } from "@/lib/db";
import { listActivity, type ActivityRow } from "./activity.server";
import { listUsage, type UsageEvent } from "./usage.server";

/**
 * DB-backed, user-scoped dashboard aggregation (Foundation-1). One call powers
 * the console home: today's totals, a 14-day sparkline, top models, and the
 * most recent activity + usage.
 */

export type DashboardToday = {
  calls: number;
  input_tokens: number;
  output_tokens: number;
  tokens: number;
  p50_latency_ms: number;
  p95_latency_ms: number;
};

export type SparklinePoint = { day: string; calls: number; tokens: number };
export type TopModel = { model: string; calls: number; tokens: number };

export type DashboardSummary = {
  today: DashboardToday;
  sparkline: SparklinePoint[];
  top_models: TopModel[];
  recent_activity: ActivityRow[];
  recent_usage: UsageEvent[];
};

/** Everything the console home renders for `userId`, in one round of queries. */
export async function dashboardSummary(opts: {
  userId: string;
}): Promise<DashboardSummary> {
  const sql = await getSql();
  const userId = opts.userId;

  const todayRows = await sql.query<{
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
     where user_id = $1 and ts::date = now()::date`,
    [userId],
  );
  const t = todayRows[0];

  const sparkline = await sql.query<SparklinePoint>(
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

  const top_models = await sql.query<TopModel>(
    `select model, count(*)::int as calls,
            coalesce(sum(input_tokens + output_tokens), 0)::bigint as tokens
     from usage_events
     where user_id = $1 and ts > now() - interval '7 days'
     group by model
     order by tokens desc
     limit 5`,
    [userId],
  );

  const [recent_activity, recent_usage] = await Promise.all([
    listActivity({ userId, limit: 8 }),
    listUsage({ userId, limit: 8 }),
  ]);

  return {
    today: {
      calls: t.calls,
      input_tokens: t.input_tokens,
      output_tokens: t.output_tokens,
      tokens: t.input_tokens + t.output_tokens,
      p50_latency_ms: t.p50,
      p95_latency_ms: t.p95,
    },
    sparkline,
    top_models,
    recent_activity,
    recent_usage,
  };
}
