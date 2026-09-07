"""End to end: a notebook tag becomes a finding.

This walks the whole chain the way a scan does — a recipe carrying a TAG
detector (which the API injects for every CUSTOM source), a notebook that
attaches a tag to an asset, and the detector pipeline that turns one into the
other. The unit tests cover each link; this proves they are actually connected.
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from src.models.generated_detectors import Severity
from src.models.generated_single_asset_scan_results import DetectorType
from src.pipeline.detector_pipeline import DetectorPipeline
from src.sources import get_source

NOTEBOOK = """from classifyre import Asset


def test_connection() -> dict:
    return {"status": "SUCCESS", "message": "Ready."}


def extract():
    yield Asset(
        id="prod.payments.transactions",
        name="transactions",
        content="card_last4,amount\\n4242,240.00\\n",
        kind="table",
        tags={"cardholder_data": "primary-account-numbers"},
    )
    yield Asset(
        id="prod.analytics.daily_active",
        name="daily_active",
        content="day,users\\n2026-08-01,18422\\n",
        kind="table",
    )
"""

# What CustomDetectorsService.buildRuntimeTagDetectors() puts in the recipe.
TAG_DETECTOR = {
    "type": "CUSTOM",
    "enabled": True,
    "config": {
        "custom_detector_key": "cardholder_data",
        "name": "Cardholder Data",
        "description": "Marks assets the catalog already classified",
        "pipeline_schema": {
            "type": "TAG",
            "label": "Cardholder data",
            "severity": "high",
        },
    },
}


def build_recipe(notebook: str = NOTEBOOK) -> dict[str, Any]:
    return {
        "type": "CUSTOM",
        "required": {
            "notebook": {
                "revision": 1,
                "cells": [{"id": "nb", "type": "code", "source": notebook}],
            }
        },
        "sampling": {"strategy": "ALL", "rows_per_page": 100},
        "detectors": [TAG_DETECTOR],
    }


@pytest.fixture
def scan(request: pytest.FixtureRequest):
    def run(recipe: dict[str, Any] | None = None) -> list[Any]:
        recipe = recipe or build_recipe()
        source = get_source(recipe, source_id="src-1", runner_id="run-1")
        request.addfinalizer(source.cleanup)
        pipeline = DetectorPipeline.from_recipe(recipe, source, runner_id="run-1")

        async def go() -> list[Any]:
            assets: list[Any] = []
            async for batch in source.extract_raw():
                assets.extend(batch)
            return await pipeline.process(assets)

        return asyncio.run(go())

    return run


def test_a_tagged_asset_gets_a_finding(scan) -> None:
    tagged = next(r for r in scan() if r.name == "transactions")

    findings = tagged.findings or []
    assert len(findings) == 1
    finding = findings[0]
    assert finding.detector_type == DetectorType.CUSTOM
    assert finding.custom_detector_key == "cardholder_data"
    assert finding.custom_detector_name == "Cardholder Data"
    assert finding.finding_type == "tag:Cardholder data"
    assert finding.severity == Severity.high
    assert finding.confidence == 1.0
    assert finding.matched_content == "primary-account-numbers"
    # The location path is what makes a finding clickable back to the asset.
    assert finding.location is not None
    assert finding.location.path


def test_an_untagged_asset_gets_nothing(scan) -> None:
    # The tag detector is in the recipe for every asset in the run; it must not
    # fire on one that carries no tag.
    plain = next(r for r in scan() if r.name == "daily_active")
    assert not (plain.findings or [])


def test_changing_a_tag_value_changes_the_asset(scan) -> None:
    # The value is part of the finding's identity, and the checksum is what
    # decides whether the asset is re-scanned at all.
    before = next(r for r in scan() if r.name == "transactions")
    revised = NOTEBOOK.replace("primary-account-numbers", "tokenized-pan")
    after = next(r for r in scan(build_recipe(revised)) if r.name == "transactions")

    assert before.hash == after.hash
    assert before.checksum != after.checksum
    assert (after.findings or [])[0].matched_content == "tokenized-pan"


def test_an_unknown_key_warns_instead_of_failing(scan) -> None:
    typo = NOTEBOOK.replace('"cardholder_data"', '"cardholderdata"')
    tagged = next(r for r in scan(build_recipe(typo)) if r.name == "transactions")

    assert not (tagged.findings or [])
    warnings = tagged.scan_stats.warnings or []
    assert any("cardholderdata" in w for w in warnings)
