"""Internal protocol and logging constants."""

MAX_ERROR_BODY_LENGTH = 200

SYSTEM_ONE_PATH = "/v1/systemone"
MODELS_PATH = "/v1/models"
SHADOW_PATH = "/v1/shadow"
SDK_NAME = "openjev"
LOGGER_NAME = "openjev"
JSON_CONTENT_TYPE = "application/json"

AUTHORIZATION_HEADER = "Authorization"
ACCEPT_HEADER = "Accept"
CONTENT_TYPE_HEADER = "Content-Type"
USER_AGENT_HEADER = "User-Agent"

# New branded headers (sent as primary).
SDK_HEADER = "X-OpenJev-SDK"
RUNTIME_HEADER = "X-OpenJev-Runtime"
RETRY_COUNT_HEADER = "X-OpenJev-Retry-Count"

# Back-compat headers kept for servers that inspect the old names.
SDK_HEADER_COMPAT = "X-TypeSafe-SDK"
RUNTIME_HEADER_COMPAT = "X-TypeSafe-Runtime"
RETRY_COUNT_HEADER_COMPAT = "X-TypeSafe-Retry-Count"

# Response header: the upstream server (and openjev) emits this name.
REQUEST_ID_HEADER = "x-typesafe-request-id"

RETRY_AFTER_HEADER = "retry-after"
RETRY_AFTER_MS_HEADER = "retry-after-ms"
SECRET_HEADERS = frozenset(
    {
        "authorization",
        "proxy-authorization",
        "x-api-key",
        "api-key",
        "cookie",
        "set-cookie",
    }
)
