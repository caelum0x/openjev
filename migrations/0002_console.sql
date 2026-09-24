-- Console persistence core (Foundation-1).
--
-- Real, user-scoped storage for the openjev console: API keys, usage
-- events, projects, and an activity feed. Replaces the previous in-memory Maps
-- (src/lib/jev/keys.server.ts) and array (src/lib/jev/usage.server.ts).
--
-- Conventions (see migrations/0001_auth.sql): snake_case app tables, every
-- per-user table carries `user_id TEXT NOT NULL` (TEXT, not UUID — the auth-off
-- dev user id is the string 'dev-user'), and every query is scoped to the
-- authenticated user server-side. Idempotent: `create table/index if not
-- exists`, applied once by basename and recorded in `_migrations`.
--
-- F2 appends projects-dependent feature tables to a SEPARATE file
-- (0003_console_features.sql) to avoid colliding with this one.

-- API keys. Only the sha256 hash of the secret is stored; the plaintext secret
-- is returned exactly once at creation time. `prefix` is the human-readable
-- first 12 chars (e.g. `ots_live_ab…`) shown in the UI.
create table if not exists api_keys (
  id           text primary key,
  user_id      text not null,
  project_id   text,
  name         text not null,
  prefix       text not null,
  secret_hash  text not null,
  scopes       text[] not null default '{}',
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

create unique index if not exists api_keys_secret_hash_key on api_keys (secret_hash);
create index if not exists api_keys_user_id_idx on api_keys (user_id, created_at desc);
create index if not exists api_keys_project_id_idx on api_keys (project_id);

-- Metered System One calls. One row per decision request, attributed to the
-- owning user and (when signed with a key) the key that made it.
create table if not exists usage_events (
  id            text primary key,
  user_id       text not null,
  key_id        text,
  project_id    text,
  ts            timestamptz not null default now(),
  model         text not null,
  path          text not null,
  questions     int not null default 0,
  input_tokens  int not null default 0,
  output_tokens int not null default 0,
  latency_ms    int not null default 0,
  status        text not null default 'ok'
);

create index if not exists usage_events_user_ts_idx on usage_events (user_id, ts desc);
create index if not exists usage_events_user_key_idx on usage_events (user_id, key_id);
create index if not exists usage_events_user_model_idx on usage_events (user_id, model);

-- Projects: an optional grouping for keys and usage (F2 builds on these).
create table if not exists projects (
  id          text primary key,
  user_id     text not null,
  name        text not null,
  slug        text not null,
  created_at  timestamptz not null default now(),
  archived_at timestamptz
);

create index if not exists projects_user_id_idx on projects (user_id, created_at desc);
create unique index if not exists projects_user_slug_key on projects (user_id, slug);

-- Activity feed: a human-readable audit trail (one row per notable event, e.g.
-- a decision, a key created/revoked). `meta_json` holds structured details.
create table if not exists activity_log (
  id        text primary key,
  user_id   text not null,
  ts        timestamptz not null default now(),
  kind      text not null,
  summary   text not null,
  meta_json jsonb not null default '{}'
);

create index if not exists activity_log_user_ts_idx on activity_log (user_id, ts desc);
