"""The Instructor-style bridge maps Pydantic decision fields to questions and back."""

import asyncio
import enum
import json
from typing import Any, Literal

import pytest
from openjev import Choice, Noul, Score, SystemOneResponse
from pydantic import BaseModel, Field

from openjev_adapters.instructor import (
    AbstainedError,
    UnsupportedFieldError,
    from_openjev,
    from_openjev_async,
    plan_decisions,
    state_from_messages,
)


class Priority(enum.Enum):
    LOW = "low"
    HIGH = "high"


class Ticket(BaseModel):
    category: Literal["refund", "cancel", "billing"] = Field(
        description="Main request in the ticket",
        json_schema_extra={"options": {"refund": "Wants money back."}},
    )
    urgent: bool
    severity: int = Field(
        ge=0, le=3, json_schema_extra={"levels": ["none", "low", "high", "critical"]}
    )
    priority: Priority
    topic: Literal["shipping", "account"] | None = None
    note: str = "untouched"


def response(answers: dict[str, Any], **extra: Any) -> SystemOneResponse:
    body = {
        "model": "auto",
        "usage": {"input_tokens": 10, "output_tokens": 0},
        "answers": answers,
        **extra,
    }
    return SystemOneResponse.model_validate_json(json.dumps(body))


def good_answers(**overrides: Any) -> dict[str, Any]:
    answers = {
        "category": {
            "type": "choice",
            "choice": "refund",
            "confidence": 0.91,
            "probabilities": {"refund": 0.91, "cancel": 0.06, "billing": 0.03},
            "ood": 0.05,
            "calibrated": True,
        },
        "urgent": {"type": "noul", "noul": 0.2},
        "severity": {
            "type": "score",
            "score": 1.9,
            "confidence": 0.7,
            "legend": {"0": "none", "1": "low", "2": "high", "3": "critical"},
            "probabilities": {"0": 0.05, "1": 0.15, "2": 0.7, "3": 0.1},
        },
        "priority": {
            "type": "choice",
            "choice": "high",
            "confidence": 0.8,
            "probabilities": {"low": 0.2, "high": 0.8},
            "escalated": True,
        },
        "topic": {
            "type": "choice",
            "choice": "__none__",
            "confidence": 0.1,
            "probabilities": {"shipping": 0.05, "account": 0.05, "__none__": 0.9},
            "abstained": True,
            "abstain_reason": "out_of_scope",
        },
    }
    answers.update(overrides)
    return answers


class FakeClient:
    def __init__(self, result: SystemOneResponse) -> None:
        self.result = result
        self.calls: list[dict[str, Any]] = []

    def system_one(
        self, state: Any, questions: Any, **kwargs: Any
    ) -> SystemOneResponse:
        self.calls.append({"state": state, "questions": questions, **kwargs})
        return self.result


class FakeAsyncClient(FakeClient):
    async def system_one(
        self, state: Any, questions: Any, **kwargs: Any
    ) -> SystemOneResponse:  # type: ignore[override]
        return FakeClient.system_one(self, state, questions, **kwargs)


def test_plan_maps_each_field_type() -> None:
    plan = {d.name: d for d in plan_decisions(Ticket)}
    assert set(plan) == {"category", "urgent", "severity", "priority", "topic"}

    category = plan["category"].question
    assert isinstance(category, Choice)
    assert category.instructions == "Main request in the ticket"
    assert dict(category.criteria) == {
        "refund": "Wants money back.",
        "cancel": None,
        "billing": None,
    }
    assert category.abstain is None

    assert isinstance(plan["urgent"].question, Noul)
    assert plan["urgent"].question.instructions == "Urgent?"

    severity = plan["severity"].question
    assert isinstance(severity, Score)
    assert list(severity.criteria) == ["none", "low", "high", "critical"]

    assert dict(plan["priority"].question.criteria) == {"low": None, "high": None}  # type: ignore[union-attr]
    assert plan["topic"].optional is True
    assert plan["topic"].question.abstain is True


def test_create_builds_model_and_report() -> None:
    client = FakeClient(response(good_answers()))
    bridge = from_openjev(client)  # type: ignore[arg-type]

    ticket, report = bridge.chat.completions.create_with_confidence(
        response_model=Ticket,
        messages=[
            {"role": "system", "content": "You are a classifier."},
            {"role": "user", "content": "Refund me"},
        ],
        model="auto",
        calibration_id="cal_1",
    )

    assert ticket == Ticket(
        category="refund", urgent=False, severity=2, priority=Priority.HIGH, topic=None
    )
    assert ticket.note == "untouched"
    assert report.confidence["category"] == 0.91
    assert report.confidence["urgent"] == pytest.approx(0.8)
    assert report.probabilities["urgent"] == {"true": 0.2, "false": pytest.approx(0.8)}
    assert report.abstained == ("topic",)
    assert report.abstain_reasons == {"topic": "out_of_scope"}
    assert report.escalated == ("priority",)
    assert report.ood == {"category": 0.05}
    assert report.below(0.75) == ("severity", "topic")
    assert report.any_abstained

    call = client.calls[0]
    assert call["state"] == "Refund me"
    assert call["model"] == "auto"
    assert call["calibration_id"] == "cal_1"
    assert set(call["questions"]) == {
        "category",
        "urgent",
        "severity",
        "priority",
        "topic",
    }


def test_create_returns_model_only() -> None:
    bridge = from_openjev(FakeClient(response(good_answers())))  # type: ignore[arg-type]
    ticket = bridge.create(Ticket, state={"subject": "refund"})
    assert ticket.category == "refund"


def test_required_field_abstaining_raises_with_report() -> None:
    abstained = {
        "type": "choice",
        "choice": "__none__",
        "confidence": 0.2,
        "probabilities": {
            "refund": 0.1,
            "cancel": 0.1,
            "billing": 0.0,
            "__none__": 0.8,
        },
        "abstained": True,
        "abstain_reason": "low_confidence",
    }
    bridge = from_openjev(FakeClient(response(good_answers(category=abstained))))  # type: ignore[arg-type]
    with pytest.raises(AbstainedError) as info:
        bridge.create(Ticket, state="What is the weather?", abstain_below=0.5)
    assert info.value.fields == ("category",)
    assert "low_confidence" in str(info.value)
    assert set(info.value.report.abstained) == {"category", "topic"}


def test_unknown_label_is_an_error() -> None:
    bad = {
        "type": "choice",
        "choice": "other",
        "confidence": 0.9,
        "probabilities": {"other": 0.9},
    }
    bridge = from_openjev(FakeClient(response(good_answers(category=bad))))  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="unknown label"):
        bridge.create(Ticket, state="x")


def test_missing_answer_is_an_error() -> None:
    answers = good_answers()
    del answers["urgent"]
    bridge = from_openjev(FakeClient(response(answers)))  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="no usable answer"):
        bridge.create(Ticket, state="x")


def test_async_bridge() -> None:
    bridge = from_openjev_async(FakeAsyncClient(response(good_answers())))  # type: ignore[arg-type]
    ticket = asyncio.run(
        bridge.chat.completions.create(
            Ticket, messages=[{"role": "user", "content": "hi"}]
        )
    )
    assert ticket.priority is Priority.HIGH


def test_int_literal_choice_maps_back_to_int() -> None:
    class Stars(BaseModel):
        stars: Literal[1, 3, 5]

    answers = {
        "stars": {
            "type": "choice",
            "choice": "3",
            "confidence": 0.6,
            "probabilities": {"1": 0.2, "3": 0.6, "5": 0.2},
        }
    }
    stars = from_openjev(FakeClient(response(answers))).create(Stars, state="ok")  # type: ignore[arg-type]
    assert stars.stars == 3


@pytest.mark.parametrize(
    ("model_fields", "message"),
    [
        ({"text": (str, ...)}, "not a decision"),
        ({"count": (int, ...)}, "without both bounds"),
        ({"count": (int, Field(ge=0, le=20))}, "spans 21 levels"),
        ({"only": (Literal["a"], ...)}, "at least two options"),
        ({"x": (Literal["a", "__none__"], ...)}, "reserved"),
        (
            {"x": (int, Field(ge=0, le=2, json_schema_extra={"levels": ["a"]}))},
            "exactly 3",
        ),
        ({"text": (str, "default")}, "no decision fields"),
    ],
)
def test_unsupported_models_fail_fast(
    model_fields: dict[str, Any], message: str
) -> None:
    from pydantic import create_model

    model = create_model("Bad", **model_fields)
    with pytest.raises(UnsupportedFieldError, match=message):
        plan_decisions(model)


def test_bounds_accept_gt_and_lt() -> None:
    class Rated(BaseModel):
        level: int = Field(gt=0, lt=4)

    (decision,) = plan_decisions(Rated)
    assert decision.values == {"0": 1, "1": 2, "2": 3}


def test_state_from_messages() -> None:
    assert state_from_messages([{"role": "user", "content": "hello"}]) == "hello"
    multi = [
        {"role": "system", "content": "ignored"},
        {
            "role": "user",
            "content": [{"type": "text", "text": "part one"}, {"type": "image_url"}],
        },
        {"role": "assistant", "content": "reply"},
    ]
    assert state_from_messages(multi) == "user: part one\nassistant: reply"
    with pytest.raises(ValueError, match="no user or assistant text"):
        state_from_messages([{"role": "system", "content": "only system"}])


def test_argument_validation() -> None:
    bridge = from_openjev(FakeClient(response(good_answers())))  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="exactly one"):
        bridge.create(Ticket)
    with pytest.raises(ValueError, match="exactly one"):
        bridge.create(Ticket, messages=[{"role": "user", "content": "a"}], state="b")
    with pytest.raises(TypeError, match="temperature"):
        bridge.create(Ticket, state="x", temperature=0)
