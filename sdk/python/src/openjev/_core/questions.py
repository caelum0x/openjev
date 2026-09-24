"""Question validation before JSON encoding."""

from collections.abc import Mapping, Sequence

from openjev._core.errors import TypeSafeError
from openjev._core.json_types import JSONContent
from openjev._core.question_types import Choice, Noul, Question, Score


def normalize_questions(questions: Mapping[str, Question]) -> dict[str, Question]:
    if not questions:
        raise TypeSafeError("At least one question is required.")
    for name, question in questions.items():
        if isinstance(question, Score):
            _validate_score_criteria(name, question.criteria)
        elif not isinstance(question, (Noul, Choice)):
            if (
                not isinstance(question, dict)
                or not isinstance(question.get("type"), str)
                or not question["type"]
            ):
                raise TypeSafeError(
                    f'Question "{name}" must be a question object or a dictionary with a nonempty string "type".'
                )
            if question["type"] in ("choice", "score") and "criteria" not in question:
                raise TypeSafeError(f'Question "{name}" requires "criteria".')
            if question["type"] == "score":
                _validate_score_criteria(name, question["criteria"])
    return dict(questions)


def _validate_score_criteria(name: str, criteria: Sequence[JSONContent]) -> None:
    """Reject a score question with fewer than two criteria; at least two scores are required."""
    if len(criteria) < 2:
        raise TypeSafeError(
            f'Score question "{name}" has {len(criteria)} criteria; at least two scores are required.'
        )
