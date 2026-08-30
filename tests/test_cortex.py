from __future__ import annotations

from datetime import UTC, datetime, timedelta
from email.utils import format_datetime

import httpx
import pytest
from constellation.config import Settings
from constellation.cortex import CortexClient, CortexContractRejected, CortexUnavailable


@pytest.mark.asyncio
async def test_analyze_precedes_solve_and_literal_poll_url_is_followed(monkeypatch) -> None:
    requests: list[httpx.Request] = []
    poll_count = 0

    async def no_sleep(_: float) -> None:
        return None

    monkeypatch.setattr("constellation.cortex.asyncio.sleep", no_sleep)

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal poll_count
        requests.append(request)
        if request.url.path == "/api/v1/analyze/cover":
            return httpx.Response(200, json={"accepted": True}, request=request)
        if request.url.path == "/api/v1/solve/cover":
            return httpx.Response(
                202,
                json={"job_id": "job-1", "poll": "/jobs/job-1?wait=29&cursor=opaque"},
                request=request,
            )
        if request.url.path == "/jobs/job-1":
            poll_count += 1
            if poll_count == 1:
                return httpx.Response(200, json={"status": "running"}, request=request)
            return httpx.Response(
                200,
                json={"status": "done", "result": {"answer": [0], "certainty": "heuristic"}},
                request=request,
            )
        raise AssertionError(f"unexpected request: {request.url}")

    transport = httpx.MockTransport(handler)
    settings = Settings(
        HEXSTELLAR_API_URL="https://cortex.example.test",
        HEXSTELLAR_API_KEY="test-only",
    )
    async with httpx.AsyncClient(transport=transport) as http_client:
        result = await CortexClient(settings, http_client).solve(
            "cover",
            {"description": "Test coverage contract", "sets": [["A"]], "elements": ["A"]},
            idempotency_key="cover-idempotency-0001",
        )

    assert result.body["answer"] == [0]
    assert [request.url.path for request in requests[:2]] == [
        "/api/v1/analyze/cover",
        "/api/v1/solve/cover",
    ]
    poll_requests = [request for request in requests if request.url.path == "/jobs/job-1"]
    assert len(poll_requests) == 2
    assert all(request.url.query == b"wait=29&cursor=opaque" for request in poll_requests)
    assert all(request.headers["idempotency-key"] == "cover-idempotency-0001" for request in requests[:2])


def test_retry_after_supports_seconds_and_http_dates() -> None:
    assert CortexClient._retry_delay("2.5", 0) == 2.5
    future = format_datetime(datetime.now(UTC) + timedelta(seconds=20), usegmt=True)
    assert 0 < CortexClient._retry_delay(future, 0) <= 20
    assert CortexClient._retry_delay("not-a-date", 3) == 8


@pytest.mark.asyncio
async def test_missing_public_description_fails_before_network() -> None:
    settings = Settings(
        HEXSTELLAR_API_URL="https://cortex.example.test",
        HEXSTELLAR_API_KEY="test-only",
    )
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: pytest.fail(str(request)))) as client:
        with pytest.raises(CortexContractRejected, match="description"):
            await CortexClient(settings, client).solve(
                "cover",
                {"sets": [["A"]], "elements": ["A"]},
                idempotency_key="missing-description-0001",
            )


@pytest.mark.asyncio
async def test_unconfigured_client_abstains_without_network() -> None:
    with pytest.raises(CortexUnavailable, match="not configured"):
        await CortexClient(Settings(HEXSTELLAR_API_KEY=None)).solve(
            "cover",
            {"description": "No credential test"},
            idempotency_key="unconfigured-cortex",
        )


@pytest.mark.asyncio
async def test_immediate_success_preserves_response_and_tags_contract() -> None:
    seen: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.json() if hasattr(request, "json") else {})
        if request.url.path.startswith("/api/v1/analyze"):
            return httpx.Response(200, json={"accepted": True}, request=request)
        return httpx.Response(
            200,
            json={"answer": [0], "certainty": "certified", "receipt": {"scope": "cover"}},
            request=request,
        )

    # MockTransport exposes bytes rather than Request.json(), so inspect after the call.
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await CortexClient(
            Settings(HEXSTELLAR_API_URL="https://cortex.example", HEXSTELLAR_API_KEY="test"), client
        ).solve(
            "cover",
            {"description": "Immediate contract", "sets": [["A"]], "elements": ["A"]},
            idempotency_key="immediate-success",
        )
    assert result.body["certainty"] == "certified"


@pytest.mark.asyncio
async def test_queued_response_requires_poll_url() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.startswith("/api/v1/analyze"):
            return httpx.Response(200, json={}, request=request)
        return httpx.Response(202, json={"job_id": "missing-poll"}, request=request)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(CortexContractRejected, match="poll URL"):
            await CortexClient(
                Settings(HEXSTELLAR_API_URL="https://cortex.example", HEXSTELLAR_API_KEY="test"), client
            ).solve(
                "cover",
                {"description": "Queued contract"},
                idempotency_key="queued-missing-poll",
            )


@pytest.mark.asyncio
async def test_transient_retry_and_failed_job_are_typed(monkeypatch) -> None:
    attempts = 0

    async def no_sleep(_: float) -> None:
        return None

    monkeypatch.setattr("constellation.cortex.asyncio.sleep", no_sleep)

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        if request.url.path.startswith("/api/v1/analyze"):
            attempts += 1
            if attempts == 1:
                return httpx.Response(429, headers={"Retry-After": "0"}, json={"detail": "slow"}, request=request)
            return httpx.Response(200, json={}, request=request)
        if request.url.path.startswith("/api/v1/solve"):
            return httpx.Response(202, json={"job_id": "failed", "poll": "/jobs/failed"}, request=request)
        return httpx.Response(200, json={"status": "failed"}, request=request)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(CortexContractRejected, match="status failed"):
            await CortexClient(
                Settings(HEXSTELLAR_API_URL="https://cortex.example", HEXSTELLAR_API_KEY="test"), client
            ).solve(
                "cover",
                {"description": "Retry contract"},
                idempotency_key="retry-then-failed",
            )
    assert attempts == 2


def test_invalid_json_shapes_and_problem_details_are_rejected() -> None:
    request = httpx.Request("GET", "https://cortex.example")
    with pytest.raises(CortexContractRejected, match="non-JSON"):
        CortexClient._json_object(httpx.Response(200, text="not-json", request=request))
    with pytest.raises(CortexContractRejected, match="non-object"):
        CortexClient._json_object(httpx.Response(200, json=[1, 2], request=request))
    detail = CortexClient._problem_detail("test", httpx.Response(500, text="bad", request=request))
    assert "non-JSON response" in detail
