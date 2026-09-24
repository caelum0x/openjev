-- Drift check history (trust layer P3.4: signed calibration audit reports).
--
-- drift_monitors keeps only the latest report. Audit reports need the history:
-- every check run (automatic after shadow traffic, or on demand) appends one
-- row here with its status and full report, so a risk team can see when a
-- calibration drifted and when it recovered.
--
-- Same conventions as 0002/0003: text ids, user-scoped, idempotent DDL.

create table if not exists drift_checks (
  id              text primary key,
  user_id         text not null,
  monitor_id      text not null,
  calibration_id  text not null,
  status          text not null,
  drifted_json    jsonb not null default '[]',
  observations    int not null default 0,
  report_json     jsonb not null,
  alerted         boolean not null default false,
  checked_at      timestamptz not null default now()
);

create index if not exists drift_checks_user_calibration_idx
  on drift_checks (user_id, calibration_id, checked_at desc);
