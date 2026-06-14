"""Unit tests for src/utils/transcription.py."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from src import config
from src.utils import transcription
from src.utils.transcription import _reset_whisper_singleton, transcribe_media


@pytest.fixture(autouse=True)
def _reset_singletons() -> Any:
    config.get_whisper_config.cache_clear()
    _reset_whisper_singleton()
    yield
    config.get_whisper_config.cache_clear()
    _reset_whisper_singleton()


class _FakeModel:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def transcribe(self, path: str, **kwargs: Any) -> tuple[list[Any], Any]:
        self.calls.append({"path": path, **kwargs})
        segments = [
            SimpleNamespace(text="Hello world. "),
            SimpleNamespace(text="  Second line."),
        ]
        return segments, SimpleNamespace(language="en")


class TestTranscribeMedia:
    def test_joins_segments_into_text(self, monkeypatch: pytest.MonkeyPatch) -> None:
        fake = _FakeModel()
        monkeypatch.setattr(transcription, "_get_whisper_model", lambda: (fake, None))

        text, err = transcribe_media(b"audio-bytes", mime_type="audio/mpeg", file_name="a.mp3")

        assert err is None
        assert text == "Hello world.\nSecond line."

    def test_passes_config_values(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("CLASSIFYRE_WHISPER_BEAM_SIZE", "3")
        monkeypatch.setenv("CLASSIFYRE_WHISPER_VAD_FILTER", "false")
        monkeypatch.setenv("CLASSIFYRE_WHISPER_WORD_TIMESTAMPS", "false")
        config.get_whisper_config.cache_clear()

        fake = _FakeModel()
        monkeypatch.setattr(transcription, "_get_whisper_model", lambda: (fake, None))

        transcribe_media(b"audio-bytes", mime_type="audio/mpeg", file_name="a.mp3")

        assert fake.calls[0]["beam_size"] == 3
        assert fake.calls[0]["vad_filter"] is False
        assert fake.calls[0]["word_timestamps"] is False

    def test_empty_bytes_returns_empty(self, monkeypatch: pytest.MonkeyPatch) -> None:
        def fail() -> tuple[object, str | None]:
            raise AssertionError("model should not be built for empty input")

        monkeypatch.setattr(transcription, "_get_whisper_model", fail)

        text, err = transcribe_media(b"", mime_type="audio/mpeg", file_name="a.mp3")

        assert text == ""
        assert err is None

    def test_model_unavailable_returns_error(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(transcription, "_get_whisper_model", lambda: (None, "boom"))

        text, err = transcribe_media(b"audio-bytes", mime_type="audio/mpeg", file_name="a.mp3")

        assert text == ""
        assert err == "boom"

    def test_transcribe_exception_degrades_to_error(self, monkeypatch: pytest.MonkeyPatch) -> None:
        class _BoomModel:
            def transcribe(self, *_args: Any, **_kwargs: Any) -> Any:
                raise RuntimeError("decode failed")

        monkeypatch.setattr(transcription, "_get_whisper_model", lambda: (_BoomModel(), None))

        text, err = transcribe_media(b"audio-bytes", mime_type="audio/mpeg", file_name="a.mp3")

        assert text == ""
        assert err is not None
        assert "Transcription failed" in err
