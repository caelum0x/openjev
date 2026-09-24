-- Per-customer calibration maps (trust layer, P1.1).
--
-- A calibration is fitted from a customer's OWN labelled examples (uploaded, or
-- taken from an eval run): every example is answered by `model`, graded
-- against its label, and a per-question map (temperature scaling or isotonic
-- regression) is fitted from (confidence, correct) pairs. Requests that pass
-- `calibration_id` get their confidences rewritten through `maps_json`.
--
--   maps_json    {question_id: {method:"temperature",temperature} | {method:"isotonic",knots:[[x,y],...]}}
--   metrics_json {question_id: {n, before:{...}, after:{...}, curve:[...], recommended}}
--
-- Same conventions as 0002: text ids, user-scoped, idempotent DDL.

create table if not exists calibration_maps (
  id             text primary key,
  user_id        text not null,
  name           text not null,
  model          text not null,
  method         text not null,
  source         text not null default 'upload',
  eval_run_id    text,
  questions_json jsonb not null default '{}',
  maps_json      jsonb not null default '{}',
  metrics_json   jsonb not null default '{}',
  sample_count   int not null default 0,
  created_at     timestamptz not null default now()
);

create index if not exists calibration_maps_user_idx on calibration_maps (user_id, created_at desc);
