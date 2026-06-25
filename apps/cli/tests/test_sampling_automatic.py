"""Unit tests for the AUTOMATIC sampling cursor mechanics on BaseSource."""

from __future__ import annotations

import base64
import json
from collections.abc import AsyncGenerator
from types import SimpleNamespace
from typing import Any

import pytest

from src.models.generated_single_asset_scan_results import SingleAssetScanResults
from src.sources.base import BaseSource

CURSOR_ENV = "CLASSIFYRE_SAMPLING_CURSOR"


class _DummySource(BaseSource):
    def test_connection(self) -> dict[str, Any]:
        return {"status": "SUCCESS"}

    async def extract_raw(self) -> AsyncGenerator[list[SingleAssetScanResults], None]:
        if False:
            yield []

    def generate_hash_id(self, asset_id: str) -> str:
        return asset_id

    def abort(self) -> None:
        self._aborted = True


def _recipe(strategy: str = "AUTOMATIC", rows: int = 3) -> dict[str, Any]:
    return {
        "type": "POSTGRESQL",
        "required": {"host": "db.local", "port": 5432},
        "sampling": {"strategy": strategy, "rows_per_page": rows},
    }


def _src(rows: int = 3) -> _DummySource:
    source = _DummySource(_recipe(rows=rows))
    # Sources expose a pydantic config; emulate the bits automatic_window reads.
    source.config = SimpleNamespace(sampling=SimpleNamespace(rows_per_page=rows))  # type: ignore[attr-defined]
    return source


def _encode(cursor: dict[str, Any]) -> str:
    return base64.b64encode(json.dumps(cursor).encode()).decode()


def test_default_strategy_is_automatic() -> None:
    recipe = {"type": "POSTGRESQL", "required": {"host": "x", "port": 1}, "sampling": {}}
    source = _DummySource(recipe)
    assert source.recipe["sampling"]["strategy"] == "AUTOMATIC"


def test_no_cursor_env_means_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(CURSOR_ENV, raising=False)
    source = _src()
    assert source.sampling_cursor() == {}
    # Nothing advanced yet → leave the stored cursor untouched.
    assert source.current_sampling_cursor() is None


def test_cursor_loaded_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(CURSOR_ENV, _encode({"items": 5}))
    source = _src()
    assert source.sampling_cursor() == {"items": 5}


def test_malformed_cursor_env_is_ignored(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(CURSOR_ENV, "!!! not base64 json !!!")
    source = _src()
    assert source.sampling_cursor() == {}


def test_automatic_window_advances_between_runs(monkeypatch: pytest.MonkeyPatch) -> None:
    items = list(range(10))

    monkeypatch.delenv(CURSOR_ENV, raising=False)
    run1 = _src(rows=3)
    assert run1.automatic_window(items) == [0, 1, 2]
    assert run1.current_sampling_cursor() == {"items": 3}

    monkeypatch.setenv(CURSOR_ENV, _encode({"items": 3}))
    run2 = _src(rows=3)
    assert run2.automatic_window(items) == [3, 4, 5]
    assert run2.current_sampling_cursor() == {"items": 6}


def test_automatic_window_wraps_at_end(monkeypatch: pytest.MonkeyPatch) -> None:
    items = list(range(10))
    monkeypatch.setenv(CURSOR_ENV, _encode({"items": 9}))
    source = _src(rows=3)
    # Only the final item remains; the next offset wraps back to the start.
    assert source.automatic_window(items) == [9]
    assert source.current_sampling_cursor() == {"items": 0}


def test_automatic_window_out_of_range_offset_restarts(monkeypatch: pytest.MonkeyPatch) -> None:
    items = list(range(5))
    # A stale offset beyond the list (items shrank) restarts from 0.
    monkeypatch.setenv(CURSOR_ENV, _encode({"items": 99}))
    source = _src(rows=2)
    assert source.automatic_window(items) == [0, 1]
    assert source.current_sampling_cursor() == {"items": 2}


def test_automatic_window_empty_list_records_nothing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(CURSOR_ENV, raising=False)
    source = _src()
    assert source.automatic_window([]) == []
    assert source.current_sampling_cursor() is None


def test_automatic_window_independent_keys(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(CURSOR_ENV, raising=False)
    source = _src(rows=2)
    source.automatic_window([1, 2, 3, 4], key="a")
    source.automatic_window([10, 20, 30, 40], key="b")
    assert source.current_sampling_cursor() == {"a": 2, "b": 2}


def test_record_automatic_offset_advances_and_wraps(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(CURSOR_ENV, raising=False)
    source = _src(rows=5)

    # A full page advances the offset.
    source.record_automatic_offset("c", prev_offset=0, fetched=5)
    assert source.current_sampling_cursor() == {"c": 5}

    # An underfilled page means the backing store is exhausted → wrap to 0.
    source.record_automatic_offset("c", prev_offset=5, fetched=2)
    assert source.current_sampling_cursor() == {"c": 0}


def test_automatic_offset_reads_saved_value(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(CURSOR_ENV, _encode({"c": 7}))
    source = _src()
    assert source.automatic_offset("c") == 7
    assert source.automatic_offset("missing") == 0
