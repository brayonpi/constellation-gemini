from __future__ import annotations

import sys
from types import ModuleType, SimpleNamespace

import pytest
from constellation import agent
from constellation.agent import GeminiIntentExtraction, IntentInterpretationError, IntentTransportError
from constellation.compiler import DEFAULT_OPERATOR_TEXT, canonicalize_intent
from constellation.config import Settings


def extraction(priority_choice: str | None = None) -> GeminiIntentExtraction:
    canonical = canonicalize_intent(
        operator_text=DEFAULT_OPERATOR_TEXT,
        model_id="fixture",
        priority_choice=priority_choice,
        live_interpretation=False,
    )
    return GeminiIntentExtraction.model_validate(
        canonical.model_dump(
            include={
                "required_obligations",
                "hard_constraints",
                "soft_preferences",
                "objective_order",
                "accepted_defaults",
                "unresolved_ambiguities",
            }
        )
    )


@pytest.mark.asyncio
async def test_missing_cloud_project_uses_disclosed_fixture() -> None:
    result = await agent.interpret_intent(Settings(GOOGLE_CLOUD_PROJECT=None), DEFAULT_OPERATOR_TEXT)
    assert not result.live_interpretation
    assert result.fallback_reason == "GOOGLE_CLOUD_PROJECT is not configured"
    assert result.gemini_model_id.endswith(":structured-fixture")


@pytest.mark.asyncio
async def test_live_schema_drives_canonical_intent(monkeypatch) -> None:
    calls: list[str] = []

    async def live(settings, operator_text, priority_choice, thinking_level):
        calls.append(thinking_level)
        return extraction(priority_choice), "interaction-123", {"input_tokens": 42}

    monkeypatch.setattr(agent, "_run_live_extraction", live)
    result = await agent.interpret_intent(
        Settings(GOOGLE_CLOUD_PROJECT="test-project"),
        DEFAULT_OPERATOR_TEXT,
        priority_choice="urgent_deadline",
    )
    assert calls == ["low"]
    assert result.live_interpretation
    assert result.interaction_id == "interaction-123"
    assert result.usage_metadata == {"input_tokens": 42, "thinking_level": "low"}
    assert not result.unresolved_ambiguities


@pytest.mark.asyncio
async def test_schema_failure_escalates_once_then_succeeds(monkeypatch) -> None:
    calls: list[str] = []

    async def live(settings, operator_text, priority_choice, thinking_level):
        calls.append(thinking_level)
        if thinking_level == "low":
            raise IntentInterpretationError("incomplete schema")
        return extraction(priority_choice), "interaction-medium", {}

    monkeypatch.setattr(agent, "_run_live_extraction", live)
    result = await agent.interpret_intent(
        Settings(GOOGLE_CLOUD_PROJECT="test-project"), DEFAULT_OPERATOR_TEXT
    )
    assert calls == ["low", "medium"]
    assert result.live_interpretation
    assert result.usage_metadata["thinking_level"] == "medium"


@pytest.mark.asyncio
async def test_transport_error_falls_back_without_second_provider_call(monkeypatch) -> None:
    calls: list[str] = []

    async def live(settings, operator_text, priority_choice, thinking_level):
        calls.append(thinking_level)
        raise IntentTransportError("provider timeout")

    monkeypatch.setattr(agent, "_run_live_extraction", live)
    result = await agent.interpret_intent(
        Settings(GOOGLE_CLOUD_PROJECT="test-project"), DEFAULT_OPERATOR_TEXT
    )
    assert calls == ["low"]
    assert not result.live_interpretation
    assert result.fallback_reason == "provider timeout"
    assert result.gemini_model_id.endswith(":fallback-after-live-error")


def test_adk_app_uses_interactions_schema_and_hides_thoughts(monkeypatch) -> None:
    captured: dict[str, dict] = {}

    def factory(name):
        def build(**kwargs):
            captured[name] = kwargs
            return SimpleNamespace(**kwargs)

        return build

    modules = {
        "google.adk.agents": ModuleType("google.adk.agents"),
        "google.adk.apps": ModuleType("google.adk.apps"),
        "google.adk.models": ModuleType("google.adk.models"),
        "google.genai": ModuleType("google.genai"),
    }
    modules["google.adk.agents"].Agent = factory("agent")
    modules["google.adk.apps"].App = factory("app")
    modules["google.adk.models"].Gemini = factory("gemini")
    modules["google.genai"].types = SimpleNamespace(
        HttpRetryOptions=factory("retry"),
        GenerateContentConfig=factory("content_config"),
        ThinkingConfig=factory("thinking_config"),
    )
    for name, module in modules.items():
        monkeypatch.setitem(sys.modules, name, module)

    app = agent.build_adk_app(Settings(), "medium")
    assert app.name == "constellation"
    assert captured["gemini"]["use_interactions_api"] is True
    assert captured["thinking_config"] == {"thinking_level": "medium", "include_thoughts": False}
    assert captured["agent"]["output_schema"] is GeminiIntentExtraction
    assert captured["agent"]["tools"] == []


def install_fake_runner(monkeypatch, events) -> None:
    class SessionService:
        async def create_session(self, **kwargs):
            return kwargs

    class Runner:
        def __init__(self, app):
            self.app = app
            self.session_service = SessionService()

        async def run_async(self, **kwargs):
            if isinstance(events, Exception):
                raise events
            for event in events:
                yield event

    runners = ModuleType("google.adk.runners")
    runners.InMemoryRunner = Runner
    genai = ModuleType("google.genai")
    genai.types = SimpleNamespace(
        Content=lambda **kwargs: SimpleNamespace(**kwargs),
        Part=lambda **kwargs: SimpleNamespace(**kwargs),
    )
    monkeypatch.setitem(sys.modules, "google.adk.runners", runners)
    monkeypatch.setitem(sys.modules, "google.genai", genai)
    monkeypatch.setattr(agent, "build_adk_app", lambda settings, thinking_level: SimpleNamespace(name="constellation"))


@pytest.mark.asyncio
async def test_live_runner_extracts_final_schema_usage_and_interaction(monkeypatch) -> None:
    payload = extraction().model_dump_json()

    class Usage:
        def model_dump(self, **kwargs):
            return {"output_tokens": 17}

    event = SimpleNamespace(
        invocation_id="invocation-1",
        usage_metadata=Usage(),
        content=SimpleNamespace(parts=[SimpleNamespace(text=payload)]),
        is_final_response=lambda: True,
    )
    install_fake_runner(monkeypatch, [event])
    result, interaction_id, usage = await agent._run_live_extraction(
        Settings(), DEFAULT_OPERATOR_TEXT, None, "low"
    )
    assert result == extraction()
    assert interaction_id == "invocation-1"
    assert usage == {"output_tokens": 17}


@pytest.mark.asyncio
async def test_live_runner_rejects_missing_and_invalid_final_responses(monkeypatch) -> None:
    install_fake_runner(monkeypatch, [])
    with pytest.raises(IntentInterpretationError, match="without a structured"):
        await agent._run_live_extraction(Settings(), DEFAULT_OPERATOR_TEXT, None, "low")

    invalid = SimpleNamespace(
        invocation_id=None,
        usage_metadata={"tokens": 1},
        content=SimpleNamespace(parts=[SimpleNamespace(text="not-json")]),
        is_final_response=lambda: True,
    )
    install_fake_runner(monkeypatch, [invalid])
    with pytest.raises(IntentInterpretationError, match="did not match"):
        await agent._run_live_extraction(Settings(), DEFAULT_OPERATOR_TEXT, None, "medium")


@pytest.mark.asyncio
async def test_live_runner_converts_provider_exception(monkeypatch) -> None:
    install_fake_runner(monkeypatch, TimeoutError("provider"))
    with pytest.raises(IntentTransportError, match="TimeoutError"):
        await agent._run_live_extraction(Settings(), DEFAULT_OPERATOR_TEXT, None, "low")
