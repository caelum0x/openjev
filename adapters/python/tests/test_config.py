"""Endpoint configuration: env-resolved base URL and credential, wire-compat.

Verifies the adapter defaults to localhost, honors TYPESAFE_API_KEY as a back-compat
alias, and retargets to any openjev URL from the environment, without network
calls.
"""

from __future__ import annotations

import asyncio

import pytest

from openjev_adapters import DEFAULT_BASE_URL, resolve_api_key, resolve_base_url
from openjev_adapters.providers import (
    build_async_endpoint_provider,
    build_endpoint_provider,
)
from openjev_adapters.providers.base import SupportsAsyncClose, SupportsClose

_BASE_URL_VARS = ("OPENJEV_BASE_URL", "TYPESAFE_BASE_URL")
_API_KEY_VARS = ("OPENJEV_API_KEY", "TYPESAFE_API_KEY")


@pytest.fixture(autouse=True)
def _clear_endpoint_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Start every test from a clean endpoint environment."""
    for name in (*_BASE_URL_VARS, *_API_KEY_VARS):
        monkeypatch.delenv(name, raising=False)


def test_base_url_defaults_to_localhost() -> None:
    assert resolve_base_url() == DEFAULT_BASE_URL == "http://localhost:8080/v1"


def test_explicit_base_url_wins_over_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENJEV_BASE_URL", "https://env.example/v1")
    assert resolve_base_url("https://explicit.example/v1") == "https://explicit.example/v1"


def test_self_hosted_base_url_from_openjev_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENJEV_BASE_URL", "http://localhost:8080/v1")
    assert resolve_base_url() == "http://localhost:8080/v1"


def test_openjev_base_url_precedes_typesafe(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TYPESAFE_BASE_URL", "https://api.typesafe.ai/v1")
    monkeypatch.setenv("OPENJEV_BASE_URL", "http://self-hosted:9000/v1")
    assert resolve_base_url() == "http://self-hosted:9000/v1"


def test_typesafe_api_key_is_honored(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TYPESAFE_API_KEY", "ts-secret")
    assert resolve_api_key() == "ts-secret"


def test_openjev_api_key_precedes_typesafe(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TYPESAFE_API_KEY", "ts-secret")
    monkeypatch.setenv("OPENJEV_API_KEY", "ots-secret")
    assert resolve_api_key() == "ots-secret"


def test_api_key_missing_returns_none() -> None:
    assert resolve_api_key() is None


def _host(provider: object) -> str:
    return str(provider._client.base_url)  # type: ignore[attr-defined]


def test_endpoint_provider_targets_localhost_by_default() -> None:
    provider = build_endpoint_provider("gpt-4o-mini", api_key="test")
    assert "localhost" in _host(provider)
    assert isinstance(provider, SupportsClose)
    provider.close()


def test_endpoint_provider_retargets_to_self_hosted(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENJEV_BASE_URL", "http://localhost:8080/v1")
    provider = build_endpoint_provider("gpt-4o-mini", api_key="test")
    assert "localhost:8080" in _host(provider)
    assert isinstance(provider, SupportsClose)
    provider.close()


def test_async_endpoint_provider_targets_localhost_by_default() -> None:
    async def run() -> None:
        provider = build_async_endpoint_provider("gpt-4o-mini", api_key="test")
        assert "localhost" in _host(provider)
        assert isinstance(provider, SupportsAsyncClose)
        await provider.aclose()

    asyncio.run(run())
