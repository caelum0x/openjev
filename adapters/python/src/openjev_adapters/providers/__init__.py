"""Provider seam: OpenAI-compatible, native Anthropic, and native Gemini requests.

The concrete providers live in `openjev_adapters.providers.openai`,
`openjev_adapters.providers.anthropic`, and `openjev_adapters.providers.gemini`
and each needs its own optional dependency (the `openai` / `anthropic` / `gemini`
extras). They are imported lazily, only when selected, so importing this package
needs none of those SDKs installed.
"""

from openjev_adapters._config import resolve_api_key, resolve_base_url
from openjev_adapters.providers.base import (
    AsyncProvider,
    Message,
    ProviderName,
    ProviderResult,
    SyncProvider,
    capture_attempt,
    translating,
)

__all__ = [
    "AsyncProvider",
    "Message",
    "ProviderName",
    "ProviderResult",
    "SyncProvider",
    "build_async_endpoint_provider",
    "build_async_provider",
    "build_endpoint_provider",
    "build_sync_provider",
    "capture_attempt",
    "translating",
]

_MISSING_PROVIDER = "A provider is required: set provider='openai', 'anthropic', or 'gemini', or pass a provider instance as the model."
_UNKNOWN_PROVIDER = "Unknown provider {provider!r}. Use 'openai', 'anthropic', or 'gemini', or pass a provider instance as the model."


def _missing_extra(provider: str) -> ValueError:
    return ValueError(
        f"The {provider!r} provider requires its optional dependency; install it with: pip install 'openjev-adapters[{provider}]'"
    )


def build_sync_provider(
    provider: ProviderName | None,
    model: str | SyncProvider,
) -> SyncProvider:
    """Build the selected synchronous provider, or use an injected provider.

    Args:
        provider: `"openai"`, `"anthropic"`, or `"gemini"`, or `None` when
            `model` is already a provider instance.
        model: Model name for the selected provider, or a ready `SyncProvider`
            such as a custom OpenAI-compatible endpoint or test double.

    Returns:
        A new synchronous provider, or the supplied instance unchanged.

    Raises:
        ValueError: A model name has no provider selector, or the selected
            provider's optional dependency is missing.
    """
    if not isinstance(model, str):
        return model
    if provider is None:
        raise ValueError(_MISSING_PROVIDER)
    if provider == "openai":
        try:
            from openjev_adapters.providers.openai import OpenAIProvider  # noqa: PLC0415
        except ImportError as error:
            raise _missing_extra("openai") from error
        return OpenAIProvider(model)
    if provider == "anthropic":
        try:
            from openjev_adapters.providers.anthropic import AnthropicProvider  # noqa: PLC0415
        except ImportError as error:
            raise _missing_extra("anthropic") from error
        return AnthropicProvider(model)
    if provider == "gemini":
        try:
            from openjev_adapters.providers.gemini import GeminiProvider  # noqa: PLC0415
        except ImportError as error:
            raise _missing_extra("gemini") from error
        return GeminiProvider(model)
    raise ValueError(_UNKNOWN_PROVIDER.format(provider=provider))


def build_async_provider(
    provider: ProviderName | None,
    model: str | AsyncProvider,
) -> AsyncProvider:
    """Build the selected asynchronous provider, or use an injected provider.

    Args:
        provider: `"openai"`, `"anthropic"`, or `"gemini"`, or `None` when
            `model` is already a provider instance.
        model: Model name for the selected provider, or a ready `AsyncProvider`
            such as a custom OpenAI-compatible endpoint or test double.

    Returns:
        A new asynchronous provider, or the supplied instance unchanged.

    Raises:
        ValueError: A model name has no provider selector, or the selected
            provider's optional dependency is missing.
    """
    if not isinstance(model, str):
        return model
    if provider is None:
        raise ValueError(_MISSING_PROVIDER)
    if provider == "openai":
        try:
            from openjev_adapters.providers.openai import AsyncOpenAIProvider  # noqa: PLC0415
        except ImportError as error:
            raise _missing_extra("openai") from error
        return AsyncOpenAIProvider(model)
    if provider == "anthropic":
        try:
            from openjev_adapters.providers.anthropic import AsyncAnthropicProvider  # noqa: PLC0415
        except ImportError as error:
            raise _missing_extra("anthropic") from error
        return AsyncAnthropicProvider(model)
    if provider == "gemini":
        try:
            from openjev_adapters.providers.gemini import AsyncGeminiProvider  # noqa: PLC0415
        except ImportError as error:
            raise _missing_extra("gemini") from error
        return AsyncGeminiProvider(model)
    raise ValueError(_UNKNOWN_PROVIDER.format(provider=provider))


def build_endpoint_provider(
    model: str,
    *,
    base_url: str | None = None,
    api_key: str | None = None,
    api: str | None = None,
) -> SyncProvider:
    """Build an OpenAI-compatible provider aimed at the openjev endpoint.

    Resolves the base URL and credential through the environment (see
    :mod:`openjev_adapters._config`), defaulting to localhost and staying
    wire-compatible with any openjev deployment. All hosts expose
    the shared ``/v1/systemone`` contract behind an OpenAI-compatible surface.

    Args:
        model: Model name to request from the endpoint.
        base_url: Explicit endpoint override; env-resolved when omitted.
        api_key: Explicit credential override; env-resolved when omitted.
        api: ``"responses"`` or ``"chat_completions"``; the provider's own
            default applies when omitted.

    Returns:
        A synchronous OpenAI-compatible provider bound to the resolved endpoint.

    Raises:
        ValueError: The ``openai`` extra is not installed.
    """
    try:
        from openjev_adapters.providers.openai import OpenAIProvider  # noqa: PLC0415
    except ImportError as error:
        raise _missing_extra("openai") from error
    return OpenAIProvider(
        model,
        base_url=resolve_base_url(base_url),
        api_key=resolve_api_key(api_key),
        api=api,  # pyrefly: ignore[bad-argument-type]
    )


def build_async_endpoint_provider(
    model: str,
    *,
    base_url: str | None = None,
    api_key: str | None = None,
    api: str | None = None,
) -> AsyncProvider:
    """Async counterpart of :func:`build_endpoint_provider`.

    Args:
        model: Model name to request from the endpoint.
        base_url: Explicit endpoint override; env-resolved when omitted.
        api_key: Explicit credential override; env-resolved when omitted.
        api: ``"responses"`` or ``"chat_completions"``; the provider's own
            default applies when omitted.

    Returns:
        An asynchronous OpenAI-compatible provider bound to the resolved endpoint.

    Raises:
        ValueError: The ``openai`` extra is not installed.
    """
    try:
        from openjev_adapters.providers.openai import AsyncOpenAIProvider  # noqa: PLC0415
    except ImportError as error:
        raise _missing_extra("openai") from error
    return AsyncOpenAIProvider(
        model,
        base_url=resolve_base_url(base_url),
        api_key=resolve_api_key(api_key),
        api=api,  # pyrefly: ignore[bad-argument-type]
    )
