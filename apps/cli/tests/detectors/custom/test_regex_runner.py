"""Unit tests for RegexRunner — pure Python, no ML dependency."""

from __future__ import annotations

import re

from src.detectors.custom.runners import RegexRunner, create_runner
from src.models.generated_detectors import RegexPatternDefinition, RegexPipelineSchema


def _make_schema(**patterns: str) -> RegexPipelineSchema:
    return RegexPipelineSchema(
        patterns={name: RegexPatternDefinition(pattern=pat) for name, pat in patterns.items()}
    )


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
