"""Unit tests for the AUTOMATIC sampling cursor mechanics on BaseSource."""

from __future__ import annotations

from collections.abc import AsyncGenerator
from types import SimpleNamespace
from typing import Any

import pytest

from src.models.generated_single_asset_scan_results import SingleAssetScanResults
from src.sources.base import BaseSource
from src.utils.sampling_cursor import encode_sampling_cursor

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
    return encode_sampling_cursor(cursor)


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


def _order(item: int) -> tuple[int, str]:
    return item, f"i{item:03d}"


def _window(
    monkeypatch: pytest.MonkeyPatch,
    items: list[Any],
    cursor: dict[str, Any] | None,
    *,
    rows: int = 3,
    key: str = "items",
) -> tuple[list[Any], dict[str, Any] | None]:
    """One run's window over ``items``, and the cursor that run leaves."""
    if cursor is None:
        monkeypatch.delenv(CURSOR_ENV, raising=False)
    else:
        monkeypatch.setenv(CURSOR_ENV, _encode(cursor))
    source = _src(rows=rows)
    window = source.automatic_window(items, key=key, order=_order)
    next_cursor = source.current_sampling_cursor()
    return window, next_cursor if next_cursor is not None else cursor


def test_automatic_window_starts_with_the_newest(monkeypatch: pytest.MonkeyPatch) -> None:
    window, cursor = _window(monkeypatch, list(range(10)), None)
    assert window == [9, 8, 7]
    assert cursor is not None and cursor["items"]["done"] is False


def test_automatic_window_continues_the_backfill(monkeypatch: pytest.MonkeyPatch) -> None:
    items = list(range(10))
    _, cursor = _window(monkeypatch, items, None)
    window, _ = _window(monkeypatch, items, cursor)
    assert window == [6, 5, 4]


def test_automatic_window_reads_new_items_before_old_ones(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Items added between runs used to shift every position and go unread
    # until the sweep wrapped around.
    items = list(range(10))
    _, cursor = _window(monkeypatch, items, None)

    window, _ = _window(monkeypatch, [*items, 10, 11], cursor)
    assert window == [11, 10, 6]


def test_automatic_window_does_not_start_over_when_finished(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    items = list(range(5))
    cursor: dict[str, Any] | None = None
    seen: list[int] = []
    for _ in range(4):
        window, cursor = _window(monkeypatch, items, cursor)
        seen += window
    assert seen == [4, 3, 2, 1, 0]
    assert cursor is not None and cursor["items"]["done"] is True

    # Only something new is read from here on.
    window, cursor = _window(monkeypatch, [*items, 5], cursor)
    assert window == [5]
    assert _window(monkeypatch, [*items, 5], cursor)[0] == []


def test_automatic_window_ignores_the_old_positional_cursor(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    window, cursor = _window(monkeypatch, list(range(10)), {"items": 6})
    assert window == [9, 8, 7]
    assert cursor is not None and cursor["items"]["v"] == 2


def test_automatic_window_empty_list_records_nothing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(CURSOR_ENV, raising=False)
    source = _src()
    assert source.automatic_window([], order=_order) == []
    assert source.current_sampling_cursor() is None


def test_automatic_window_independent_keys(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(CURSOR_ENV, raising=False)
    source = _src(rows=2)
    assert source.automatic_window([1, 2, 3, 4], key="a", order=_order) == [4, 3]
    assert source.automatic_window([10, 20, 30, 40], key="b", order=_order) == [40, 30]
    cursor = source.current_sampling_cursor()
    assert cursor is not None
    assert cursor["a"]["head"]["r"] == 4
    assert cursor["b"]["head"]["r"] == 40


def test_a_key_the_run_did_not_reach_keeps_its_place(monkeypatch: pytest.MonkeyPatch) -> None:
    # A folder that could not be listed this run must not lose its frontier
    # and be swept again from the top.
    _, cursor = _window(monkeypatch, list(range(10)), None, key="a")
    _, cursor = _window(monkeypatch, list(range(10)), cursor, key="b")
    assert cursor is not None
    assert set(cursor) == {"a", "b"}
    before = cursor["a"]

    _, cursor = _window(monkeypatch, list(range(10)), cursor, key="b")
    assert cursor is not None and cursor["a"] == before


def test_items_without_a_rank_are_paged_round_and_round(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # No timestamp, so no way to tell a new one from one already read: these
    # wrap, on whatever the ranked items leave of the budget.
    ranked = [("r", n) for n in range(2)]
    unranked = [("u", n) for n in range(5)]

    def order(item: tuple[str, int]) -> tuple[int | None, str]:
        kind, number = item
        return (number if kind == "r" else None), f"{kind}{number}"

    def run(cursor: dict[str, Any] | None) -> tuple[list[Any], dict[str, Any] | None]:
        if cursor is None:
            monkeypatch.delenv(CURSOR_ENV, raising=False)
        else:
            monkeypatch.setenv(CURSOR_ENV, _encode(cursor))
        source = _src(rows=4)
        window = source.automatic_window([*ranked, *unranked], order=order)
        return window, source.current_sampling_cursor()

    first, cursor = run(None)
    assert first == [("r", 1), ("r", 0), ("u", 0), ("u", 1)]
    second, cursor = run(cursor)
    assert second == [("u", 2), ("u", 3), ("u", 4)]
    third, _ = run(cursor)
    assert third == [("u", 0), ("u", 1), ("u", 2), ("u", 3)]


def test_ranged_window_reads_only_as_far_as_it_needs(monkeypatch: pytest.MonkeyPatch) -> None:
    """A remote listing is asked for ranges, not fetched whole."""
    store = list(range(40))
    asked: list[tuple[Any, Any]] = []

    def run(cursor: dict[str, Any] | None) -> tuple[list[int], dict[str, Any] | None, int]:
        if cursor is None:
            monkeypatch.delenv(CURSOR_ENV, raising=False)
        else:
            monkeypatch.setenv(CURSOR_ENV, _encode(cursor))
        source = _src(rows=5)
        yielded = 0

        def fetch(lower: Any, upper: Any) -> Any:
            nonlocal yielded
            asked.append((lower, upper))
            for item in sorted(store, reverse=True):
                if (lower is None or item >= lower) and (upper is None or item <= upper):
                    yielded += 1
                    yield item

        window = source.automatic_ranged_window(fetch=fetch, order=_order)
        return window, source.current_sampling_cursor(), yielded

    first, cursor, yielded = run(None)
    assert first == [39, 38, 37, 36, 35]
    assert yielded <= 6  # one more than the window, to learn there is more

    store += [40, 41]
    second, cursor, yielded = run(cursor)
    assert second == [41, 40, 34, 33, 32]
    assert asked[-2:] == [(39, None), (None, 35)]
    assert yielded < 15

    seen = first + second
    for _ in range(10):
        window, cursor, _ = run(cursor)
        seen += window
    assert sorted(seen) == list(range(42))
    assert len(seen) == len(set(seen))
    assert run(cursor)[0] == []


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
