"""Endpoint configuration for the shared openjev wire contract.

The adapter runs System One decisions through LLM providers, but it stays
wire-compatible with the ``/v1/systemone`` contract served by any
``openjev`` deployment. The base URL and credential are resolved from the
environment so the same code targets any endpoint without edits:

* Base URL: an explicit argument, else ``OPENJEV_BASE_URL``, else
  ``TYPESAFE_BASE_URL`` (back-compat alias), else :data:`DEFAULT_BASE_URL`.
* Credential: an explicit argument, else ``OPENJEV_API_KEY``, else
  ``TYPESAFE_API_KEY`` (back-compat alias).

Set ``OPENJEV_BASE_URL`` to point at a self-hosted openjev deployment.
The default :data:`DEFAULT_BASE_URL` targets ``localhost``; override it for any
other host, including the upstream ``api.typesafe.ai`` endpoint (wire-compatible
with the same ``/v1/systemone`` contract).
"""

from __future__ import annotations

import os

# Default endpoint. Points at localhost by default; set OPENJEV_BASE_URL to
# target any openjev deployment. The ``/v1/systemone`` wire contract is shared
# with every compatible host, including the upstream api.typesafe.ai endpoint.
DEFAULT_BASE_URL = "http://localhost:8080/v1"

# Ordered by precedence: the openjev-native variable wins, then the back-compat
# TYPESAFE_* variable so existing credentials keep working unchanged.
_BASE_URL_ENV_VARS = ("OPENJEV_BASE_URL", "OPENTYPESAFE_BASE_URL", "TYPESAFE_BASE_URL")
_API_KEY_ENV_VARS = ("OPENJEV_API_KEY", "OPENTYPESAFE_API_KEY", "TYPESAFE_API_KEY")


def _first_env(names: tuple[str, ...]) -> str | None:
    """Return the first non-empty environment value among ``names``."""
    for name in names:
        value = os.environ.get(name)
        if value:
            return value
    return None


def resolve_base_url(base_url: str | None = None) -> str:
    """Resolve the endpoint base URL.

    Args:
        base_url: Explicit override. When ``None``, the environment is consulted
            (``OPENJEV_BASE_URL`` then ``TYPESAFE_BASE_URL`` as a back-compat
            alias) before falling back to :data:`DEFAULT_BASE_URL`.

    Returns:
        The resolved base URL. Never ``None``.
    """
    if base_url is not None:
        return base_url
    return _first_env(_BASE_URL_ENV_VARS) or DEFAULT_BASE_URL


def resolve_api_key(api_key: str | None = None) -> str | None:
    """Resolve the endpoint credential.

    Args:
        api_key: Explicit override. When ``None``, the environment is consulted
            (``OPENJEV_API_KEY`` then ``TYPESAFE_API_KEY`` as a back-compat
            alias).

    Returns:
        The resolved credential, or ``None`` when neither is set so the provider
        SDK can apply its own resolution.
    """
    if api_key is not None:
        return api_key
    return _first_env(_API_KEY_ENV_VARS)
