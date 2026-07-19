from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from src.main import _emit_text_chunks_with_retry


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
