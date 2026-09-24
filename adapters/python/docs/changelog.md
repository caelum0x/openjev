---
title: Changelog
icon: lucide/history
---

# Changelog

## OpenJev fork (2026-09-23)

Renamed to `openjev-adapters` (import `openjev_adapters`) and rebranded to the
OpenJev ecosystem. Based on
[`@typesafe-ai/system-one-adapter-python`](https://github.com/typesafe-ai/system-one-adapter-python)
(MIT); see `NOTICE`.

### Features

- env-configurable endpoint: base URL and credential resolve from
  `OPENJEV_BASE_URL` / `TYPESAFE_BASE_URL` and `OPENJEV_API_KEY` /
  `TYPESAFE_API_KEY`, defaulting to the hosted TypeSafe API
  (`https://api.typesafe.ai/v1`) and staying wire-compatible with a self-hosted
  OpenJev deployment. Adds `resolve_base_url`, `resolve_api_key`,
  `build_endpoint_provider`, and `build_async_endpoint_provider`.

The request/response shapes (`model` + `state` + questions-as-dict → Choice/Score/Noul)
are unchanged, so it remains a drop-in for `typesafe_sdk`.

## v0.2.1 (2026-09-22)

### Bug fixes

- reject incomplete chat completions
- allow OpenAI responses without token usage
- stop retrying provider refusals as malformed output
- support both `httpx` and `httpx2` provider SDKs

### Features

- support Gemini provider

## v0.2.0 (2026-09-18)

### Breaking Changes

- ser/de library has been changed from `msgspec` to `pydantic` as `typesafe-sdk` did in `v0.7.0`

### Features

- support `typesafe-sdk>=0.7.0`

## v0.1.5 (2026-09-18)

### Bug fixes

- constrained `typesafe-sdk` version to `>=0.6.0,<0.7.0`

## v0.1.4 (2026-09-16)

### Bug fixes

- reuse providers and close owned SDK clients. Thanks [@AbdelStark](https://github.com/AbdelStark)!

## v0.1.3 (2026-09-15)

Initial release.
