-- Engine identity on calibration maps and eval runs.
--
-- `system-one` is served by the sentence-embedding engine when its encoder is
-- installed and by the lexical (TF-IDF) engine otherwise. A calibration map
-- fitted on one engine's confidences is meaningless on the other's, so maps
-- now record the engine kind + version they were fitted on, and inference
-- refuses (and flags) a map whose engine differs from the one answering.
--
--   engine_kind     embedding | lexical | neural | cloud | llm (null = unrecorded)
--   engine_version  e.g. gte-small+p1a2b3c4d, tfidf-1, otsone-1
--   examples_json   the labelled examples the map was fitted on (upload path),
--                   kept so the map can be re-fitted on a new engine
--   fitted_at       when the maps were last (re)fitted
--
-- Eval runs record the engine that answered, and eval cases keep their state +
-- questions so a calibration fitted from a run can be re-fitted by re-answering.

alter table calibration_maps add column if not exists engine_kind text;
alter table calibration_maps add column if not exists engine_version text;
alter table calibration_maps add column if not exists examples_json jsonb;
alter table calibration_maps add column if not exists fitted_at timestamptz;
alter table calibration_maps add column if not exists refit_count int not null default 0;

-- Backfill what can be inferred. Local weight presets are always lexical;
-- neural and cloud backends are keyed by their model id. `system-one` maps
-- created before the embedding engine became the default (2026-09-24 13:43 UTC)
-- were fitted on the lexical engine. Later `system-one` maps stay NULL
-- (unrecorded) and are flagged for a re-fit instead of being guessed.
update calibration_maps set engine_kind = 'lexical', engine_version = 'tfidf-1'
  where engine_kind is null and model in ('jev-v13', 'decisive', 'contrastive');
update calibration_maps set engine_kind = 'lexical', engine_version = 'tfidf-1'
  where engine_kind is null and model = 'system-one'
    and created_at < timestamptz '2026-09-24 13:43:47+00';
update calibration_maps set engine_kind = 'neural', engine_version = model
  where engine_kind is null and (model like 'laya%' or model like 'otsone%');
update calibration_maps set engine_kind = 'cloud', engine_version = model
  where engine_kind is null and model = 'system-one-cloud';
update calibration_maps set fitted_at = created_at where fitted_at is null;

alter table eval_runs add column if not exists engine_kind text;
alter table eval_runs add column if not exists engine_version text;
alter table eval_cases add column if not exists state_json jsonb;
alter table eval_cases add column if not exists questions_json jsonb;
