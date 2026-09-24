# OpenJev Python SDK

`openjev` is an open Python client for OpenJev — a self-hostable decision engine
that speaks the same **System One** `/v1` wire protocol as the upstream TypeSafe AI API, so a
single client works unchanged against:

- a **self-hosted OpenJev** deployment (default base URL: `http://localhost:8080`)
- the hosted **TypeSafe AI API** at `https://api.typesafe.ai`

This SDK is derived from [`@typesafe-ai/typesafe-sdk-python`](https://github.com/typesafe-ai/typesafe-sdk-python) (MIT).
See [`NOTICE`](./NOTICE) for attribution.  The request/response shapes (`model` + `state` +
questions-as-`dict`) and the public class names (`TypeSafeClient`, `AsyncTypeSafeClient`, …) are
kept identical so existing TypeSafe code is drop-in compatible.

## Quickstart

Install the SDK:

> Not published to PyPI. Note that the PyPI name `openjev` currently belongs to an
> unrelated project, so do not `pip install openjev`. Install from a clone instead:

```
git clone https://github.com/caelum0x/openjev
pip install ./openjev/sdk/python
# or: uv add ./openjev/sdk/python
```

Set `OPENJEV_API_KEY` (and optionally `OPENJEV_BASE_URL`) in your environment, then
instantiate and use the client:

```python
from openjev import Choice, TypeSafeClient

with TypeSafeClient() as client:
    response = client.system_one(
        state={"document": "I was charged twice. Please fix this ASAP."},
        questions={
            "category": Choice(
                instructions="What is this ticket about?",
                criteria={"billing": None, "technical": None, "other": None},
            ),
        },
    )

print(response.choices["category"].choice)
```

## Configuration

Point the SDK at a self-hosted OpenJev endpoint or the upstream TypeSafe AI API by setting
environment variables or passing arguments to the client constructor.

| Purpose            | Primary (OpenJev)           | Back-compat alias (legacy)  |
| ------------------ | -------------------------------- | --------------------------- |
| API key            | `OPENJEV_API_KEY`           | `TYPESAFE_API_KEY`          |
| Base URL           | `OPENJEV_BASE_URL`          | `TYPESAFE_BASE_URL`         |
| Default model      | `OPENJEV_DEFAULT_MODEL`     | `TYPESAFE_DEFAULT_MODEL`    |
| Log level          | `OPENJEV_LOG_LEVEL`         | `TYPESAFE_LOG_LEVEL`        |

The primary `OPENJEV_*` variable is checked first; the `TYPESAFE_*` alias is consulted only
when the primary variable is absent so that callers already using `TYPESAFE_*` continue to work
without changes.

Default base URL when no variable is set: `http://localhost:8080`.

Example — point at a self-hosted deployment:

```bash
export OPENJEV_BASE_URL="https://systemone.internal.example.com"
export OPENJEV_API_KEY="your-self-hosted-key"
```

Example — point at the upstream TypeSafe AI API using the back-compat alias:

```bash
export TYPESAFE_BASE_URL="https://api.typesafe.ai"
export TYPESAFE_API_KEY="ts_live_..."
```

```python
from openjev import TypeSafeClient

# Explicit override also works and takes precedence over the environment:
client = TypeSafeClient(
    base_url="https://systemone.internal.example.com", api_key="..."
)
```

## Trust layer (OpenJev servers)

```python
from openjev import Choice, TypeSafeClient

with TypeSafeClient() as client:
    questions = {
        "intent": Choice(
            instructions="What does the customer want?",
            criteria={"refund": None, "status": None},
            abstain=True,
        )
    }
    result = client.system_one(
        "Where is my order?",
        questions,
        model="auto",                 # local first, LLM only for low-confidence questions
        calibration_id="cal_...",     # confidence fitted on your own labels
    )
    intent = result.choices["intent"]
    if intent.abstained:
        print("out of scope", intent.ood)

    # Shadow mode: compare with your production LLM or human labels.
    client.shadow.run(
        "Where is my order?",
        questions,
        incumbent={"kind": "label", "answers": {"intent": "status"}},
    )
    summary = client.shadow.summary(days=7)
```

## License

MIT — see [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE).
