"""How a source's saved cursor travels from the API to a scan.

The API hands the cursor to the CLI in one environment variable, gzip then
base64. Linux caps a single environment variable at 128 KiB (MAX_ARG_STRLEN);
over it the process never starts and the kernel's "argument list too long"
names neither the variable nor its size. So the size is checked on both ends:
the API refuses to launch with a cursor that does not fit, and a notebook is
told in the run that tries to *save* one, while it can still do something
about it.
"""

from __future__ import annotations

import base64
import gzip
import json
from collections.abc import Mapping
from typing import Any

#: The limit for one environment variable, and so for an encoded cursor.
MAX_ENCODED_CURSOR_BYTES = 128 * 1024


def encode_sampling_cursor(cursor: Mapping[str, Any]) -> str:
    """The cursor as it is put into the environment variable."""
    raw = json.dumps(cursor, separators=(",", ":")).encode("utf-8")
    return base64.b64encode(gzip.compress(raw)).decode("ascii")


def decode_sampling_cursor(encoded: str) -> dict[str, Any]:
    """The cursor an environment variable carries. Raises on malformed input."""
    data = json.loads(gzip.decompress(base64.b64decode(encoded)).decode("utf-8"))
    return data if isinstance(data, dict) else {}


def check_cursor_fits(cursor: Mapping[str, Any]) -> None:
    """Refuse a cursor the next run could not be started with."""
    size = len(encode_sampling_cursor(cursor))
    if size > MAX_ENCODED_CURSOR_BYTES:
        raise ValueError(
            f"This cursor is {size} bytes compressed, over the "
            f"{MAX_ENCODED_CURSOR_BYTES}-byte limit: the next run could not be "
            "started with it. A cursor records where a run stopped; keep bulk "
            "state in assets and read it back with ctx.query_assets()."
        )
