"""Unit tests for CodeSecurityDetector."""

import pytest

from src.detectors.base import BaseDetector
from src.detectors.dependencies import MissingDependencyError
from src.detectors.threat import code_security_detector as module
from src.models.generated_detectors import (
    CodeSecurityDetectorConfig,
    DetectorConfig,
    GenericDetectorConfig,
    Severity,
)
from src.models.generated_single_asset_scan_results import DetectorType

_BANDIT_ISSUE = {
    "issue_text": "Use of assert detected.",
    "issue_severity": "LOW",
    "issue_confidence": "HIGH",
    "line_number": 3,
    "test_name": "assert_used",
    "test_id": "B101",
    "code": "assert user.is_admin",
}


def _stub_detector(cfg: DetectorConfig | None = None) -> module.CodeSecurityDetector:
    detector = module.CodeSecurityDetector.__new__(module.CodeSecurityDetector)
    resolved_cfg = cfg if cfg is not None else CodeSecurityDetectorConfig(confidence_threshold=0.7)
    BaseDetector.__init__(detector, resolved_cfg)
    detector._cfg = resolved_cfg
    return detector


@pytest.mark.asyncio
async def test_detect_maps_bandit_issue() -> None:
    detector = _stub_detector()
    detector._run_bandit_json = lambda _content, **_kwargs: (
        [_BANDIT_ISSUE],
        [],
    )

    findings = await detector.detect("def f(user):\n    assert user.is_admin\n")

    assert len(findings) == 1
    finding = findings[0]
    assert finding.detector_type == DetectorType.CODE_SECURITY
    assert finding.finding_type == "B101"
    assert finding.severity == Severity.low
    assert finding.category == "SECURITY"


@pytest.mark.asyncio
async def test_detect_passes_skips_and_tests_to_bandit() -> None:
    cfg = CodeSecurityDetectorConfig(
        skips=["B101", "B105"],
        tests=["B201", "B301"],
    )
    detector = _stub_detector(cfg)

    captured: dict[str, object] = {}

    def _capture(_content: str, skips: list[str] | None = None, tests: list[str] | None = None):
        captured["skips"] = skips
        captured["tests"] = tests
        return [], []

    detector._run_bandit_json = _capture  # type: ignore[method-assign]

    await detector.detect("import os")

    assert [s.root for s in detector._cfg.skips.root] == ["B101", "B105"]
    assert [s.root for s in detector._cfg.tests.root] == ["B201", "B301"]


@pytest.mark.asyncio
async def test_detect_filters_by_severity_threshold() -> None:
    cfg = CodeSecurityDetectorConfig(severity_threshold=Severity.medium)
    detector = _stub_detector(cfg)
    detector._run_bandit_json = lambda _content, **_kwargs: (
        [
            {**_BANDIT_ISSUE, "issue_severity": "LOW", "test_id": "B101"},
            {**_BANDIT_ISSUE, "issue_severity": "MEDIUM", "test_id": "B601"},
            {**_BANDIT_ISSUE, "issue_severity": "HIGH", "test_id": "B602"},
        ],
        [],
    )

    findings = await detector.detect("import subprocess")

    finding_types = {f.finding_type for f in findings}
    assert "B101" not in finding_types  # LOW is below threshold
    assert "B601" in finding_types
    assert "B602" in finding_types


@pytest.mark.asyncio
async def test_detect_no_severity_threshold_keeps_all_severities() -> None:
    cfg = CodeSecurityDetectorConfig(severity_threshold=None)
    detector = _stub_detector(cfg)
    detector._run_bandit_json = lambda _content, **_kwargs: (
        [
            {**_BANDIT_ISSUE, "issue_severity": "LOW", "test_id": "B101"},
            {**_BANDIT_ISSUE, "issue_severity": "MEDIUM", "test_id": "B601"},
        ],
        [],
    )

    findings = await detector.detect("x = 1")

    assert len(findings) == 2


@pytest.mark.asyncio
async def test_detect_uses_generic_config_fallback() -> None:
    """Detector still works when initialised with the old GenericDetectorConfig."""
    detector = _stub_detector(GenericDetectorConfig(confidence_threshold=0.7))
    detector._run_bandit_json = lambda _content, **_kwargs: (
        [_BANDIT_ISSUE],
        [],
    )

    findings = await detector.detect("assert True")

    assert len(findings) == 1


def test_init_skips_require_module_when_bandit_is_discoverable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(module, "find_spec", lambda _module_name: object())

    def _require_module_should_not_run(*_args, **_kwargs):
        raise AssertionError("require_module should not run when bandit is discoverable")

    monkeypatch.setattr(module, "require_module", _require_module_should_not_run)

    detector = module.CodeSecurityDetector()
    assert detector.detector_type == "code_security"


def test_init_raises_missing_dependency_when_bandit_is_not_discoverable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(module, "find_spec", lambda _module_name: None)

    def _raise_missing(*_args, **_kwargs):
        raise MissingDependencyError(
            detector_name="code_security",
            dependencies=["bandit"],
            uv_groups=["code-security", "detectors"],
            detail="simulated import failure",
        )

    monkeypatch.setattr(module, "require_module", _raise_missing)

    with pytest.raises(MissingDependencyError):
        module.CodeSecurityDetector()


def test_init_defaults_to_code_security_config_when_no_config_given(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(module, "find_spec", lambda _module_name: object())
    detector = module.CodeSecurityDetector()
    assert isinstance(detector._cfg, CodeSecurityDetectorConfig)


def test_init_accepts_code_security_config(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(module, "find_spec", lambda _module_name: object())
    cfg = CodeSecurityDetectorConfig(skips=["B101"], tests=None, severity_threshold=Severity.high)
    detector = module.CodeSecurityDetector(cfg)
    assert isinstance(detector._cfg, CodeSecurityDetectorConfig)
    # skips is a Skips RootModel wrapping a list of Skip
    assert [s.root for s in detector._cfg.skips.root] == ["B101"]
    assert detector._cfg.severity_threshold == Severity.high
