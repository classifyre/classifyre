"""Unit tests for the YouTube source.

Network access (yt-dlp + youtube-transcript-api) is fully mocked. Because these
run under pytest, ``metadata_fields`` validates emitted metadata against the
x-asset-metadata catalog in strict mode, so an asset that drifts from the
declared contract fails these tests automatically.
"""

from __future__ import annotations

from typing import Any

import pytest

from src.models.generated_single_asset_scan_results import AssetType as OutputAssetType
from src.sources.asset_metadata import resolve_fields
from src.sources.youtube.source import YouTubeSource, _TranscriptResult


def _make_fake_ydl(entries: list[str], captured: list[dict[str, Any]]):
    class FakeYDL:
        def __init__(self, opts: dict[str, Any]):
            captured.append(opts)

        def __enter__(self) -> FakeYDL:
            return self

        def __exit__(self, *_: Any) -> bool:
            return False

        def extract_info(self, url: str, download: bool = False) -> dict[str, Any]:
            return {"entries": [{"id": vid} for vid in entries]}

    return FakeYDL


def _source(recipe_overrides: dict[str, Any] | None = None) -> YouTubeSource:
    recipe: dict[str, Any] = {
        "type": "YOUTUBE",
        "required": {"channels": ["@OpenAI"]},
        "sampling": {"strategy": "LATEST", "rows_per_page": 10},
    }
    if recipe_overrides:
        recipe.update(recipe_overrides)
    return YouTubeSource(recipe, source_id="src-1", runner_id="run-1")


def _video_info(video_id: str = "vid1") -> dict[str, Any]:
    return {
        "id": video_id,
        "title": "Demo Video",
        "webpage_url": f"https://www.youtube.com/watch?v={video_id}",
        "channel_id": "UC123",
        "channel": "OpenAI",
        "duration": 212,
        "view_count": 1000,
        "like_count": 50,
        "upload_date": "20260101",
        "timestamp": 1767225600,
    }


def test_requires_channels_or_video_urls() -> None:
    with pytest.raises(ValueError, match="at least one"):
        YouTubeSource({"type": "YOUTUBE", "required": {}, "sampling": {"strategy": "ALL"}})


def test_connection_missing_dependency_returns_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    source = _source()

    def _raise() -> Any:
        raise ImportError("YouTube source requires yt-dlp")

    monkeypatch.setattr(source, "_ydl_class", _raise)
    result = source.test_connection()
    assert result["status"] == "FAILURE"
    assert "yt-dlp" in result["message"]


def test_connection_success(monkeypatch: pytest.MonkeyPatch) -> None:
    source = _source()
    captured: list[dict[str, Any]] = []
    monkeypatch.setattr(source, "_ydl_class", lambda: _make_fake_ydl(["a"], captured))
    monkeypatch.setattr(source, "_transcript_api", lambda: None)
    result = source.test_connection()
    assert result["status"] == "SUCCESS"


def test_list_channel_latest_sets_playlist_items(monkeypatch: pytest.MonkeyPatch) -> None:
    source = _source()  # LATEST, rows_per_page=10
    captured: list[dict[str, Any]] = []
    monkeypatch.setattr(source, "_ydl_class", lambda: _make_fake_ydl(["a", "b", "c"], captured))
    ids = source._list_channel_video_ids("@OpenAI", limit=10)
    assert ids == ["a", "b", "c"]
    assert captured[0]["extract_flat"] == "in_playlist"
    assert captured[0]["playlist_items"] == "1:10"


def test_list_channel_all_has_no_playlist_items(monkeypatch: pytest.MonkeyPatch) -> None:
    source = _source({"sampling": {"strategy": "ALL"}})
    captured: list[dict[str, Any]] = []
    monkeypatch.setattr(source, "_ydl_class", lambda: _make_fake_ydl(["a", "b"], captured))
    source._list_channel_video_ids("@OpenAI", limit=None)
    assert "playlist_items" not in captured[0]


def test_resolve_random_samples_to_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    source = _source({"sampling": {"strategy": "RANDOM", "rows_per_page": 10}})
    monkeypatch.setattr(
        source, "_list_channel_video_ids", lambda _c, _l: [f"v{i}" for i in range(25)]
    )
    ids = source._resolve_target_video_ids()
    assert len(ids) == 10
    assert set(ids).issubset({f"v{i}" for i in range(25)})


@pytest.mark.asyncio
async def test_extract_builds_video_asset_with_transcript(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = _source()
    monkeypatch.setattr(source, "_list_channel_video_ids", lambda _c, _l: ["vid1"])
    monkeypatch.setattr(source, "_extract_video_info", lambda _v: _video_info("vid1"))
    monkeypatch.setattr(
        source,
        "_fetch_transcript",
        lambda _v: _TranscriptResult(
            text="hello my email is a@b.com",
            language="en",
            is_generated=True,
            available_languages=["en", "es"],
        ),
    )

    assets = [a for batch in [b async for b in source.extract_raw()] for a in batch]
    assert len(assets) == 1
    asset = assets[0]
    assert asset.asset_type == OutputAssetType.TXT
    assert asset.asset_kind == "video"
    assert asset.metadata["video_id"] == "vid1"
    assert asset.metadata["transcript_available"] is True
    assert asset.metadata["transcript_language"] == "en"
    assert asset.metadata["caption_tracks"] == ["en", "es"]
    assert asset.metadata["duration_seconds"] == 212

    content = await source.fetch_content(asset.hash)
    assert content is not None
    assert "a@b.com" in content[0]


@pytest.mark.asyncio
async def test_extract_without_transcript_skips_phase2(monkeypatch: pytest.MonkeyPatch) -> None:
    source = _source()
    monkeypatch.setattr(source, "_list_channel_video_ids", lambda _c, _l: ["vid1"])
    monkeypatch.setattr(source, "_extract_video_info", lambda _v: _video_info("vid1"))
    monkeypatch.setattr(source, "_fetch_transcript", lambda _v: None)

    assets = [a for batch in [b async for b in source.extract_raw()] for a in batch]
    assert len(assets) == 1
    assert assets[0].metadata["transcript_available"] is False
    assert "transcript_language" not in assets[0].metadata
    assert await source.fetch_content(assets[0].hash) is None


@pytest.mark.asyncio
async def test_explicit_video_urls(monkeypatch: pytest.MonkeyPatch) -> None:
    source = _source(
        {
            "required": {
                "video_urls": [
                    "https://www.youtube.com/watch?v=abc123",
                    "https://youtu.be/def456",
                ]
            },
            "sampling": {"strategy": "ALL"},
        }
    )
    monkeypatch.setattr(source, "_extract_video_info", _video_info)
    monkeypatch.setattr(source, "_fetch_transcript", lambda _v: None)

    assets = [a for batch in [b async for b in source.extract_raw()] for a in batch]
    video_ids = sorted(a.metadata["video_id"] for a in assets)
    assert video_ids == ["abc123", "def456"]


def test_video_id_parsing() -> None:
    parse = YouTubeSource._video_id_from_url
    assert parse("https://www.youtube.com/watch?v=abc123") == "abc123"
    assert parse("https://youtu.be/def456") == "def456"
    assert parse("https://www.youtube.com/shorts/ghi789") == "ghi789"
    assert parse("abc123") == "abc123"


def test_metadata_catalog_conformance() -> None:
    """The source's emitted kind/keys must be declared in x-asset-metadata."""
    fields = resolve_fields("youtube", "video")
    declared = {f["name"] for f in fields}
    required = {f["name"] for f in fields if f["required"]}
    assert {"video_id", "title"}.issubset(declared)
    assert required == {"video_id", "title"}
