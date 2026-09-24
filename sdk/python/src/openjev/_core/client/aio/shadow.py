"""Shadow-mode resource for the asynchronous client, exposed as `AsyncTypeSafeClient.shadow`."""

from collections.abc import Mapping
from typing import Any

import httpx2
from tenacity import AsyncRetrying

from openjev._core.config import Config
from openjev._core.endpoints import prepare_shadow_run, prepare_shadow_summary
from openjev._core.json_types import JSONContent
from openjev._core.question_types import Question
from openjev._core.response_types import ShadowResult, ShadowSummary
from openjev._core.retry import RetryPolicy
from openjev._core.transport import send_async


class AsyncShadow:
    """Run OpenJev next to your production LLM (or human labels) and log agreement."""

    def __init__(
        self, config: Config, http_client: httpx2.AsyncClient, retry: AsyncRetrying
    ) -> None:
        self._config = config
        self._http_client = http_client
        self._retry = retry

    async def run(
        self,
        state: JSONContent,
        questions: Mapping[str, Question],
        *,
        incumbent: Mapping[str, Any] | None = None,
        model: str | None = None,
        calibration_id: str | None = None,
        retry: RetryPolicy | None = None,
        timeout: float | httpx2.Timeout | None = None,
        extra_headers: Mapping[str, str] | None = None,
    ) -> ShadowResult:
        """Compare OpenJev's answers with the incumbent's for one request.

        Args:
            state: Text, a JSON object, or an array to evaluate.
            questions: Nonempty mapping of names to question objects or raw dictionaries.
            incumbent: `{"name", "kind", "answers", "latency_ms", "usage"}`. `answers` maps question
                ids to a choice key, score level index, or noul boolean from your production LLM;
                `kind="label"` marks them as human ground truth. Omit `answers` to let the server
                ask its own configured LLM.
            model: Model override; `None` inherits the client default.
            calibration_id: Apply a calibration and feed its drift monitor.
            retry: Retry policy override for this call.
            timeout: Timeout override for this call, in seconds.
            extra_headers: Additional request headers.

        Returns:
            The comparison per question, agreement, and OpenJev's own answers.
        """
        return await send_async(
            self._http_client,
            self._retry,
            prepare_shadow_run(
                self._config,
                state,
                questions,
                model,
                {"calibration_id": calibration_id},
                incumbent,
                timeout,
                extra_headers,
            ),
            retry,
        )

    async def summary(
        self,
        *,
        days: int | None = None,
        threshold: float | None = None,
        incumbent: str | None = None,
        retry: RetryPolicy | None = None,
        timeout: float | httpx2.Timeout | None = None,
        extra_headers: Mapping[str, str] | None = None,
    ) -> ShadowSummary:
        """Aggregated agreement, confidence bands, disagreements and projected savings."""
        return await send_async(
            self._http_client,
            self._retry,
            prepare_shadow_summary(
                self._config, days, threshold, incumbent, timeout, extra_headers
            ),
            retry,
        )
