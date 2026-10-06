from __future__ import annotations

import base64
import json

import pytest

from src.notebook.sdk import Context
from src.sources.base import BaseSource
from src.utils.sampling_cursor import (
    MAX_ENCODED_CURSOR_BYTES,
    check_cursor_fits,
    decode_sampling_cursor,
    encode_sampling_cursor,
)


def _person_companies(persons: int) -> dict[str, list[str]]:
    """The shape that broke a production source: a person -> companies map."""
    return {
        f"person-{i:06d}--19{i % 100:02d}-01-01": [f"{i:06d}a", f"{i + 1:06d}b"]
        for i in range(persons)
    }


def test_cursor_round_trips() -> None:
    cursor = {"cohort": {"register": {"newest": "606601k"}}, "companies": 1200}
    assert decode_sampling_cursor(encode_sampling_cursor(cursor)) == cursor


def test_a_cursor_too_large_as_plain_base64_fits_once_compressed() -> None:
    cursor = {"person_companies": _person_companies(2400)}
    plain = base64.b64encode(json.dumps(cursor).encode()).decode()
    assert len(plain) > MAX_ENCODED_CURSOR_BYTES
    assert len(encode_sampling_cursor(cursor)) < MAX_ENCODED_CURSOR_BYTES
    check_cursor_fits(cursor)


def test_a_cursor_that_cannot_start_the_next_run_is_refused() -> None:
    # Random-looking values, so compression cannot rescue it.
    cursor = {str(i): base64.b64encode(i.to_bytes(4, "big") * 12).decode() for i in range(40000)}
    with pytest.raises(ValueError, match="over the 131072-byte limit"):
        check_cursor_fits(cursor)


def test_set_cursor_refuses_an_oversized_cursor_and_keeps_the_last_good_one() -> None:
    ctx = Context()
    ctx.set_cursor({"offset": 5})
    huge = {str(i): base64.b64encode(i.to_bytes(4, "big") * 12).decode() for i in range(40000)}
    with pytest.raises(ValueError, match=r"ctx\.query_assets\(\)"):
        ctx.set_cursor(huge)
    assert ctx.next_cursor == {"offset": 5}


def test_a_malformed_cursor_is_ignored(monkeypatch: pytest.MonkeyPatch) -> None:
    class _Source:
        SAMPLING_CURSOR_ENV = BaseSource.SAMPLING_CURSOR_ENV

    monkeypatch.setenv(BaseSource.SAMPLING_CURSOR_ENV, "not-a-cursor")
    assert BaseSource._load_sampling_cursor(_Source()) == {}  # type: ignore[arg-type]
