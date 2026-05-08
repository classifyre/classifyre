"""Tests for the YARA threat detector."""

import pytest

from src.detectors.threat.yara_detector import YaraDetector
from src.models.generated_detectors import DetectorConfig, Severity, ThreatDetectorConfig, YaraRuleConfig


# ---------------------------------------------------------------------------
# Shared rule helpers
# ---------------------------------------------------------------------------

def _malware_rules() -> list[YaraRuleConfig]:
    return [
        YaraRuleConfig(
            name="Process_Injection_APIs",
            severity=Severity.critical,
            category="malware",
            strings=[
                "\"CreateRemoteThread\" nocase ascii",
                "\"VirtualAllocEx\" nocase ascii",
                "\"WriteProcessMemory\" nocase ascii",
            ],
            condition="2 of ($s*)",
        )
    ]


def _script_rules() -> list[YaraRuleConfig]:
    return [
        YaraRuleConfig(
            name="Shell_Curl_Pipe_Exec",
            severity=Severity.high,
            category="suspicious_scripts",
            strings=[
                "/curl|wget/ ascii",
                "/\\| bash|\\| sh/ ascii",
            ],
            condition="$s0 and $s1",
        )
    ]


def _detector_with(rules: list[YaraRuleConfig], **kwargs: object) -> YaraDetector:
    return YaraDetector(ThreatDetectorConfig(rules=rules, **kwargs))


# ---------------------------------------------------------------------------
# Initialization
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_initialization_defaults():
    det = YaraDetector()
    assert det.detector_type == "yara"
    assert det.detector_name == "yara"
    assert det.config is not None


@pytest.mark.asyncio
async def test_initialization_with_rules():
    det = _detector_with(_malware_rules())
    assert det._rules is not None


@pytest.mark.asyncio
async def test_no_rules_produces_no_findings():
    det = YaraDetector(ThreatDetectorConfig(rules=None))
    results = await det.detect("CreateRemoteThread VirtualAllocEx WriteProcessMemory")
    assert results == []


# ---------------------------------------------------------------------------
# Detection — positive cases
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_detects_malware_pattern(sample_malware_pattern):
    det = _detector_with(_malware_rules())
    results = await det.detect(sample_malware_pattern, content_type="application/octet-stream")

    assert len(results) >= 1
    for r in results:
        assert r.severity in (Severity.high, Severity.critical)
        assert r.category == "THREAT"


@pytest.mark.asyncio
async def test_detects_suspicious_script(sample_suspicious_script):
    det = _detector_with(_script_rules())
    results = await det.detect(sample_suspicious_script, content_type="application/x-sh")

    assert len(results) >= 1


@pytest.mark.asyncio
async def test_detects_with_string_content():
    det = _detector_with(_malware_rules())
    results = await det.detect("CreateRemoteThread VirtualAllocEx WriteProcessMemory")

    assert len(results) >= 1


@pytest.mark.asyncio
async def test_detects_any_of_them_condition():
    rules = [
        YaraRuleConfig(
            name="Known_Tools",
            severity=Severity.critical,
            category="malware",
            strings=["\"mimikatz\" nocase ascii", "\"cobaltstrike\" nocase ascii"],
            condition="any of them",
        )
    ]
    det = _detector_with(rules)
    results = await det.detect("found mimikatz in memory dump")
    assert len(results) >= 1
    assert results[0].finding_type == "Known_Tools"


@pytest.mark.asyncio
async def test_detects_regex_pattern():
    rules = [
        YaraRuleConfig(
            name="AWS_Key",
            severity=Severity.critical,
            category="secrets",
            strings=["/AKIA[0-9A-Z]{16}/ ascii"],
            condition="any of them",
        )
    ]
    det = _detector_with(rules)
    results = await det.detect("key = AKIAIOSFODNN7EXAMPLE123")
    assert len(results) >= 1


@pytest.mark.asyncio
async def test_multiple_rules_both_fire():
    rules = [
        YaraRuleConfig(
            name="Rule_A",
            severity=Severity.high,
            category="test",
            strings=["\"mimikatz\" nocase ascii"],
            condition="any of them",
        ),
        YaraRuleConfig(
            name="Rule_B",
            severity=Severity.critical,
            category="test",
            strings=["\"msfvenom\" nocase ascii"],
            condition="any of them",
        ),
    ]
    det = _detector_with(rules)
    results = await det.detect("using mimikatz and msfvenom together")
    assert len(results) == 2


# ---------------------------------------------------------------------------
# Detection — negative / clean cases
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_no_false_positives_clean_text(sample_clean_text_bytes):
    det = _detector_with(_malware_rules() + _script_rules())
    results = await det.detect(sample_clean_text_bytes)
    assert results == []


@pytest.mark.asyncio
async def test_no_false_positives_clean_script(sample_clean_script):
    det = _detector_with(_script_rules())
    results = await det.detect(sample_clean_script)
    high_and_above = [r for r in results if r.severity in (Severity.high, Severity.critical)]
    assert len(high_and_above) == 0


# ---------------------------------------------------------------------------
# Result structure
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_result_structure(sample_malware_pattern):
    det = _detector_with(_malware_rules())
    results = await det.detect(sample_malware_pattern)

    assert len(results) >= 1
    for r in results:
        assert hasattr(r, "finding_type")
        assert hasattr(r, "category")
        assert hasattr(r, "severity")
        assert hasattr(r, "confidence")
        assert hasattr(r, "matched_content")
        assert r.category == "THREAT"
        assert 0.0 <= r.confidence <= 1.0


@pytest.mark.asyncio
async def test_location_populated(sample_malware_pattern):
    det = _detector_with(_malware_rules())
    results = await det.detect(sample_malware_pattern, content_type="application/octet-stream")
    assert results[0].location is not None
    assert "application/octet-stream" in results[0].location.path


@pytest.mark.asyncio
async def test_metadata_contains_rule_name(sample_malware_pattern):
    det = _detector_with(_malware_rules())
    results = await det.detect(sample_malware_pattern)
    meta = results[0].metadata or {}
    assert "rule" in meta
    assert meta["rule"] == "Process_Injection_APIs"


# ---------------------------------------------------------------------------
# Config controls
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_confidence_threshold_filters(sample_malware_pattern):
    det = _detector_with(_malware_rules(), confidence_threshold=0.99)
    results = await det.detect(sample_malware_pattern)
    for r in results:
        assert r.confidence >= 0.99


@pytest.mark.asyncio
async def test_max_findings_respected(sample_malware_pattern):
    rules = [
        YaraRuleConfig(
            name=f"Rule_{i}",
            severity=Severity.high,
            category="test",
            strings=["\"CreateRemoteThread\" nocase ascii"],
            condition="any of them",
        )
        for i in range(5)
    ]
    det = _detector_with(rules, max_findings=2)
    results = await det.detect(sample_malware_pattern)
    assert len(results) <= 2


@pytest.mark.asyncio
async def test_results_sorted_by_severity_desc():
    rules = [
        YaraRuleConfig(
            name="Low_Rule",
            severity=Severity.low,
            category="test",
            strings=["\"CreateRemoteThread\" nocase ascii"],
            condition="any of them",
        ),
        YaraRuleConfig(
            name="Critical_Rule",
            severity=Severity.critical,
            category="test",
            strings=["\"VirtualAllocEx\" nocase ascii"],
            condition="any of them",
        ),
    ]
    det = _detector_with(rules)
    results = await det.detect("CreateRemoteThread VirtualAllocEx")
    assert len(results) == 2
    assert results[0].severity == Severity.critical


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_handles_empty_bytes():
    det = _detector_with(_malware_rules())
    results = await det.detect(b"")
    assert isinstance(results, list)


@pytest.mark.asyncio
async def test_handles_empty_string():
    det = _detector_with(_malware_rules())
    results = await det.detect("")
    assert isinstance(results, list)


@pytest.mark.asyncio
async def test_handles_large_content():
    det = _detector_with(_malware_rules())
    results = await det.detect(b"A" * 1_000_000)
    assert isinstance(results, list)


@pytest.mark.asyncio
async def test_handles_bytes_input(sample_malware_pattern):
    det = _detector_with(_malware_rules())
    results = await det.detect(sample_malware_pattern)
    assert isinstance(results, list)


# ---------------------------------------------------------------------------
# Metadata
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_supported_content_types():
    det = YaraDetector()
    types = det.get_supported_content_types()
    assert "application/octet-stream" in types
    assert "text/plain" in types
    assert isinstance(types, list)


@pytest.mark.asyncio
async def test_detector_metadata():
    det = YaraDetector()
    meta = det.get_metadata()
    assert meta["detector_type"] == "yara"
    assert meta["detector_name"] == "yara"
    assert "content_types" in meta
    assert meta["requires_gpu"] is False
