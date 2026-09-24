-- Drift monitoring + paid-plan upgrades (trust layer follow-ups).
--
-- 1. shadow_pairs learns which calibration a request used and what the
--    reference was: an incumbent LLM ('llm', agreement is an accuracy proxy)
--    or a human label ('label', agreement IS accuracy). Drift monitors read
--    these pairs per calibration.
-- 2. drift_monitors: one per calibration. Compares recent shadow / labelled
--    traffic with the calibration's held-out metrics and POSTs a signed
--    `calibration.drift` event to one of the account's webhooks.
-- 3. billing_events: every Creem webhook event id we processed, so a retried
--    delivery is applied exactly once.
--
-- Same conventions as 0002/0003: text ids, user-scoped, idempotent DDL.

alter table shadow_pairs add column if not exists calibration_id text;
alter table shadow_pairs add column if not exists reference_kind text not null default 'llm';

create index if not exists shadow_pairs_user_calibration_idx
  on shadow_pairs (user_id, calibration_id, created_at desc);

create table if not exists drift_monitors (
  id                 text primary key,
  user_id            text not null,
  calibration_id     text not null,
  webhook_id         text not null,
  window_days        int not null default 7,
  thresholds_json    jsonb not null default '{}',
  active             boolean not null default true,
  last_checked_at    timestamptz,
  last_status        text,
  last_report_json   jsonb,
  last_alert_at      timestamptz,
  last_alert_fingerprint text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index if not exists drift_monitors_user_calibration_uidx
  on drift_monitors (user_id, calibration_id);

create table if not exists billing_events (
  id           text primary key,
  provider     text not null,
  event_type   text not null,
  user_id      text,
  plan         text,
  subscription_id text,
  status       text not null,
  detail       text,
  created_at   timestamptz not null default now()
);

create index if not exists billing_events_user_idx on billing_events (user_id, created_at desc);
