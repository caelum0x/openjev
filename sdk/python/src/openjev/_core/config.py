"""Configuration resolution."""

import math
import os
from collections.abc import Mapping
from dataclasses import dataclass, field

import httpx2

from openjev._core.errors import TypeSafeError
from openjev.constants import (
    API_KEY_ENV,
    BASE_URL_ENV,
    DEFAULT_BASE_URL,
    DEFAULT_MODEL,
    DEFAULT_MODEL_ENV,
    DEFAULT_TIMEOUT,
)

# Back-compat aliases. The OPENJEV_* variables are the primary names (set in constants.py);
# the legacy TYPESAFE_* variables are consulted only when the primary variable is unset so that
# callers already using TYPESAFE_* continue to work without changes.
API_KEY_ENV_ALIAS = "TYPESAFE_API_KEY"
BASE_URL_ENV_ALIAS = "TYPESAFE_BASE_URL"
DEFAULT_MODEL_ENV_ALIAS = "TYPESAFE_DEFAULT_MODEL"


def _resolve_string(
    value: str | None, env: str, default: str = "", alias: str | None = None
) -> str:
    """Resolve an explicit string, a stripped primary env value, or a stripped alias env value, falling back to a default."""
    if value is not None:
        return value
    resolved = os.environ.get(env, "").strip()
    if not resolved and env.startswith("OPENJEV_"):
        # Pre-rename name (the project was called opentypesafe before OpenJev).
        resolved = os.environ.get("OPENTYPESAFE_" + env[len("OPENJEV_"):], "").strip()
    if not resolved and alias is not None:
        resolved = os.environ.get(alias, "").strip()
    return resolved or default


def resolve_and_validate_api_key(api_key: str | None) -> str:
    """Resolve an API key from the argument or environment, strip whitespace, and validate it."""
    key = _resolve_string(api_key, API_KEY_ENV, alias=API_KEY_ENV_ALIAS).strip()
    if not key:
        raise TypeSafeError(
            f"No API key was provided. Pass api_key or set the {API_KEY_ENV} environment variable."
        )
    if not key.isascii() or not key.isprintable() or " " in key:
        raise TypeSafeError(
            "API key must contain only printable ASCII characters without whitespace."
        )
    return key


def resolve_timeout(timeout: float | httpx2.Timeout) -> float | httpx2.Timeout:
    if not isinstance(timeout, httpx2.Timeout) and (
        not math.isfinite(timeout) or timeout <= 0
    ):
        raise TypeSafeError("timeout must be a positive, finite number of seconds.")
    return timeout


@dataclass
class Config:
    api_key: str = field(repr=False)
    base_url: str
    default_model: str
    timeout: float | httpx2.Timeout
    default_headers: httpx2.Headers = field(repr=False)

    @classmethod
    def resolve(
        cls,
        api_key: str | None,
        base_url: str | None,
        default_model: str | None,
        timeout: float | httpx2.Timeout | None,
        default_headers: Mapping[str, str] | None,
    ) -> "Config":
        return cls(
            resolve_and_validate_api_key(api_key),
            _resolve_string(
                base_url, BASE_URL_ENV, DEFAULT_BASE_URL, alias=BASE_URL_ENV_ALIAS
            ).rstrip("/"),
            _resolve_string(
                default_model,
                DEFAULT_MODEL_ENV,
                DEFAULT_MODEL,
                alias=DEFAULT_MODEL_ENV_ALIAS,
            ),
            resolve_timeout(DEFAULT_TIMEOUT if timeout is None else timeout),
            httpx2.Headers(default_headers),
        )
