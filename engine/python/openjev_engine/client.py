from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping
from urllib.request import Request, urlopen

from .engine import run_local


@dataclass
class Noul:
    instructions: str
    true: str | None = None
    false: str | None = None

    def to_question(self) -> dict:
        q: dict[str, Any] = {"type": "noul", "instructions": self.instructions}
        if self.true is not None or self.false is not None:
            q["criteria"] = {"true": self.true, "false": self.false}
        return q


@dataclass
class Choice:
    instructions: str
    criteria: Mapping[str, str | None]

    def to_question(self) -> dict:
        return {
            "type": "choice",
            "instructions": self.instructions,
            "criteria": dict(self.criteria),
        }


@dataclass
class Score:
    instructions: str
    criteria: list[str]

    def to_question(self) -> dict:
        return {
            "type": "score",
            "instructions": self.instructions,
            "criteria": list(self.criteria),
        }


Question = Noul | Choice | Score | dict


def _normalize(questions: Mapping[str, Question]) -> dict[str, dict]:
    out = {}
    for k, v in questions.items():
        if hasattr(v, "to_question"):
            out[k] = v.to_question()  # type: ignore[union-attr]
        else:
            out[k] = v  # type: ignore[assignment]
    return out


class SystemOne:
    def __init__(
        self,
        model: str = "system-one",
        base_url: str | None = None,
        api_key: str | None = None,
    ):
        self.model = model
        self.base_url = base_url.rstrip("/") if base_url else None
        self.api_key = api_key

    def ask(self, state: Any, questions: Mapping[str, Question]) -> dict:
        req = {
            "model": self.model,
            "state": state,
            "questions": _normalize(questions),
        }
        if not self.base_url:
            return run_local(req, self.model)
        data = __import__("json").dumps(req).encode("utf-8")
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        r = Request(self.base_url + "/v1/systemone", data=data, headers=headers, method="POST")
        with urlopen(r) as resp:
            return __import__("json").loads(resp.read().decode("utf-8"))


def ask(state: Any, questions: Mapping[str, Question], **kwargs: Any) -> dict:
    return SystemOne(**kwargs).ask(state, questions)
