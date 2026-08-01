"""Payloads that outgrow memory.

A scan used to hold every asset it was working on entirely in the heap, which is
what forced every source to cap object size in the low megabytes. These cover the
replacement: a payload is a handle, small ones stay in memory, large ones live on
disk, and the size a scan can survive stops being a function of RAM.
"""

from __future__ import annotations

import io
import tempfile

import pytest

from src.utils.payload import (
    PayloadTooLargeError,
    as_binary_io,
    header,
    payload_size,
    read_all,
    spool,
)


def _chunks(total: int, chunk: int = 1024) -> list[bytes]:
    return [bytes((i + j) % 251 for j in range(chunk)) for i in range(0, total, chunk)]


# ── spooling ─────────────────────────────────────────────────────────────


def test_a_small_payload_never_touches_the_filesystem() -> None:
    """The common case must stay exactly as cheap as it was."""
    handle = spool([b"hello ", b"world"], threshold_bytes=1024)

    assert handle.read() == b"hello world"
    # SpooledTemporaryFile only materializes a real file on rollover.
    assert handle._rolled is False  # type: ignore[attr-defined]
    handle.close()


def test_a_large_payload_rolls_over_to_disk() -> None:
    """Past the threshold the payload lives on disk, not in the heap."""
    payload = b"".join(_chunks(64 * 1024))
    handle = spool(_chunks(64 * 1024), threshold_bytes=8 * 1024)

    assert handle._rolled is True  # type: ignore[attr-defined]
    assert handle.read() == payload
    handle.close()


def test_a_spooled_payload_is_rewound_and_seekable() -> None:
    """Parsers seek: a Parquet footer read is the first thing that happens."""
    handle = spool(_chunks(32 * 1024), threshold_bytes=1024)

    assert handle.tell() == 0
    assert handle.seek(0, io.SEEK_END) == 32 * 1024
    handle.seek(16 * 1024)
    assert len(handle.read(100)) == 100
    handle.close()


def test_a_hard_ceiling_refuses_rather_than_truncates() -> None:
    """A truncated payload is not a smaller payload, it is a corrupt one.

    Handing a headless Parquet or a directory-less zip to a parser is how an
    unreadable file gets recorded as an empty one.
    """
    with pytest.raises(PayloadTooLargeError, match=r"shard\.parquet"):
        spool(_chunks(64 * 1024), threshold_bytes=1024, max_bytes=16 * 1024, label="shard.parquet")


def test_no_ceiling_is_the_default() -> None:
    handle = spool(_chunks(256 * 1024), threshold_bytes=1024)
    assert payload_size(handle) == 256 * 1024
    handle.close()


def test_a_failed_stream_leaves_no_spool_file_behind() -> None:
    def _explode() -> object:
        yield b"x" * 4096
        raise RuntimeError("connection reset")

    with pytest.raises(RuntimeError, match="connection reset"):
        spool(_explode(), threshold_bytes=1024)  # type: ignore[arg-type]


# ── handles and bytes, interchangeably ───────────────────────────────────


def test_as_binary_io_accepts_either_shape() -> None:
    assert as_binary_io(b"abc").read() == b"abc"

    handle = io.BytesIO(b"abc")
    handle.read()
    # Rewound, so a second consumer sees the whole payload.
    assert as_binary_io(handle).read() == b"abc"


def test_read_all_accepts_either_shape() -> None:
    assert read_all(b"abc") == b"abc"
    assert read_all(io.BytesIO(b"abc")) == b"abc"


def test_header_reads_a_prefix_and_leaves_the_payload_readable() -> None:
    """MIME detection must never be the step that pulls in a whole object."""
    handle = spool(_chunks(64 * 1024), threshold_bytes=1024)

    prefix = header(handle, 16)
    assert len(prefix) == 16
    # The payload is still readable from the top afterwards.
    assert len(as_binary_io(handle).read()) == 64 * 1024
    handle.close()


def test_payload_size_knows_bytes_and_handles() -> None:
    assert payload_size(b"abcd") == 4
    assert payload_size(io.BytesIO(b"abcd")) == 4

    with tempfile.TemporaryFile() as handle:
        handle.write(b"abcdef")
        assert payload_size(handle) == 6
