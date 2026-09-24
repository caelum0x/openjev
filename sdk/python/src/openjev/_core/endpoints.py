"""Endpoint-specific request builders, layered over the generic `transport.prepare`."""

from collections.abc import Mapping
from typing import Any
from urllib.parse import urlencode

import httpx2

from openjev._core.config import Config
from openjev._core.constants import MODELS_PATH, SHADOW_PATH, SYSTEM_ONE_PATH
from openjev._core.errors import TypeSafeError
from openjev._core.json_types import JSONContent, JSONValue
from openjev._core.question_types import Question
from openjev._core.questions import normalize_questions
from openjev._core.response_types import ListModelsResponse, ShadowResult, ShadowSummary
from openjev._core.transport import Request, ResponseT, prepare


def prepare_system_one(
    config: Config,
    state: JSONContent,
    questions: Mapping[str, Question],
    model: str | None,
    extra_body: Mapping[str, JSONValue | None] | None,
    timeout: float | httpx2.Timeout | None,
    headers: Mapping[str, str] | None,
    response_type: type[ResponseT],
    trust: Mapping[str, Any] | None = None,
) -> Request[ResponseT]:
    body = system_one_body(config, state, questions, model, trust)
    if extra_body is not None:
        body.update(extra_body)
    return prepare(
        config, "POST", SYSTEM_ONE_PATH, body, timeout, headers, response_type
    )


def _unit(name: str, value: float) -> float:
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not 0 <= value <= 1
    ):
        raise TypeSafeError(f"{name} must be a number between 0 and 1.")
    return float(value)


def system_one_body(
    config: Config,
    state: JSONContent,
    questions: Mapping[str, Question],
    model: str | None,
    trust: Mapping[str, Any] | None,
) -> dict[str, Any]:
    """The `/v1/systemone` body; trust options left at `None` are not sent."""
    body: dict[str, Any] = {
        "state": state,
        "model": config.default_model if model is None else model,
        "questions": normalize_questions(questions),
    }
    for key, value in (trust or {}).items():
        if value is None:
            continue
        if key in ("abstain_below", "escalate_below"):
            value = _unit(key, value)
        elif key == "calibration_id" and (
            not isinstance(value, str) or not value.startswith("cal_")
        ):
            raise TypeSafeError(
                "calibration_id must be a calibration id like 'cal_...'."
            )
        body[key] = value
    return body


def prepare_shadow_run(
    config: Config,
    state: JSONContent,
    questions: Mapping[str, Question],
    model: str | None,
    trust: Mapping[str, Any] | None,
    incumbent: Mapping[str, Any] | None,
    timeout: float | httpx2.Timeout | None,
    headers: Mapping[str, str] | None,
) -> Request[ShadowResult]:
    body = system_one_body(config, state, questions, model, trust)
    if incumbent is not None:
        kind = incumbent.get("kind")
        if kind is not None and kind not in ("llm", "label"):
            raise TypeSafeError('incumbent["kind"] must be "llm" or "label".')
        body["incumbent"] = dict(incumbent)
    return prepare(config, "POST", SHADOW_PATH, body, timeout, headers, ShadowResult)


def prepare_shadow_summary(
    config: Config,
    days: int | None,
    threshold: float | None,
    incumbent: str | None,
    timeout: float | httpx2.Timeout | None,
    headers: Mapping[str, str] | None,
) -> Request[ShadowSummary]:
    query = {
        key: value
        for key, value in (
            ("days", days),
            ("threshold", threshold),
            ("incumbent", incumbent),
        )
        if value is not None
    }
    path = f"{SHADOW_PATH}?{urlencode(query)}" if query else SHADOW_PATH
    return prepare(config, "GET", path, None, timeout, headers, ShadowSummary)


def prepare_models(
    config: Config,
    timeout: float | httpx2.Timeout | None,
    headers: Mapping[str, str] | None,
) -> Request[ListModelsResponse]:
    return prepare(
        config, "GET", MODELS_PATH, None, timeout, headers, ListModelsResponse
    )
