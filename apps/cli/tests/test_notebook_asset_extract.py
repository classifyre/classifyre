"""``Asset(extract=False)``: record an artefact without extracting its content."""

from __future__ import annotations

import pytest

from src.notebook.sdk import Asset


def test_assets_are_extracted_by_default() -> None:
    asset = Asset(id="a", content="text")
    assert asset.extract is True
    assert asset.reference_reason is None


def test_a_reference_asset_keeps_its_reason_trimmed() -> None:
    asset = Asset(id="filing", extract=False, reference_reason="  27 pages, 17 min to convert ")
    assert asset.extract is False
    assert asset.reference_reason == "27 pages, 17 min to convert"


def test_a_blank_reason_is_no_reason() -> None:
    assert Asset(id="filing", extract=False, reference_reason="   ").reference_reason is None


def test_bytes_are_allowed_on_a_reference_asset() -> None:
    # They fill in size, MIME type and page count; the runtime does not keep them.
    asset = Asset(id="filing", content_bytes=b"%PDF-1.7", extract=False)
    assert asset.content_bytes == b"%PDF-1.7"


def test_content_on_a_reference_asset_is_refused() -> None:
    # It would never be scanned, so accepting it would drop it without a word.
    with pytest.raises(ValueError, match="not scanned when extract=False"):
        Asset(id="filing", content="summary", extract=False)


def test_a_reason_without_extract_false_is_refused() -> None:
    with pytest.raises(ValueError, match="only applies with extract=False"):
        Asset(id="filing", reference_reason="too big")


def test_extract_must_be_a_boolean() -> None:
    # "false" is truthy; guessing would extract what the author meant to skip.
    with pytest.raises(TypeError, match="True or False"):
        Asset(id="filing", extract="false")  # type: ignore[arg-type]
