"""Where an asset's bytes live, and how a parser gets at them.

A scan used to hold every asset it was working on entirely in memory: a source
downloaded an object into ``bytes``, and every parser took ``bytes``. With
``pool_workers * 2`` assets in flight that makes resident memory a multiple of
the largest file in the corpus, which is the real reason every source carries a
``max_object_bytes`` cap — and why the caps are 5-25 MB rather than something
that would actually fit a corpus.

The caps were solving the wrong problem. What must be bounded is *resident
memory*, not file size, and the parsers were never the obstacle: they are all
driven through a file object already (``pdfplumber.open``, ``docx.Document``,
``openpyxl.load_workbook``, ``zipfile.ZipFile``, ``pyarrow.parquet.ParquetFile``
— every one of them was being handed ``io.BytesIO(file_bytes)``). Give them a
handle to somewhere other than the heap and the size limit stops mattering.

So this module deals in handles:

* ``spool`` streams chunks into a ``SpooledTemporaryFile``, which keeps a small
  payload in memory and rolls over to a temp file beyond a threshold. Small files
  stay exactly as fast as before; a 2 GB file costs a file descriptor.
* ``as_binary_io`` accepts either bytes or a handle, so a function can take both
  during (and after) the migration.
* ``read_all`` is the deliberate escape hatch for the few consumers that really
  do need every byte at once — YARA, image models — and is the thing to grep for
  when memory goes wrong.

The one rule: a handle is positioned at 0 before it is handed to a parser, and
whoever opened it closes it.
"""

from __future__ import annotations

import io
import logging
import tempfile
from collections.abc import Iterable
from typing import IO, Any

logger = logging.getLogger(__name__)

# Below this, a payload stays in memory and never touches the filesystem. Chosen
# to cover the overwhelming majority of documents in a normal corpus, so spilling
# is the exception rather than the rule.
DEFAULT_SPOOL_THRESHOLD_BYTES = 8 * 1024 * 1024

BinarySource = bytes | bytearray | IO[bytes] | Any


def is_bytes(source: BinarySource) -> bool:
    return isinstance(source, bytes | bytearray)


def as_binary_io(source: BinarySource) -> IO[bytes]:
    """A file object over ``source``, rewound to the start.

    Bytes are wrapped; a handle is rewound and returned as-is — deliberately not
    copied, so a caller passing a range reader keeps its laziness.
    """
    if is_bytes(source):
        return io.BytesIO(bytes(source))
    seek = getattr(source, "seek", None)
    if callable(seek):
        try:
            seek(0)
        except Exception:  # pragma: no cover - a non-seekable stream reads on
            logger.debug("Payload handle could not be rewound; reading from its current position")
    return source


def read_all(source: BinarySource) -> bytes:
    """Every byte of a payload, in memory.

    Only for consumers that genuinely cannot work incrementally (whole-file
    binary detectors). Everything else should take the handle: this is where a
    multi-gigabyte asset becomes a multi-gigabyte allocation.
    """
    if is_bytes(source):
        return bytes(source)
    return as_binary_io(source).read()


def header(source: BinarySource, size: int) -> bytes:
    """The first ``size`` bytes, leaving the payload readable from the start.

    MIME detection only ever looks at a magic prefix, so it must not be the thing
    that drags a whole object into memory.
    """
    if is_bytes(source):
        return bytes(source[:size])
    handle = as_binary_io(source)
    prefix = handle.read(size)
    try:
        handle.seek(0)
    except Exception:  # pragma: no cover - non-seekable
        logger.debug("Payload handle could not be rewound after reading its header")
    return prefix


def payload_size(source: BinarySource) -> int | None:
    """The payload's length when it is knowable without reading it."""
    if is_bytes(source):
        return len(source)
    for attribute in ("size",):
        value = getattr(source, attribute, None)
        if isinstance(value, int) and value >= 0:
            return value
    seek = getattr(source, "seek", None)
    tell = getattr(source, "tell", None)
    if callable(seek) and callable(tell):
        try:
            here = tell()
            end = seek(0, io.SEEK_END)
            seek(here)
            return int(end)
        except Exception:  # pragma: no cover - non-seekable
            return None
    return None


def spool(
    chunks: Iterable[bytes],
    *,
    threshold_bytes: int = DEFAULT_SPOOL_THRESHOLD_BYTES,
    max_bytes: int | None = None,
    label: str = "",
) -> tempfile.SpooledTemporaryFile[bytes]:
    """Collect a stream into a rewound handle, spilling to disk past a threshold.

    ``max_bytes`` is a refusal, not a truncation: a payload cut short is not a
    smaller payload but a corrupt one (a headless Parquet, a directory-less zip),
    and silently handing that to a parser is how an unreadable file gets recorded
    as an empty one. None — the default — means no ceiling; the size a scan can
    handle is then free disk.
    """
    handle: tempfile.SpooledTemporaryFile[bytes] = tempfile.SpooledTemporaryFile(
        max_size=max(0, threshold_bytes),
        prefix="classifyre-payload-",
    )
    total = 0
    try:
        for chunk in chunks:
            if not chunk:
                continue
            total += len(chunk)
            if max_bytes is not None and total > max_bytes:
                raise PayloadTooLargeError(
                    f"{label or 'Payload'} exceeds the configured limit of {max_bytes} bytes"
                )
            handle.write(chunk)
    except BaseException:
        handle.close()
        raise
    handle.seek(0)
    if total > threshold_bytes:
        logger.info(
            "Payload %s (%d bytes) spilled to disk rather than held in memory",
            label or "asset",
            total,
        )
    return handle


class PayloadTooLargeError(RuntimeError):
    """A payload exceeded a configured hard ceiling and was not read."""
