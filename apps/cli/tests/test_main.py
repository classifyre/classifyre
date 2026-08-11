from __future__ import annotations

import argparse
import json
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from src.main import _emit_text_chunks_with_retry, run_evaluate_file_command


@pytest.mark.asyncio
async def test_emit_text_chunks_retries_before_succeeding(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sink = type("Sink", (), {})()
    sink.emit_text_chunks = AsyncMock(side_effect=[RuntimeError("temporary outage"), None])
    sleep = AsyncMock()
    monkeypatch.setattr("src.main.asyncio.sleep", sleep)

    await _emit_text_chunks_with_retry(sink, "asset-1", object(), attempts=3)

    assert sink.emit_text_chunks.await_count == 2
    sleep.assert_awaited_once_with(0.25)


@pytest.mark.asyncio
async def test_emit_text_chunks_propagates_exhausted_retries(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sink = type("Sink", (), {})()
    sink.emit_text_chunks = AsyncMock(side_effect=RuntimeError("API unavailable"))
    monkeypatch.setattr("src.main.asyncio.sleep", AsyncMock())

    with pytest.raises(RuntimeError, match="API unavailable"):
        await _emit_text_chunks_with_retry(sink, "asset-1", object(), attempts=3)

    assert sink.emit_text_chunks.await_count == 3


def test_evaluate_file_directory_returns_one_result_per_sample(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    (tmp_path / "input-001.txt").write_text("counter")
    (tmp_path / "input-000.txt").write_text("positive")

    calls: list[str] = []

    class FakeParsed:
        mime_type = "text/plain"
        parse_error = None

    class FakeFinding:
        def model_dump(self, **_kwargs: object) -> dict[str, str]:
            return {"finding_type": "match"}

    class FakeRunner:
        def __init__(self, _detectors: list[dict[str, object]]) -> None:
            self.detector_errors: list[str] = []

        def run(self, sample_path: Path) -> tuple[FakeParsed, list[FakeFinding]]:
            calls.append(sample_path.name)
            findings = [FakeFinding()] if sample_path.name == "input-000.txt" else []
            return FakeParsed(), findings

    monkeypatch.setattr("src.file_evaluation.FileEvaluationRunner", FakeRunner)
    run_evaluate_file_command(
        argparse.Namespace(recipe=str(tmp_path), detectors_file=None),
    )

    output = json.loads(capsys.readouterr().out)
    assert calls == ["input-000.txt", "input-001.txt"]
    assert [item["name"] for item in output["evaluations"]] == calls
    assert len(output["evaluations"][0]["findings"]) == 1
    assert output["evaluations"][1]["findings"] == []
