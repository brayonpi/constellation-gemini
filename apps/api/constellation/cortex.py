from __future__ import annotations

import asyncio
import random
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from typing import Any, Literal
from urllib.parse import urljoin

import httpx

from .config import Settings
from .digests import sha256_digest


class CortexError(RuntimeError):
    """Base class for public Cortex adapter failures."""


class CortexUnavailable(CortexError):
    """The public service could not be reached within the declared retry budget."""


class CortexContractRejected(CortexError):
    """The public API rejected a malformed or unsupported contract."""


@dataclass(frozen=True)
class CortexResponse:
    body: dict[str, Any]
    latency_ms: int
    retry_count: int
    request_digest: str


class CortexClient:
    """Adapter for the documented public HTTPS contract.

    It performs the free analysis preflight, submits exactly once, and follows the
    polling URL returned by the accepted request without reconstructing the job.
    """

    _commands: frozenset[str] = frozenset({"cover", "qap"})

    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None):
        self.settings = settings
        self._client = client

    async def solve(
        self,
        command: Literal["cover", "qap"],
        problem: dict[str, Any],
        *,
        idempotency_key: str,
        seed: int = 4242,
        max_latency_ms: int = 120_000,
        effort: Literal["flash", "medium", "high"] | None = None,
    ) -> CortexResponse:
        if command not in self._commands:
            raise ValueError("Constellation permits only the cover and qap public contracts")
        if not self.settings.live_cortex_available:
            raise CortexUnavailable("HexStellar HTTPS credentials are not configured")

        assert self.settings.hexstellar_api_url and self.settings.hexstellar_api_key
        base = self.settings.hexstellar_api_url.rstrip("/") + "/"
        payload = {**problem, "tag": "hexstellar-cortex-v1"}
        if not str(payload.get("description", "")).strip():
            raise CortexContractRejected("Cortex contracts require a public description")
        chosen_effort = effort or (
            self.settings.cortex_cover_effort if command == "cover" else self.settings.cortex_qap_effort
        )
        params = {
            "effort": chosen_effort,
            "seed": str(seed),
            "version": self.settings.cortex_model,
            "max_latency_ms": str(max_latency_ms),
        }
        headers = {
            "Authorization": f"Bearer {self.settings.hexstellar_api_key}",
            "Content-Type": "application/json",
            "Idempotency-Key": idempotency_key,
        }
        owns_client = self._client is None
        client = self._client or httpx.AsyncClient(timeout=httpx.Timeout(40, connect=10))
        started = time.perf_counter()
        retry_count = 0
        try:
            analysis, retries = await self._request_with_retry(
                client,
                "POST",
                urljoin(base, f"api/v1/analyze/{command}"),
                headers=headers,
                params=params,
                json=payload,
            )
            retry_count += retries
            if analysis.status_code >= 400:
                raise CortexContractRejected(self._problem_detail("analysis preflight", analysis))

            response, retries = await self._request_with_retry(
                client,
                "POST",
                urljoin(base, f"api/v1/solve/{command}"),
                headers=headers,
                params=params,
                json=payload,
            )
            retry_count += retries
            body = self._json_object(response)
            if response.status_code == 200:
                result = body
            elif response.status_code == 202:
                poll_url = body.get("poll")
                if not isinstance(poll_url, str) or not poll_url:
                    raise CortexContractRejected("queued Cortex response omitted its poll URL")
                result, poll_retries = await self._poll_accepted_job(
                    client=client,
                    accepted_url=str(response.url),
                    poll_url=poll_url,
                    authorization=headers["Authorization"],
                    deadline=time.monotonic() + max_latency_ms / 1000,
                    job_id=str(body.get("job_id", "unknown")),
                )
                retry_count += poll_retries
            else:
                raise CortexContractRejected(self._problem_detail("solve request", response))
            return CortexResponse(
                body=result,
                latency_ms=round((time.perf_counter() - started) * 1000),
                retry_count=retry_count,
                request_digest=sha256_digest(payload),
            )
        finally:
            if owns_client:
                await client.aclose()

    async def _poll_accepted_job(
        self,
        *,
        client: httpx.AsyncClient,
        accepted_url: str,
        poll_url: str,
        authorization: str,
        deadline: float,
        job_id: str,
    ) -> tuple[dict[str, Any], int]:
        literal_poll_url = urljoin(accepted_url, poll_url)
        retries_total = 0
        while time.monotonic() < deadline:
            response, retries = await self._request_with_retry(
                client,
                "GET",
                literal_poll_url,
                headers={"Authorization": authorization},
            )
            retries_total += retries
            if response.status_code >= 400:
                raise CortexContractRejected(self._problem_detail("job poll", response))
            body = self._json_object(response)
            status = body.get("status")
            if status == "done":
                result = body.get("result")
                if not isinstance(result, dict):
                    raise CortexContractRejected("completed Cortex job omitted a result object")
                return result, retries_total
            if status in {"failed", "cancelled"}:
                raise CortexContractRejected(f"Cortex job {job_id} ended with status {status}")
            if status is None and "answer" in body:
                return body, retries_total
            await asyncio.sleep(min(0.5, max(0, deadline - time.monotonic())))
        raise CortexUnavailable(f"Cortex job exceeded the declared latency budget; job_id={job_id}")

    async def _request_with_retry(
        self, client: httpx.AsyncClient, method: str, url: str, **kwargs: Any
    ) -> tuple[httpx.Response, int]:
        last_error: Exception | None = None
        for attempt in range(4):
            try:
                response = await client.request(method, url, **kwargs)
                conflict_in_progress = False
                if response.status_code == 409:
                    conflict_in_progress = (
                        self._json_object(response).get("code") == "HXS_IDEMPOTENCY_IN_PROGRESS"
                    )
                retryable = (
                    response.status_code in {408, 425, 429}
                    or response.status_code >= 500
                    or conflict_in_progress
                )
                if not retryable:
                    return response, attempt
                if attempt == 3:
                    raise CortexUnavailable(self._problem_detail("request retry budget", response))
                delay = self._retry_delay(response.headers.get("Retry-After"), attempt)
                if conflict_in_progress:
                    delay = max(delay, 1.0)
            except (httpx.TimeoutException, httpx.NetworkError) as exc:
                last_error = exc
                if attempt == 3:
                    break
                delay = min(2**attempt, 30)
            await asyncio.sleep(delay + random.SystemRandom().uniform(0, 0.25))
        raise CortexUnavailable(f"Cortex transport failed after bounded retries: {type(last_error).__name__}")

    @staticmethod
    def _retry_delay(value: str | None, attempt: int) -> float:
        if value:
            try:
                return min(max(float(value), 0), 120)
            except ValueError:
                try:
                    retry_at = parsedate_to_datetime(value)
                    if retry_at.tzinfo is None:
                        retry_at = retry_at.replace(tzinfo=UTC)
                    return min(max((retry_at - datetime.now(UTC)).total_seconds(), 0), 120)
                except (TypeError, ValueError, OverflowError):
                    pass
        return float(min(2**attempt, 30))

    @staticmethod
    def _json_object(response: httpx.Response) -> dict[str, Any]:
        try:
            value = response.json()
        except ValueError as exc:
            raise CortexContractRejected(f"Cortex returned non-JSON HTTP {response.status_code}") from exc
        if not isinstance(value, dict):
            raise CortexContractRejected("Cortex returned a non-object JSON response")
        return value

    @classmethod
    def _problem_detail(cls, operation: str, response: httpx.Response) -> str:
        try:
            body = cls._json_object(response)
            detail = body.get("detail") or body.get("title") or body.get("code") or "request rejected"
        except CortexContractRejected:
            detail = "non-JSON response"
        return f"Cortex {operation} failed with HTTP {response.status_code}: {detail}"
