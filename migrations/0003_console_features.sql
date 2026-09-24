-- Console feature tables (Foundation-2).
--
-- Builds on the persistence core in 0002_console.sql (api_keys, usage_events,
-- projects, activity_log). These tables back the higher-level console surfaces:
-- saved decisions (a reusable System One schema), evaluation runs + their cases,
-- outbound webhooks, and per-account display settings.
--
-- Conventions (see migrations/auth/0001_auth.sql and 0002_console.sql): snake_case
-- app tables, every per-user table carries `user_id TEXT NOT NULL` (TEXT, not
-- UUID — the preview dev user id is the string 'dev-user'), timestamps are
-- `timestamptz` and converted to epoch-millis numbers in read queries. Idempotent:
-- `create table/index if not exists`, applied once by basename and recorded in
-- `_migrations`. `projects` (0002) is referenced by project_id, but — matching the
-- api_keys.project_id convention — without a hard FK, so archiving/removing a
-- project never wedges a write. Every read is scoped to the authenticated user.

-- Saved decisions: a named, versioned System One schema (state + questions) a
-- user can re-run from the console. `state_json`/`questions_json` are the exact
-- shapes POSTed to /api/v1/systemone. `version` bumps on every update.
create table if not exists saved_decisions (
  id             text primary key,
  user_id        text not null,
  project_id     text,
  name           text not null,
  description    text,
  state_json     jsonb not null default '{}',
  questions_json jsonb not null default '{}',
  version        int not null default 1,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists saved_decisions_user_idx on saved_decisions (user_id, created_at desc);
create index if not exists saved_decisions_project_idx on saved_decisions (project_id);

-- Evaluation runs: one row per batch of cases executed against a backend/model
-- (the gold calibration suite, or a decision's own cases). Totals are rolled up
-- from eval_cases at write time.
create table if not exists eval_runs (
  id          text primary key,
  user_id     text not null,
  decision_id text,
  backend     text not null,
  model       text not null,
  total       int not null default 0,
  passed      int not null default 0,
  failed      int not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists eval_runs_user_idx on eval_runs (user_id, created_at desc);
create index if not exists eval_runs_decision_idx on eval_runs (decision_id);

-- Evaluation cases: one row per case within a run. Scoped to a user through
-- `run_id` -> eval_runs.user_id (no user_id column of its own); reads always join
-- back to eval_runs and filter on the owner.
create table if not exists eval_cases (
  id       text primary key,
  run_id   text not null,
  name     text not null,
  expected jsonb not null default '{}',
  got      jsonb not null default '{}',
  pass     boolean not null default false
);

create index if not exists eval_cases_run_idx on eval_cases (run_id);

-- Outbound webhooks: a user-registered URL notified of console events. Only a
-- hint of the signing `secret` is ever returned to the client; the full secret
-- is shown once at creation and used server-side to HMAC-sign deliveries.
create table if not exists webhooks (
  id               text primary key,
  user_id          text not null,
  url              text not null,
  secret           text not null,
  events           text[] not null default '{}',
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  last_delivery_at timestamptz
);

create index if not exists webhooks_user_idx on webhooks (user_id, created_at desc);

-- Per-account display settings: one row per user (user_id is the primary key).
-- Profile identity (email/name) lives in the Better Auth `"user"` table; this
-- holds console-owned overrides and org display fields.
create table if not exists account_settings (
  user_id      text primary key,
  display_name text,
  org_name     text,
  org_slug     text,
  timezone     text,
  theme        text not null default 'system',
  email_digest boolean not null default false,
  updated_at   timestamptz not null default now()
);
