-- Per-key rate limits and monthly decision quotas (Phase-2 multi-tenant metering).
--
-- Default free-tier: 60 rpm, 1 000 decisions/month. A key with no row in this
-- table falls back to those defaults (applied in code). A row with key_id equal
-- to a user_id (not matching any api_key) acts as a user-level plan override
-- that the billing summary reads to show the account's current quota.
--
-- monthly_quota = 0  means unlimited (no monthly cap, only rpm enforcement).
-- rpm_limit = 0      means unlimited requests per minute.
--
-- Applied idempotently (create … if not exists); recorded in _migrations by name.

create table if not exists key_quotas (
  key_id        text primary key,
  rpm_limit     int  not null default 60,
  monthly_quota int  not null default 1000,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists key_quotas_updated_idx on key_quotas (updated_at desc);
