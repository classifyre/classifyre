"""Tests for production-hardening behavior of custom detector runners."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from src.detectors.custom.runners._base import (
    _MAX_EMBEDDED_SPANS_PER_LABEL,
    _slim_pipeline_result,
)
from src.detectors.custom.runners._gliner2 import (
    _LONG_TEXT_CHAR_THRESHOLD,
    GLiNER2Runner,
)
from src.detectors.custom.runners._regex import _MAX_SPANS_PER_PATTERN, RegexRunner
from src.detectors.custom.runners._text_classification import TextClassificationRunner
from src.models.generated_detectors import (
    GLiNER2PipelineSchema,
    PipelineClassificationDefinition,
    PipelineEntityDefinition,
    PipelineResult,
    RegexPatternDefinition,
    RegexPipelineSchema,
    TextClassificationPipelineSchema,
)
from src.pipeline.worker_pool import (
    compute_pool_workers,
    recipe_has_ml_custom_detectors,
)

# ── GLiNER2 long-document handling ─────────────────────────────────────────────


def _gliner2_runner(mock_model: MagicMock) -> GLiNER2Runner:
    schema = GLiNER2PipelineSchema(
        entities={"order_id": PipelineEntityDefinition(description="Order ID")},
        classification={"intent": PipelineClassificationDefinition(labels=["refund", "question"])},
    )
    runner = GLiNER2Runner(schema, detector_key="test")
    runner._model = mock_model
    return runner


def test_gliner2_short_text_uses_plain_extract() -> None:
    mock_model = MagicMock()
    mock_model.extract_entities.return_value = {"entities": {}}
    mock_model.classify_text.return_value = {"intent": {"label": "refund", "confidence": 0.9}}
    runner = _gliner2_runner(mock_model)

    runner.run("short text")

    mock_model.extract_entities.assert_called_once()
    mock_model.extract_entities_long.assert_not_called()


def test_gliner2_long_text_uses_chunked_extract() -> None:
    mock_model = MagicMock()
    mock_model.extract_entities_long.return_value = {"entities": {}}
    mock_model.classify_text.return_value = {"intent": {"label": "refund", "confidence": 0.9}}
    runner = _gliner2_runner(mock_model)

    runner.run("x" * (_LONG_TEXT_CHAR_THRESHOLD + 1))

    mock_model.extract_entities_long.assert_called_once()
    mock_model.extract_entities.assert_not_called()


def test_gliner2_long_text_falls_back_when_long_api_missing() -> None:
    # spec pins the surface to what the real gliner2 class exposes: no
    # extract_entities_long, and classify_text rather than classify.
    mock_model = MagicMock(spec=["extract_entities", "classify_text"])
    mock_model.extract_entities.return_value = {"entities": {}}
    mock_model.classify_text.return_value = {"intent": {"label": "refund", "confidence": 0.9}}
    runner = _gliner2_runner(mock_model)

    runner.run("x" * (_LONG_TEXT_CHAR_THRESHOLD + 1))

    mock_model.extract_entities.assert_called_once()


def test_gliner2_long_text_classification_keeps_max_confidence() -> None:
    mock_model = MagicMock()
    mock_model.extract_entities_long.return_value = {"entities": {}}
    # classify_text returns results keyed by task name — see gliner2>=1.3.
    mock_model.classify_text.side_effect = [
        {"intent": {"label": "question", "confidence": 0.55}},
        {"intent": {"label": "refund", "confidence": 0.97}},
        {"intent": {"label": "question", "confidence": 0.61}},
    ] * 10
    runner = _gliner2_runner(mock_model)

    result = runner.run("word " * 2000)  # ~10k chars → multiple chunks

    assert mock_model.classify_text.call_count > 1
    assert result.classification["intent"]["label"] == "refund"
    assert result.classification["intent"]["confidence"] == pytest.approx(0.97)


def test_gliner2_load_failure_raises_once_then_skips() -> None:
    schema = GLiNER2PipelineSchema(
        entities={"order_id": PipelineEntityDefinition(description="Order ID")}
    )
    runner = GLiNER2Runner(schema, detector_key="test")

    fake_module = MagicMock()
    fake_module.GLiNER2.from_pretrained.side_effect = OSError("no network")
    with patch("src.detectors.custom.runners._gliner2.require_module", return_value=fake_module):
        with pytest.raises(RuntimeError, match="failed to load"):
            runner.run("some text")
        # Second call skips quietly with an empty result.
        result = runner.run("some text")

    assert not result.entities
    fake_module.GLiNER2.from_pretrained.assert_called_once()


# ── Transformer runner lazy loading ───────────────────────────────────────────


def test_text_classification_load_failure_raises_once_then_skips() -> None:
    schema = TextClassificationPipelineSchema(
        type="TEXT_CLASSIFICATION", model="org/does-not-exist"
    )
    runner = TextClassificationRunner(schema, detector_key="test")

    with patch(
        "src.detectors.custom.runners._text_classification.ensure_torch",
        side_effect=OSError("download failed"),
    ):
        with pytest.raises(RuntimeError, match="failed to load"):
            runner.detect("some text", "text/plain")
        assert runner.detect("some text", "text/plain") == []


def test_text_classification_init_does_not_load_model() -> None:
    # Construction must be side-effect free: no torch import, no HF download.
    schema = TextClassificationPipelineSchema(
        type="TEXT_CLASSIFICATION", model="org/does-not-exist"
    )
    runner = TextClassificationRunner(schema, detector_key="test")
    assert runner._pipe is None


# ── Regex span cap ────────────────────────────────────────────────────────────


def test_regex_runner_caps_spans_per_pattern() -> None:
    schema = RegexPipelineSchema(
        type="REGEX",
        patterns={"digit": RegexPatternDefinition(pattern=r"\d")},
    )
    runner = RegexRunner(schema, detector_key="test")

    result = runner.run("1" * (_MAX_SPANS_PER_PATTERN * 2))

    assert len(result.entities["digit"]) == _MAX_SPANS_PER_PATTERN


# ── Embedded pipeline_result slimming ─────────────────────────────────────────


def test_slim_pipeline_result_caps_entity_spans() -> None:
    spans = [{"value": str(i), "confidence": 1.0, "start": i, "end": i + 1} for i in range(500)]
    result = PipelineResult(entities={"digit": spans}, classification={}, metadata={})

    slim = _slim_pipeline_result(result)

    assert len(slim["entities"]["digit"]) == _MAX_EMBEDDED_SPANS_PER_LABEL
    assert slim["metadata"]["truncated_spans:digit"] == 500
    # Original result is untouched.
    assert len(result.entities["digit"]) == 500


def test_slim_pipeline_result_leaves_small_results_alone() -> None:
    spans = [{"value": "a", "confidence": 1.0, "start": 0, "end": 1}]
    result = PipelineResult(entities={"digit": spans}, classification={}, metadata={})

    slim = _slim_pipeline_result(result)

    assert slim["entities"]["digit"] == spans
    assert "truncated_spans:digit" not in slim["metadata"]


# ── ML-aware pool sizing ──────────────────────────────────────────────────────


def test_recipe_has_ml_custom_detectors() -> None:
    ml_recipe = {
        "detectors": [
            {"type": "PII", "config": {}},
            {"type": "CUSTOM", "config": {"pipeline_schema": {"type": "GLINER2"}}},
        ]
    }
    regex_recipe = {
        "detectors": [
            {"type": "CUSTOM", "config": {"pipeline_schema": {"type": "REGEX"}}},
        ]
    }
    disabled_recipe = {
        "detectors": [
            {
                "type": "CUSTOM",
                "enabled": False,
                "config": {"pipeline_schema": {"type": "GLINER2"}},
            },
        ]
    }
    assert recipe_has_ml_custom_detectors(ml_recipe) is True
    assert recipe_has_ml_custom_detectors(regex_recipe) is False
    assert recipe_has_ml_custom_detectors(disabled_recipe) is False
    assert recipe_has_ml_custom_detectors({}) is False


def test_compute_pool_workers_respects_per_worker_mb() -> None:
    with (
        patch("src.pipeline.worker_pool.get_effective_cpu_count", return_value=16),
        patch("src.pipeline.worker_pool.get_effective_memory_mb", return_value=8704),
    ):
        # 8704 - 512 = 8192MB → 8 workers at 1GB, 4 at 2GB.
        assert compute_pool_workers() == 8
        assert compute_pool_workers(per_worker_mb=2048) == 4
