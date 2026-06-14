"""Live network integration test for the YouTube source.

Marked ``integration`` (network access required) so it is excluded from the
default unit-test run. Run explicitly with the optional ``youtube`` extra:

    uv run --group youtube pytest -m integration tests/test_youtube_source_integration.py

The test scans a single real public video end-to-end: yt-dlp metadata
extraction + youtube-transcript-api caption fetching.
"""

from __future__ import annotations

import pytest

from src.sources.youtube.source import YouTubeSource

VIDEO_URL = "https://www.youtube.com/watch?v=JsmYHLfVpF8"
VIDEO_ID = "JsmYHLfVpF8"


def _youtube_installed() -> bool:
    try:
        import youtube_transcript_api  # noqa: F401
        import yt_dlp  # noqa: F401

        return True
    except ImportError:
        return False


pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        not _youtube_installed(),
        reason="requires the [youtube] optional dependency group (uv sync --group youtube)",
    ),
]


def _source() -> YouTubeSource:
    recipe = {
        "type": "YOUTUBE",
        "required": {"video_urls": [VIDEO_URL]},
        "optional": {"transcript": {"languages": ["en"]}},
        "sampling": {"strategy": "ALL"},
    }
    return YouTubeSource(recipe, source_id="integration", runner_id="integration")


def test_youtube_connection_live() -> None:
    result = _source().test_connection()
    assert result["status"] == "SUCCESS", result


@pytest.mark.asyncio
async def test_youtube_extract_video_with_transcript_live() -> None:
    source = _source()
    assets = [a for batch in [b async for b in source.extract_raw()] for a in batch]

    assert len(assets) == 1
    asset = assets[0]

    # Metadata comes from yt-dlp and is always populated for a public video.
    assert asset.asset_kind == "video"
    assert asset.metadata["video_id"] == VIDEO_ID
    assert asset.metadata["title"]
    assert asset.metadata["channel_name"]
    assert asset.metadata["duration_seconds"] > 0

    # This video has English captions, so the transcript pipeline (Phase 2 input)
    # must resolve to non-empty detector content.
    assert asset.metadata["transcript_available"] is True
    assert asset.metadata["transcript_language"] == "en"
    content = await source.fetch_content(asset.hash)
    assert content is not None
    assert len(content[0]) > 100
