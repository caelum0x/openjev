"""Public environment-variable names and client defaults."""

API_KEY_ENV = "OPENJEV_API_KEY"
"""Primary environment variable for the API key.

The pre-rename ``OPENTYPESAFE_API_KEY`` and the back-compat alias ``TYPESAFE_API_KEY``
are also accepted (in that order) when ``OPENJEV_API_KEY`` is not set.
"""

BASE_URL_ENV = "OPENJEV_BASE_URL"
"""Primary environment variable for the API base URL.

``OPENTYPESAFE_BASE_URL`` (pre-rename) and ``TYPESAFE_BASE_URL`` are also accepted.
"""

DEFAULT_MODEL_ENV = "OPENJEV_DEFAULT_MODEL"
"""Primary environment variable for the default model.

``OPENTYPESAFE_DEFAULT_MODEL`` (pre-rename) and ``TYPESAFE_DEFAULT_MODEL`` are also accepted.
"""

LOG_LEVEL_ENV = "OPENJEV_LOG_LEVEL"
"""Primary environment variable for the logging level (debug/info/warn/error/off).

``OPENTYPESAFE_LOG_LEVEL`` (pre-rename) and ``TYPESAFE_LOG_LEVEL`` are also accepted.
"""

DEFAULT_BASE_URL = "http://localhost:8080"
"""Default API base URL (a self-hosted openjev endpoint).

Override via ``OPENJEV_BASE_URL`` or the ``base_url`` constructor argument to
point at any openjev-compatible host (including ``https://api.typesafe.ai``).
"""

DEFAULT_MODEL = "otsone-latest"
"""Default model name."""

DEFAULT_TIMEOUT = 10.0
"""Default timeout in seconds for each HTTP operation."""
