"""Code detectors (``CODE_DETECTOR``) against a real child process.

Each test earns its process: the wire (handshake, detect round trip, lazy
payload, setup), the parent-side enforcement (severity ceiling, declared
fields, identity, row locations) and failure containment (exceptions,
timeouts, the consecutive-failure switch).
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from types import SimpleNamespace
from typing import Any

import pytest

from src.detectors.custom_detector.sdk import DetectorAsset, Finding, iter_findings
from src.detectors.custom_detector.session import CustomDetectorSession
from src.models.generated_single_asset_scan_results import (
    DetectionResult,
    DetectorType,
    Severity,
)
from src.sources.base import BaseSource

ROWS_NOTEBOOK = """from classifyre import Finding, Location


def setup(ctx):
    ctx.state["limit"] = float(ctx.var("limit", "100"))


def detect(asset, ctx):
    for index, row in enumerate(asset.rows()):
        total = float(row["total"])
        parts = float(row["a"]) + float(row["b"])
        if abs(total - parts) > 0.001:
            yield Finding(
                label="total_mismatch",
                value=f"total {total:g} != {parts:g}",
                severity="critical",
                location=Location(row=index, column_name="total"),
                message="Total does not equal the sum of its parts",
                fields={"expected": parts, "actual": total, "undeclared": 1},
                identity=f"row-{row['id']}",
                normalized_value=str(row["id"]),
            )
        if total > ctx.state["limit"]:
            yield Finding(label="over_limit", value=str(total), severity="low")
"""


class FakeSource(BaseSource):
    source_type = "fakesource"

    def __init__(self, recipe: dict[str, Any], pages: list[tuple[str, str]]) -> None:
        super().__init__(recipe)
        self._pages = pages
        self.page_reads = 0

    def test_connection(self) -> dict[str, Any]:
        return {"status": "SUCCESS", "message": "fake"}

    async def extract_raw(self) -> AsyncGenerator[list[Any], None]:
        yield []

    def generate_hash_id(self, asset_id: str) -> str:
        return f"hash:{asset_id}"

    def abort(self) -> None:
        super().abort()

    async def fetch_content_bytes(self, asset_id: str) -> tuple[bytes, str] | None:
        return None

    async def fetch_content_pages(self, asset_id: str) -> AsyncGenerator[tuple[str, str], None]:
        self.page_reads += 1
        for page in self._pages:
            yield page


def _rows_source() -> FakeSource:
    rows = (
        '[{"id": 1, "a": 1, "b": 2, "total": 3},'
        ' {"id": 2, "a": 5, "b": 5, "total": 11},'
        ' {"id": 3, "a": 100, "b": 50, "total": 150}]'
    )
    return FakeSource({"type": "FAKESOURCE"}, [(rows, "id a b total")])


def _asset(**overrides: Any) -> SimpleNamespace:
    base: dict[str, Any] = {
        "hash": "hash:a",
        "name": "table-a",
        "asset_kind": "table",
        "external_url": "fake://a",
        "metadata": {"external_id": "a"},
    }
    base.update(overrides)
    return SimpleNamespace(**base)


def _schema(source: str, **overrides: Any) -> dict[str, Any]:
    schema: dict[str, Any] = {
        "type": "CODE_DETECTOR",
        "notebook": {"revision": 1, "cells": [{"id": "c1", "type": "code", "source": source}]},
        "severity": "high",
        "fields": [
            {"name": "expected", "type": "number"},
            {"name": "actual", "type": "number"},
        ],
        "variables": {"limit": "120"},
    }
    schema.update(overrides)
    return schema


def _session(schema: dict[str, Any], source: Any) -> CustomDetectorSession:
    return CustomDetectorSession(key="de_dq_totals", name="Totals", schema=schema, source=source)


def _by_label(findings: list[DetectionResult]) -> dict[str, list[DetectionResult]]:
    grouped: dict[str, list[DetectionResult]] = {}
    for finding in findings:
        grouped.setdefault(finding.finding_type, []).append(finding)
    return grouped


async def test_rows_rule_maps_findings_with_ceiling_fields_identity_and_location() -> None:
    source = _rows_source()
    session = _session(_schema(ROWS_NOTEBOOK), source)
    try:
        outcome = await session.detect(_asset())
    finally:
        session.close()

    assert outcome.ok, outcome.error
    by_label = _by_label(outcome.findings)
    [mismatch] = by_label["total_mismatch"]
    assert mismatch.detector_type == DetectorType.CUSTOM
    assert mismatch.custom_detector_key == "de_dq_totals"
    assert mismatch.category == "QUALITY"
    assert mismatch.extraction_method == "CODE_DETECTOR"
    # Severity is a ceiling: "critical" was asked for, "high" is the cap.
    assert mismatch.severity == Severity.high
    assert mismatch.metadata is not None
    assert mismatch.metadata["severity_requested"] == "critical"
    assert mismatch.metadata["tabular_row_index"] == 1
    assert mismatch.metadata["tabular_column_name"] == "total"
    assert mismatch.metadata["normalized_value"] == "2"
    assert mismatch.metadata["message"] == "Total does not equal the sum of its parts"
    assert mismatch.identity_key == "row-2"
    # Only declared fields survive, and the dropped one warns.
    assert mismatch.extracted_data == {"expected": 10.0, "actual": 11.0}
    assert any("undeclared" in warning for warning in outcome.warnings)
    # setup() read the variable into ctx.state.
    [over] = by_label["over_limit"]
    assert over.matched_content == "150.0"
    assert over.severity == Severity.low
    assert "severity_requested" not in (over.metadata or {})


async def test_print_in_user_code_does_not_corrupt_the_channel() -> None:
    notebook = (
        "print('loading the notebook')\n\n"
        "def setup(ctx):\n    print('in setup')\n\n"
        "def detect(asset, ctx):\n"
        "    print('judging', asset.name)\n"
        "    yield Finding(label='seen', value=asset.name)\n"
    )
    session = _session(_schema(notebook), _rows_source())
    try:
        outcome = await session.detect(_asset())
    finally:
        session.close()
    assert outcome.ok, outcome.error
    assert [f.finding_type for f in outcome.findings] == ["seen"]


async def test_payload_is_fetched_once_and_nothing_yielded_is_ok() -> None:
    source = _rows_source()
    notebook = "def detect(asset):\n    list(asset.rows())\n    list(asset.rows())\n"
    session = _session(_schema(notebook), source)
    try:
        outcome = await session.detect(_asset())
    finally:
        session.close()
    assert outcome.ok and outcome.findings == []
    assert source.page_reads == 1


async def test_exception_is_contained_and_repeated_failures_disable() -> None:
    notebook = "def detect(asset, ctx):\n    raise ValueError('boom on ' + asset.name)\n"
    session = _session(_schema(notebook, limits={"max_consecutive_failures": 2}), _rows_source())
    try:
        first = await session.detect(_asset())
        second = await session.detect(_asset(hash="hash:b", name="b"))
        third = await session.detect(_asset(hash="hash:c", name="c"))
    finally:
        session.close()
    assert first.error is not None and "boom on table-a" in first.error
    assert second.error is not None
    assert third.error is not None and "disabled after 2 consecutive failures" in third.error


async def test_timeout_restarts_the_child_for_the_next_asset() -> None:
    notebook = (
        "import time\n\n"
        "def detect(asset):\n"
        "    if asset.name == 'slow':\n"
        "        time.sleep(5)\n"
        "    yield Finding(label='seen', value=asset.name)\n"
    )
    session = _session(_schema(notebook, limits={"per_asset_timeout_seconds": 1}), _rows_source())
    try:
        slow = await session.detect(_asset(name="slow"))
        fast = await session.detect(_asset(hash="hash:f", name="fast"))
    finally:
        session.close()
    assert slow.error is not None and "timed out" in slow.error
    assert fast.ok and [f.matched_content for f in fast.findings] == ["fast"]


async def test_missing_detect_is_a_contract_error() -> None:
    session = _session(_schema("def setup(ctx):\n    pass\n"), _rows_source())
    try:
        outcome = await session.detect(_asset())
    finally:
        session.close()
    assert outcome.error is not None and "detect" in outcome.error


async def test_writers_refuse_and_secrets_are_redacted() -> None:
    notebook = (
        "def detect(asset, ctx):\n"
        "    yield Finding(label='leak', value='token=' + ctx.secret('api_token'))\n"
        "    asset.set('x', 1)\n"
    )
    session = _session(_schema(notebook, secrets={"api_token": "s3cr3t-value-123"}), _rows_source())
    try:
        outcome = await session.detect(_asset())
    finally:
        session.close()
    # The writer raised, so the asset failed -- a detector cannot write.
    assert outcome.error is not None and "not available to a detector" in outcome.error
    assert "s3cr3t-value-123" not in outcome.error


async def test_needs_findings_exposes_prior_findings_only_when_enabled() -> None:
    notebook = (
        "def detect(asset, ctx):\n"
        "    ibans = [f for f in asset.findings if f.type == 'IBAN']\n"
        "    if ibans:\n"
        "        yield Finding(label='iban_and_health', value=ibans[0].value)\n"
    )
    prior = [
        DetectionResult(
            detector_type=DetectorType.PII,
            finding_type="IBAN",
            category="PRIVACY",
            severity=Severity.high,
            confidence=0.9,
            matched_content="DE89370400440532013000",
        )
    ]
    enabled = _session(_schema(notebook, needs_findings=True), _rows_source())
    disabled = _session(_schema(notebook), _rows_source())
    try:
        seen = await enabled.detect(_asset(), prior)
        refused = await disabled.detect(_asset(), prior)
    finally:
        enabled.close()
        disabled.close()
    assert seen.ok and [f.matched_content for f in seen.findings] == ["DE89370400440532013000"]
    assert refused.error is not None and "needs_findings" in refused.error


def test_detector_asset_is_read_only() -> None:
    asset = DetectorAsset(hash="h", name="n")
    for call in (
        lambda: asset.set("k", "v"),
        lambda: asset.tag("k", "v"),
        lambda: asset.link("other"),
        lambda: asset.set_urn("urn:x"),
    ):
        with pytest.raises(TypeError, match="never changes it"):
            call()


def test_iter_findings_accepts_findings_dicts_and_rejects_strings() -> None:
    payloads = list(
        iter_findings(
            [Finding(label="a", value=1), {"label": "b", "value": "x", "severity": "LOW"}]
        )
    )
    assert payloads[0] == {"label": "a", "value": "1", "confidence": 1.0}
    assert payloads[1]["severity"] == "low"
    with pytest.raises(TypeError, match="Finding"):
        list(iter_findings("oops"))
    with pytest.raises(ValueError, match="confidence"):
        list(iter_findings([Finding(label="a", value="x", confidence=2)]))
    with pytest.raises(ValueError, match="Unknown location key"):
        list(iter_findings([Finding(label="a", value="x", location={"page": 3})]))
