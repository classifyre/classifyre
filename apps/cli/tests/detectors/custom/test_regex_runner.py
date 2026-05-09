"""Unit tests for RegexRunner — pure Python, no ML dependency."""

from __future__ import annotations

import re
from unittest.mock import patch

import pytest

from src.detectors.custom.runners import RegexRunner, create_runner
from src.models.generated_detectors import (
    CustomDetectorConfig,
    RegexPatternDefinition,
    RegexPipelineSchema,
)


def _make_schema(**patterns: str) -> RegexPipelineSchema:
    return RegexPipelineSchema(
        patterns={name: RegexPatternDefinition(pattern=pat) for name, pat in patterns.items()}
    )


def _make_pattern(**kwargs: object) -> RegexPatternDefinition:
    return RegexPatternDefinition(**kwargs)  # type: ignore[arg-type]


class TestRegexRunnerBasics:
    def test_single_pattern_match(self):
        schema = _make_schema(order_id=r"ORD-\d+")
        runner = RegexRunner(schema)
        result = runner.run("Customer order ORD-1234 has been shipped.")

        assert "order_id" in result.entities
        spans = result.entities["order_id"]
        assert len(spans) == 1
        assert spans[0]["value"] == "ORD-1234"
        assert spans[0]["confidence"] == 1.0

    def test_multiple_matches_for_same_pattern(self):
        schema = _make_schema(email=r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")
        runner = RegexRunner(schema)
        result = runner.run("Contact alice@example.com or bob@corp.org for support.")

        assert "email" in result.entities
        assert len(result.entities["email"]) == 2
        values = {s["value"] for s in result.entities["email"]}
        assert "alice@example.com" in values
        assert "bob@corp.org" in values

    def test_no_match_returns_empty_entities(self):
        schema = _make_schema(ssn=r"\d{3}-\d{2}-\d{4}")
        runner = RegexRunner(schema)
        result = runner.run("No social security numbers here.")

        assert result.entities == {}

    def test_multiple_patterns(self):
        schema = _make_schema(
            order_id=r"ORD-\d+",
            sku=r"SKU-[A-Z]{3}\d{4}",
        )
        runner = RegexRunner(schema)
        result = runner.run("Order ORD-999 includes SKU-ABC1234 and SKU-XYZ9876.")

        assert "order_id" in result.entities
        assert "sku" in result.entities
        assert len(result.entities["order_id"]) == 1
        assert len(result.entities["sku"]) == 2

    def test_span_offsets_are_accurate(self):
        text = "Ref ORD-42 end"
        schema = _make_schema(order_id=r"ORD-\d+")
        runner = RegexRunner(schema)
        result = runner.run(text)

        span = result.entities["order_id"][0]
        assert span["start"] == text.index("ORD-42")
        assert span["end"] == text.index("ORD-42") + len("ORD-42")
        assert text[span["start"] : span["end"]] == "ORD-42"

    def test_classification_is_always_empty(self):
        schema = _make_schema(x=r"\d+")
        runner = RegexRunner(schema)
        result = runner.run("42")
        assert result.classification == {}

    def test_metadata_runner_field(self):
        schema = _make_schema(x=r"\d+")
        runner = RegexRunner(schema)
        result = runner.run("123")
        assert result.metadata["runner"] == "REGEX"
        assert "latency_ms" in result.metadata
        assert "timestamp" in result.metadata


class TestRegexRunnerFlags:
    def test_case_insensitive_flag(self):
        schema = RegexPipelineSchema(
            patterns={
                "keyword": RegexPatternDefinition(
                    pattern=r"confidential",
                    flags=re.IGNORECASE,
                )
            }
        )
        runner = RegexRunner(schema)
        result = runner.run("This document is CONFIDENTIAL.")
        assert "keyword" in result.entities

    def test_invalid_pattern_is_skipped(self):
        schema = RegexPipelineSchema(
            patterns={
                "bad": RegexPatternDefinition(pattern=r"[invalid"),
                "good": RegexPatternDefinition(pattern=r"\d+"),
            }
        )
        runner = RegexRunner(schema)
        result = runner.run("123 is a number")
        assert "bad" not in result.entities
        assert "good" in result.entities


class TestCreateRunnerFactory:
    def test_regex_schema_returns_regex_runner(self):
        schema = _make_schema(x=r"\d+")
        runner = create_runner(schema)
        assert isinstance(runner, RegexRunner)

    def test_regex_runner_via_factory_works(self):
        schema = _make_schema(phone=r"\+?\d[\d\s\-]{7,}")
        runner = create_runner(schema)
        result = runner.run("Call us at +49 89 123456789.")
        assert "phone" in result.entities


class TestRegexRunnerNewFields:
    def test_case_insensitive_via_bool(self):
        schema = RegexPipelineSchema(
            patterns={
                "keyword": _make_pattern(pattern=r"secret", case_sensitive=False),
            }
        )
        runner = RegexRunner(schema)
        result = runner.run("The SECRET is out.")
        assert "keyword" in result.entities
        assert result.entities["keyword"][0]["value"] == "SECRET"

    def test_case_sensitive_default(self):
        schema = RegexPipelineSchema(
            patterns={
                "keyword": _make_pattern(pattern=r"secret"),
            }
        )
        runner = RegexRunner(schema)
        result = runner.run("The SECRET is out.")
        assert result.entities == {}

    def test_dot_nl_matches_newline(self):
        schema = RegexPipelineSchema(
            patterns={
                "multiline": _make_pattern(pattern=r"start.end", dot_nl=True),
            }
        )
        runner = RegexRunner(schema)
        result = runner.run("start\nend")
        assert "multiline" in result.entities
        assert result.entities["multiline"][0]["value"] == "start\nend"

    def test_dot_nl_false_does_not_match_newline(self):
        schema = RegexPipelineSchema(
            patterns={
                "multiline": _make_pattern(pattern=r"start.end", dot_nl=False),
            }
        )
        runner = RegexRunner(schema)
        result = runner.run("start\nend")
        assert result.entities == {}

    def test_capture_group_extraction(self):
        schema = RegexPipelineSchema(
            patterns={
                "ticket": _make_pattern(
                    pattern=r"Ticket\s*#?(\d{4,8})",
                    group=1,
                ),
            }
        )
        runner = RegexRunner(schema)
        result = runner.run("See Ticket #12345 for details.")
        assert "ticket" in result.entities
        span = result.entities["ticket"][0]
        assert span["value"] == "12345"

    def test_capture_group_zero_is_default(self):
        schema = RegexPipelineSchema(
            patterns={
                "ticket": _make_pattern(pattern=r"Ticket\s*#?(\d+)", group=0),
            }
        )
        runner = RegexRunner(schema)
        result = runner.run("See Ticket #999.")
        span = result.entities["ticket"][0]
        assert span["value"] == "Ticket #999"

    def test_invalid_group_falls_back_to_zero(self):
        schema = RegexPipelineSchema(
            patterns={
                "no_groups": _make_pattern(pattern=r"\d+", group=5),
            }
        )
        runner = RegexRunner(schema)
        result = runner.run("42")
        span = result.entities["no_groups"][0]
        assert span["value"] == "42"

    def test_severity_in_span(self):
        schema = RegexPipelineSchema(
            patterns={
                "crit": _make_pattern(pattern=r"LEAK-\d+", severity="critical"),
            }
        )
        runner = RegexRunner(schema)
        result = runner.run("Found LEAK-001.")
        span = result.entities["crit"][0]
        assert span["severity"] == "critical"

    def test_severity_absent_when_not_set(self):
        schema = _make_schema(x=r"\d+")
        runner = RegexRunner(schema)
        result = runner.run("42")
        span = result.entities["x"][0]
        assert "severity" not in span

    def test_groups_present_when_captures_exist(self):
        schema = RegexPipelineSchema(
            patterns={
                "kv": _make_pattern(pattern=r"(\w+)=(\w+)"),
            }
        )
        runner = RegexRunner(schema)
        result = runner.run("key=value")
        span = result.entities["kv"][0]
        assert span["groups"] == ("key", "value")

    def test_groups_absent_when_no_captures(self):
        schema = _make_schema(num=r"\d+")
        runner = RegexRunner(schema)
        result = runner.run("42")
        span = result.entities["num"][0]
        assert "groups" not in span

    def test_literal_mode(self):
        schema = RegexPipelineSchema(
            patterns={
                "dot_literal": _make_pattern(pattern=r"price is $5.00", literal=True),
            }
        )
        runner = RegexRunner(schema)
        result = runner.run("The price is $5.00 today")
        assert "dot_literal" in result.entities
        assert result.entities["dot_literal"][0]["value"] == "price is $5.00"

    def test_literal_mode_does_not_match_regex(self):
        schema = RegexPipelineSchema(
            patterns={
                "dot_literal": _make_pattern(pattern=r"a.b", literal=True),
            }
        )
        runner = RegexRunner(schema)
        result = runner.run("axb")
        assert result.entities == {}


class TestRegexRunnerEngine:
    def test_metadata_contains_engine_field(self):
        schema = _make_schema(x=r"\d+")
        runner = RegexRunner(schema)
        result = runner.run("42")
        assert "engine" in result.metadata
        assert result.metadata["engine"] in ("RE2", "stdlib-re")

    def test_fallback_to_stdlib_when_re2_unavailable(self):
        from src.detectors.custom import runners as runners_module

        def mock_load() -> tuple[object, bool]:
            return re, False

        with patch.object(runners_module, "_load_regex_engine", mock_load):
            schema = _make_schema(x=r"\d+")
            runner = RegexRunner(schema)
            result = runner.run("42")
            assert result.metadata["engine"] == "stdlib-re"
            assert "x" in result.entities


class TestCustomDetectorRegexSeverity:
    @pytest.mark.asyncio
    async def test_per_pattern_severity_flows_to_finding(self):
        from src.detectors.custom.detector import CustomDetector

        config = CustomDetectorConfig(
            custom_detector_key="test_sev",
            name="Severity Test",
            pipeline_schema=RegexPipelineSchema(
                patterns={
                    "critical_leak": _make_pattern(pattern=r"SECRET-\d+", severity="critical"),
                    "info_ref": _make_pattern(pattern=r"REF-\d+", severity="info"),
                    "default_sev": _make_pattern(pattern=r"CODE-\d+"),
                }
            ),
        )
        detector = CustomDetector(config)
        findings = await detector.detect("Found SECRET-123 and REF-456 and CODE-789.")

        by_type = {f.finding_type: f for f in findings}
        assert by_type["regex:critical_leak"].severity.value == "critical"
        assert by_type["regex:info_ref"].severity.value == "info"
        assert by_type["regex:default_sev"].severity.value == "high"

    @pytest.mark.asyncio
    async def test_capture_groups_in_metadata(self):
        from src.detectors.custom.detector import CustomDetector

        config = CustomDetectorConfig(
            custom_detector_key="test_groups",
            name="Groups Test",
            pipeline_schema=RegexPipelineSchema(
                patterns={
                    "kv": _make_pattern(pattern=r"(\w+)=(\w+)", group=1),
                }
            ),
        )
        detector = CustomDetector(config)
        findings = await detector.detect("key=value")

        assert len(findings) == 1
        assert findings[0].matched_content == "key"
        assert findings[0].metadata is not None
        assert findings[0].metadata["capture_groups"] == ("key", "value")

    @pytest.mark.asyncio
    async def test_empty_content_returns_no_findings(self):
        from src.detectors.custom.detector import CustomDetector

        config = CustomDetectorConfig(
            custom_detector_key="test_empty",
            name="Empty Test",
            pipeline_schema=RegexPipelineSchema(patterns={"x": _make_pattern(pattern=r"\d+")}),
        )
        detector = CustomDetector(config)
        assert await detector.detect("") == []
        assert await detector.detect(b"binary content") == []

    @pytest.mark.asyncio
    async def test_max_findings_cap(self):
        from src.detectors.custom.detector import CustomDetector

        config = CustomDetectorConfig(
            custom_detector_key="test_cap",
            name="Cap Test",
            max_findings=2,
            pipeline_schema=RegexPipelineSchema(patterns={"num": _make_pattern(pattern=r"\d+")}),
        )
        detector = CustomDetector(config)
        findings = await detector.detect("1 2 3 4 5")
        assert len(findings) == 2
