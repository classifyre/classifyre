"""The TAG pipeline: a detector that asserts rather than detects."""

from __future__ import annotations

import pytest

from src.detectors.custom.detector import CustomDetector
from src.detectors.custom.runners import TagRunner, create_runner
from src.models.generated_detectors import (
    CustomDetectorConfig,
    GLiNER2PipelineSchema,
    RegexPipelineSchema,
    Severity,
    TagPipelineSchema,
)
from src.models.generated_single_asset_scan_results import DetectorType


def test_factory_returns_tag_runner() -> None:
    # The factory ends in a bare GLiNER2 fall-through, so a TAG schema reaching
    # it would try to load a transformer model for a detector that runs nothing.
    runner = create_runner(TagPipelineSchema(label="Legal hold"), "legal_hold", "Legal Hold")
    assert isinstance(runner, TagRunner)


def test_factory_still_routes_other_schemas() -> None:
    assert not isinstance(create_runner(RegexPipelineSchema(patterns={})), TagRunner)
    assert not isinstance(create_runner(GLiNER2PipelineSchema()), TagRunner)


@pytest.mark.parametrize(
    "content,content_type",
    [("cardholder data everywhere", "text/plain"), (b"\x00\x01", "application/octet-stream")],
)
def test_detect_never_fires_on_content(content: str | bytes, content_type: str) -> None:
    runner = TagRunner(TagPipelineSchema(label="Cardholder data"), "cardholder_data", "Cardholder")
    assert runner.detect(content, content_type) == []


def test_supports_no_content_types() -> None:
    # Empty means the pipeline never puts this detector in the text, binary or
    # link bucket -- which is how it stays out of every content pass.
    assert TagRunner(TagPipelineSchema(), "k", "n").get_supported_content_types() == []


def test_tag_finding_shape() -> None:
    runner = TagRunner(
        TagPipelineSchema(label="Cardholder data", severity=Severity.high),
        "cardholder_data",
        "Cardholder Data",
    )
    finding = runner.tag_finding("  primary-account-numbers  ")

    assert finding.detector_type == DetectorType.CUSTOM
    assert finding.finding_type == "tag:Cardholder data"
    assert finding.category == "CLASSIFICATION"
    assert finding.severity == Severity.high
    # Asserted by the connector, so there is nothing for a confidence to express.
    assert finding.confidence == 1.0
    assert finding.matched_content == "primary-account-numbers"
    assert finding.custom_detector_key == "cardholder_data"
    assert finding.custom_detector_name == "Cardholder Data"
    assert finding.metadata == {
        "runner": "TAG",
        "label": "Cardholder data",
        "tag_key": "cardholder_data",
        "tag_value": "primary-account-numbers",
    }


def test_label_falls_back_to_detector_name() -> None:
    runner = TagRunner(TagPipelineSchema(), "legal_hold", "Legal Hold")
    assert runner.tag_finding("retained").finding_type == "tag:Legal Hold"


def test_severity_defaults_to_medium() -> None:
    assert TagRunner(TagPipelineSchema(), "k", "n").severity == Severity.medium


def test_custom_detector_exposes_tag_runner() -> None:
    detector = CustomDetector(
        CustomDetectorConfig(
            custom_detector_key="legal_hold",
            name="Legal Hold",
            pipeline_schema=TagPipelineSchema(label="Legal hold"),
        )
    )
    assert isinstance(detector.runner, TagRunner)
    assert detector.get_supported_content_types() == []


# ── Per-tag severity (field report P9) ────────────────────────────────────────


def test_tag_finding_takes_a_severity_within_the_detector_ceiling() -> None:
    # The early-warning rule is "HIGH at +30%, MEDIUM at +20%". One detector at
    # HIGH now covers both bands instead of two detectors with duplicated
    # descriptions that every inquiry and case had to name separately.
    runner = TagRunner(
        TagPipelineSchema(label="Insolvenzen YoY", severity=Severity.high),
        "insolvencies_yoy",
        "Insolvenzen",
    )

    finding = runner.tag_finding("+22%", Severity.medium)

    assert finding.severity == Severity.medium
    assert finding.metadata["tag_severity"] == "medium"


def test_a_tag_may_not_outrank_its_detector() -> None:
    # The detector is where the operator's decision lives; a connector asking
    # for more than it allows gets the ceiling, and the caller is told.
    runner = TagRunner(
        TagPipelineSchema(label="Insolvenzen YoY", severity=Severity.medium),
        "insolvencies_yoy",
        "Insolvenzen",
    )

    applied, lowered = runner.bound_severity("CRITICAL")

    assert applied == Severity.medium
    assert lowered is True
    assert runner.tag_finding("+80%", "CRITICAL").severity == Severity.medium


def test_no_severity_leaves_the_detector_in_charge() -> None:
    runner = TagRunner(
        TagPipelineSchema(label="Legal hold", severity=Severity.low), "legal_hold", "Legal Hold"
    )

    applied, lowered = runner.bound_severity(None)

    assert (applied, lowered) == (Severity.low, False)
    # An untouched severity leaves no trace in metadata: nothing was overridden.
    assert "tag_severity" not in runner.tag_finding("retained").metadata


def test_an_unreadable_severity_lands_on_the_ceiling_and_is_reported() -> None:
    runner = TagRunner(TagPipelineSchema(severity=Severity.high), "k", "n")

    assert runner.bound_severity("URGENT") == (Severity.high, True)


def test_severity_is_case_insensitive() -> None:
    # The schema spells them lowercase; a notebook author writes "HIGH".
    runner = TagRunner(TagPipelineSchema(severity=Severity.critical), "k", "n")

    assert runner.bound_severity("Info") == (Severity.info, False)
    assert runner.bound_severity("high") == (Severity.high, False)


def test_a_refused_promotion_is_recorded_on_the_finding() -> None:
    # The interesting case left no trace on the finding at all: only a warning
    # in a runner log, and on Kubernetes the tail of that log is not reliably
    # kept. The finding now carries what was asked for and what was applied.
    runner = TagRunner(TagPipelineSchema(severity=Severity.medium), "insolvencies_yoy", "Ins")

    metadata = runner.tag_finding("+80%", "CRITICAL").metadata

    assert metadata["tag_severity_requested"] == "CRITICAL"
    # No tag_severity: the finding landed on the detector's own severity, so
    # there is no override to record -- only a refusal.
    assert "tag_severity" not in metadata


def test_an_applied_override_records_what_it_became() -> None:
    runner = TagRunner(TagPipelineSchema(severity=Severity.high), "k", "n")

    metadata = runner.tag_finding("+22%", "LOW").metadata

    assert metadata["tag_severity"] == "low"
    assert "tag_severity_requested" not in metadata
