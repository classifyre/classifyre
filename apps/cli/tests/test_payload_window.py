"""Unit tests for payload-level sampling windows.

These cover the arithmetic only — no files, no sources. The counterpart
``test_payload_window_parquet.py`` drives the same logic through real Parquet and
CSV bytes.
"""

from __future__ import annotations

import random
import threading
from functools import partial
from types import SimpleNamespace
from typing import Any

import pytest

from src.pipeline.payload_window import (
    PayloadCursor,
    PayloadWindow,
    PayloadWindowStore,
)

PARQUET = "application/parquet"
CSV = "text/csv"
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
PDF = "application/pdf"


def _rows(total: int) -> list[str]:
    return [f"row_{i + 1}" for i in range(total)]


def _factory(total: int, calls: list[tuple[int, int | None]] | None = None) -> Any:
    """A page factory over ``total`` single-row pages, recording its bounds."""
    pages = _rows(total)

    def _pages(start_row: int, max_rows: int | None):
        if calls is not None:
            calls.append((start_row, max_rows))
        window = pages[start_row:] if max_rows is None else pages[start_row : start_row + max_rows]
        yield from window

    return _pages


def _asset(
    *,
    hash: str = "h1",
    checksum: str = "c1",
    name: str = "data.parquet",
    external_url: str = "s3://bucket/data.parquet",
) -> SimpleNamespace:
    return SimpleNamespace(hash=hash, checksum=checksum, name=name, external_url=external_url)


def _store(strategy: str, rows: int = 100, **kwargs: Any) -> PayloadWindowStore:
    store = PayloadWindowStore(strategy, rows, **kwargs)
    store.bind(_asset())
    return store


# ── Strategy selection ───────────────────────────────────────────────────


def test_all_strategy_has_no_window() -> None:
    store = _store("ALL")
    assert store.enabled is False
    assert store.window_for("h1", PARQUET) is None


@pytest.mark.parametrize("strategy", ["AUTOMATIC", "RANDOM", "LATEST"])
def test_non_tabular_payload_has_no_window(strategy: str) -> None:
    store = _store(strategy)
    assert store.window_for("h1", PDF) is None
    assert store.window_for("h1", "image/png") is None


@pytest.mark.parametrize("mime", [PARQUET, CSV, XLSX, "text/tab-separated-values"])
def test_tabular_payloads_get_a_window(mime: str) -> None:
    assert _store("AUTOMATIC").window_for("h1", mime) is not None


def test_recipe_defaults_to_automatic_100() -> None:
    store = PayloadWindowStore.from_recipe({"type": "S3", "sampling": {}})
    assert (store.strategy, store.rows_per_page) == ("AUTOMATIC", 100)

    configured = PayloadWindowStore.from_recipe(
        {"sampling": {"strategy": "LATEST", "rows_per_page": 25}}
    )
    assert (configured.strategy, configured.rows_per_page) == ("LATEST", 25)


# ── AUTOMATIC ────────────────────────────────────────────────────────────


def test_automatic_advances_across_runs() -> None:
    """Three runs of 100 over a 1000-row payload cover disjoint slices."""
    stored: dict[str, Any] | None = None
    seen: list[list[str]] = []

    for _ in range(3):
        run = _store("AUTOMATIC", 100)
        run.record_prior([{"hash": "h1", "cursor": stored}] if stored else [])
        window = run.window_for("h1", PARQUET)
        assert window is not None
        record = partial(run.record, "h1")
        seen.append(list(window.iterate(_factory(1000), on_cursor=record)))
        stored = run.cursor_payload_for(_asset())

    assert seen[0] == _rows(1000)[0:100]
    assert seen[1] == _rows(1000)[100:200]
    assert seen[2] == _rows(1000)[200:300]
    assert stored is not None
    assert stored["offset"] == 300
    assert stored["exhausted"] is False


def test_automatic_pushes_bounds_into_the_reader() -> None:
    """The skip is a reader bound, not a decode-and-drop."""
    calls: list[tuple[int, int | None]] = []
    store = _store("AUTOMATIC", 100)
    store.record_prior([{"hash": "h1", "cursor": {"v": 1, "offset": 4_000_000, "checksum": "c1"}}])
    window = store.window_for("h1", PARQUET)
    assert window is not None
    list(window.iterate(_factory(4_000_500, calls)))
    assert calls == [(4_000_000, 100)]


def test_automatic_wraps_and_marks_exhausted() -> None:
    """A short final window completes the pass and rewinds to the top."""
    store = _store("AUTOMATIC", 100)
    store.record_prior([{"hash": "h1", "cursor": {"v": 1, "offset": 250, "checksum": "c1"}}])
    window = store.window_for("h1", PARQUET)
    assert window is not None

    pages = list(window.iterate(_factory(280), on_cursor=lambda c: store.record("h1", c)))

    assert pages == _rows(280)[250:280]
    cursor = store.cursor_payload_for(_asset())
    assert cursor is not None
    assert cursor["offset"] == 0
    assert cursor["exhausted"] is True
    assert cursor["rows_seen"] == 280
    assert cursor["passes"] == 1


def test_automatic_exactly_full_final_window_is_not_exhausted_early() -> None:
    """A full window cannot prove the end; the next run finds out."""
    store = _store("AUTOMATIC", 100)
    window = store.window_for("h1", PARQUET)
    assert window is not None
    list(window.iterate(_factory(100), on_cursor=lambda c: store.record("h1", c)))

    cursor = store.cursor_payload_for(_asset())
    assert cursor is not None
    assert (cursor["offset"], cursor["exhausted"]) == (100, False)


def test_automatic_offset_past_the_end_restarts_within_the_same_run() -> None:
    """A shrunken payload must not burn a whole run on zero rows."""
    calls: list[tuple[int, int | None]] = []
    store = _store("AUTOMATIC", 100)
    store.record_prior([{"hash": "h1", "cursor": {"v": 1, "offset": 900, "checksum": "c1"}}])
    window = store.window_for("h1", PARQUET)
    assert window is not None

    pages = list(window.iterate(_factory(50, calls), on_cursor=lambda c: store.record("h1", c)))

    assert pages == _rows(50)
    assert calls == [(900, 100), (0, 100)]
    cursor = store.cursor_payload_for(_asset())
    assert cursor is not None
    assert (cursor["offset"], cursor["exhausted"]) == (0, True)


def test_automatic_uses_a_known_row_count_to_decide_the_sweep_is_done() -> None:
    """A reader that knows the total is believed over the size of the last window."""
    store = _store("AUTOMATIC", 100)
    store.record_prior([{"hash": "h1", "cursor": {"v": 1, "offset": 200, "checksum": "c1"}}])
    window = store.window_for("h1", PARQUET)
    assert window is not None

    list(window.iterate(_factory(300), row_count=300, on_cursor=lambda c: store.record("h1", c)))

    cursor = store.cursor_payload_for(_asset())
    assert cursor is not None
    # The window was full (rows 200-299) but the file ends there, so the pass is
    # complete. Waiting for a short window would mean another whole run.
    assert (cursor["offset"], cursor["exhausted"], cursor["rows_seen"]) == (0, True, 300)


def test_automatic_does_not_wrap_forever_on_an_exact_multiple_of_the_page_size() -> None:
    """The bug this guards: a full last window used to read as 'more to come'.

    With 300 rows and 100 per run, run 3 ends exactly on the boundary. Inferring
    completion from an underfilled window never fires here — run 4 reads nothing,
    restarts at the top, and the asset is re-scanned forever without ever being
    cacheable.
    """
    stored: dict[str, Any] | None = None
    for _ in range(3):
        run = _store("AUTOMATIC", 100)
        run.record_prior([{"hash": "h1", "cursor": stored}] if stored else [])
        window = run.window_for("h1", PARQUET)
        assert window is not None
        list(window.iterate(_factory(300), row_count=300, on_cursor=partial(run.record, "h1")))
        stored = run.cursor_payload_for(_asset())

    assert stored is not None
    assert (stored["offset"], stored["exhausted"], stored["passes"]) == (0, True, 1)


def test_automatic_treats_an_empty_payload_with_a_known_count_as_covered() -> None:
    store = _store("AUTOMATIC", 100)
    window = store.window_for("h1", PARQUET)
    assert window is not None

    list(window.iterate(_factory(0), row_count=0, on_cursor=lambda c: store.record("h1", c)))

    cursor = store.cursor_payload_for(_asset())
    assert cursor is not None
    assert (cursor["exhausted"], cursor["rows_seen"]) == (True, 0)


def test_automatic_never_calls_a_payload_covered_when_it_read_nothing_at_all() -> None:
    """Zero rows from row 0 with no row count is not proof of an empty file.

    It is equally the signature of a payload that could not be read — and banking
    ``exhausted`` on it retires the asset from every later scan (the scan cache
    reads that flag to skip). Re-reading costs one pass; the alternative costs the
    whole file.
    """
    store = _store("AUTOMATIC", 100)
    window = store.window_for("h1", CSV)
    assert window is not None

    list(window.iterate(_factory(0), on_cursor=lambda c: store.record("h1", c)))

    cursor = store.cursor_payload_for(_asset())
    assert cursor is not None
    assert (cursor["offset"], cursor["exhausted"]) == (0, False)


def test_a_stored_cursor_claiming_a_zero_row_sweep_is_repaired() -> None:
    """Cursors already poisoned by the old logic must heal themselves.

    Runs before the fix banked ``exhausted`` after reading nothing, and the scan
    cache honours that flag on every later run — so without this the asset stays
    retired for ever, whatever the reader now does.
    """
    store = _store("AUTOMATIC", 100)
    store.record_prior(
        [
            {
                "hash": "h1",
                "cursor": {
                    "v": 1,
                    "offset": 0,
                    "rows_seen": 0,
                    "passes": 1,
                    "exhausted": True,
                    "checksum": "c1",
                },
            }
        ]
    )

    assert store.prior_for(_asset()) is None
    # And so the scan cache is told there are rows still to cover.
    assert store.advances_for(_asset()) is True


def test_a_completed_sweep_that_actually_read_rows_is_kept() -> None:
    store = _store("AUTOMATIC", 100)
    store.record_prior(
        [
            {
                "hash": "h1",
                "cursor": {
                    "v": 1,
                    "offset": 0,
                    "rows_seen": 280,
                    "passes": 1,
                    "exhausted": True,
                    "checksum": "c1",
                },
            }
        ]
    )

    cursor = store.prior_for(_asset())
    assert cursor is not None and cursor.exhausted is True
    assert store.advances_for(_asset()) is False


def test_automatic_counts_rows_not_pages_for_line_paged_payloads() -> None:
    """A spreadsheet page carries a block of rows; the offset still counts rows."""
    store = _store("AUTOMATIC", 100)
    window = store.window_for("h1", XLSX)
    assert window is not None

    def _pages(start_row: int, max_rows: int | None):
        # 100 lines requested, delivered as four pages of 25.
        assert (start_row, max_rows) == (0, 100)
        yield from ["block-1", "block-2", "block-3", "block-4"]

    list(window.iterate(_pages, rows_per_unit=25, on_cursor=lambda c: store.record("h1", c)))

    cursor = store.cursor_payload_for(_asset())
    assert cursor is not None
    assert (cursor["offset"], cursor["exhausted"]) == (100, False)


# ── Cursor invalidation ──────────────────────────────────────────────────


def test_changed_checksum_restarts_the_sweep() -> None:
    """Row 12000 of an edited file is not the row the offset meant."""
    store = _store("AUTOMATIC", 100)
    store.record_prior([{"hash": "h1", "cursor": {"v": 1, "offset": 12_000, "checksum": "OLD"}}])
    window = store.window_for("h1", PARQUET)
    assert window is not None
    assert window.prior is None
    assert window.start_row == 0


def test_strategy_switch_restarts_the_sweep() -> None:
    store = _store("AUTOMATIC", 100)
    store.record_prior(
        [
            {
                "hash": "h1",
                "cursor": {"v": 1, "offset": 500, "checksum": "c1", "strategy": "LATEST"},
            }
        ]
    )
    window = store.window_for("h1", PARQUET)
    assert window is not None
    assert window.start_row == 0


@pytest.mark.parametrize(
    "raw",
    [
        None,
        "not-a-dict",
        {"v": 99, "offset": 500},
        {"v": 1, "kind": "bytes", "offset": 500},
    ],
)
def test_unusable_cursor_is_discarded(raw: Any) -> None:
    assert PayloadCursor.parse(raw, checksum="c1", strategy="AUTOMATIC") is None


def test_matching_checksum_and_strategy_resume() -> None:
    cursor = PayloadCursor.parse(
        {"v": 1, "offset": 700, "passes": 2, "checksum": "c1", "strategy": "AUTOMATIC"},
        checksum="c1",
        strategy="AUTOMATIC",
    )
    assert cursor is not None
    assert (cursor.offset, cursor.passes) == (700, 2)


def test_cursor_round_trips_through_its_payload() -> None:
    original = PayloadCursor(
        offset=42, rows_seen=99, passes=3, exhausted=True, checksum="c", strategy="AUTOMATIC"
    )
    assert PayloadCursor.parse(original.to_payload(), checksum="c", strategy="AUTOMATIC") == (
        original
    )


# ── LATEST ───────────────────────────────────────────────────────────────


def test_latest_reads_the_top_rows_every_run() -> None:
    calls: list[tuple[int, int | None]] = []
    store = _store("LATEST", 50)
    window = store.window_for("h1", PARQUET)
    assert window is not None

    assert list(window.iterate(_factory(1000, calls))) == _rows(1000)[:50]
    assert calls == [(0, 50)]
    # Nothing to remember: the same rows are produced from the strategy alone.
    assert store.cursor_payload_for(_asset()) is None


# ── RANDOM ───────────────────────────────────────────────────────────────


def test_random_seeks_when_the_row_count_is_known() -> None:
    """A known row count turns RANDOM into one seek, not a full decode."""
    calls: list[tuple[int, int | None]] = []
    store = _store("RANDOM", 100, rng=random.Random(7))
    window = store.window_for("h1", PARQUET)
    assert window is not None

    pages = list(window.iterate(_factory(1000, calls), row_count=1000))

    assert len(calls) == 1
    start, limit = calls[0]
    assert limit == 100
    assert 0 <= start <= 900
    assert pages == _rows(1000)[start : start + 100]


def test_random_windows_differ_between_runs() -> None:
    starts = set()
    for seed in range(12):
        store = _store("RANDOM", 100, rng=random.Random(seed))
        window = store.window_for("h1", PARQUET)
        assert window is not None
        calls: list[tuple[int, int | None]] = []
        list(window.iterate(_factory(10_000, calls), row_count=10_000))
        starts.add(calls[0][0])
    assert len(starts) > 1


def test_random_reservoir_samples_when_the_row_count_is_unknown() -> None:
    """CSV has no cheap row count, so RANDOM samples in one bounded pass."""
    store = _store("RANDOM", 10, rng=random.Random(3))
    window = store.window_for("h1", CSV)
    assert window is not None

    pages = list(window.iterate(_factory(500), row_count=None))

    assert len(pages) == 10
    assert len(set(pages)) == 10
    assert set(pages) <= set(_rows(500))


def test_random_reservoir_covers_the_whole_payload_over_many_runs() -> None:
    """Every row must be reachable, not just the first window."""
    seen: set[str] = set()
    for seed in range(40):
        store = _store("RANDOM", 5, rng=random.Random(seed))
        window = store.window_for("h1", CSV)
        assert window is not None
        seen.update(window.iterate(_factory(60), row_count=None))
    assert len(seen) > 5
    # Rows from the tail are reachable, which a "first N" implementation fails.
    assert any(row in seen for row in _rows(60)[40:])


def test_random_never_persists_a_cursor() -> None:
    store = _store("RANDOM", 10, rng=random.Random(1))
    window = store.window_for("h1", PARQUET)
    assert window is not None
    list(window.iterate(_factory(100), row_count=100))
    assert store.cursor_payload_for(_asset()) is None


# ── Identity ─────────────────────────────────────────────────────────────


def test_window_resolves_through_either_asset_id() -> None:
    """Sources key content by external URL; the API keys cursors by hash."""
    store = _store("AUTOMATIC", 100)
    store.record_prior([{"hash": "h1", "cursor": {"v": 1, "offset": 400, "checksum": "c1"}}])

    by_url = store.window_for("s3://bucket/data.parquet", PARQUET)
    by_hash = store.window_for("h1", PARQUET)
    assert by_url is not None and by_hash is not None
    assert by_url.start_row == by_hash.start_row == 400

    store.record("s3://bucket/data.parquet", PayloadCursor(offset=500, checksum="c1"))
    cursor = store.cursor_payload_for(_asset())
    assert cursor is not None and cursor["offset"] == 500


def test_unbound_asset_id_still_gets_a_bounded_window() -> None:
    """An unregistered id reads one window; it just cannot resume."""
    store = PayloadWindowStore("AUTOMATIC", 100)
    window = store.window_for("never-seen", PARQUET)
    assert window is not None
    assert window.start_row == 0


def test_concurrent_records_do_not_lose_cursors() -> None:
    store = PayloadWindowStore("AUTOMATIC", 100)
    assets = [_asset(hash=f"h{i}", external_url=f"s3://b/{i}.parquet") for i in range(50)]
    for asset in assets:
        store.bind(asset)

    def _record(index: int) -> None:
        store.record(f"h{index}", PayloadCursor(offset=index, checksum="c1"))

    threads = [threading.Thread(target=_record, args=(i,)) for i in range(50)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    for index, asset in enumerate(assets):
        cursor = store.cursor_payload_for(asset)
        assert cursor is not None and cursor["offset"] == index


# ── Scan-cache interaction ───────────────────────────────────────────────


def test_advances_for_is_true_while_automatic_has_rows_left() -> None:
    store = _store("AUTOMATIC", 100)
    store.record_prior(
        [{"hash": "h1", "cursor": {"v": 1, "offset": 300, "checksum": "c1", "exhausted": False}}]
    )
    assert store.advances_for(_asset()) is True


def test_advances_for_is_false_once_a_pass_covered_the_payload() -> None:
    """An unchanged, fully-swept file is exactly what the scan cache is for."""
    store = _store("AUTOMATIC", 100)
    store.record_prior(
        [
            {
                "hash": "h1",
                "cursor": {
                    "v": 1,
                    "offset": 0,
                    "passes": 1,
                    "exhausted": True,
                    "checksum": "c1",
                },
            }
        ]
    )
    assert store.advances_for(_asset()) is False


def test_advances_for_is_true_on_a_first_sighting_of_a_tabular_asset() -> None:
    assert _store("AUTOMATIC", 100).advances_for(_asset()) is True


def test_advances_for_is_always_true_under_random() -> None:
    store = _store("RANDOM", 100)
    store.record_prior(
        [{"hash": "h1", "cursor": {"v": 1, "offset": 0, "exhausted": True, "checksum": "c1"}}]
    )
    assert store.advances_for(_asset()) is True


@pytest.mark.parametrize("strategy", ["LATEST", "ALL"])
def test_advances_for_is_false_for_stable_strategies(strategy: str) -> None:
    assert _store(strategy, 100).advances_for(_asset()) is False


def test_advances_for_is_false_for_a_payload_with_no_row_axis() -> None:
    store = PayloadWindowStore("AUTOMATIC", 100)
    pdf = _asset(name="report.pdf", external_url="s3://bucket/report.pdf")
    store.bind(pdf)
    assert store.advances_for(pdf) is False


def test_advances_for_is_false_for_a_child_lifted_out_of_a_tabular_parent() -> None:
    """The container's extension must not make its children look row-shaped.

    An image extracted from a parquet is addressed under the parquet's name; if
    that counted as a row axis, the cache could never skip any embedded child.
    """
    store = PayloadWindowStore("AUTOMATIC", 100)
    child = _asset(
        hash="h2",
        name="data.parquet#row=12;col=image",
        external_url="s3://bucket/data.parquet#row=12;col=image",
    )
    store.bind(child)
    assert store.advances_for(child) is False


def test_advances_for_is_true_for_a_tabular_child_of_a_container() -> None:
    """A CSV pulled out of an archive does have its own row axis."""
    store = PayloadWindowStore("AUTOMATIC", 100)
    child = _asset(
        hash="h3",
        name="docs.zip#reports/q3.csv",
        external_url="s3://bucket/docs.zip#reports/q3.csv",
    )
    store.bind(child)
    assert store.advances_for(child) is True


def test_advances_for_trusts_a_stored_cursor_over_an_unhelpful_name() -> None:
    """An extensionless object with a live cursor is still mid-sweep."""
    store = PayloadWindowStore("AUTOMATIC", 100)
    asset = _asset(name="export-2026-07", external_url="s3://bucket/export-2026-07")
    store.bind(asset)
    store.record_prior([{"hash": "h1", "cursor": {"v": 1, "offset": 300, "checksum": "c1"}}])
    assert store.advances_for(asset) is True


# ── Window shape ─────────────────────────────────────────────────────────


def test_unknown_strategy_reads_everything_rather_than_under_scanning() -> None:
    calls: list[tuple[int, int | None]] = []
    window = PayloadWindow(strategy="SOMETHING_NEW", rows_per_page=10)
    assert list(window.iterate(_factory(30, calls))) == _rows(30)
    assert calls == [(0, None)]


# ── Direct row addressing (row_bounds) ───────────────────────────────────


def test_row_bounds_latest_reads_the_top_of_the_payload() -> None:
    assert PayloadWindow(strategy="LATEST", rows_per_page=10).row_bounds() == (0, 10)


def test_row_bounds_automatic_resumes_from_the_stored_offset() -> None:
    window = PayloadWindow(
        strategy="AUTOMATIC",
        rows_per_page=10,
        prior=PayloadCursor(offset=4000, strategy="AUTOMATIC"),
    )
    assert window.row_bounds() == (4000, 10)


def test_row_bounds_automatic_starts_at_zero_without_a_cursor() -> None:
    assert PayloadWindow(strategy="AUTOMATIC", rows_per_page=10).row_bounds() == (0, 10)


def test_row_bounds_random_seeks_inside_the_payload() -> None:
    window = PayloadWindow(strategy="RANDOM", rows_per_page=10, rng=random.Random(7))
    start, take = window.row_bounds(row_count=100)
    assert take == 10
    assert 0 <= start <= 90


def test_row_bounds_random_without_a_row_count_reads_from_the_top() -> None:
    """No total means no safe offset to seek to — guessing could land past the end."""
    window = PayloadWindow(strategy="RANDOM", rows_per_page=10, rng=random.Random(7))
    assert window.row_bounds() == (0, 10)


def test_row_bounds_unwindowed_strategy_reads_everything() -> None:
    assert PayloadWindow(strategy="ALL", rows_per_page=10).row_bounds() == (0, None)
