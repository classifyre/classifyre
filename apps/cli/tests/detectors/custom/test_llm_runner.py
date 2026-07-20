"""Unit tests for the AI/LLM detector runner.

litellm.completion is mocked so the tests never hit a real provider.
"""

from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from src.detectors.custom.runners._llm import LLMCompletionError, LLMRunner
from src.models.generated_detectors import (
    LLMLabelDefinition,
    LLMOutputField,
    LLMPipelineSchema,
    LLMProviderRuntime,
    PipelineSeverityRule,
    Severity,
)

from .conftest import requires_litellm

pytestmark = requires_litellm

TEXT = "Dieses Produkt ist schrecklich und gewalttätig."


def _runtime(provider: str = "CLAUDE", model: str = "claude-sonnet-4-5") -> LLMProviderRuntime:
    return LLMProviderRuntime(provider=provider, model=model, api_key="sk-test")


def _schema(**overrides) -> LLMPipelineSchema:
    base: dict = {
        "system_prompt": "Classify sentiment.",
        "labels": [
            LLMLabelDefinition(name="good"),
            LLMLabelDefinition(name="bad", description="negative sentiment"),
            LLMLabelDefinition(name="violent"),
        ],
        "severity_map": [
            PipelineSeverityRule(pattern="violent", severity=Severity.critical),
            PipelineSeverityRule(pattern="bad", severity=Severity.medium),
        ],
        "output_fields": [LLMOutputField(name="language", type="string")],
        "confidence_threshold": 0.5,
        "provider_runtime": _runtime(),
    }
    base.update(overrides)
    return LLMPipelineSchema(**base)


def _mock_completion(payload: dict) -> MagicMock:
    message = SimpleNamespace(content=json.dumps(payload))
    choice = SimpleNamespace(message=message)
    return MagicMock(return_value=SimpleNamespace(choices=[choice]))


def _runner(schema: LLMPipelineSchema, completion: MagicMock) -> LLMRunner:
    runner = LLMRunner(schema, detector_key="sentiment", detector_name="Sentiment")
    runner._litellm = SimpleNamespace(completion=completion)
    return runner


def test_missing_provider_runtime_raises() -> None:
    schema = LLMPipelineSchema(system_prompt="x")
    with pytest.raises(ValueError, match="provider_runtime"):
        LLMRunner(schema, detector_key="d")


def test_label_to_severity_and_extraction() -> None:
    completion = _mock_completion(
        {
            "labels": [
                {"name": "violent", "confidence": 0.95, "matched_content": "gewalttätig"},
                {"name": "bad", "confidence": 0.8},
            ],
            "fields": {"language": "de"},
        }
    )
    runner = _runner(_schema(), completion)
    results = runner.detect(TEXT, "text/plain")

    assert {r.finding_type for r in results} == {"violent", "bad"}
    violent = next(r for r in results if r.finding_type == "violent")
    assert violent.severity == Severity.critical
    assert violent.matched_content == "gewalttätig"
    assert violent.extracted_data == {"language": "de"}
    assert violent.extraction_method == "LLM"
    assert violent.metadata["provider"] == "CLAUDE"

    bad = next(r for r in results if r.finding_type == "bad")
    assert bad.severity == Severity.medium


def test_confidence_threshold_filters() -> None:
    completion = _mock_completion({"labels": [{"name": "bad", "confidence": 0.3}], "fields": {}})
    runner = _runner(_schema(confidence_threshold=0.5), completion)
    assert runner.detect(TEXT, "text/plain") == []


def test_default_severity_when_no_rule_matches() -> None:
    completion = _mock_completion({"labels": [{"name": "good", "confidence": 0.9}]})
    runner = _runner(_schema(), completion)
    results = runner.detect(TEXT, "text/plain")
    assert results[0].severity == Severity.info


def test_model_string_per_provider() -> None:
    completion = _mock_completion({"labels": []})
    runner = _runner(_schema(provider_runtime=_runtime("GEMINI", "gemini-2.0-flash")), completion)
    runner.detect(TEXT, "text/plain")
    assert completion.call_args.kwargs["model"] == "gemini/gemini-2.0-flash"


def test_openai_compatible_uses_api_base_and_prefix() -> None:
    runtime = LLMProviderRuntime(
        provider="OPENAI_COMPATIBLE",
        model="moonshotai/kimi-k2.6",
        api_key="nv-key",
        base_url="https://integrate.api.nvidia.com/v1",
    )
    completion = _mock_completion({"labels": []})
    runner = _runner(_schema(provider_runtime=runtime), completion)
    runner.detect(TEXT, "text/plain")
    kwargs = completion.call_args.kwargs
    assert kwargs["model"] == "openai/moonshotai/kimi-k2.6"
    assert kwargs["api_base"] == "https://integrate.api.nvidia.com/v1"


def test_max_tokens_passed_as_int() -> None:
    # max_tokens is a RootModel[int] wrapper; it must be unwrapped to a plain int
    # before being handed to litellm, otherwise the completion request fails.
    completion = _mock_completion({"labels": []})
    runner = _runner(_schema(max_tokens=256), completion)
    runner.detect(TEXT, "text/plain")
    assert completion.call_args.kwargs["max_tokens"] == 256


def test_max_tokens_defaults_to_none() -> None:
    completion = _mock_completion({"labels": []})
    runner = _runner(_schema(), completion)
    runner.detect(TEXT, "text/plain")
    assert completion.call_args.kwargs["max_tokens"] is None


def test_non_text_content_skipped() -> None:
    completion = _mock_completion({"labels": [{"name": "bad", "confidence": 0.9}]})
    runner = _runner(_schema(), completion)
    assert runner.detect(b"bytes", "image/png") == []
    assert runner.detect("text", "image/png") == []
    completion.assert_not_called()


def test_malformed_json_returns_no_findings() -> None:
    message = SimpleNamespace(content="not json at all")
    completion = MagicMock(return_value=SimpleNamespace(choices=[SimpleNamespace(message=message)]))
    runner = _runner(_schema(), completion)
    assert runner.detect(TEXT, "text/plain") == []


# ── Provider-failure handling (BUG A) ─────────────────────────────────────────


class _RateLimitError(Exception):
    status_code = 429


class _AuthError(Exception):
    status_code = 401


def test_provider_error_raises_instead_of_empty_result(monkeypatch) -> None:
    # A dead provider must surface as an error the pipeline records, never as
    # a silent zero-findings result indistinguishable from a clean scan.
    monkeypatch.setattr("src.detectors.custom.runners._llm.time.sleep", lambda _s: None)
    completion = MagicMock(side_effect=_RateLimitError("rate limited"))
    runner = _runner(_schema(), completion)
    with pytest.raises(LLMCompletionError, match="sentiment"):
        runner.detect(TEXT, "text/plain")


def test_transient_provider_error_retries_then_succeeds(monkeypatch) -> None:
    sleeps: list[float] = []
    monkeypatch.setattr("src.detectors.custom.runners._llm.time.sleep", sleeps.append)
    good = _mock_completion({"labels": [{"name": "bad", "confidence": 0.9}]})
    completion = MagicMock(
        side_effect=[_RateLimitError("429"), _RateLimitError("503"), good.return_value]
    )
    runner = _runner(_schema(), completion)

    results = runner.detect(TEXT, "text/plain")

    assert [r.finding_type for r in results] == ["bad"]
    assert completion.call_count == 3
    assert len(sleeps) == 2
    assert sleeps[1] > sleeps[0]  # exponential backoff


def test_non_retryable_provider_error_fails_fast(monkeypatch) -> None:
    monkeypatch.setattr("src.detectors.custom.runners._llm.time.sleep", lambda _s: None)
    completion = MagicMock(side_effect=_AuthError("bad key"))
    runner = _runner(_schema(), completion)
    with pytest.raises(LLMCompletionError):
        runner.detect(TEXT, "text/plain")
    assert completion.call_count == 1


def test_completion_error_is_picklable() -> None:
    # The error crosses the detector worker-pool process boundary.
    import pickle

    err = LLMCompletionError("LLM provider call failed for detector 'x': 429")
    restored = pickle.loads(pickle.dumps(err))
    assert isinstance(restored, LLMCompletionError)
    assert "429" in str(restored)


# ── Vision / file input ───────────────────────────────────────────────────────


def _vision_runtime() -> LLMProviderRuntime:
    return LLMProviderRuntime(
        provider="CLAUDE", model="claude-sonnet-4-5", api_key="sk-test", supports_vision=True
    )


def test_supported_content_types_gated_by_vision() -> None:
    completion = _mock_completion({"labels": []})

    text_only = _runner(_schema(), completion)
    assert "image/png" not in text_only.get_supported_content_types()
    assert "application/pdf" not in text_only.get_supported_content_types()

    vision = _runner(_schema(provider_runtime=_vision_runtime()), completion)
    supported = vision.get_supported_content_types()
    assert "text/plain" in supported
    assert "image/png" in supported
    assert "application/pdf" in supported


def test_vision_detect_builds_image_blocks_and_findings(monkeypatch) -> None:
    monkeypatch.setattr(
        "src.detectors.custom.runners._llm.render_to_images",
        lambda _content, _content_type, **_: [b"\x89PNG-page-1", b"\x89PNG-page-2"],
    )
    completion = _mock_completion(
        {"labels": [{"name": "bad", "confidence": 0.9}], "fields": {"language": "en"}}
    )
    runner = _runner(_schema(provider_runtime=_vision_runtime()), completion)

    results = runner.detect(b"%PDF-1.4 fake", "application/pdf")

    assert [r.finding_type for r in results] == ["bad"]
    finding = results[0]
    assert finding.metadata["input"] == "vision"
    assert finding.metadata["vision_pages"] == 2

    messages = completion.call_args.kwargs["messages"]
    user_blocks = messages[1]["content"]
    assert [b["type"] for b in user_blocks] == ["image_url", "image_url"]
    assert user_blocks[0]["image_url"]["url"].startswith("data:image/png;base64,")


def test_vision_disabled_returns_no_findings_for_bytes(monkeypatch) -> None:
    called = MagicMock(return_value=[b"img"])
    monkeypatch.setattr("src.detectors.custom.runners._llm.render_to_images", called)
    completion = _mock_completion({"labels": [{"name": "bad", "confidence": 0.9}]})
    runner = _runner(_schema(), completion)  # supports_vision defaults off

    assert runner.detect(b"%PDF-1.4 fake", "application/pdf") == []
    called.assert_not_called()
    completion.assert_not_called()


def test_vision_no_images_rendered_returns_empty(monkeypatch) -> None:
    monkeypatch.setattr(
        "src.detectors.custom.runners._llm.render_to_images",
        lambda *_, **__: [],
    )
    completion = _mock_completion({"labels": [{"name": "bad", "confidence": 0.9}]})
    runner = _runner(_schema(provider_runtime=_vision_runtime()), completion)

    assert runner.detect(b"not-a-real-pdf", "application/pdf") == []
    completion.assert_not_called()


def test_vision_unsupported_mime_skipped(monkeypatch) -> None:
    called = MagicMock(return_value=[b"img"])
    monkeypatch.setattr("src.detectors.custom.runners._llm.render_to_images", called)
    completion = _mock_completion({"labels": []})
    runner = _runner(_schema(provider_runtime=_vision_runtime()), completion)

    assert runner.detect(b"audio-bytes", "audio/mpeg") == []
    called.assert_not_called()
