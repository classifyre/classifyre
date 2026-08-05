"""Arrow IPC / Feather payloads, read the way Parquet payloads are read.

``test_payload_window_parquet.py`` pins the row-window behaviour for Parquet and
CSV. Arrow arrives through the same pipeline — same page text, same absolute row
numbers, same cursor arithmetic, same child assets — so most of what is asserted
here is *parity*: the format a dataset happens to be published in must not change
what a scan sees or how a finding is addressed.

The three on-disk layouts that share these extensions are all covered: the IPC
file layout (``.arrow`` / ``.ipc`` / Feather V2), the legacy Feather V1 layout,
and the IPC streaming layout.
"""

from __future__ import annotations

import io
import re
from types import SimpleNamespace
from typing import Any

import pytest

from src.pipeline.payload_window import PayloadWindowStore
from src.sources.base import BaseSource
from src.utils.embedded_files import has_embedded_files, iter_embedded_files
from src.utils.file_metadata import extract_file_metadata
from src.utils.file_parser import (
    ARROW_FILE_MIME_TYPE,
    ARROW_STREAM_MIME_TYPE,
    TextExtractionCoverageCode,
    TextExtractionCoverageError,
    count_tabular_rows,
    is_tabular_mime_type,
    iter_file_pages,
    normalize_mime_type,
    resolve_mime_type,
    tabular_mime_type_for_name,
)

pytest.importorskip("pyarrow")

PARQUET_MIME = "application/parquet"
ROWS = 1000
ROWS_PER_BATCH = 100

_PNG_BYTES = b"\x89PNG\r\n\x1a\n" + bytes(64)


def _table(rows: int = ROWS) -> Any:
    import pyarrow as pa

    return pa.table(
        {
            "id": list(range(rows)),
            "email": [f"user{i}@example.com" for i in range(rows)],
        }
    )


def _arrow_bytes(rows: int = ROWS, batch_rows: int = ROWS_PER_BATCH) -> bytes:
    """An IPC *file* payload — what ``.arrow``, ``.ipc`` and Feather V2 all hold."""
    from pyarrow import ipc

    table = _table(rows)
    buffer = io.BytesIO()
    with ipc.new_file(buffer, table.schema) as writer:
        for batch in table.to_batches(max_chunksize=batch_rows):
            writer.write_batch(batch)
    return buffer.getvalue()


def _arrow_stream_bytes(rows: int = ROWS, batch_rows: int = ROWS_PER_BATCH) -> bytes:
    """An IPC *stream* payload: no footer, so it can only be read front to back."""
    from pyarrow import ipc

    table = _table(rows)
    buffer = io.BytesIO()
    with ipc.new_stream(buffer, table.schema) as writer:
        for batch in table.to_batches(max_chunksize=batch_rows):
            writer.write_batch(batch)
    return buffer.getvalue()


def _feather_v1_bytes(rows: int = ROWS) -> bytes:
    import warnings

    from pyarrow import feather

    buffer = io.BytesIO()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", FutureWarning)
        feather.write_feather(_table(rows), buffer, version=1)
    return buffer.getvalue()


def _parquet_bytes(rows: int = ROWS, row_group_size: int = ROWS_PER_BATCH) -> bytes:
    import pyarrow.parquet as pq

    buffer = io.BytesIO()
    pq.write_table(_table(rows), buffer, row_group_size=row_group_size)
    return buffer.getvalue()


def _hf_arrow_bytes(rows: int = 4, batch_rows: int = 2) -> bytes:
    """An IPC file mimicking a HuggingFace image dataset: struct<bytes, path>."""
    import pyarrow as pa
    from pyarrow import ipc

    table = pa.table(
        {
            "image": pa.array([{"bytes": _PNG_BYTES, "path": f"{i}.png"} for i in range(rows)]),
            "label": pa.array(list(range(rows)), type=pa.int64()),
        }
    )
    buffer = io.BytesIO()
    with ipc.new_file(buffer, table.schema) as writer:
        for batch in table.to_batches(max_chunksize=batch_rows):
            writer.write_batch(batch)
    return buffer.getvalue()


def _row_numbers(pages: list[str]) -> list[int]:
    numbers: list[int] = []
    for page in pages:
        match = re.search(r"row_(\d+):", page)
        assert match, f"page has no row marker: {page[:60]!r}"
        numbers.append(int(match.group(1)))
    return numbers


def _ids(pages: list[str]) -> list[int]:
    return [int(re.search(r"\bid: (\d+)", page).group(1)) for page in pages]  # type: ignore[union-attr]


# ── Format identification ────────────────────────────────────────────────


def test_an_arrow_payload_is_recognised_by_its_magic_and_by_its_name() -> None:
    assert resolve_mime_type(_arrow_bytes(rows=4)) == ARROW_FILE_MIME_TYPE
    # Feather V1 is a different layout under the same type; the reader tells them
    # apart again by magic, so nothing downstream has to know V1 exists.
    assert resolve_mime_type(_feather_v1_bytes(rows=4)) == ARROW_FILE_MIME_TYPE
    for name in ("data.arrow", "data.feather", "data.ipc"):
        assert resolve_mime_type(b"", file_name=name) == ARROW_FILE_MIME_TYPE
    assert resolve_mime_type(b"", file_name="data.arrows") == ARROW_STREAM_MIME_TYPE


def test_the_spellings_stores_use_collapse_onto_one_type() -> None:
    """Arrow has no registered MIME type, so every tool picked its own."""
    for alias in ("application/x-arrow", "application/vnd.apache.feather", "application/x-feather"):
        assert normalize_mime_type(alias) == ARROW_FILE_MIME_TYPE


def test_arrow_payloads_have_a_row_axis_a_window_can_address() -> None:
    assert is_tabular_mime_type(ARROW_FILE_MIME_TYPE)
    assert is_tabular_mime_type(ARROW_STREAM_MIME_TYPE)
    # Name-only, which is what the scan cache asks before downloading anything.
    assert tabular_mime_type_for_name("shard.arrow") == ARROW_FILE_MIME_TYPE
    assert tabular_mime_type_for_name("shard.feather") == ARROW_FILE_MIME_TYPE


# ── Reader-level bounds ──────────────────────────────────────────────────


def test_bounds_return_exactly_the_requested_slice() -> None:
    pages = list(iter_file_pages(_arrow_bytes(), ARROW_FILE_MIME_TYPE, start_row=250, max_rows=100))

    assert len(pages) == 100
    assert _ids(pages) == list(range(250, 350))
    # Row numbering stays absolute, so a finding's location survives windowing.
    assert _row_numbers(pages) == list(range(251, 351))


def test_bounds_land_inside_a_batch() -> None:
    """The offset need not fall on a record-batch boundary."""
    pages = list(iter_file_pages(_arrow_bytes(), ARROW_FILE_MIME_TYPE, start_row=137, max_rows=45))
    assert _ids(pages) == list(range(137, 182))


def test_default_bounds_read_the_whole_payload() -> None:
    assert len(list(iter_file_pages(_arrow_bytes(), ARROW_FILE_MIME_TYPE))) == ROWS


def test_bounds_past_the_end_yield_nothing() -> None:
    pages = iter_file_pages(_arrow_bytes(), ARROW_FILE_MIME_TYPE, start_row=ROWS + 50, max_rows=100)
    assert list(pages) == []


def test_a_window_overlapping_the_end_is_short_not_padded() -> None:
    pages = list(
        iter_file_pages(_arrow_bytes(), ARROW_FILE_MIME_TYPE, start_row=ROWS - 30, max_rows=100)
    )
    assert _ids(pages) == list(range(ROWS - 30, ROWS))


def test_a_seekable_handle_reads_the_same_rows_as_bytes() -> None:
    """Range-reading sources hand the reader a handle, never the whole object."""
    payload = _arrow_bytes()
    from_bytes = list(iter_file_pages(payload, ARROW_FILE_MIME_TYPE, start_row=400, max_rows=20))
    from_handle = list(
        iter_file_pages(io.BytesIO(payload), ARROW_FILE_MIME_TYPE, start_row=400, max_rows=20)
    )
    assert from_handle == from_bytes


@pytest.mark.parametrize(
    ("mime", "payload"),
    [
        (ARROW_STREAM_MIME_TYPE, _arrow_stream_bytes(rows=200)),
        (ARROW_FILE_MIME_TYPE, _feather_v1_bytes(rows=200)),
    ],
    ids=["ipc-stream", "feather-v1"],
)
def test_the_other_two_layouts_window_the_same_way(mime: str, payload: bytes) -> None:
    """A stream has no footer and V1 predates it; both still honour the window."""
    pages = list(iter_file_pages(payload, mime, start_row=120, max_rows=30))
    assert _ids(pages) == list(range(120, 150))
    assert len(list(iter_file_pages(payload, mime))) == 200


def test_a_row_reads_identically_whichever_container_held_it() -> None:
    """The point of the parity: a finding must not depend on the file format."""
    arrow_pages = list(iter_file_pages(_arrow_bytes(rows=20), ARROW_FILE_MIME_TYPE))
    parquet_pages = list(iter_file_pages(_parquet_bytes(rows=20), PARQUET_MIME))
    assert arrow_pages == parquet_pages


def test_a_truncated_arrow_fails_loudly_instead_of_reading_as_empty() -> None:
    """A byte-capped payload has lost its footer, so it has no rows — and no excuse.

    Yielding nothing here is indistinguishable from an empty file, which the
    AUTOMATIC cursor banks as a completed sweep; the asset is then skipped by the
    scan cache on every later run without ever having been read once.
    """
    payload = _arrow_bytes()

    with pytest.raises(TextExtractionCoverageError) as excinfo:
        list(iter_file_pages(payload[: len(payload) // 2], ARROW_FILE_MIME_TYPE))
    assert excinfo.value.code is TextExtractionCoverageCode.FAILED
    assert "max_object_bytes" in str(excinfo.value)


def test_the_row_count_is_not_free_for_arrow() -> None:
    """Arrow's footer indexes batches by offset, not by row count.

    Reporting None is the honest answer: totalling the rows would mean reading
    every batch, which is the full pass the window exists to avoid. RANDOM then
    reservoir-samples and AUTOMATIC infers the end from a short window, exactly as
    they do for CSV.
    """
    assert count_tabular_rows(_arrow_bytes(), ARROW_FILE_MIME_TYPE) is None


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
        name="events.arrow",
        external_url="file:///data/events.arrow",
    )


def test_three_automatic_runs_cover_disjoint_rows_then_wrap() -> None:
    """The end-to-end promise: run N reads rows that run N-1 did not."""
    payload = _arrow_bytes()
    per_run = 400
    stored: dict[str, Any] | None = None
    covered: list[list[int]] = []

    for _ in range(3):
        source, store = _source("AUTOMATIC", per_run)
        asset = _asset()
        store.bind(asset)
        if stored:
            store.record_prior([{"hash": asset.hash, "cursor": stored}])

        pages = list(
            source.iter_asset_pages(payload, ARROW_FILE_MIME_TYPE, asset_id=asset.external_url)
        )
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
    fourth = _ids(
        list(source.iter_asset_pages(payload, ARROW_FILE_MIME_TYPE, asset_id=asset.external_url))
    )
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
        source.iter_asset_pages(_arrow_bytes(), ARROW_FILE_MIME_TYPE, asset_id=asset.external_url)
    )
    assert _ids(pages) == list(range(0, 100))


def test_a_truncated_arrow_leaves_the_cursor_alone() -> None:
    """The failure must not be recorded as progress through the file."""
    source, store = _source("AUTOMATIC", 100)
    asset = _asset()
    store.bind(asset)

    payload = _arrow_bytes()
    with pytest.raises(TextExtractionCoverageError):
        list(
            source.iter_asset_pages(
                payload[: len(payload) // 2],
                ARROW_FILE_MIME_TYPE,
                asset_id=asset.external_url,
            )
        )

    assert store.cursor_payload_for(asset) is None


def test_latest_reads_the_top_rows_of_the_real_file() -> None:
    source, store = _source("LATEST", 60)
    asset = _asset()
    store.bind(asset)

    pages = list(
        source.iter_asset_pages(_arrow_bytes(), ARROW_FILE_MIME_TYPE, asset_id=asset.external_url)
    )
    assert _ids(pages) == list(range(0, 60))
    assert store.cursor_payload_for(asset) is None


def test_random_reads_a_bounded_sample_of_the_real_file() -> None:
    """Bounded, but not contiguous: with no free row count this reservoir-samples."""
    source, store = _source("RANDOM", 75)
    asset = _asset()
    store.bind(asset)

    ids = _ids(
        list(
            source.iter_asset_pages(
                _arrow_bytes(), ARROW_FILE_MIME_TYPE, asset_id=asset.external_url
            )
        )
    )
    assert len(ids) == 75
    assert len(set(ids)) == 75
    assert all(0 <= row_id < ROWS for row_id in ids)


def test_all_strategy_still_reads_every_row() -> None:
    source, _ = _source("ALL", 100)
    pages = list(
        source.iter_asset_pages(_arrow_bytes(), ARROW_FILE_MIME_TYPE, asset_id="file:///x.arrow")
    )
    assert len(pages) == ROWS


# ── Embedded files ───────────────────────────────────────────────────────


def test_arrow_is_a_container_that_yields_child_assets() -> None:
    assert has_embedded_files(ARROW_FILE_MIME_TYPE)
    assert has_embedded_files("application/vnd.apache.arrow.file; charset=binary")


def test_embedded_files_come_from_the_rows_this_run_scans() -> None:
    data = _hf_arrow_bytes(rows=4)

    window = list(iter_embedded_files(data, ARROW_FILE_MIME_TYPE, start_row=1, max_rows=2))

    assert [f.location for f in window] == ["row=2;col=image", "row=3;col=image"]
    assert {f.mime_type for f in window} == {"image/png"}


def test_embedded_file_locations_stay_absolute() -> None:
    """A child's location — and therefore its identity — must not depend on the window."""
    data = _hf_arrow_bytes(rows=4)

    whole = list(iter_embedded_files(data, ARROW_FILE_MIME_TYPE))
    tail = list(iter_embedded_files(data, ARROW_FILE_MIME_TYPE, start_row=2, max_rows=2))

    assert [f.location for f in tail] == [f.location for f in whole[2:]]
    assert [f.file_bytes for f in tail] == [f.file_bytes for f in whole[2:]]


def test_embedded_files_read_through_a_handle_too() -> None:
    data = _hf_arrow_bytes(rows=4)
    through_handle = list(
        iter_embedded_files(io.BytesIO(data), ARROW_FILE_MIME_TYPE, start_row=2, max_rows=2)
    )
    assert [f.location for f in through_handle] == ["row=3;col=image", "row=4;col=image"]


def test_a_file_column_renders_as_a_placeholder_in_the_row_text() -> None:
    """Its bytes belong to the child asset, not to the parent's text detectors."""
    page = next(iter(iter_file_pages(_hf_arrow_bytes(rows=1, batch_rows=1), ARROW_FILE_MIME_TYPE)))

    assert "image: <image:" in page
    assert "PNG" not in page


def test_a_window_past_the_end_yields_no_children() -> None:
    data = _hf_arrow_bytes(rows=2)
    assert list(iter_embedded_files(data, ARROW_FILE_MIME_TYPE, start_row=99, max_rows=10)) == []


# ── Normalized metadata ──────────────────────────────────────────────────


def test_metadata_reports_rows_and_typed_columns() -> None:
    metadata = extract_file_metadata(_arrow_bytes(rows=20), "", file_name="events.arrow")

    assert metadata["row_count"] == 20
    assert metadata["columns"] == [
        {"name": "id", "type": "int64"},
        {"name": "email", "type": "string"},
    ]


def test_metadata_reads_the_legacy_feather_layout() -> None:
    metadata = extract_file_metadata(_feather_v1_bytes(rows=7), "", file_name="legacy.feather")

    assert metadata["row_count"] == 7
    assert [column["name"] for column in metadata["columns"]] == ["id", "email"]
