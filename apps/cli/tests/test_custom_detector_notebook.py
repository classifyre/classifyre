"""The notebook command for code detectors: cell/all/validate and preview_detect."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from src.notebook.cli import run_request
from src.notebook.protocol import ExecutionStatus

RULE = """from classifyre import Finding


def setup(ctx):
    ctx.state["needle"] = ctx.var("needle")
    ctx.log("setup done")


def detect(asset, ctx):
    ctx.log(f"judging {asset.name}")
    if ctx.state["needle"] in asset.text():
        yield Finding(label="needle", value=ctx.state["needle"], location={"line": 1})
"""


def _detector(source: str = RULE) -> dict[str, Any]:
    return {
        "key": "needle_rule",
        "name": "Needle rule",
        "pipeline_schema": {
            "type": "CODE_DETECTOR",
            "notebook": {"revision": 3, "cells": [{"id": "c1", "type": "code", "source": source}]},
            "variables": {"needle": "haystack-needle"},
        },
    }


def test_run_all_replays_cells_with_the_detector_namespace() -> None:
    response = run_request(
        {
            "mode": "all",
            "scope": "detector",
            "recipe": {},
            "detector": _detector(RULE + "\nprint(Finding(label='x', value='y').to_payload())\n"),
        }
    )
    assert response.status is ExecutionStatus.SUCCESS, response.error
    output = str(response.to_dict()["cells"])
    assert "'label': 'x'" in output


def test_validate_requires_detect() -> None:
    response = run_request(
        {
            "mode": "validate",
            "scope": "detector",
            "recipe": {},
            "detector": _detector("def setup(ctx):\n    pass\n"),
        }
    )
    assert response.status is ExecutionStatus.ERROR
    assert response.contract is not None and not response.contract["ok"]


def _local_recipe(path: Path) -> dict[str, Any]:
    return {
        "type": "LOCAL_FOLDER",
        "required": {"path": str(path)},
        "masked": {},
        "optional": {},
        "sampling": {"strategy": "ALL"},
    }


def test_preview_detect_samples_the_source(tmp_path: Path) -> None:
    (tmp_path / "a.txt").write_text("there is a haystack-needle here")
    response = run_request(
        {
            "mode": "preview_detect",
            "scope": "detector",
            "recipe": _local_recipe(tmp_path),
            "detector": _detector(),
            "maxAssets": 5,
        }
    )
    assert response.status is ExecutionStatus.SUCCESS, response.error
    [sample] = response.assets
    assert sample["status"] == "ok"
    assert [f["finding_type"] for f in sample["findings"]] == ["needle"]
    assert response.result is not None
    assert "judging a.txt" in response.result["logs"]
    # A snapshot the editor can save as a test fixture.
    assert sample["fixture"]["name"] == "a.txt"
    assert "haystack-needle" in "".join(sample["fixture"]["pages"])


def test_preview_detect_on_a_named_asset_uses_its_metadata(tmp_path: Path) -> None:
    (tmp_path / "a.txt").write_text("nothing")
    rule = (
        "def detect(asset, ctx):\n"
        "    yield Finding(label='kind', value=asset.kind + ':' + asset.metadata['doc_type'])\n"
        "    for prior in asset.findings:\n"
        "        yield Finding(label='prior', value=prior.type)\n"
    )
    detector = _detector(rule)
    detector["pipeline_schema"]["needs_findings"] = True
    response = run_request(
        {
            "mode": "preview_detect",
            "scope": "detector",
            "recipe": _local_recipe(tmp_path),
            "detector": detector,
            "asset": {
                "hash": "h1",
                "name": "report",
                "assetKind": "document",
                "externalUrl": str(tmp_path / "a.txt"),
                "metadata": {"doc_type": "jab"},
            },
            "priorFindings": [
                {
                    "detector": "PII",
                    "type": "IBAN",
                    "value": "DE89",
                    "severity": "high",
                    "confidence": 0.9,
                }
            ],
        }
    )
    assert response.status is ExecutionStatus.SUCCESS, response.error
    [sample] = response.assets
    assert [(f["finding_type"], f["matched_content"]) for f in sample["findings"]] == [
        ("kind", "document:jab"),
        ("prior", "IBAN"),
    ]
