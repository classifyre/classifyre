"""Seekable file objects that fetch only the byte ranges they are asked for.

Columnar formats are read back-to-front: the footer says where the row groups
are, and a reader that only wants rows 4,000,000-4,000,100 needs the footer plus
one row group. Downloading the object to get at them defeats the point — a 500 MB
Parquet shard costs 500 MB of egress to read 100 rows, and capping the download
instead produces a headless file that cannot be read at all.

``RangeReader`` closes that gap. It presents ``read``/``seek``/``tell`` over
whatever range primitive a provider offers, so pyarrow (or any file-object-shaped
parser) can drive it directly and transfer only what it touches.

Providers differ only in how a range is fetched, which is the one method
subclasses supply:

* ``HttpRangeReader`` sends a ``Range`` header — Hugging Face, Dropbox, and any
  plain HTTP origin;
* ``CallableRangeReader`` wraps an SDK call — ``boto3.get_object(Range=…)``,
  ``blob.download_as_bytes(start=, end=)``, ``download_blob(offset=, length=)``.

Two properties matter for correctness:

* the total size must be known up front (every caller here has it from the
  object listing), because ``seek(0, SEEK_END)`` is the first thing a Parquet
  reader does;
* a provider that ignores the range and returns the whole object is handled by
  slicing, so a backend without range support is slow rather than wrong.

The classes are deliberately unbuffered: callers wrap them with ``open_buffered``,
which coalesces the parser's many small reads into a few larger fetches and
discards its buffer on seek.
"""

from __future__ import annotations

import io
import logging
from collections.abc import Callable
from typing import Any

logger = logging.getLogger(__name__)

# Big enough that a Parquet footer and its metadata arrive in one fetch, small
# enough not to inflate the reads that follow. ``BufferedReader`` passes a read
# larger than its buffer straight through, so this only ever pads *small* reads —
# which is why an oversized buffer costs bytes rather than saving requests. On a
# 4 MB shard with 100-row groups, 256 KB transfers 409 KB in 3 requests where
# 1 MB transfers 1.2 MB in the same 3.
DEFAULT_BUFFER_BYTES = 256 * 1024


class RangeReader(io.RawIOBase):
    """Random access over a remote object, one range fetch at a time."""

    def __init__(self, *, size: int, label: str = "") -> None:
        super().__init__()
        if size <= 0:
            raise ValueError("A range reader requires the object's size")
        self._size = int(size)
        self._label = label or "object"
        self._position = 0
        self._bytes_transferred = 0
        self._fetches = 0

    # ── the provider hook ────────────────────────────────────────────────

    def _fetch_range(self, start: int, end_inclusive: int) -> bytes:
        """Return ``[start, end_inclusive]`` of the object. Implemented per provider.

        May return more than was asked for (a backend that ignores ranges);
        ``_take`` trims it. Returning less is also tolerated — the reader simply
        reports a short read, which every file consumer already handles.
        """
        raise NotImplementedError

    def _take(self, payload: bytes, start: int, end_inclusive: int, *, whole: bool) -> bytes:
        """Account for a fetch and trim a whole-object response down to the range."""
        if whole:
            logger.warning(
                "Range fetch for %s returned the whole object (%d bytes) for a "
                "%d-byte range; this backend appears not to support ranges",
                self._label,
                len(payload),
                end_inclusive - start + 1,
            )
            payload = payload[start : end_inclusive + 1]
        self._fetches += 1
        self._bytes_transferred += len(payload)
        return payload

    # ── io protocol ──────────────────────────────────────────────────────

    def readable(self) -> bool:
        return True

    def seekable(self) -> bool:
        return True

    def writable(self) -> bool:
        return False

    def tell(self) -> int:
        return self._position

    def seek(self, offset: int, whence: int = io.SEEK_SET) -> int:
        if whence == io.SEEK_SET:
            target = offset
        elif whence == io.SEEK_CUR:
            target = self._position + offset
        elif whence == io.SEEK_END:
            target = self._size + offset
        else:
            raise ValueError(f"Unsupported whence: {whence}")
        # Seeking past the end is legal and simply reads nothing, which is what
        # a local file does; landing below zero is not.
        self._position = max(0, target)
        return self._position

    def readinto(self, buffer: Any) -> int:  # type: ignore[override]
        wanted = len(buffer)
        if wanted == 0 or self._position >= self._size:
            return 0
        end = min(self._position + wanted, self._size)
        chunk = self._fetch_range(self._position, end - 1)
        received = len(chunk)
        buffer[:received] = chunk
        self._position += received
        return received

    def read(self, size: int = -1) -> bytes:  # type: ignore[override]
        if size is None or size < 0:
            size = max(0, self._size - self._position)
        if size == 0 or self._position >= self._size:
            return b""
        end = min(self._position + size, self._size)
        chunk = self._fetch_range(self._position, end - 1)
        self._position += len(chunk)
        return chunk

    def readall(self) -> bytes:  # type: ignore[override]
        return self.read(-1)

    # ── accounting ───────────────────────────────────────────────────────

    @property
    def size(self) -> int:
        return self._size

    @property
    def bytes_transferred(self) -> int:
        """Total bytes actually pulled over the wire, for run accounting."""
        return self._bytes_transferred

    @property
    def fetch_count(self) -> int:
        return self._fetches


class HttpRangeReader(RangeReader):
    """Ranges over plain HTTP, via a ``requests``-shaped session."""

    def __init__(
        self,
        session: Any,
        url: str,
        *,
        size: int,
        headers: dict[str, str] | None = None,
        timeout: float | tuple[float, float] | None = None,
        label: str = "",
    ) -> None:
        super().__init__(size=size, label=label or url)
        self._session = session
        self._url = url
        self._headers = dict(headers or {})
        self._timeout = timeout

    def _fetch_range(self, start: int, end_inclusive: int) -> bytes:
        headers = dict(self._headers)
        headers["Range"] = f"bytes={start}-{end_inclusive}"
        response = self._session.get(
            self._url,
            headers=headers,
            timeout=self._timeout,
            stream=True,
            allow_redirects=True,
        )
        response.raise_for_status()
        try:
            payload = response.content
        finally:
            close = getattr(response, "close", None)
            if callable(close):
                close()
        return self._take(payload, start, end_inclusive, whole=response.status_code != 206)


class CallableRangeReader(RangeReader):
    """Ranges over an SDK call: ``fetch(start, end_inclusive) -> bytes``.

    For backends whose client already exposes a byte range (S3's ``Range=``,
    GCS's ``start=/end=``, Azure's ``offset=/length=``) there is no HTTP layer to
    reach around, so the provider hands over a closure instead of a URL.
    """

    def __init__(
        self,
        fetch: Callable[[int, int], bytes],
        *,
        size: int,
        label: str = "",
    ) -> None:
        super().__init__(size=size, label=label)
        self._fetch = fetch

    def _fetch_range(self, start: int, end_inclusive: int) -> bytes:
        payload = self._fetch(start, end_inclusive)
        wanted = end_inclusive - start + 1
        return self._take(payload, start, end_inclusive, whole=len(payload) > wanted)


def open_buffered(
    reader: RangeReader,
    buffer_size: int = DEFAULT_BUFFER_BYTES,
) -> io.BufferedReader:
    """Wrap a range reader so small sequential reads become few large fetches."""
    return io.BufferedReader(reader, buffer_size=buffer_size)
