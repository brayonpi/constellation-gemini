from __future__ import annotations

import asyncio
import random
from typing import Any
from urllib.parse import urljoin

import httpx

from .config import Settings


class CortexError(RuntimeError):
    pass


class CortexUnavailable(CortexError):
    pass


class CortexClient:
    """Thin public HTTPS adapter with durable idempotency and 202 polling."""

    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None):
        self.settings = settings
        self._client = client

    async def solve(
        self,
        command: str,
        problem: dict[str, Any],
        *,
        idempotency_key: str,
        seed: int = 4242,
        max_latency_ms: int = 120_000,
    ) -> dict[str, Any]:
        if command not in {"cover", "qap"}:
            raise ValueError("Constellation permits only the cover and qap public contracts")
        if not self.settings.live_cortex_available:
            raise CortexUnavailable("HexStellar HTTPS credentials are not configured")
        assert self.settings.hexstellar_api_url and self.settings.hexstellar_api_key
        base = self.settings.hexstellar_api_url.rstrip("/") + "/"
        url = urljoin(base, f"api/v1/solve/{command}")
        headers = {
            "Authorization": f"Bearer {self.settings.hexstellar_api_key}",
            "Content-Type": "application/json",
            "Idempotency-Key": idempotency_key,
        }
        params = {
            "effort": self.settings.cortex_effort,
            "seed": str(seed),
            "version": self.settings.cortex_model,
            "max_latency_ms": str(max_latency_ms),
        }
        owns_client = self._client is None
        client = self._client or httpx.AsyncClient(timeout=httpx.Timeout(35, connect=10))
        try:
            response = await self._request_with_retry(client, "POST", url, headers=headers, params=params, json=problem)
            body = response.json()
            if response.status_code == 200:
                return body
            if response.status_code != 202:
                raise CortexError(f"Cortex rejected request with HTTP {response.status_code}: {body}")
            poll_url = body.get("poll")
            if not poll_url:
                raise CortexError("queued Cortex response omitted poll URL")
            for _ in range(25):
                poll = await self._request_with_retry(
                    client,
                    "GET",
                    urljoin(base, poll_url),
                    headers={"Authorization": headers["Authorization"]},
                )
                poll_body = poll.json()
                if poll_body.get("status") == "done":
                    return poll_body["result"]
                if poll_body.get("status") in {"failed", "cancelled"}:
                    raise CortexError(f"Cortex job ended with status {poll_body.get('status')}")
            raise CortexUnavailable(f"Cortex job remains queued; recover with job_id={body.get('job_id')}")
        finally:
            if owns_client:
                await client.aclose()

    async def _request_with_retry(
        self, client: httpx.AsyncClient, method: str, url: str, **kwargs: Any
    ) -> httpx.Response:
        last_error: Exception | None = None
        for attempt in range(3):
            try:
                response = await client.request(method, url, **kwargs)
                conflict_in_progress = False
                if response.status_code == 409:
                    try:
                        conflict_in_progress = response.json().get("code") == "HXS_IDEMPOTENCY_IN_PROGRESS"
                    except ValueError:
                        conflict_in_progress = False
                retryable = response.status_code in {408, 429} or response.status_code >= 500 or conflict_in_progress
                if not retryable:
                    return response
                retry_after = response.headers.get("Retry-After")
                delay = min(float(retry_after), 120) if retry_after and retry_after.isdigit() else 2**attempt
                if conflict_in_progress:
                    delay = max(delay, 1)
            except (httpx.TimeoutException, httpx.NetworkError) as exc:
                last_error = exc
                delay = 2**attempt
            if attempt < 2:
                await asyncio.sleep(delay + random.Random(attempt).random() * 0.25)
        raise CortexUnavailable(f"Cortex transport failed after bounded retries: {last_error}")
