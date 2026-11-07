-- External benchmark submissions (Geek Room hackathon capability): a third
-- party points their own typed-decision model at the shipped gold calibration
-- suite (src/lib/jev/gold.ts, 93 cases) and gets scored by the SAME engine
-- (buildReliability in calibration.ts) OpenJev's own models are scored by, so
-- the result is directly comparable on the real /leaderboard page.
--
-- One row per submission attempt; one row per (submission, qtype) in
-- benchmark_results, where qtype = 'overall' is the aggregate row used on the
-- leaderboard table and 'choice' | 'noul' | 'score' are the per-question-type
-- breakdown (mirrors otsone/laya_mlx/eval_external.py's by_type report).
--
-- Scoped to user_id (the console account whose API key submitted it), same
-- ownership pattern as eval_runs / webhooks / decisions.

create table if not exists benchmark_submissions (
  id              text primary key,
  user_id         text not null,
  model_label     text not null,
  -- 'endpoint': we POST {state, questions} to endpoint_url per gold case and
  -- read back {answers}. 'answers': the submitter precomputed every gold
  -- case's answers offline and uploaded them as one JSON payload.
  source_kind     text not null check (source_kind in ('endpoint', 'answers')),
  endpoint_url    text,
  answers_json    jsonb,
  status          text not null default 'pending'
                    check (status in ('pending', 'running', 'completed', 'failed')),
  error_message   text,
  case_count      int not null default 0,
  submitted_at    timestamptz not null default now(),
  completed_at    timestamptz
);

create index if not exists benchmark_submissions_user_idx
  on benchmark_submissions (user_id, submitted_at desc);
create index if not exists benchmark_submissions_status_idx
  on benchmark_submissions (status, submitted_at desc);

create table if not exists benchmark_results (
  id               text primary key,
  submission_id    text not null references benchmark_submissions (id) on delete cascade,
  qtype            text not null check (qtype in ('overall', 'choice', 'noul', 'score')),
  case_count       int not null default 0,
  accuracy         double precision,
  strict_pass_rate double precision,
  avg_confidence   double precision,
  ece              double precision,
  adaptive_ece     double precision,
  mce              double precision,
  brier            double precision,
  nll              double precision,
  created_at       timestamptz not null default now()
);

create unique index if not exists benchmark_results_submission_qtype_idx
  on benchmark_results (submission_id, qtype);
