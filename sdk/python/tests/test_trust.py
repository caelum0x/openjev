"""Trust-layer fields (calibration, abstain / out-of-scope, auto model) and the shadow resource."""

import json
from typing import Any

import httpx2
import pytest

from openjev import AsyncTypeSafeClient, Choice, TypeSafeClient, TypeSafeError
from tests.conftest import ClientFactory

ANSWER: dict[str, Any] = {
    "model": "auto",
    "answers": {
        "intent": {
            "type": "choice",
            "choice": "__none__",
            "confidence": 0.2,
            "probabilities": {"refund": 0.1, "status": 0.1, "__none__": 0.8},
            "ood": 0.91,
            "abstained": True,
            "abstain_reason": "out_of_scope",
            "calibrated": True,
        }
    },
    "usage": {"input_tokens": 3, "output_tokens": 0},
    "latency_ms": 4,
    "calibration": {"id": "cal_abc123", "method": "isotonic", "questions": ["intent"]},
    "escalation": {
        "local_model": "otsone-1",
        "escalated": [],
        "kept": ["intent"],
        "threshold": 0.6,
        "provider": None,
        "llm_model": None,
    },
}

QUESTIONS = {
    "intent": Choice(
        instructions="Intent?",
        criteria={"refund": None, "status": None},
        abstain=True,
        abstain_below=0.4,
    )
}


async def _call(client: TypeSafeClient | AsyncTypeSafeClient, **kwargs: Any) -> Any:
    result = client.system_one("weather on mars", QUESTIONS, **kwargs)
    return await result if isinstance(client, AsyncTypeSafeClient) else result


async def test_trust_request_fields_and_answer_fields(clients: ClientFactory) -> None:
    sent: list[dict[str, Any]] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        sent.append(json.loads(request.content))
        return httpx2.Response(200, json=ANSWER)

    client = clients(handler)
    result = await _call(
        client, model="auto", calibration_id="cal_abc123", escalate_below=0.6
    )
    body = sent[0]
    assert body["model"] == "auto"
    assert body["calibration_id"] == "cal_abc123"
    assert body["escalate_below"] == 0.6
    assert "abstain" not in body
    assert body["questions"]["intent"]["abstain"] is True
    assert body["questions"]["intent"]["abstain_below"] == 0.4
    answer = result.choices["intent"]
    assert answer.abstained is True
    assert answer.abstain_reason == "out_of_scope"
    assert answer.ood == 0.91
    assert result.calibration is not None and result.calibration.questions == (
        "intent",
    )
    assert result.escalation is not None and result.escalation.kept == ("intent",)


async def test_trust_fields_are_validated_client_side(clients: ClientFactory) -> None:
    client = clients(lambda _: httpx2.Response(200, json=ANSWER))
    with pytest.raises(TypeSafeError):
        await _call(client, calibration_id="not-a-calibration")
    with pytest.raises(TypeSafeError):
        await _call(client, abstain_below=1.5)
    with pytest.raises(ValueError):
        Choice.model_validate(
            {"instructions": "x", "criteria": {"a": None}, "abstain_below": 2}
        )


async def test_shadow_run_and_summary(clients: ClientFactory) -> None:
    sent: list[httpx2.Request] = []
    result: dict[str, Any] = {
        "batch_id": "shb_1",
        "incumbent": {"name": "humans", "source": "caller", "kind": "label"},
        "calibration_id": "cal_abc123",
        "ours": ANSWER,
        "comparisons": [
            {
                "question_id": "intent",
                "qtype": "choice",
                "ours": "__none__",
                "incumbent": "refund",
                "agree": False,
                "confidence": 0.2,
                "ood": 0.91,
            }
        ],
        "agreement": 0,
    }
    summary: dict[str, Any] = {
        "window_days": 7,
        "threshold": 0.8,
        "total": 1,
        "agreed": 0,
        "agreement": 0,
        "incumbents": ["humans"],
        "by_question": [],
        "by_confidence": [],
        "above_threshold": {"n": 0, "share": 0, "agreement": None},
        "disagreements": [],
        "savings": {
            "incumbent_input_tokens": 0,
            "incumbent_output_tokens": 0,
            "incumbent_cost_usd": 0,
            "projected_savings_usd": 0,
            "price_in_usd_per_mtok": 0.4,
            "price_out_usd_per_mtok": 1.6,
            "price_source": "default",
        },
    }

    def handler(request: httpx2.Request) -> httpx2.Response:
        sent.append(request)
        return httpx2.Response(
            200, json={"data": result if request.method == "POST" else summary}
        )

    client = clients(handler)
    incumbent = {"name": "humans", "kind": "label", "answers": {"intent": "refund"}}
    if isinstance(client, AsyncTypeSafeClient):
        run = await client.shadow.run(
            "refund me", QUESTIONS, incumbent=incumbent, calibration_id="cal_abc123"
        )
        stats = await client.shadow.summary(days=7, threshold=0.8)
    else:
        run = client.shadow.run(
            "refund me", QUESTIONS, incumbent=incumbent, calibration_id="cal_abc123"
        )
        stats = client.shadow.summary(days=7, threshold=0.8)
    assert sent[0].url.path == "/v1/shadow"
    assert json.loads(sent[0].content)["incumbent"]["kind"] == "label"
    assert run.incumbent.kind == "label"
    assert run.comparisons[0].agree is False
    assert run.ours.answers["intent"].abstained is True
    assert sent[1].method == "GET"
    assert sent[1].url.query == b"days=7&threshold=0.8"
    assert stats.total == 1 and stats.savings.price_source == "default"


async def test_shadow_rejects_unknown_incumbent_kind(clients: ClientFactory) -> None:
    client = clients(lambda _: httpx2.Response(200, json={}))
    with pytest.raises(TypeSafeError):
        if isinstance(client, AsyncTypeSafeClient):
            await client.shadow.run("x", QUESTIONS, incumbent={"kind": "oracle"})
        else:
            client.shadow.run("x", QUESTIONS, incumbent={"kind": "oracle"})
