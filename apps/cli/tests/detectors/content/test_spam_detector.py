"""Tests for Spam detector heuristic fallback behavior."""

import pytest

from src.detectors.content.spam_detector import SpamDetector


@pytest.mark.asyncio
async def test_spam_detector_heuristic_detects_obvious_spam(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("CLASSIFYRE_ENABLE_SPAM_MODEL", "0")
    detector = SpamDetector()

    results = await detector.detect(
        "Win big now! Click here for a free prize! http://spam.example",
        content_type="text/plain",
    )

    assert results
    assert results[0].finding_type == "spam"
    assert results[0].metadata.get("model") == "heuristic"


@pytest.mark.asyncio
async def test_spam_detector_heuristic_ignores_clean_text(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CLASSIFYRE_ENABLE_SPAM_MODEL", "0")
    detector = SpamDetector()

    results = await detector.detect(
        "Thanks for sharing the meeting notes. Let's sync tomorrow.",
        content_type="text/plain",
    )

    assert results == []
