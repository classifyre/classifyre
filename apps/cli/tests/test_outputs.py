from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import pytest

from src.outputs.base import OutputRuntimeContext
from src.outputs.console import ConsoleOutputSink
from src.outputs.factory import resolve_output_settings
from src.outputs.file import FileOutputSink
from src.outputs.rest import RestOutputSink


def _args(**overrides: Any) -> argparse.Namespace:
    defaults: dict[str, Any] = {
        "output_type": None,
        "output_batch_size": None,
        "output_rest_url": None,
        "output_file_path": None,
        "source_id": None,
        "runner_id": None,
        "managed_runner": False,
    }
    defaults.update(overrides)
    return argparse.Namespace(**defaults)


def test_output_resolution_cli_overrides_env(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("CLASSIFYRE_OUTPUT_TYPE", "console")
    monkeypatch.setenv("CLASSIFYRE_OUTPUT_BATCH_SIZE", "7")
    monkeypatch.setenv("CLASSIFYRE_OUTPUT_REST_URL", "http://env.example:8000")

    args = _args(
        output_type="rest",
        output_batch_size=20,
        output_rest_url="http://cli.example:8000",
        source_id="source-1",
        runner_id="runner-1",
        managed_runner=True,
    )

    settings = resolve_output_settings(args)

    assert settings.output_type == "rest"
    assert settings.batch_size == 20
    assert settings.rest_url == "http://cli.example:8000"
    assert settings.source_id == "source-1"
    assert settings.runner_id == "runner-1"
    assert settings.managed_runner is True


def test_output_resolution_env_used_when_cli_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("CLASSIFYRE_OUTPUT_TYPE", "console")
    monkeypatch.setenv("CLASSIFYRE_OUTPUT_BATCH_SIZE", "5")
    monkeypatch.setenv("CLASSIFYRE_OUTPUT_FILE_PATH", "./env.ndjson")

    settings = resolve_output_settings(_args())

    assert settings.output_type == "console"
    assert settings.batch_size == 5
    assert settings.file_path == "./env.ndjson"


def test_output_resolution_defaults_to_rest_for_backend_runs() -> None:
    settings = resolve_output_settings(_args(source_id="source-1", runner_id="runner-1"))

    assert settings.output_type == "rest"
    assert settings.rest_url == "http://localhost:8000"


def test_output_resolution_rest_uses_api_url_env_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("API_URL", "http://api-env.example:8000")

    settings = resolve_output_settings(_args(source_id="source-1"))

    assert settings.output_type == "rest"
    assert settings.batch_size == 20
    assert settings.rest_url == "http://api-env.example:8000"


def test_output_resolution_defaults_to_console_without_source_id() -> None:
    settings = resolve_output_settings(_args())

    assert settings.output_type == "console"
    assert settings.batch_size == 20


@pytest.mark.asyncio
async def test_file_output_appends_ndjson_batches(tmp_path: Path) -> None:
    output_path = tmp_path / "assets.ndjson"
    context = OutputRuntimeContext(
        source_id="source-1",
        runner_id="runner-1",
        managed_runner=False,
        batch_size=2,
    )

    sink = FileOutputSink(context, str(output_path))
    await sink.start()
    await sink.emit_batch([{"hash": "a"}, {"hash": "b"}])
    await sink.finish()

    second_sink = FileOutputSink(context, str(output_path))
    await second_sink.start()
    await second_sink.emit_batch([{"hash": "c"}])
    await second_sink.finish()

    lines = [json.loads(line) for line in output_path.read_text().splitlines()]
    assert [line["event"] for line in lines] == ["batch", "finish", "batch", "finish"]
    assert lines[0]["asset_count"] == 2
    assert lines[2]["asset_count"] == 1


@pytest.mark.asyncio
async def test_console_output_emits_batch_envelope(capsys: pytest.CaptureFixture[str]) -> None:
    context = OutputRuntimeContext(
        source_id="source-1",
        runner_id="runner-1",
        managed_runner=False,
        batch_size=20,
    )
    sink = ConsoleOutputSink(context)
    await sink.start()
    await sink.emit_batch([{"hash": "asset-1"}])
    await sink.finish()

    lines = capsys.readouterr().out.strip().splitlines()
    batch = json.loads(lines[0])
    finished = json.loads(lines[1])
    assert batch["event"] == "batch"
    assert batch["asset_count"] == 1
    assert finished["event"] == "finish"
    assert finished["total_assets"] == 1


class _FakeResponse:
    def __init__(self, payload: dict[str, Any] | None = None, status_code: int = 200):
        self.payload = payload or {}
        self.status_code = status_code
        self.reason = "OK" if status_code < 400 else "Bad Request"
        self.text = json.dumps(self.payload) if self.payload else ""

    def json(self) -> dict[str, Any]:
        return self.payload


class _FakeSession:
    def __init__(self, responses: list[_FakeResponse]):
        self.responses = responses
        self.calls: list[dict[str, Any]] = []

    def request(
        self,
        method: str,
        url: str,
        json: dict[str, Any] | None,
        timeout: int,
    ) -> _FakeResponse:
        self.calls.append(
            {
                "method": method,
                "url": url,
                "json": json,
                "timeout": timeout,
            }
        )
        if not self.responses:
            raise AssertionError("Unexpected request with no stubbed response")
        return self.responses.pop(0)


@pytest.mark.asyncio
async def test_rest_output_managed_runner_flow(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_session = _FakeSession(
        responses=[
            _FakeResponse({}),
            _FakeResponse({}),
            _FakeResponse({}),
        ]
    )
    monkeypatch.setattr("src.outputs.rest.requests.Session", lambda: fake_session)

    context = OutputRuntimeContext(
        source_id="source-1",
        runner_id="runner-1",
        managed_runner=True,
        batch_size=20,
    )
    sink = RestOutputSink(context, base_url="http://localhost:8000", timeout_sec=30)

    await sink.start()
    await sink.emit_batch([{"hash": "h1"}])
    await sink.finish()

    assert [call["method"] for call in fake_session.calls] == ["POST", "POST", "PATCH"]
    assert fake_session.calls[0]["url"].endswith("/sources/source-1/assets/bulk")
    assert fake_session.calls[0]["json"]["finalizeRun"] is False
    assert fake_session.calls[1]["url"].endswith("/sources/source-1/assets/finalize")
    assert fake_session.calls[2]["url"].endswith("/runners/runner-1/status")
    assert fake_session.calls[2]["json"]["status"] == "COMPLETED"


@pytest.mark.asyncio
async def test_rest_output_omits_null_fields_in_nested_payload(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_session = _FakeSession(
        responses=[
            _FakeResponse({}),
            _FakeResponse({}),
            _FakeResponse({}),
        ]
    )
    monkeypatch.setattr("src.outputs.rest.requests.Session", lambda: fake_session)

    context = OutputRuntimeContext(
        source_id="source-1",
        runner_id="runner-1",
        managed_runner=True,
        batch_size=20,
    )
    sink = RestOutputSink(context, base_url="http://localhost:8000", timeout_sec=30)

    await sink.start()
    await sink.emit_batch(
        [
            {
                "hash": "h1",
                "findings": [
                    {
                        "detector_type": "CUSTOM",
                        "finding_type": "custom_match",
                        "category": "COMPLIANCE",
                        "severity": "medium",
                        "confidence": 0.9,
                        "matched_content": "test",
                        "custom_detector_id": None,
                        "custom_detector_key": "cust_test",
                        "custom_detector_name": "Test",
                        "runner_id": None,
                        "metadata": None,
                    }
                ],
            }
        ]
    )
    await sink.finish()

    posted_assets = fake_session.calls[0]["json"]["assets"]
    finding = posted_assets[0]["findings"][0]
    assert "custom_detector_id" not in finding
    assert "runner_id" not in finding
    assert "metadata" not in finding


@pytest.mark.asyncio
async def test_rest_output_auto_creates_external_runner(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_session = _FakeSession(
        responses=[
            _FakeResponse({"id": "runner-external", "sourceId": "source-1"}),
            _FakeResponse({}),
            _FakeResponse({}),
            _FakeResponse({}),
        ]
    )
    monkeypatch.setattr("src.outputs.rest.requests.Session", lambda: fake_session)

    context = OutputRuntimeContext(
        source_id="source-1",
        runner_id=None,
        managed_runner=False,
        batch_size=20,
    )
    sink = RestOutputSink(context, base_url="http://localhost:8000", timeout_sec=30)

    await sink.start()
    await sink.emit_batch([{"hash": "h1"}])
    await sink.finish()

    assert fake_session.calls[0]["url"].endswith("/sources/source-1/runners/external")
    assert fake_session.calls[-1]["url"].endswith("/runners/runner-external/status")
    assert fake_session.calls[-1]["json"]["status"] == "COMPLETED"


@pytest.mark.asyncio
async def test_rest_output_fail_marks_runner_error(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_session = _FakeSession(responses=[_FakeResponse({})])
    monkeypatch.setattr("src.outputs.rest.requests.Session", lambda: fake_session)

    context = OutputRuntimeContext(
        source_id="source-1",
        runner_id="runner-1",
        managed_runner=False,
        batch_size=20,
    )
    sink = RestOutputSink(context, base_url="http://localhost:8000", timeout_sec=30)

    await sink.start()
    await sink.fail(RuntimeError("boom"))

    assert fake_session.calls[0]["method"] == "PATCH"
    assert fake_session.calls[0]["url"].endswith("/runners/runner-1/status")
    assert fake_session.calls[0]["json"]["status"] == "ERROR"


@pytest.mark.asyncio
async def test_rest_output_fail_marks_managed_runner_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_session = _FakeSession(responses=[_FakeResponse({})])
    monkeypatch.setattr("src.outputs.rest.requests.Session", lambda: fake_session)

    context = OutputRuntimeContext(
        source_id="source-1",
        runner_id="runner-1",
        managed_runner=True,
        batch_size=20,
    )
    sink = RestOutputSink(context, base_url="http://localhost:8000", timeout_sec=30)

    await sink.start()
    await sink.fail(RuntimeError("boom"))

    assert fake_session.calls[0]["method"] == "PATCH"
    assert fake_session.calls[0]["url"].endswith("/runners/runner-1/status")
    assert fake_session.calls[0]["json"]["status"] == "ERROR"
