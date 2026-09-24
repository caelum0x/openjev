"""Instructor-style bridge: ``response_model=`` in, a validated Pydantic model out, plus
calibrated probabilities and an abstain flag for every decision field.

Instructor users already describe decisions as Pydantic models with ``Literal`` fields. This
bridge reads such a model, turns each decision field into a System One question, asks an
OpenJev server once, and builds the model from the typed answers. Nothing is generated, so
the result is always valid, and each field comes back with the confidence behind it.

Field mapping:

* ``Literal["a", "b"]``, ``Literal[1, 2]`` or a ``str``/``int`` ``Enum`` -> ``Choice``
* ``bool`` -> ``Noul`` (``True`` when P(yes) >= 0.5)
* ``int`` with both ``ge``/``gt`` and ``le``/``lt`` bounds (2 to 10 levels) -> ``Score``
* ``X | None`` -> the same question with abstention on; an abstained answer becomes ``None``

Any other field must have a default and is left at it. Per-option or per-level descriptions
come from ``Field(json_schema_extra={"options": {...}})`` or ``{"levels": [...]}``.

Three lines::

    from openjev_adapters.instructor import from_openjev
    client = from_openjev()
    ticket, report = client.chat.completions.create_with_confidence(
        response_model=Ticket, messages=[{"role": "user", "content": text}])
"""

from __future__ import annotations

import enum
import types
import typing
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal, TypeVar

import annotated_types
from openjev import (
    AsyncTypeSafeClient,
    Choice,
    ChoiceAnswer,
    Noul,
    NoulAnswer,
    Score,
    ScoreAnswer,
    SystemOneResponse,
    TypeSafeClient,
)
from pydantic import BaseModel
from pydantic.fields import FieldInfo

__all__ = [
    "AbstainedError",
    "AsyncOpenJevInstructor",
    "DecisionField",
    "DecisionReport",
    "OpenJevInstructor",
    "UnsupportedFieldError",
    "from_openjev",
    "from_openjev_async",
    "plan_decisions",
    "state_from_messages",
]

ModelT = TypeVar("ModelT", bound=BaseModel)

NONE_LABEL = "__none__"
MIN_SCORE_LEVELS = 2
MAX_SCORE_LEVELS = 10

Kind = Literal["choice", "noul", "score"]


class UnsupportedFieldError(TypeError):
    """A required field has a type the bridge cannot map to a decision question."""


@dataclass(frozen=True)
class DecisionField:
    """One Pydantic field mapped to a System One question."""

    name: str
    kind: Kind
    question: Choice | Noul | Score
    optional: bool
    # Choice: wire label -> Python value. Score: level index -> int value.
    values: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class DecisionReport:
    """Confidence and trust signals for every decision field of one call."""

    confidence: Mapping[str, float]
    probabilities: Mapping[str, Mapping[str, float]]
    abstained: tuple[str, ...]
    abstain_reasons: Mapping[str, str]
    escalated: tuple[str, ...]
    ood: Mapping[str, float]
    response: SystemOneResponse

    @property
    def any_abstained(self) -> bool:
        return len(self.abstained) > 0

    def below(self, threshold: float) -> tuple[str, ...]:
        """Field names answered with confidence under ``threshold``."""
        return tuple(name for name, c in self.confidence.items() if c < threshold)


class AbstainedError(ValueError):
    """A required (non-optional) field abstained, so the model cannot be built honestly."""

    def __init__(self, fields: Sequence[str], report: DecisionReport) -> None:
        self.fields = tuple(fields)
        self.report = report
        reasons = ", ".join(
            f"{f} ({report.abstain_reasons.get(f, 'abstained')})" for f in fields
        )
        super().__init__(
            f"OpenJev abstained on required field(s): {reasons}. "
            "Make the field optional (`X | None`) to receive None instead, or route to a human."
        )


# ---------------------------------------------------------------------------
# Schema -> questions
# ---------------------------------------------------------------------------


def _unwrap_optional(annotation: Any) -> tuple[Any, bool]:
    origin = typing.get_origin(annotation)
    if origin is typing.Union or origin is types.UnionType:
        args = [a for a in typing.get_args(annotation) if a is not type(None)]
        if len(args) == 1 and len(args) < len(typing.get_args(annotation)):
            return args[0], True
    return annotation, False


def _extra(info: FieldInfo, key: str) -> Any:
    extra = info.json_schema_extra
    return extra.get(key) if isinstance(extra, dict) else None


def _instructions(name: str, info: FieldInfo) -> str:
    return info.description or f"{name.replace('_', ' ').strip().capitalize()}?"


def _choice_field(
    name: str, info: FieldInfo, options: Sequence[Any], optional: bool
) -> DecisionField:
    if len(options) < 2:
        raise UnsupportedFieldError(
            f"Field {name!r} needs at least two options to be a Choice."
        )
    described = _extra(info, "options") or {}
    values: dict[str, Any] = {}
    for opt in options:
        raw = opt.value if isinstance(opt, enum.Enum) else opt
        if isinstance(raw, bool) or not isinstance(raw, (str, int)):
            raise UnsupportedFieldError(
                f"Field {name!r}: option {opt!r} must be a str or int."
            )
        values[str(raw)] = opt
    if NONE_LABEL in values:
        raise UnsupportedFieldError(
            f"Field {name!r}: {NONE_LABEL!r} is reserved for abstention."
        )
    criteria = {label: described.get(label) for label in values}
    question = Choice(
        instructions=_instructions(name, info),
        criteria=criteria,
        abstain=optional or None,
    )
    return DecisionField(name, "choice", question, optional, values)


def _as_int(name: str, bound: object) -> int:
    if isinstance(bound, bool) or not isinstance(bound, (int, float)):
        raise UnsupportedFieldError(
            f"Field {name!r} has a non-numeric bound {bound!r}."
        )
    return int(bound)


def _bounds(name: str, info: FieldInfo) -> tuple[int, int]:
    low: int | None = None
    high: int | None = None
    for meta in info.metadata:
        if isinstance(meta, annotated_types.Ge):
            low = _as_int(name, meta.ge)
        elif isinstance(meta, annotated_types.Gt):
            low = _as_int(name, meta.gt) + 1
        elif isinstance(meta, annotated_types.Le):
            high = _as_int(name, meta.le)
        elif isinstance(meta, annotated_types.Lt):
            high = _as_int(name, meta.lt) - 1
    if low is None or high is None:
        raise UnsupportedFieldError(
            f"Field {name!r} is an int without both bounds; use Field(ge=0, le=4) to make it a Score."
        )
    levels = high - low + 1
    if not MIN_SCORE_LEVELS <= levels <= MAX_SCORE_LEVELS:
        raise UnsupportedFieldError(
            f"Field {name!r} spans {levels} levels; a Score needs {MIN_SCORE_LEVELS} to {MAX_SCORE_LEVELS}."
        )
    return low, high


def _score_field(name: str, info: FieldInfo, optional: bool) -> DecisionField:
    low, high = _bounds(name, info)
    described = _extra(info, "levels")
    count = high - low + 1
    if described is not None and (
        not isinstance(described, list) or len(described) != count
    ):
        raise UnsupportedFieldError(
            f"Field {name!r}: 'levels' must list exactly {count} descriptions."
        )
    criteria = (
        list(described)
        if described
        else [f"{name} = {v}" for v in range(low, high + 1)]
    )
    question = Score(
        instructions=_instructions(name, info),
        criteria=criteria,
        abstain=optional or None,
    )
    values = {str(i): low + i for i in range(count)}
    return DecisionField(name, "score", question, optional, values)


def _field_to_decision(name: str, info: FieldInfo) -> DecisionField | None:
    annotation, optional = _unwrap_optional(info.annotation)
    if typing.get_origin(annotation) is Literal:
        return _choice_field(name, info, typing.get_args(annotation), optional)
    if isinstance(annotation, type) and issubclass(annotation, enum.Enum):
        return _choice_field(name, info, list(annotation), optional)
    if annotation is bool:
        question = Noul(
            instructions=_instructions(name, info), abstain=optional or None
        )
        return DecisionField(name, "noul", question, optional)
    if annotation is int:
        return _score_field(name, info, optional)
    if not info.is_required():
        return None
    raise UnsupportedFieldError(
        f"Field {name!r} ({annotation!r}) is not a decision. The bridge answers Literal, Enum, bool "
        "and bounded int fields; give other fields a default or extract them with Instructor."
    )


def plan_decisions(response_model: type[BaseModel]) -> tuple[DecisionField, ...]:
    """Map every decision field of ``response_model`` to a question. Raises on unmappable fields."""
    plan = tuple(
        d
        for name, info in response_model.model_fields.items()
        if (d := _field_to_decision(name, info)) is not None
    )
    if not plan:
        raise UnsupportedFieldError(
            f"{response_model.__name__} has no decision fields to answer."
        )
    return plan


# ---------------------------------------------------------------------------
# Messages -> state
# ---------------------------------------------------------------------------


def _content_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = [
            p.get("text", "")
            for p in content
            if isinstance(p, dict) and p.get("type") == "text"
        ]
        return "\n".join(t for t in parts if t)
    return ""


def state_from_messages(messages: Sequence[Mapping[str, Any]]) -> str:
    """The text to judge. System prompts are instructions to an LLM, not input, so they are dropped."""
    turns = [
        (str(m.get("role", "user")), _content_text(m.get("content")))
        for m in messages
        if m.get("role") != "system"
    ]
    turns = [(role, text) for role, text in turns if text.strip()]
    if not turns:
        raise ValueError("messages contain no user or assistant text to judge.")
    if len(turns) == 1:
        return turns[0][1]
    return "\n".join(f"{role}: {text}" for role, text in turns)


# ---------------------------------------------------------------------------
# Answers -> model + report
# ---------------------------------------------------------------------------


def _answer_signals(
    d: DecisionField, answer: Any
) -> tuple[Any, float, dict[str, float]]:
    """(python value or NONE_LABEL, confidence, probabilities keyed by wire label)."""
    if isinstance(answer, NoulAnswer):
        p = float(answer.noul)
        return p >= 0.5, max(p, 1 - p), {"true": p, "false": 1 - p}
    if isinstance(answer, ChoiceAnswer):
        if answer.choice == NONE_LABEL:
            return NONE_LABEL, float(answer.confidence), dict(answer.probabilities)
        if answer.choice not in d.values:
            raise ValueError(
                f"Server returned unknown label {answer.choice!r} for field {d.name!r}."
            )
        return (
            d.values[answer.choice],
            float(answer.confidence),
            dict(answer.probabilities),
        )
    if isinstance(answer, ScoreAnswer):
        probs = {str(k): float(v) for k, v in answer.probabilities.items()}
        best = max(probs, key=lambda k: probs[k])
        return d.values.get(best, NONE_LABEL), float(answer.confidence), probs
    raise ValueError(f"Field {d.name!r} got no usable answer from the server.")


def build_result(
    response_model: type[ModelT],
    plan: Sequence[DecisionField],
    response: SystemOneResponse,
    extra_values: Mapping[str, Any] | None = None,
) -> tuple[ModelT, DecisionReport]:
    values: dict[str, Any] = dict(extra_values or {})
    confidence: dict[str, float] = {}
    probabilities: dict[str, Mapping[str, float]] = {}
    abstained: list[str] = []
    reasons: dict[str, str] = {}
    escalated: list[str] = []
    ood: dict[str, float] = {}
    for d in plan:
        answer = response.answers.get(d.name)
        value, conf, probs = _answer_signals(d, answer)
        confidence[d.name] = conf
        probabilities[d.name] = probs
        if answer is not None and answer.ood is not None:
            ood[d.name] = float(answer.ood)
        if answer is not None and answer.escalated:
            escalated.append(d.name)
        if (answer is not None and answer.abstained) or value == NONE_LABEL:
            abstained.append(d.name)
            reasons[d.name] = (
                answer.abstain_reason if answer is not None else None
            ) or "abstained"
            values[d.name] = None
        else:
            values[d.name] = value
    report = DecisionReport(
        confidence=confidence,
        probabilities=probabilities,
        abstained=tuple(abstained),
        abstain_reasons=reasons,
        escalated=tuple(escalated),
        ood=ood,
        response=response,
    )
    required = [d.name for d in plan if d.name in abstained and not d.optional]
    if required:
        raise AbstainedError(required, report)
    return response_model.model_validate(values), report


# ---------------------------------------------------------------------------
# Clients
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class _Call:
    state: Any
    questions: dict[str, Choice | Noul | Score]
    options: dict[str, Any]


def _prepare(
    response_model: type[BaseModel],
    messages: Sequence[Mapping[str, Any]] | None,
    state: Any,
    options: Mapping[str, Any],
) -> tuple[tuple[DecisionField, ...], _Call]:
    if (messages is None) == (state is None):
        raise ValueError("Pass exactly one of `messages` or `state`.")
    plan = plan_decisions(response_model)
    resolved_state = state if state is not None else state_from_messages(messages or [])
    known = {
        "model",
        "calibration_id",
        "abstain",
        "abstain_below",
        "escalate_below",
        "timeout",
        "retry",
    }
    unknown = set(options) - known
    if unknown:
        raise TypeError(f"Unsupported option(s): {', '.join(sorted(unknown))}.")
    kwargs = {k: v for k, v in options.items() if v is not None}
    return plan, _Call(resolved_state, {d.name: d.question for d in plan}, kwargs)


class _Completions:
    def __init__(self, owner: Any) -> None:
        self.create = owner.create
        self.create_with_confidence = owner.create_with_confidence


class _Chat:
    def __init__(self, owner: Any) -> None:
        self.completions = _Completions(owner)


class OpenJevInstructor:
    """Sync bridge. ``client.chat.completions.create`` mirrors Instructor's call shape."""

    def __init__(self, client: TypeSafeClient) -> None:
        self.client = client
        self.chat = _Chat(self)

    def create_with_confidence(
        self,
        response_model: type[ModelT],
        messages: Sequence[Mapping[str, Any]] | None = None,
        *,
        state: Any = None,
        **options: Any,
    ) -> tuple[ModelT, DecisionReport]:
        plan, call = _prepare(response_model, messages, state, options)
        response = self.client.system_one(call.state, call.questions, **call.options)
        return build_result(response_model, plan, response)

    def create(
        self,
        response_model: type[ModelT],
        messages: Sequence[Mapping[str, Any]] | None = None,
        *,
        state: Any = None,
        **options: Any,
    ) -> ModelT:
        return self.create_with_confidence(
            response_model, messages, state=state, **options
        )[0]


class AsyncOpenJevInstructor:
    """Async bridge over ``AsyncTypeSafeClient``."""

    def __init__(self, client: AsyncTypeSafeClient) -> None:
        self.client = client
        self.chat = _Chat(self)

    async def create_with_confidence(
        self,
        response_model: type[ModelT],
        messages: Sequence[Mapping[str, Any]] | None = None,
        *,
        state: Any = None,
        **options: Any,
    ) -> tuple[ModelT, DecisionReport]:
        plan, call = _prepare(response_model, messages, state, options)
        response = await self.client.system_one(
            call.state, call.questions, **call.options
        )
        return build_result(response_model, plan, response)

    async def create(
        self,
        response_model: type[ModelT],
        messages: Sequence[Mapping[str, Any]] | None = None,
        *,
        state: Any = None,
        **options: Any,
    ) -> ModelT:
        result = await self.create_with_confidence(
            response_model, messages, state=state, **options
        )
        return result[0]


def from_openjev(
    client: TypeSafeClient | None = None, **client_kwargs: Any
) -> OpenJevInstructor:
    """Wrap an OpenJev client (or build one from ``OPENJEV_*`` env vars and ``client_kwargs``)."""
    return OpenJevInstructor(
        client if client is not None else TypeSafeClient(**client_kwargs)
    )


def from_openjev_async(
    client: AsyncTypeSafeClient | None = None, **client_kwargs: Any
) -> AsyncOpenJevInstructor:
    return AsyncOpenJevInstructor(
        client if client is not None else AsyncTypeSafeClient(**client_kwargs)
    )
