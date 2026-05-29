"""Unit tests for the AI/LLM detector runner.

litellm.completion is mocked so the tests never hit a real provider.
"""

from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from src.detectors.custom.runners._llm import LLMRunner
from src.models.generated_detectors import (
    LLMLabelDefinition,
    LLMOutputField,
    LLMPipelineSchema,
    LLMProviderRuntime,
    PipelineSeverityRule,
    Severity,
)

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

    assert {r.finding_type for r in results} == {"llm:violent", "llm:bad"}
    violent = next(r for r in results if r.finding_type == "llm:violent")
    assert violent.severity == Severity.critical
    assert violent.matched_content == "gewalttätig"
    assert violent.extracted_data == {"language": "de"}
    assert violent.extraction_method == "LLM"
    assert violent.metadata["provider"] == "CLAUDE"

    bad = next(r for r in results if r.finding_type == "llm:bad")
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
