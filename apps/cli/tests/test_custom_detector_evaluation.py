"""Test scenarios for code detectors: evaluate-file over text and asset fixtures."""

from __future__ import annotations

import json
from pathlib import Path

from src.file_evaluation import FileEvaluationRunner

RULE = """def detect(asset, ctx):
    for index, row in enumerate(asset.rows()):
        if row["total"] != row["a"] + row["b"]:
            yield Finding(label="total_mismatch", value=str(row["total"]),
                          identity=f"row-{index}", location={"row": index})
    if asset.metadata.get("table_code") == "12411-0001" and asset.kind == "table":
        yield Finding(label="seen_table", value=asset.name)
    if "secret word" in asset.text():
        yield Finding(label="word", value="secret word")
"""

DETECTORS = [
    {
        "type": "CUSTOM",
        "enabled": True,
        "config": {
            "custom_detector_key": "totals",
            "name": "Totals",
            "pipeline_schema": {
                "type": "CODE_DETECTOR",
                "notebook": {"cells": [{"id": "c", "type": "code", "source": RULE}]},
            },
        },
    }
]


def test_asset_fixture_serves_rows_metadata_and_kind(tmp_path: Path) -> None:
    fixture = tmp_path / "scenario.classifyre-asset.json"
    fixture.write_text(
        json.dumps(
            {
                "name": "bevoelkerung.csv",
                "kind": "table",
                "mime_type": "text/csv",
                "metadata": {"table_code": "12411-0001"},
                "rows": [{"a": 1, "b": 2, "total": 3}, {"a": 2, "b": 2, "total": 5}],
            }
        )
    )
    runner = FileEvaluationRunner(DETECTORS)
    _parsed, findings = runner.run(fixture)
    assert runner.detector_errors == []
    labels = sorted((f.finding_type, f.identity_key) for f in findings)
    assert labels == [("seen_table", None), ("total_mismatch", "row-1")]


def test_plain_text_input_reaches_the_rule_as_text(tmp_path: Path) -> None:
    sample = tmp_path / "sample.txt"
    sample.write_text("contains the secret word here")
    runner = FileEvaluationRunner(DETECTORS)
    _parsed, findings = runner.run(sample)
    assert [f.finding_type for f in findings] == ["word"]


def test_a_failing_rule_is_reported_as_a_detector_error(tmp_path: Path) -> None:
    sample = tmp_path / "sample.txt"
    sample.write_text("x")
    broken = json.loads(json.dumps(DETECTORS))
    broken[0]["config"]["pipeline_schema"]["notebook"]["cells"][0]["source"] = (
        "def detect(asset):\n    raise KeyError('nope')\n"
    )
    runner = FileEvaluationRunner(broken)
    _parsed, findings = runner.run(sample)
    assert findings == []
    assert runner.detector_errors and "nope" in runner.detector_errors[0]
