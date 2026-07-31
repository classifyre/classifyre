"""Payload windows driven through real Parquet and CSV bytes.

``test_payload_window.py`` covers the arithmetic against a fake reader. This file
proves the same behaviour survives the actual readers: that the row bounds reach
``iter_file_pages``, that a resumed Parquet sweep skips row groups instead of
decoding and discarding them, and that consecutive runs cover disjoint rows of a
real file and then wrap.
"""

from __future__ import annotations

import io
import re
from types import SimpleNamespace
from typing import Any

import pytest

from src.pipeline.payload_window import PayloadWindowStore
from src.sources.base import BaseSource
from src.utils.file_parser import count_tabular_rows, iter_file_pages

pytest.importorskip("pyarrow")

PARQUET_MIME = "application/parquet"
CSV_MIME = "text/csv"
ROWS = 1000
ROWS_PER_GROUP = 100


def _parquet_bytes(rows: int = ROWS, row_group_size: int = ROWS_PER_GROUP) -> bytes:
    import pyarrow as pa
    import pyarrow.parquet as pq

    table = pa.table(
        {
            "id": list(range(rows)),
            "email": [f"user{i}@example.com" for i in range(rows)],
        }
    )
    buffer = io.BytesIO()
    pq.write_table(table, buffer, row_group_size=row_group_size)
    return buffer.getvalue()


def _csv_bytes(rows: int = ROWS) -> bytes:
    lines = ["id,email"]
    lines += [f"{i},user{i}@example.com" for i in range(rows)]
    return ("\n".join(lines) + "\n").encode()


def _row_numbers(pages: list[str]) -> list[int]:
    """The absolute row numbers a set of pages reports."""
    numbers: list[int] = []
    for page in pages:
        match = re.search(r"row_(\d+):", page)
        assert match, f"page has no row marker: {page[:60]!r}"
        numbers.append(int(match.group(1)))
    return numbers


def _ids(pages: list[str]) -> list[int]:
    """The ``id`` column values a set of pages carries."""
    return [int(re.search(r"\bid: (\d+)", page).group(1)) for page in pages]  # type: ignore[union-attr]


# ── Reader-level bounds ──────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("mime", "payload"),
    [(PARQUET_MIME, _parquet_bytes()), (CSV_MIME, _csv_bytes())],
    ids=["parquet", "csv"],
)
def test_bounds_return_exactly_the_requested_slice(mime: str, payload: bytes) -> None:
    pages = list(iter_file_pages(payload, mime, start_row=250, max_rows=100))

    assert len(pages) == 100
    assert _ids(pages) == list(range(250, 350))
    # Row numbering stays absolute, so a finding's location survives windowing.
    assert _row_numbers(pages) == list(range(251, 351))


@pytest.mark.parametrize(
    ("mime", "payload"),
    [(PARQUET_MIME, _parquet_bytes()), (CSV_MIME, _csv_bytes())],
    ids=["parquet", "csv"],
)
def test_default_bounds_read_the_whole_payload(mime: str, payload: bytes) -> None:
    assert len(list(iter_file_pages(payload, mime))) == ROWS


@pytest.mark.parametrize(
    ("mime", "payload"),
    [(PARQUET_MIME, _parquet_bytes()), (CSV_MIME, _csv_bytes())],
    ids=["parquet", "csv"],
)
def test_bounds_past_the_end_yield_nothing(mime: str, payload: bytes) -> None:
    assert list(iter_file_pages(payload, mime, start_row=ROWS + 50, max_rows=100)) == []


@pytest.mark.parametrize(
    ("mime", "payload"),
    [(PARQUET_MIME, _parquet_bytes()), (CSV_MIME, _csv_bytes())],
    ids=["parquet", "csv"],
)
def test_a_window_overlapping_the_end_is_short_not_padded(mime: str, payload: bytes) -> None:
    pages = list(iter_file_pages(payload, mime, start_row=ROWS - 30, max_rows=100))
    assert _ids(pages) == list(range(ROWS - 30, ROWS))


def test_parquet_bounds_land_inside_a_row_group() -> None:
    """The offset need not fall on a row-group boundary."""
    pages = list(iter_file_pages(_parquet_bytes(), PARQUET_MIME, start_row=137, max_rows=45))
    assert _ids(pages) == list(range(137, 182))


def test_parquet_skips_row_groups_instead_of_decoding_them(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Resuming deep into a file must not decode everything before it."""
    import pyarrow.parquet as pq

    seen: list[Any] = []
    original = pq.ParquetFile.iter_batches

    def _spy(self: Any, *args: Any, **kwargs: Any) -> Any:
        seen.append(kwargs.get("row_groups"))
        return original(self, *args, **kwargs)

    monkeypatch.setattr(pq.ParquetFile, "iter_batches", _spy)

    pages = list(iter_file_pages(_parquet_bytes(), PARQUET_MIME, start_row=800, max_rows=100))

    assert _ids(pages) == list(range(800, 900))
    # 1000 rows in groups of 100: row 800 starts at group 8, so groups 0-7 are
    # never handed to the decoder.
    assert seen == [[8, 9]]


def test_row_count_is_free_for_parquet_and_unknown_for_csv() -> None:
    assert count_tabular_rows(_parquet_bytes(), PARQUET_MIME) == ROWS
    # CSV has no index; counting would cost the full pass the window avoids.
    assert count_tabular_rows(_csv_bytes(), CSV_MIME) is None
    assert count_tabular_rows(b"not a parquet file", PARQUET_MIME) is None


# ── Source-level windowing ───────────────────────────────────────────────


class _FileSource(BaseSource):
    """Minimal source: everything under test lives in BaseSource itself."""

    source_type = "local_folder"

    def test_connection(self) -> dict[str, Any]:
        return {"status": "SUCCESS"}

    async def extract_raw(self):  # type: ignore[no-untyped-def]
        if False:
            yield []

    def generate_hash_id(self, asset_id: str) -> str:
        return asset_id

    def abort(self) -> None:
        self._aborted = True


def _source(strategy: str, rows_per_page: int) -> tuple[_FileSource, PayloadWindowStore]:
    recipe = {
        "type": "LOCAL_FOLDER",
        "required": {"folder_path": "/tmp"},
        "sampling": {"strategy": strategy, "rows_per_page": rows_per_page},
    }
    source = _FileSource(dict(recipe))
    store = PayloadWindowStore.from_recipe(recipe)
    source.attach_payload_windows(store)
    return source, store


def _asset(checksum: str = "sum-1") -> SimpleNamespace:
    return SimpleNamespace(
        hash="asset-hash",
        checksum=checksum,
        name="events.parquet",
        external_url="file:///data/events.parquet",
    )


@pytest.mark.parametrize(
    ("mime", "payload"),
    [(PARQUET_MIME, _parquet_bytes()), (CSV_MIME, _csv_bytes())],
    ids=["parquet", "csv"],
)
def test_three_automatic_runs_cover_disjoint_rows_then_wrap(mime: str, payload: bytes) -> None:
    """The end-to-end promise: run N reads rows that run N-1 did not."""
    per_run = 400
    stored: dict[str, Any] | None = None
    covered: list[list[int]] = []

    for _ in range(3):
        source, store = _source("AUTOMATIC", per_run)
        asset = _asset()
        store.bind(asset)
        if stored:
            store.record_prior([{"hash": asset.hash, "cursor": stored}])

        pages = list(source.iter_asset_pages(payload, mime, asset_id=asset.external_url))
        covered.append(_ids(pages))
        stored = store.cursor_payload_for(asset)

    assert covered[0] == list(range(0, 400))
    assert covered[1] == list(range(400, 800))
    assert covered[2] == list(range(800, 1000))
    # The third run ran off the end: the pass is complete and the next one
    # restarts at the top rather than reading nothing.
    assert stored is not None
    assert (stored["offset"], stored["exhausted"], stored["passes"]) == (0, True, 1)

    source, store = _source("AUTOMATIC", per_run)
    asset = _asset()
    store.bind(asset)
    store.record_prior([{"hash": asset.hash, "cursor": stored}])
    fourth = _ids(list(source.iter_asset_pages(payload, mime, asset_id=asset.external_url)))
    assert fourth == list(range(0, 400))


def test_an_edited_file_restarts_its_sweep() -> None:
    """A cursor is only valid for the bytes it was measured against."""
    source, store = _source("AUTOMATIC", 100)
    asset = _asset(checksum="sum-2")
    store.bind(asset)
    store.record_prior(
        [{"hash": asset.hash, "cursor": {"v": 1, "offset": 600, "checksum": "sum-1"}}]
    )

    pages = list(
        source.iter_asset_pages(_parquet_bytes(), PARQUET_MIME, asset_id=asset.external_url)
    )
    assert _ids(pages) == list(range(0, 100))


def test_latest_reads_the_top_rows_of_the_real_file() -> None:
    source, store = _source("LATEST", 60)
    asset = _asset()
    store.bind(asset)

    pages = list(
        source.iter_asset_pages(_parquet_bytes(), PARQUET_MIME, asset_id=asset.external_url)
    )
    assert _ids(pages) == list(range(0, 60))
    assert store.cursor_payload_for(asset) is None


def test_random_reads_a_bounded_window_of_the_real_file() -> None:
    source, store = _source("RANDOM", 75)
    asset = _asset()
    store.bind(asset)

    ids = _ids(
        list(source.iter_asset_pages(_parquet_bytes(), PARQUET_MIME, asset_id=asset.external_url))
    )
    assert len(ids) == 75
    assert ids == list(range(ids[0], ids[0] + 75))


def test_all_strategy_still_reads_every_row() -> None:
    source, _ = _source("ALL", 100)
    pages = list(
        source.iter_asset_pages(_parquet_bytes(), PARQUET_MIME, asset_id="file:///x.parquet")
    )
    assert len(pages) == ROWS


def test_a_pdf_is_never_windowed() -> None:
    """Only payloads with a row axis are bounded; text keeps streaming whole."""
    source, store = _source("AUTOMATIC", 2)
    asset = SimpleNamespace(
        hash="doc", checksum="c", name="notes.txt", external_url="file:///notes.txt"
    )
    store.bind(asset)

    payload = ("\n".join(f"line {i}" for i in range(50))).encode()
    pages = list(source.iter_asset_pages(payload, "text/plain", asset_id=asset.external_url))
    assert "line 49" in "".join(pages)
    assert store.cursor_payload_for(asset) is None


def test_a_source_without_a_store_reads_everything() -> None:
    """Payload windows are opt-in; a source that never attaches one is unaffected."""
    source = _FileSource(
        {"type": "LOCAL_FOLDER", "required": {"folder_path": "/tmp"}, "sampling": {}}
    )
    pages = list(source.iter_asset_pages(_parquet_bytes(), PARQUET_MIME))
    assert len(pages) == ROWS
