# openjev-adapters

A drop-in replacement for `typesafe_sdk`'s `system_one` evaluation API, backed by LLM
APIs. It runs typed System One decisions (producing `Choice` / `Score` / `Noul`
answers) through OpenAI, Anthropic, or Gemini — no server required.

Part of the **OpenJev** ecosystem. It stays wire-compatible with both the hosted
TypeSafe API (`https://api.typesafe.ai/v1`) and a self-hosted OpenJev deployment,
which share the `/v1/systemone` contract: the request/response shapes (`model` +
`state` + `questions` as a **dict**) are unchanged, so it remains a straight drop-in for
`typesafe_sdk`.

Useful for comparing OpenJev against an LLM on cost/speed/intelligence, or for running
System One decisions entirely against your own models.

> Based on [`@typesafe-ai/system-one-adapter-python`](https://github.com/typesafe-ai/system-one-adapter-python)
> (MIT). See [NOTICE](NOTICE) for changes.

## Install

The provider SDKs are optional extras — install the one(s) you use:

> Not published to PyPI yet. Install from a clone of this repository, e.g.
> `pip install './openjev/adapters/python[openai]'`. The published form will be:

```bash
pip install 'openjev-adapters[openai]'      # OpenAI-compatible providers
pip install 'openjev-adapters[anthropic]'   # native Anthropic
pip install 'openjev-adapters[gemini]'      # native Gemini
```

## Usage

Unlike `TypeSafeClient`, the client is configured with how the LLM should answer, and
each call names a `provider` alongside the `model`:

```python
from openjev_adapters import SystemOneAdapterClient, Noul, Score, Choice

client = SystemOneAdapterClient(
    structured_outputs=True,  # use the provider's native structured-output mode
    llm_answer_mode="probabilities",  # or "discrete"
    normalize_probabilities=True,
)

response = client.system_one(
    state="This book was a delight to read.",
    questions={"positive": Noul(instructions="The book review is positive.")},
    provider="openai",  # "openai", "anthropic", or "gemini"
    model="gpt-4o-mini",
)
```

`provider` and `model` may also be set on the constructor as defaults. `provider`
is required unless `model` is a provider instance (e.g. a custom OpenAI-compatible
endpoint or a Gemini client):

```python
from openjev_adapters.providers.openai import OpenAIProvider

client.system_one(state, questions, model=OpenAIProvider("grok-4", base_url="https://api.x.ai/v1"))
```

Use clients as context managers (`with` / `async with`), or call `close()` /
`await aclose()` after all evaluations finish. The adapter closes providers it
creates; provider instances passed as `model` remain caller-owned.

### Endpoint configuration

The adapter is wire-compatible with the shared `/v1/systemone` contract, so the same
code can target the hosted TypeSafe API or a self-hosted OpenJev deployment. The
base URL and credential are resolved from the environment, with an explicit argument
always taking precedence:

| Setting | Precedence |
| --- | --- |
| Base URL | argument → `OPENJEV_BASE_URL` → `TYPESAFE_BASE_URL` → `http://localhost:8080/v1` |
| API key | argument → `OPENJEV_API_KEY` → `TYPESAFE_API_KEY` |

```python
from openjev_adapters import resolve_base_url, resolve_api_key
from openjev_adapters.providers import build_endpoint_provider

# Defaults to localhost; set OPENJEV_BASE_URL to point at any openjev host.
resolve_base_url()  # "http://localhost:8080/v1" unless overridden

# Point at a remote openjev host with:  export OPENJEV_BASE_URL=http://your-host/v1
provider = build_endpoint_provider("gpt-4o-mini")  # OpenAI-compatible, env-resolved
client.system_one(state, questions, model=provider)
```

`build_endpoint_provider` (and `build_async_endpoint_provider`) build an
OpenAI-compatible provider aimed at the resolved endpoint; pass `base_url=` / `api_key=`
to override the environment explicitly. `resolve_base_url` / `resolve_api_key` expose the
same resolution for custom wiring.

OpenAI's endpoint uses the Responses API, with strict JSON Schema for structured
output and JSON mode for prompted output. Custom endpoints (including
`OPENAI_BASE_URL`) default to Chat Completions. Pass `api="responses"` or
`api="chat_completions"` to `OpenAIProvider` / `AsyncOpenAIProvider` to select
explicitly, for example when using an OpenAI proxy. Responses are requested with
`store=False`; corrective retries send the conversation history with each request.

Gemini uses the Interactions API. Structured mode sets `response_format` to JSON
Schema; prompted mode leaves the schema in the system prompt. Requests use
`store=False` and send the full conversation on corrective retries. Credentials
come from `GEMINI_API_KEY` or `GOOGLE_API_KEY`, or `api_key=` on
`GeminiProvider` / `AsyncGeminiProvider`.

For larger Anthropic evaluations, configure the output token limit on the provider
(default: 4,096 tokens):

```python
from openjev_adapters.providers.anthropic import AnthropicProvider

client.system_one(state, questions, model=AnthropicProvider("claude-haiku-4-5", max_tokens=8192))
```

`AsyncAnthropicProvider` accepts the same option. A response that reaches the limit
raises `typesafe_sdk.TypeSafeError` with instructions to increase `max_tokens` or
request fewer questions; it does not consume malformed-output retries.

Provider-declared refusals and incomplete generations, including Anthropic context
overflow, also raise `TypeSafeError` without corrective retries. The error names the
reason and preserves the full provider response in `error.debug["llm_attempts"]`.

### Response

The response is a `typesafe_sdk.SystemOneResponse` subclass — same `answers` and typed
views — with two additions:

- `response.usage` adds `input_tokens_total` / `output_tokens_total` (across retries),
  `n_retries`, `n_retries_malformed_structure`, and `latency`.
- `response.debug` holds `llm_attempts`, `retry_reasons`, and probability-normalization
  diagnostics.

OpenAI-compatible endpoints may omit token usage. Unreported counts are `None`;
the evaluation still succeeds. A cumulative token count is `None` if any attempt
omitted that count. Reported counts, including zero, are preserved.

`llm_attempts` records every provider call in order, including transient failures and
malformed responses. Each entry contains a snapshot of `messages`,
`model_request_parameters` (`schema` and `structured`), `llm_response`, and `debug_info`
with the model, provider, and any error. The built-in providers also include the exact
SDK `request` arguments, the full provider response in `llm_response`, and the API and
finish reason in `debug_info`. Custom providers return their text and token counts in
`llm_response`. Calls that fail before returning a model response leave it as `None`.
Terminal `TypeSafeError` exceptions expose the same attempt history in `error.debug`.

To replay an attempt through the same configured provider (use `await` for async):

```python
from openjev_adapters.providers import Message

attempt = response.debug["llm_attempts"][0]
result = provider.request(
    [Message(**message) for message in attempt["messages"]],
    **attempt["model_request_parameters"],
)
```

It is a Pydantic model like every SDK response in `typesafe-sdk>=0.7.0`, so use
`model_dump()` for a dictionary or `model_dump_json()` for JSON:

```python
print(response.model_dump_json())
```

### Async

`AsyncSystemOneAdapterClient` mirrors the sync client with `await client.system_one(...)`
and `async with`.

## Options

| Option | Meaning |
| --- | --- |
| `structured_outputs` | Use the provider's native structured output, else prompt for JSON and validate client-side (works with any chat model). |
| `llm_answer_mode` | `"probabilities"` (per-label distribution) or `"discrete"` (one value per question). |
| `normalize_probabilities` | Rescale invalid LLM probability distributions to sum to 1. |
| `n_retry_malformed_structure` | Corrective retries when the model's output fails schema validation. |
| `retry` | `typesafe_sdk.RetryPolicy` for transient provider failures. |

The transient retry count and time budget apply separately to each provider request.
Corrective requests share the evaluation's `n_retry_malformed_structure` allowance
and preserve the earlier responses and correction messages.

## Instructor bridge: confidence for `response_model=`

If you already describe decisions as Pydantic models for
[Instructor](https://python.useinstructor.com/), `openjev_adapters.instructor` answers the
same model through an OpenJev server and hands back the confidence behind every field.
Nothing is generated, so the model always validates.

```python
from openjev_adapters.instructor import from_openjev
client = from_openjev()  # reads OPENJEV_BASE_URL / OPENJEV_API_KEY
ticket, report = client.chat.completions.create_with_confidence(response_model=Ticket, messages=messages)
```

```python
from typing import Literal
from pydantic import BaseModel, Field

class Ticket(BaseModel):
    category: Literal["refund", "cancel", "billing"] = Field(description="Main request")
    urgent: bool
    severity: int = Field(ge=0, le=3, json_schema_extra={"levels": ["none", "low", "high", "critical"]})
    topic: Literal["shipping", "account"] | None = None   # may abstain -> None

report.confidence["category"]     # confidence of the chosen label (fitted to your labels with calibration_id)
report.probabilities["category"]  # full distribution over the options
report.abstained                  # fields that said "I don't know", e.g. ("topic",)
report.escalated                  # fields the `auto` model re-asked to an LLM
```

| Pydantic field | Question | Value |
| --- | --- | --- |
| `Literal[...]`, `str`/`int` `Enum` | `Choice` | the chosen option |
| `bool` | `Noul` | `True` when P(yes) >= 0.5 |
| `int` with `ge`/`gt` and `le`/`lt` (2 to 10 levels) | `Score` | the most likely level |
| `X \| None` | same, with abstention on | `None` when the answer abstains |

Other fields must have a default and are left at it; a required free-text field raises
`UnsupportedFieldError` so you can keep extracting it with Instructor. A required field
that abstains raises `AbstainedError` (with `.report`) rather than guessing.

Options pass straight to `/v1/systemone`: `model="auto"` (local first, LLM only when unsure),
`calibration_id="cal_..."` (a map fitted on your labels), `abstain_below=0.5`,
`escalate_below`, `timeout`, `retry`. `client.create(...)` returns only the model;
`from_openjev_async()` gives the same API with `await`. System messages are treated as
LLM instructions and are not part of the judged text.
