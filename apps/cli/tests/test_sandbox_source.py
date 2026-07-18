from __future__ import annotations

import base64
import json
from datetime import UTC, datetime, timedelta

import pytest

from src.sources import get_source, list_available_sources
from src.sources.object_storage.base import ContentSnapshot, ObjectRef
from src.sources.sandbox.source import SandboxSource


def _recipe(strategy: str = "ALL", rows_per_page: int = 10) -> dict:
    return {
        "type": "SANDBOX",
        "required": {},
        "masked": {},
        "optional": {},
        "sampling": {"strategy": strategy, "rows_per_page": rows_per_page},
    }


def _refs(count: int = 15) -> list[ObjectRef]:
    now = datetime.now(UTC)
    return [
        ObjectRef(
            key=f"file-{index}",
            size=index + 1,
            last_modified=now - timedelta(minutes=index),
            etag=f"hash-{index}",
            content_type_hint="text/plain",
        )
        for index in range(count)
    ]


def test_sandbox_source_is_registered_and_requires_source_id() -> None:
    assert "sandbox" in list_available_sources()
    source = get_source(_recipe(), source_id="source-1", runner_id="runner-1")
    assert isinstance(source, SandboxSource)
    assert source._max_object_bytes() == 50 * 1024 * 1024
    source.cleanup()
    with pytest.raises(ValueError, match="source ID"):
        SandboxSource(_recipe())


def test_sandbox_sampling_all_latest_and_random_are_stable() -> None:
    refs = _refs()
    all_source = SandboxSource(_recipe("ALL"), source_id="source-1")
    latest_source = SandboxSource(_recipe("LATEST"), source_id="source-1")
    random_source = SandboxSource(_recipe("RANDOM"), source_id="source-1")
    try:
        assert all_source._apply_sampling(iter(refs)) == refs
        assert [ref.key for ref in latest_source._apply_sampling(iter(reversed(refs)))] == [
            ref.key for ref in refs[:10]
        ]
        first = [ref.key for ref in random_source._apply_sampling(iter(refs))]
        second = [ref.key for ref in random_source._apply_sampling(iter(refs))]
        assert first == second
        assert len(first) == 10
    finally:
        all_source.cleanup()
        latest_source.cleanup()
        random_source.cleanup()


def test_sandbox_automatic_sampling_uses_persisted_rolling_window(monkeypatch) -> None:
    refs = _refs()
    first = SandboxSource(_recipe("AUTOMATIC"), source_id="source-1")
    try:
        first_window = first._apply_sampling(iter(refs))
        cursor = first.current_sampling_cursor()
    finally:
        first.cleanup()

    monkeypatch.setenv(
        "CLASSIFYRE_SAMPLING_CURSOR",
        base64.b64encode(json.dumps(cursor).encode()).decode(),
    )
    second = SandboxSource(_recipe("AUTOMATIC"), source_id="source-1")
    try:
        second_window = second._apply_sampling(iter(refs))
        assert [ref.key for ref in first_window] == [ref.key for ref in refs[:10]]
        assert [ref.key for ref in second_window] == [ref.key for ref in refs[10:]]
        assert second.current_sampling_cursor() == {"objects": 0}
    finally:
        second.cleanup()


@pytest.mark.asyncio
async def test_sandbox_asset_identity_and_file_metadata_are_stable(monkeypatch) -> None:
    source = SandboxSource(_recipe(), source_id="source-1", runner_id="runner-1")
    metadata = {
        "id": "file-id",
        "fileName": "customer.csv",
        "fileSizeBytes": 14,
        "contentHash": "abc123",
        "declaredMimeType": "text/csv",
        "createdAt": "2026-07-17T08:00:00Z",
    }
    source._file_by_id = {"file-id": metadata}
    ref = ObjectRef(
        key="file-id",
        size=14,
        last_modified=datetime(2026, 7, 17, 8, tzinfo=UTC),
        etag="abc123",
        content_type_hint="text/csv",
    )
    monkeypatch.setattr(source, "_list_objects", lambda: iter([ref]))
    monkeypatch.setattr(
        source,
        "_build_snapshot",
        lambda _ref: ContentSnapshot(
            mime_type="text/csv",
            raw_content="name\nAda\n",
            text_content="name\nAda\n",
            parse_error=None,
            downloaded_bytes=14,
        ),
    )
    try:
        assets = [asset async for batch in source.extract() for asset in batch]
        first = assets[0]
        assert first.name == "customer.csv"
        assert first.external_url == "sandbox://source-1/file-id"
        assert first.hash == source.generate_hash_id(first.external_url)

        again = source._to_asset(ref)
        assert again.hash == first.hash
        assert again.checksum == first.checksum
        assert again.name == "customer.csv"
    finally:
        source.cleanup()
