"""Runtime configuration loaded from environment variables.

A central, reusable place for tunables that may be overridden via `.env`
(loaded by ``src.main.load_local_env``) without touching source recipes. Each
concrete config section is a small pydantic model with a cached accessor so the
environment is read once per process.

Future sources/processors can add their own sections here following the same
pattern (``BaseModel`` + ``functools.lru_cache`` accessor).
"""

from __future__ import annotations

import os
from functools import lru_cache

from pydantic import BaseModel, Field


def _env_str(name: str, default: str) -> str:
    value = os.environ.get(name)
    if value is None:
        return default
    value = value.strip()
    return value or default


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    try:
        return int(raw.strip())
    except ValueError:
        return default


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


class WhisperConfig(BaseModel):
    """faster-whisper transcription settings (CPU-only defaults).

    Overridable via environment so a deployment can trade speed for accuracy
    (e.g. a larger model, GPU device, or float16 compute) without code changes.
    """

    model: str = Field(
        "medium", description="Whisper model size or path (e.g. tiny, base, medium, large-v3)."
    )
    device: str = Field("cpu", description="Inference device: cpu, cuda, or auto.")
    compute_type: str = Field(
        "int8", description="ctranslate2 compute type: int8, int8_float16, float16, float32."
    )
    beam_size: int = Field(5, ge=1, description="Beam search width.")
    vad_filter: bool = Field(
        True, description="Drop non-speech segments with Silero VAD before decoding."
    )
    word_timestamps: bool = Field(True, description="Emit per-word timestamps during decoding.")


@lru_cache(maxsize=1)
def get_whisper_config() -> WhisperConfig:
    """Return the process-wide WhisperConfig, populated from the environment."""
    return WhisperConfig(
        model=_env_str("CLASSIFYRE_WHISPER_MODEL", "medium"),
        device=_env_str("CLASSIFYRE_WHISPER_DEVICE", "cpu"),
        compute_type=_env_str("CLASSIFYRE_WHISPER_COMPUTE_TYPE", "int8"),
        beam_size=_env_int("CLASSIFYRE_WHISPER_BEAM_SIZE", 5),
        vad_filter=_env_bool("CLASSIFYRE_WHISPER_VAD_FILTER", True),
        word_timestamps=_env_bool("CLASSIFYRE_WHISPER_WORD_TIMESTAMPS", True),
    )
