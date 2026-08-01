"""A seekable file object backed by HTTP range requests.

Columnar formats are read back-to-front: the footer says where the row groups
are, and a reader that only wants rows 4,000,000-4,000,100 needs the footer plus
one row group. Downloading the object to get at them defeats the point — a 500 MB
Parquet shard costs 500 MB of egress to read 100 rows, and capping the download
instead produces a headless file that cannot be read at all.

``HttpRangeReader`` closes that gap. It presents ``read``/``seek``/``tell`` over
``Range`` requests so pyarrow can drive it directly, and transfers only the byte
ranges it is actually asked for.

Two properties matter for correctness:

* the total size must be known up front (every caller here has it from the
  object listing), because ``seek(0, SEEK_END)`` is the first thing a Parquet
  reader does;
* a server that ignores ``Range`` and replies 200 with the whole body is handled
  by slicing the response, so a provider without range support is slow rather
  than wrong.

The class is deliberately unbuffered: callers wrap it in ``io.BufferedReader``
(see ``open_buffered``), which coalesces pyarrow's many small reads into a few
large ranges and discards its buffer on seek.
"""

from __future__ import annotations

import io
import logging
from typing import Any

logger = logging.getLogger(__name__)

# Big enough that a Parquet footer and its metadata arrive in one request, small
# enough that a seek into the middle of a file does not drag a row group along.
DEFAULT_BUFFER_BYTES = 1024 * 1024


class HttpRangeReader(io.RawIOBase):
    """Random access over an HTTP object, one ``Range`` request at a time."""

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
        super().__init__()
        if size <= 0:
            raise ValueError("HttpRangeReader requires the object's size")
        self._session = session
        self._url = url
        self._size = int(size)
        self._headers = dict(headers or {})
        self._timeout = timeout
        self._label = label or url
        self._position = 0
        self._bytes_transferred = 0
        self._requests = 0

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
        # a local file does; clamping below zero is not.
        self._position = max(0, target)
        return self._position

    def readinto(self, buffer: Any) -> int:  # type: ignore[override]
        wanted = len(buffer)
        if wanted == 0 or self._position >= self._size:
            return 0
        end = min(self._position + wanted, self._size)
        chunk = self._fetch(self._position, end - 1)
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
        chunk = self._fetch(self._position, end - 1)
        self._position += len(chunk)
        return chunk

    def readall(self) -> bytes:  # type: ignore[override]
        return self.read(-1)

    # ── transfer ─────────────────────────────────────────────────────────

    @property
    def size(self) -> int:
        return self._size

    @property
    def bytes_transferred(self) -> int:
        """Total bytes actually pulled over the wire, for run accounting."""
        return self._bytes_transferred

    @property
    def request_count(self) -> int:
        return self._requests

    def _fetch(self, start: int, end_inclusive: int) -> bytes:
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
            response.close()

        if response.status_code != 206:
            # The server ignored the range and sent the whole object. Slicing
            # keeps the read correct; the warning explains the egress.
            logger.warning(
                "Range request for %s returned %s, not 206: the server sent the "
                "whole object (%d bytes) for a %d-byte range",
                self._label,
                response.status_code,
                len(payload),
                end_inclusive - start + 1,
            )
            payload = payload[start : end_inclusive + 1]

        self._requests += 1
        self._bytes_transferred += len(payload)
        return payload


def open_buffered(
    reader: HttpRangeReader,
    buffer_size: int = DEFAULT_BUFFER_BYTES,
) -> io.BufferedReader:
    """Wrap a range reader so small sequential reads become few large requests."""
    return io.BufferedReader(reader, buffer_size=buffer_size)
