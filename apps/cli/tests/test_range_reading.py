"""Reading an oversized Parquet object by HTTP range instead of downloading it.

The behaviour under test is the one that decides whether a repository of
multi-hundred-megabyte shards is scannable at all. ``max_object_bytes`` bounds a
whole-file download, and a Parquet file cut off at that bound has lost the footer
that indexes its row groups — so capping does not yield fewer rows, it yields a
file that cannot be opened. These tests cover the alternative: seek to the
footer, then to the row groups the sampling window asks for, and transfer nothing
else.
"""

from __future__ import annotations

import io
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any

import pytest

from src.pipeline.payload_window import PayloadWindowStore
from src.sources.hugging_face.source import HuggingFaceObjectRef, HuggingFaceSource
from src.utils.http_range_reader import HttpRangeReader, open_buffered

pytest.importorskip("pyarrow")

PARQUET_MIME = "application/parquet"
ROWS = 200_000
ROWS_PER_GROUP = 10_000


def _parquet_bytes(rows: int = ROWS, row_group_size: int = ROWS_PER_GROUP) -> bytes:
    """A payload big enough that reading one window of it is visibly cheaper."""
    import pyarrow as pa
    import pyarrow.parquet as pq

    table = pa.table(
        {
            "id": list(range(rows)),
            # Poorly compressible, so the file's size on the wire is real.
            "email": [f"user{i}-{i * 2654435761 % 10**12:012d}@example.com" for i in range(rows)],
        }
    )
    buffer = io.BytesIO()
    pq.write_table(table, buffer, row_group_size=row_group_size, compression="none")
    return buffer.getvalue()


PAYLOAD = _parquet_bytes()


# ── the fake origin ──────────────────────────────────────────────────────


class _Response:
    def __init__(self, status_code: int, body: bytes) -> None:
        self.status_code = status_code
        self.content = body
        self.headers: dict[str, str] = {}

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def close(self) -> None:
        pass


class _RangeSession:
    """A server that honours ``Range`` — or, on request, stubbornly does not."""

    def __init__(self, payload: bytes, *, honour_ranges: bool = True) -> None:
        self.payload = payload
        self.honour_ranges = honour_ranges
        self.ranges: list[tuple[int, int]] = []
        self.bytes_served = 0

    def get(self, url: str, **kwargs: Any) -> _Response:
        header = (kwargs.get("headers") or {}).get("Range")
        if header is None or not self.honour_ranges:
            self.bytes_served += len(self.payload)
            return _Response(200, self.payload)

        span = header.split("=", 1)[1]
        start_text, end_text = span.split("-", 1)
        start = int(start_text)
        end = int(end_text)
        self.ranges.append((start, end))
        body = self.payload[start : end + 1]
        self.bytes_served += len(body)
        return _Response(206, body)


def _reader(session: _RangeSession, size: int | None = None) -> HttpRangeReader:
    return HttpRangeReader(
        session,
        "https://hub.test/data/shard.parquet",
        size=size if size is not None else len(session.payload),
        label="test:shard.parquet",
    )


# ── reader mechanics ─────────────────────────────────────────────────────


def test_reader_serves_the_exact_bytes_asked_for() -> None:
    session = _RangeSession(b"0123456789")
    reader = _reader(session)

    reader.seek(3)
    assert reader.read(4) == b"3456"
    assert reader.tell() == 7
    assert session.ranges == [(3, 6)]


def test_reader_reports_the_end_of_the_object_without_reading_it() -> None:
    """The first thing a Parquet reader does is seek to the footer."""
    session = _RangeSession(PAYLOAD)
    reader = _reader(session)

    assert reader.seek(0, io.SEEK_END) == len(PAYLOAD)
    assert session.ranges == []

    reader.seek(-4, io.SEEK_END)
    assert reader.read(4) == b"PAR1"


def test_reader_stops_at_the_end_of_the_object() -> None:
    session = _RangeSession(b"0123456789")
    reader = _reader(session)

    reader.seek(8)
    assert reader.read(100) == b"89"
    assert reader.read(1) == b""


def test_reader_is_correct_even_when_the_server_ignores_ranges() -> None:
    """A provider without range support must be slow, never wrong."""
    session = _RangeSession(b"0123456789", honour_ranges=False)
    reader = _reader(session)

    reader.seek(4)
    assert reader.read(3) == b"456"


def test_reader_refuses_an_unknown_size() -> None:
    with pytest.raises(ValueError, match="size"):
        HttpRangeReader(_RangeSession(b"x"), "https://hub.test/x", size=0)


# ── driving pyarrow through it ───────────────────────────────────────────


def test_a_parquet_is_read_through_ranges_without_downloading_it() -> None:
    from src.utils.file_parser import count_tabular_rows, iter_file_pages

    session = _RangeSession(PAYLOAD)
    handle = open_buffered(_reader(session))

    assert count_tabular_rows(handle, PARQUET_MIME) == ROWS

    pages = list(iter_file_pages(handle, PARQUET_MIME, start_row=150_000, max_rows=100))
    assert [int(p.split("id: ")[1].split("\n")[0]) for p in pages] == list(range(150_000, 150_100))

    # The whole point: a window near the end of the file costs a fraction of it.
    assert session.bytes_served < len(PAYLOAD) // 4, (
        f"transferred {session.bytes_served} of {len(PAYLOAD)} bytes"
    )


# ── the source path ──────────────────────────────────────────────────────


def _hf_source(
    session: _RangeSession, *, size: int, max_object_bytes: int, rows_per_page: int = 100
):
    source = HuggingFaceSource(
        {
            "type": "HUGGING_FACE",
            "required": {"repo_id": "acme/corpus", "repo_type": "dataset"},
            "masked": {"token": "hf_test-token"},
            "optional": {"connection": {"max_object_bytes": max_object_bytes}},
            "sampling": {"strategy": "AUTOMATIC", "rows_per_page": rows_per_page},
        }
    )
    source._cached_revision = "0" * 40
    source._cached_session = session  # type: ignore[assignment]
    source._resolve_url = lambda key: f"https://hub.test/{key}"  # type: ignore[assignment]

    ref = HuggingFaceObjectRef(
        key="data/shard.parquet",
        size=size,
        last_modified=datetime.now(UTC),
        etag="sha-1",
        lfs_sha256="sha-1",
    )
    external_url = source._external_url(ref.key)
    source._object_ref_by_hash[source.generate_hash_id(external_url)] = ref
    return source, ref, external_url


def _asset(external_url: str, source: HuggingFaceSource) -> SimpleNamespace:
    return SimpleNamespace(
        hash=source.generate_hash_id(external_url),
        checksum="sha-1",
        name="shard.parquet",
        external_url=external_url,
    )


def test_an_oversized_parquet_takes_the_range_path() -> None:
    session = _RangeSession(PAYLOAD)
    source, _ref, url = _hf_source(session, size=len(PAYLOAD), max_object_bytes=1024 * 1024)

    opened = source._open_row_reader(url)
    assert opened is not None
    handle, mime = opened
    assert mime == PARQUET_MIME
    handle.close()


def test_an_object_within_the_cap_still_downloads_whole() -> None:
    """Ranges are for what cannot be downloaded, not a replacement for downloading."""
    session = _RangeSession(PAYLOAD)
    source, _ref, url = _hf_source(session, size=len(PAYLOAD), max_object_bytes=len(PAYLOAD) + 1)

    assert source._open_row_reader(url) is None


def test_an_oversized_non_parquet_object_is_not_range_read() -> None:
    """Truncating a PDF loses detail; truncating a Parquet loses the file."""
    session = _RangeSession(PAYLOAD)
    source, ref, url = _hf_source(session, size=len(PAYLOAD), max_object_bytes=1024)
    object.__setattr__(ref, "key", "docs/report.pdf")
    source._object_ref_by_hash[source.generate_hash_id(url)] = ref

    assert source._open_row_reader(url) is None


@pytest.mark.asyncio
async def test_successive_runs_read_successive_windows_over_the_wire() -> None:
    """The end-to-end promise, with nothing downloaded whole in between."""
    stored: dict[str, Any] | None = None
    covered: list[list[int]] = []
    served: list[int] = []

    for _ in range(3):
        session = _RangeSession(PAYLOAD)
        source, _ref, url = _hf_source(
            session, size=len(PAYLOAD), max_object_bytes=1024 * 1024, rows_per_page=50
        )
        store = PayloadWindowStore.from_recipe(
            {"sampling": {"strategy": "AUTOMATIC", "rows_per_page": 50}}
        )
        source.attach_payload_windows(store)
        asset = _asset(url, source)
        store.bind(asset)
        if stored:
            store.record_prior([{"hash": asset.hash, "cursor": stored}])

        pages = [page async for _raw, page in source.fetch_content_pages(url)]
        covered.append([int(p.split("id: ")[1].split("\n")[0]) for p in pages])
        stored = store.cursor_payload_for(asset)
        served.append(session.bytes_served)

    assert covered[0] == list(range(0, 50))
    assert covered[1] == list(range(50, 100))
    assert covered[2] == list(range(100, 150))
    assert stored is not None and stored["exhausted"] is False
    assert max(served) < len(PAYLOAD) // 4
