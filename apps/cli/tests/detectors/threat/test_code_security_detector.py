"""Unit tests for CodeSecurityDetector."""

import pytest

from src.detectors.base import BaseDetector
from src.detectors.dependencies import MissingDependencyError
from src.detectors.threat import code_security_detector as module
from src.models.generated_detectors import DetectorConfig, Severity
from src.models.generated_single_asset_scan_results import DetectorType


def _stub_detector() -> module.CodeSecurityDetector:
    detector = module.CodeSecurityDetector.__new__(module.CodeSecurityDetector)
    BaseDetector.__init__(detector, DetectorConfig(confidence_threshold=0.7))
    return detector


@pytest.mark.asyncio
async def test_detect_maps_bandit_issue() -> None:
    detector = _stub_detector()
    detector._run_bandit_json = lambda _content: (
        [
            {
                "issue_text": "Use of assert detected.",
                "issue_severity": "LOW",
                "issue_confidence": "HIGH",
                "line_number": 3,
                "test_name": "assert_used",
                "test_id": "B101",
                "code": "assert user.is_admin",
            }
        ],
        [],
    )

    findings = await detector.detect("def f(user):\n    assert user.is_admin\n")

    assert len(findings) == 1
    finding = findings[0]
    assert finding.detector_type == DetectorType.CODE_SECURITY
    assert finding.finding_type == "B101"
    assert finding.severity == Severity.low
    assert finding.category == "SECURITY"


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
