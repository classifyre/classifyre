"""End to end: a code detector (``CUSTOM_DETECTOR``) inside a real scan pipeline.

A local folder source, the detector pipeline built from a recipe exactly as a
scan builds it, and the rule judging each asset after every other detector.
What matters here is what the API later reads off the result: the findings,
and one detector outcome per asset -- OK whether or not the rule fired (so a
finding it stopped producing resolves, GENESIS P4), ERROR when it failed (so
nothing it found before is resolved).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from src.models.generated_single_asset_scan_results import DetectorType, Status
from src.pipeline.detector_pipeline import DetectorPipeline
from src.pipeline.scan_cache import ScanCache, detector_fingerprint
from src.sources.local_folder.source import LocalFolderSource

RULE = """def detect(asset, ctx):
    text = asset.text()
    if "4242" in text:
        yield Finding(label="card_in_file", value="4242", identity="last4", severity="high")
"""


def _detector(source: str, key: str = "card_rule", **schema: Any) -> dict[str, Any]:
    return {
        "type": "CUSTOM",
        "enabled": True,
        "config": {
            "custom_detector_key": key,
            "name": key.replace("_", " ").title(),
            "pipeline_schema": {
                "type": "CUSTOM_DETECTOR",
                "notebook": {
                    "revision": 1,
                    "cells": [{"id": "rule", "type": "code", "source": source}],
                },
                "severity": "medium",
                **schema,
            },
        },
    }


def _recipe(path: Path, detectors: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "type": "LOCAL_FOLDER",
        "required": {"path": str(path)},
        "masked": {},
        "optional": {},
        "sampling": {"strategy": "ALL"},
        "detectors": detectors,
    }


async def _scan(path: Path, detectors: list[dict[str, Any]]) -> list[Any]:
    recipe = _recipe(path, detectors)
    source = LocalFolderSource(recipe, source_id="src-1", runner_id="run-1")
    pipeline = DetectorPipeline.from_recipe(recipe, source, runner_id="run-1")
    try:
        assert not pipeline.init_warnings, pipeline.init_warnings
        assets: list[Any] = []
        async for batch in source.extract_raw():
            assets.extend(batch)
        return await pipeline.process(assets)
    finally:
        pipeline.close()
        source.cleanup()


def _outcome(asset: Any, key: str) -> Any:
    outcomes = asset.scan_stats.detector_outcomes or []
    return next(o for o in outcomes if o.custom_detector_key == key)


async def test_rule_fires_then_stops_firing_and_still_reports_ok(tmp_path: Path) -> None:
    file = tmp_path / "payments.txt"
    file.write_text("card 4242 paid 240.00\n")

    [first] = await _scan(tmp_path, [_detector(RULE)])
    [finding] = first.findings
    assert finding.detector_type == DetectorType.CUSTOM
    assert finding.finding_type == "card_in_file"
    assert finding.identity_key == "last4"
    assert _outcome(first, "card_rule").status == Status.OK

    file.write_text("nothing to see here\n")
    [second] = await _scan(tmp_path, [_detector(RULE)])
    assert second.findings == []
    # OK with no findings is what lets the API resolve the first run's finding.
    assert _outcome(second, "card_rule").status == Status.OK


async def test_a_broken_rule_records_error_and_leaves_other_rules_alone(tmp_path: Path) -> None:
    (tmp_path / "payments.txt").write_text("card 4242\n")
    broken = _detector("def detect(asset):\n    raise RuntimeError('bad rule')\n", key="broken")

    [asset] = await _scan(tmp_path, [broken, _detector(RULE)])

    assert _outcome(asset, "broken").status == Status.ERROR
    assert "bad rule" in (_outcome(asset, "broken").error or "")
    assert _outcome(asset, "card_rule").status == Status.OK
    assert [f.finding_type for f in asset.findings] == ["card_in_file"]
    assert any("bad rule" in warning for warning in asset.scan_stats.warnings or [])


async def test_out_of_scope_asset_records_no_outcome(tmp_path: Path) -> None:
    (tmp_path / "payments.txt").write_text("card 4242\n")
    scoped = _detector(RULE, scope={"asset_kinds": ["record"]})

    [asset] = await _scan(tmp_path, [scoped])

    assert asset.findings == []
    outcomes = asset.scan_stats.detector_outcomes or []
    assert all(o.custom_detector_key != "card_rule" for o in outcomes)


def test_fingerprint_ignores_secrets_and_urls_but_not_code_or_files() -> None:
    base = _detector(
        RULE,
        secrets={"token": "a"},
        files_runtime=[{"id": "f1", "name": "list.csv", "content_hash": "h1", "url": "http://a/x"}],
    )["config"]
    rotated = _detector(
        RULE,
        secrets={"token": "b"},
        files_runtime=[{"id": "f1", "name": "list.csv", "content_hash": "h1", "url": "http://b/y"}],
    )["config"]
    new_file = _detector(
        RULE, files_runtime=[{"id": "f1", "name": "list.csv", "content_hash": "h2"}]
    )["config"]
    edited = _detector(RULE + "\n# tweak\n")["config"]

    def fp(config: dict[str, Any]) -> str:
        return detector_fingerprint("CUSTOM", config, {})

    assert fp(base) == fp(rotated)
    assert fp(base) != fp(new_file)
    assert fp(_detector(RULE)["config"]) != fp(edited)


def test_non_deterministic_rule_is_never_cached(tmp_path: Path) -> None:
    recipe = _recipe(
        tmp_path,
        [_detector(RULE, key="stable"), _detector(RULE, key="live", deterministic=False)],
    )
    cacheable, always_run = ScanCache._build_fingerprints(recipe)
    assert "CUSTOM::stable" in cacheable
    assert "CUSTOM::live" in always_run
