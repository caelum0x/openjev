"""openjev: Python clients and public types for the OpenJev /v1 API.

Wire-compatible with any openjev deployment and with the upstream TypeSafe AI API
(https://api.typesafe.ai).  The default base URL is ``http://localhost:8080``; override via
``OPENJEV_BASE_URL`` or the ``base_url`` constructor argument.

Based on the official TypeSafe AI Python SDK (MIT); see the NOTICE file for attribution.
Derived from and wire-compatible with the upstream System One v1 API.
"""

from openjev import _core as _core
from openjev import constants as constants
from openjev._core.client.aio.client import AsyncTypeSafeClient
from openjev._core.client.aio.models import AsyncModels
from openjev._core.client.aio.shadow import AsyncShadow
from openjev._core.client.sync.client import TypeSafeClient
from openjev._core.client.sync.models import Models
from openjev._core.client.sync.shadow import Shadow
from openjev._core.errors import (
    TypeSafeAPIConnectionError,
    TypeSafeAPIError,
    TypeSafeAPIResponseValidationError,
    TypeSafeAPITimeoutError,
    TypeSafeAuthenticationError,
    TypeSafeBadRequestError,
    TypeSafeError,
    TypeSafeInternalServerError,
    TypeSafeNotFoundError,
    TypeSafePermissionDeniedError,
    TypeSafeRateLimitError,
    TypeSafeUnprocessableEntityError,
)
from openjev._core.json_types import JSONContent, JSONValue
from openjev._core.question_types import (
    Choice,
    ChoiceModel,
    Noul,
    NoulCriteria,
    NoulModel,
    Question,
    QuestionModel,
    Questions,
    Score,
    ScoreModel,
)
from openjev._core.response_types import (
    Answer,
    CalibrationApplied,
    ChoiceAnswer,
    Escalation,
    Fallback,
    ListModelsResponse,
    ModelMetadata,
    NoulAnswer,
    ScoreAnswer,
    ShadowComparison,
    ShadowResult,
    ShadowSummary,
    SystemOneResponse,
    Usage,
)
from openjev._core.retry import RetryPolicy
from openjev._version import __version__ as __version__

__all__ = [
    "Answer",
    "AsyncModels",
    "AsyncShadow",
    "AsyncTypeSafeClient",
    "CalibrationApplied",
    "Choice",
    "ChoiceAnswer",
    "ChoiceModel",
    "Escalation",
    "Fallback",
    "JSONContent",
    "JSONValue",
    "ListModelsResponse",
    "ModelMetadata",
    "Models",
    "Noul",
    "NoulAnswer",
    "NoulCriteria",
    "NoulModel",
    "Question",
    "QuestionModel",
    "Questions",
    "RetryPolicy",
    "Score",
    "ScoreAnswer",
    "ScoreModel",
    "Shadow",
    "ShadowComparison",
    "ShadowResult",
    "ShadowSummary",
    "SystemOneResponse",
    "TypeSafeAPIConnectionError",
    "TypeSafeAPIError",
    "TypeSafeAPIResponseValidationError",
    "TypeSafeAPITimeoutError",
    "TypeSafeAuthenticationError",
    "TypeSafeBadRequestError",
    "TypeSafeClient",
    "TypeSafeError",
    "TypeSafeInternalServerError",
    "TypeSafeNotFoundError",
    "TypeSafePermissionDeniedError",
    "TypeSafeRateLimitError",
    "TypeSafeUnprocessableEntityError",
    "Usage",
    "constants",
]

del _core
