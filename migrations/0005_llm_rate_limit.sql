-- Global, cross-process rate limit for the LLM escalation backend.
--
-- llm.server.ts used a module-level in-memory array (8 calls / 5 min): that
-- counter is PER-PROCESS, so under multiple workers or serverless instances the
-- cap was bypassed (each process kept its own counter) and it reset on every
-- restart. This table moves the counter into the shared database so the cap is
-- GLOBAL across every worker and survives restarts.
--
-- Each ALLOWED escalation records one row (called_at = now()). The limiter counts
-- rows inside the trailing window and inserts a new row only when the count is
-- under the cap, so the semantics match the old array (N allowed calls / window).
-- Rows older than the window are pruned opportunistically on each check, so the
-- table stays small without a separate sweeper. `bucket` scopes the counter
-- (currently a single 'global' bucket; kept so future per-key limits can reuse
-- the same table).
--
-- Applied idempotently (create ... if not exists); recorded in _migrations by
-- name. Safe to re-run.

create table if not exists llm_rate_limit (
  id         bigint generated always as identity primary key,
  bucket     text        not null default 'global',
  called_at  timestamptz not null default now()
);

create index if not exists llm_rate_limit_bucket_ts_idx
  on llm_rate_limit (bucket, called_at desc);
