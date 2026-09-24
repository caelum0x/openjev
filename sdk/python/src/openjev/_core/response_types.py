"""Ergonomic answer objects and response metadata, built on the generated wire schemas.

The wire models in `openjev._schemas.models` mirror the OpenAPI schema. The public answer types
subclass them, adding immutability and integer-keyed score maps. Because the answer models are tagged,
the public `Answer` union validates by discriminator; per-answer dispatch is kept only to skip answer
kinds a future API adds without failing the whole response.
"""

from functools import cached_property
from typing import Annotated, Any, Literal, TypeAlias

import httpx2
from pydantic import ConfigDict, Field, ValidationError, model_serializer
from pydantic.functional_serializers import SerializerFunctionWrapHandler
from typing_extensions import Self, override

from openjev._core.json import deserialize, serialize
from openjev._core.logging import logger
from openjev._core.schemas.base import (
    Response,
    Schema,
    format_error_path,
    format_path,
    validation_error,
)
from openjev._schemas import models as wire

_OPTIONAL_TRUST_FIELDS = frozenset(
    {
        "ood",
        "abstained",
        "abstain_reason",
        "p_none",
        "calibrated",
        "escalated",
        "latency_ms",
        "fallback",
        "escalation",
        "calibration",
    }
)


class _OmitUnreportedTrust:
    """Leave optional trust fields the server did not report out of `model_dump`, so a
    response from a server without the trust layer serializes exactly as before."""

    @model_serializer(mode="wrap")
    def _omit_unreported(
        self, handler: SerializerFunctionWrapHandler
    ) -> dict[str, Any]:
        return {
            key: value
            for key, value in handler(self).items()
            if not (key in _OPTIONAL_TRUST_FIELDS and value is None)
        }


class NoulAnswer(_OmitUnreportedTrust, wire.NoulAnswer):
    """A yes/no answer.

    See the [noul primitive](https://docs.typesafe.ai/primitives/noul) for details.
    """

    model_config = ConfigDict(extra="ignore", frozen=True, strict=True)

    type: Literal["noul"] = "noul"  # pyrefly: ignore[bad-override]
    ood: float | None = None
    """Out-of-scope score from 0 (in scope) to 1 (unrelated); `None` when the server does not report it."""
    abstained: bool | None = None
    """`True` when the question opted into abstention and the model abstained."""
    abstain_reason: Literal["out_of_scope", "low_confidence"] | None = None
    """Why the answer abstained."""
    p_none: float | None = None
    """Probability mass on "none of the above" when abstaining."""
    calibrated: bool | None = None
    """`True` when a calibration map (`calibration_id`) rewrote the confidence."""
    escalated: bool | None = None
    """`True` when the `auto` model re-asked this question to an LLM."""


class ChoiceAnswer(_OmitUnreportedTrust, wire.ChoiceAnswer):
    """A selected label and its probabilities.

    See the [choice primitive](https://docs.typesafe.ai/primitives/choice) for details.
    """

    model_config = ConfigDict(extra="ignore", frozen=True, strict=True)

    type: Literal["choice"] = "choice"  # pyrefly: ignore[bad-override]
    ood: float | None = None
    """Out-of-scope score from 0 (in scope) to 1 (unrelated); `None` when the server does not report it."""
    abstained: bool | None = None
    """`True` when the question opted into abstention and the model abstained."""
    abstain_reason: Literal["out_of_scope", "low_confidence"] | None = None
    """Why the answer abstained."""
    p_none: float | None = None
    """Probability mass on "none of the above" when abstaining."""
    calibrated: bool | None = None
    """`True` when a calibration map (`calibration_id`) rewrote the confidence."""
    escalated: bool | None = None
    """`True` when the `auto` model re-asked this question to an LLM."""


class ScoreAnswer(_OmitUnreportedTrust, wire.ScoreAnswer):
    """An expected score with its rubric and probabilities.

    See the [score primitive](https://docs.typesafe.ai/primitives/score) for details.
    """

    model_config = ConfigDict(extra="ignore", frozen=True, strict=True)

    type: Literal["score"] = "score"  # pyrefly: ignore[bad-override]
    ood: float | None = None
    """Out-of-scope score from 0 (in scope) to 1 (unrelated); `None` when the server does not report it."""
    abstained: bool | None = None
    """`True` when the question opted into abstention and the model abstained."""
    abstain_reason: Literal["out_of_scope", "low_confidence"] | None = None
    """Why the answer abstained."""
    p_none: float | None = None
    """Probability mass on "none of the above" when abstaining."""
    calibrated: bool | None = None
    """`True` when a calibration map (`calibration_id`) rewrote the confidence."""
    escalated: bool | None = None
    """`True` when the `auto` model re-asked this question to an LLM."""
    # JSON object keys are strings; `dict[int, ...]` tells Pydantic to coerce them to the integer score
    # levels. `Any` (not the recursive JSON value) keeps the nested values decodable.
    legend: dict[int, str | dict[str, Any] | list[Any]]  # pyrefly: ignore[bad-override]
    """Rubric descriptions keyed by integer score."""
    probabilities: dict[int, float]  # pyrefly: ignore[bad-override]
    """Probabilities keyed by integer score."""


Answer: TypeAlias = Annotated[
    NoulAnswer | ChoiceAnswer | ScoreAnswer, Field(discriminator="type")
]
"""An answer to a single question, identified by its `type`."""


class Usage(wire.Usage):
    """Token counts for a request, when reported by the API."""

    model_config = ConfigDict(extra="ignore", frozen=True, strict=True)

    input_tokens: int | None = None  # pyrefly: ignore[bad-override]
    """Number of input tokens used, or `None` when the API did not report it."""
    output_tokens: int | None = None  # pyrefly: ignore[bad-override]
    """Number of output tokens used, or `None` when the API did not report it."""


_ANSWER_TYPES = {"noul", "choice", "score"}


def _prepare_system_one_response(
    response: httpx2.Response, answer_fields: set[str]
) -> dict[str, Any]:
    """Validate answers, drop future types, and lift declared answer fields into top-level keys."""
    decoded = deserialize(response.content)
    if not isinstance(decoded, dict):
        raise validation_error(response, "")
    answers = decoded.get("answers")
    if isinstance(answers, dict):
        for name, raw in list(answers.items()):
            if not isinstance(raw, dict) or not isinstance(raw.get("type"), str):
                raise validation_error(response, f"answers.{name}.type")
            if raw["type"] not in _ANSWER_TYPES:
                # Forward-compat: ignore answer types this SDK version does not model. The raw payload
                # is still available through `response.raw_http_response`.
                logger.warning(
                    "Ignoring answer %r with unrecognized type %r", name, raw["type"]
                )
                del answers[name]
        for answer_field in answer_fields & answers.keys():
            decoded[answer_field] = answers[answer_field]
    return decoded


class Fallback(Schema):
    """Set when the requested backend was unavailable and another one answered."""

    requested: str
    served: str
    reason: str
    detail: str


class Escalation(Schema):
    """Present on `auto` responses: which questions stayed local and which escalated to an LLM."""

    local_model: str
    escalated: tuple[str, ...] = ()
    kept: tuple[str, ...] = ()
    threshold: float
    provider: str | None = None
    llm_model: str | None = None
    needed: tuple[str, ...] | None = None
    skipped_reason: Literal["no_llm_configured", "rate_limited", "llm_error"] | None = (
        None
    )
    llm_usage: Usage | None = None


class CalibrationApplied(Schema):
    """Present when `calibration_id` was sent."""

    id: str
    method: Literal["temperature", "isotonic"]
    questions: tuple[str, ...] = ()
    """Question ids whose confidence was remapped."""
    skipped_reason: str | None = None
    """Set when the map was not applied (for example fitted on a different model)."""


class SystemOneResponse(_OmitUnreportedTrust, Response):
    """Answers grouped by question type with model and usage metadata.

    See [System One](https://docs.typesafe.ai/concepts/system-one) for details.
    """

    model: str
    """The model used to answer the request."""
    usage: Usage
    """Token usage for the request."""
    answers: dict[str, Answer] = Field(default_factory=dict)
    """All answer objects keyed by question name."""
    latency_ms: float | None = None
    """Server-side latency in milliseconds, when reported (OpenJev servers)."""
    fallback: Fallback | None = None
    """Set when a different backend than the requested one answered."""
    escalation: Escalation | None = None
    """Set on `auto` responses."""
    calibration: CalibrationApplied | None = None
    """Set when a calibration map was requested with `calibration_id`."""

    @cached_property
    def nouls(self) -> dict[str, NoulAnswer]:
        """Yes/no answers keyed by question name."""
        return {
            name: answer
            for name, answer in self.answers.items()
            if isinstance(answer, NoulAnswer)
        }

    @cached_property
    def choices(self) -> dict[str, ChoiceAnswer]:
        """Choice answers keyed by question name."""
        return {
            name: answer
            for name, answer in self.answers.items()
            if isinstance(answer, ChoiceAnswer)
        }

    @cached_property
    def scores(self) -> dict[str, ScoreAnswer]:
        """Score answers keyed by question name."""
        return {
            name: answer
            for name, answer in self.answers.items()
            if isinstance(answer, ScoreAnswer)
        }

    @classmethod
    @override
    def _decode(cls, response: httpx2.Response) -> Self:
        answer_fields = set(cls.model_fields) - set(SystemOneResponse.model_fields)
        decoded = _prepare_system_one_response(response, answer_fields)
        try:
            return cls.model_validate_json(serialize(decoded))
        except ValidationError as error:
            location = list(error.errors(include_url=False)[0]["loc"])
            match location:
                case ["answers", _, answer_type, *_] if answer_type in _ANSWER_TYPES:
                    del location[2]
            raise validation_error(response, format_path(location)) from error


class ModelMetadata(Schema):
    """Metadata describing a single available model."""

    name: str
    """Model name or alias accepted by a request's model field."""
    description: str
    """Human-readable description of the model and its capabilities."""
    release_date: str
    """Model release date, formatted as YYYY-MM-DD."""


class ListModelsResponse(Response):
    """The models available to the account."""

    models: tuple[ModelMetadata, ...]
    """The available models."""

    @classmethod
    @override
    def _decode(cls, response: httpx2.Response) -> Self:
        try:
            return cls.model_validate_json(response.content)
        except ValidationError as error:
            raise validation_error(response, format_error_path((), error)) from error


# ---------------------------------------------------------------------------
# Shadow mode
# ---------------------------------------------------------------------------


class ShadowAnswers(_OmitUnreportedTrust, Schema):
    """OpenJev's own answers inside a shadow result."""

    model: str
    answers: dict[str, Answer] = Field(default_factory=dict)
    usage: Usage | None = None
    latency_ms: float | None = None
    fallback: Fallback | None = None
    escalation: Escalation | None = None
    calibration: CalibrationApplied | None = None


class ShadowIncumbentInfo(Schema):
    """Who the reference answers came from."""

    name: str
    source: Literal["caller", "server_llm"]
    kind: Literal["llm", "label"] = "llm"
    """`label` when the answers were human ground truth (agreement is accuracy)."""


class ShadowComparison(Schema):
    """One question compared between OpenJev and the incumbent."""

    question_id: str
    qtype: str
    ours: str
    incumbent: str
    agree: bool
    confidence: float
    ood: float | None = None


def _unwrap_data(cls: type[Response], response: httpx2.Response) -> Any:
    decoded = deserialize(response.content)
    if not isinstance(decoded, dict) or not isinstance(decoded.get("data"), dict):
        raise validation_error(response, "data")
    try:
        return cls.model_validate_json(serialize(decoded["data"]))
    except ValidationError as error:
        raise validation_error(response, format_error_path(("data",), error)) from error


class ShadowResult(Response):
    """Result of one shadow request (`POST /v1/shadow`)."""

    batch_id: str
    incumbent: ShadowIncumbentInfo
    calibration_id: str | None = None
    """Calibration applied to OpenJev's answers; it also feeds that calibration's drift monitor."""
    ours: ShadowAnswers
    comparisons: tuple[ShadowComparison, ...] = ()
    agreement: float
    """Share of compared questions that agreed, from 0 to 1."""

    @classmethod
    @override
    def _decode(cls, response: httpx2.Response) -> Self:
        return _unwrap_data(cls, response)


class ShadowQuestionStats(Schema):
    question_id: str
    qtype: str
    n: int
    agreement: float
    avg_confidence: float


class ShadowBand(Schema):
    label: str
    lo: float
    hi: float
    n: int
    agreement: float | None = None


class ShadowAboveThreshold(Schema):
    n: int
    share: float
    agreement: float | None = None


class ShadowDisagreement(Schema):
    id: str
    question_id: str
    ours: str
    incumbent: str
    confidence: float
    state_excerpt: str
    created_at: int


class ShadowSavings(Schema):
    incumbent_input_tokens: int
    incumbent_output_tokens: int
    incumbent_cost_usd: float
    projected_savings_usd: float
    price_in_usd_per_mtok: float
    price_out_usd_per_mtok: float
    price_source: Literal["env", "default"]


class ShadowSummary(Response):
    """Aggregated shadow-mode evidence (`GET /v1/shadow`)."""

    window_days: int
    threshold: float
    total: int
    agreed: int
    agreement: float | None = None
    incumbents: tuple[str, ...] = ()
    by_question: tuple[ShadowQuestionStats, ...] = ()
    by_confidence: tuple[ShadowBand, ...] = ()
    above_threshold: ShadowAboveThreshold
    disagreements: tuple[ShadowDisagreement, ...] = ()
    savings: ShadowSavings

    @classmethod
    @override
    def _decode(cls, response: httpx2.Response) -> Self:
        return _unwrap_data(cls, response)
