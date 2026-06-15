"""Unit tests for src/config.py."""

from __future__ import annotations

from typing import Any

import pytest

from src import config
from src.config import get_whisper_config


@pytest.fixture(autouse=True)
def _clear_cache() -> Any:
    config.get_whisper_config.cache_clear()
    yield
    config.get_whisper_config.cache_clear()


def test_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    for var in (
        "CLASSIFYRE_WHISPER_MODEL",
        "CLASSIFYRE_WHISPER_DEVICE",
        "CLASSIFYRE_WHISPER_COMPUTE_TYPE",
        "CLASSIFYRE_WHISPER_BEAM_SIZE",
        "CLASSIFYRE_WHISPER_VAD_FILTER",
        "CLASSIFYRE_WHISPER_WORD_TIMESTAMPS",
    ):
        monkeypatch.delenv(var, raising=False)

    cfg = get_whisper_config()

    assert cfg.model == "medium"
    assert cfg.device == "cpu"
    assert cfg.compute_type == "int8"
    assert cfg.beam_size == 5
    assert cfg.vad_filter is True
    assert cfg.word_timestamps is True


def test_env_overrides(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CLASSIFYRE_WHISPER_MODEL", "large-v3")
    monkeypatch.setenv("CLASSIFYRE_WHISPER_DEVICE", "cuda")
    monkeypatch.setenv("CLASSIFYRE_WHISPER_COMPUTE_TYPE", "float16")
    monkeypatch.setenv("CLASSIFYRE_WHISPER_BEAM_SIZE", "8")
    monkeypatch.setenv("CLASSIFYRE_WHISPER_VAD_FILTER", "false")
    monkeypatch.setenv("CLASSIFYRE_WHISPER_WORD_TIMESTAMPS", "0")

    cfg = get_whisper_config()

    assert cfg.model == "large-v3"
    assert cfg.device == "cuda"
    assert cfg.compute_type == "float16"
    assert cfg.beam_size == 8
    assert cfg.vad_filter is False
    assert cfg.word_timestamps is False


def test_invalid_int_falls_back_to_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CLASSIFYRE_WHISPER_BEAM_SIZE", "not-a-number")

    cfg = get_whisper_config()

    assert cfg.beam_size == 5
