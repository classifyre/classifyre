"""End to end: an augmentation tag on a known source becomes a finding.

Mirrors test_custom_source_tags_end_to_end.py, but the connector is a real
known source (local folder) and the tag comes from the attached augmentation
notebook rather than from extract(). The chain is the same one a scan walks:
recipe carrying a TAG detector (which the API injects for augmentation-enabled
sources), notebook asserting the tag, pipeline turning it into a finding —
plus the metadata the notebook staged.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from src.augmentation.session import AugmentationSession
from src.models.generated_single_asset_scan_results import DetectorType
from src.pipeline.detector_pipeline import DetectorPipeline
from src.sources.local_folder.source import LocalFolderSource

NOTEBOOK = """def augment(asset):
    asset.set("join_key", "customer:acme")
    if asset.name.endswith(".csv"):
        asset.tag("cardholder_data", "primary-account-numbers")
"""

# What the API injects for an augmentation-enabled source: every active TAG
# detector, since nothing in the stored config can name them.
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


def _recipe(path: Path) -> dict[str, Any]:
    return {
        "type": "LOCAL_FOLDER",
        "required": {"path": str(path)},
        "masked": {},
        "optional": {},
        "sampling": {"strategy": "ALL"},
        "detectors": [TAG_DETECTOR],
        "augmentation": {
            "enabled": True,
            "notebook": {
                "revision": 1,
                "cells": [{"id": "nb", "type": "code", "source": NOTEBOOK}],
            },
            "variables": {},
            "secrets": {},
        },
    }


async def _scan(tmp_path: Path, *, enabled: bool = True) -> tuple[list[Any], Any]:
    (tmp_path / "payments.csv").write_text("card_last4,amount\n4242,240.00\n")
    recipe = _recipe(tmp_path)
    if not enabled:
        recipe.pop("augmentation")
    source = LocalFolderSource(recipe, source_id="src-1", runner_id="run-1")
    session = AugmentationSession.from_recipe(recipe, source)
    if session is not None:
        source.attach_augmentation(session)
        await session.startup()
    try:
        assets: list[Any] = []
        async for batch in source.extract_raw():
            assets.extend(batch)
        if session is not None:
            for asset in assets:
                await session.augment(asset)
                session.evict(asset)
            await session.finish()
        pipeline = DetectorPipeline.from_recipe(recipe, source, runner_id="run-1")
        return await pipeline.process(assets), session
    finally:
        if session is not None:
            session.close()
        source.cleanup()


async def test_augmentation_tag_becomes_a_finding(tmp_path: Path) -> None:
    results, session = await _scan(tmp_path)
    assert len(results) == 1
    findings = results[0].findings or []
    assert len(findings) == 1
    finding = findings[0]
    assert finding.detector_type == DetectorType.CUSTOM
    assert finding.matched_content == "primary-account-numbers"
    assert results[0].metadata.get("augmentation") == {"join_key": "customer:acme"}
    assert session is not None and session.stats.assets_augmented == 1


async def test_disabled_augmentation_behaves_as_before(tmp_path: Path) -> None:
    results, session = await _scan(tmp_path, enabled=False)
    assert session is None
    assert len(results) == 1
    assert (results[0].findings or []) == []
    assert "augmentation" not in (results[0].metadata or {})


async def test_broken_notebook_ingests_byte_identically(tmp_path: Path) -> None:
    (tmp_path / "payments.csv").write_text("card_last4,amount\n4242,240.00\n")
    good, _ = await _scan(tmp_path, enabled=False)

    broken_recipe = _recipe(tmp_path)
    broken_recipe["augmentation"]["notebook"]["cells"] = [
        {
            "id": "nb",
            "type": "code",
            "source": "def augment(asset):\n    raise RuntimeError('boom')\n",
        }
    ]
    source = LocalFolderSource(broken_recipe, source_id="src-1", runner_id="run-1")
    session = AugmentationSession.from_recipe(broken_recipe, source)
    assert session is not None
    source.attach_augmentation(session)
    try:
        await session.startup()
        assets: list[Any] = []
        async for batch in source.extract_raw():
            assets.extend(batch)
        for asset in assets:
            await session.augment(asset)
        await session.finish()
        pipeline = DetectorPipeline.from_recipe(broken_recipe, source, runner_id="run-1")
        broken = await pipeline.process(assets)
    finally:
        session.close()
        source.cleanup()

    assert len(broken) == 1
    assert (broken[0].findings or []) == []
    assert "augmentation" not in (broken[0].metadata or {})
    # Byte-identical to the run with augmentation disabled.
    assert broken[0].checksum == good[0].checksum
    assert session.stats.assets_failed == 1
    assert session.warnings
