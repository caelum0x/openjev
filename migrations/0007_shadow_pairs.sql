-- Shadow mode (trust layer, P1.3).
--
-- One row per (shadow request, question): our typed answer next to the
-- customer's incumbent LLM answer for the same state + question, and whether
-- they agree. The /shadow dashboard aggregates agreement overall, per
-- question, and per confidence band, and projects the LLM spend a cascade
-- would have avoided on the agreeing, high-confidence share.

create table if not exists shadow_pairs (
  id                      text primary key,
  user_id                 text not null,
  batch_id                text not null,
  model                   text not null,
  incumbent               text not null,
  question_id             text not null,
  qtype                   text not null,
  ours_value              text not null,
  incumbent_value         text not null,
  ours_confidence         double precision not null,
  ours_ood                double precision,
  agree                   boolean not null,
  state_excerpt           text not null,
  ours_latency_ms         int not null default 0,
  incumbent_latency_ms    int,
  incumbent_input_tokens  int not null default 0,
  incumbent_output_tokens int not null default 0,
  created_at              timestamptz not null default now()
);

create index if not exists shadow_pairs_user_idx on shadow_pairs (user_id, created_at desc);
create index if not exists shadow_pairs_user_question_idx on shadow_pairs (user_id, question_id);
