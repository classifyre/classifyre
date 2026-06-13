"""Audio/video transcription via faster-whisper (CPU-only by default).

Mirrors the lazy, thread-safe singleton pattern used for the Docling converter
in ``file_parser.py``: building a WhisperModel loads model weights (~1.5 GB for
``medium``) so it happens exactly once per process, and a semaphore caps
concurrent inference to avoid OOM under the worker thread pool.

Transcription is opt-in (per-source ``sampling.enable_transcription``); callers
treat a returned error the same way they treat any other parse failure.
"""

from __future__ import annotations

import logging
import tempfile
from pathlib import Path
from threading import Lock, Semaphore
from urllib.parse import urlsplit

from ..config import get_whisper_config

logger = logging.getLogger(__name__)

# Map a normalized media MIME type to a temp-file extension faster-whisper /
# PyAV can demux. Extension is only a hint for the demuxer; PyAV sniffs the
# container regardless, so an imperfect guess still decodes.
_MIME_EXTENSION_HINTS = {
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/mp4": ".m4a",
    "audio/aac": ".aac",
    "audio/ogg": ".ogg",
    "audio/opus": ".opus",
    "audio/flac": ".flac",
    "audio/x-flac": ".flac",
    "video/mp4": ".mp4",
    "video/x-matroska": ".mkv",
    "video/quicktime": ".mov",
    "video/webm": ".webm",
    "video/x-msvideo": ".avi",
}


class _WhisperState:
    """Mutable singleton state for the WhisperModel (see _DoclingState rationale)."""

    def __init__(self) -> None:
        self.model: object = None
        self.error: str | None = None
        self.attempted: bool = False
        # Allow one retry when the failure is a transient dependency install
        # (network blip / registry timeout). A genuinely broken package fails on
        # the retry too and is then cached permanently.
        self.install_retry_remaining: int = 1


_whisper_state = _WhisperState()
_whisper_lock = Lock()
# A single medium model already holds ~1.5 GB; serialise inference so two
# concurrent transcriptions cannot push the worker over its memory limit.
_whisper_inference_sem = Semaphore(1)


def _get_whisper_model() -> tuple[object, str | None]:
    """Return a cached WhisperModel, initializing it on the first call."""
    if _whisper_state.model is not None or _whisper_state.error is not None:
        return _whisper_state.model, _whisper_state.error
    with _whisper_lock:
        if _whisper_state.attempted:
            return _whisper_state.model, _whisper_state.error
        _whisper_state.attempted = True
        try:
            from ..sources.dependencies import require_module

            whisper_module = require_module(
                "faster_whisper",
                "audio/video transcription",
                ["transcription"],
                detail="Transcription requires the faster-whisper optional dependency.",
            )
            cfg = get_whisper_config()
            _whisper_state.model = whisper_module.WhisperModel(
                cfg.model,
                device=cfg.device,
                compute_type=cfg.compute_type,
            )
            logger.info(
                "Loaded faster-whisper model %s (device=%s, compute_type=%s)",
                cfg.model,
                cfg.device,
                cfg.compute_type,
            )
        except Exception as exc:
            from ..sources.dependencies import MissingSourceDependencyError

            if (
                isinstance(exc, MissingSourceDependencyError)
                and _whisper_state.install_retry_remaining > 0
            ):
                _whisper_state.install_retry_remaining -= 1
                _whisper_state.attempted = False
                logger.warning(
                    "Transcription dependency install failed (may be transient); "
                    "will retry once: %s",
                    exc,
                )
            else:
                _whisper_state.error = str(exc)
    return _whisper_state.model, _whisper_state.error


def _reset_whisper_singleton() -> None:
    """Reset the cached WhisperModel. Intended for test isolation only."""
    with _whisper_lock:
        _whisper_state.model = None
        _whisper_state.error = None
        _whisper_state.attempted = False
        _whisper_state.install_retry_remaining = 1


def _temp_suffix(file_name: str, mime_type: str) -> str:
    if file_name:
        path = urlsplit(file_name).path or file_name
        suffix = Path(path).suffix.lower()
        if suffix:
            return suffix
    normalized = mime_type.split(";", 1)[0].strip().lower()
    return _MIME_EXTENSION_HINTS.get(normalized, ".bin")


def transcribe_media(
    file_bytes: bytes,
    *,
    mime_type: str,
    file_name: str = "",
) -> tuple[str, str | None]:
    """Transcribe audio/video bytes to text.

    Returns:
        (transcript_text, error_message_or_None)
    """
    if not file_bytes:
        return "", None

    model, error = _get_whisper_model()
    if error:
        return "", error
    if model is None:
        return "", "Transcription model unavailable"

    cfg = get_whisper_config()
    suffix = _temp_suffix(file_name, mime_type)
    try:
        with tempfile.TemporaryDirectory(prefix="classifyre-whisper-") as temp_dir:
            temp_path = Path(temp_dir) / f"input{suffix}"
            temp_path.write_bytes(file_bytes)
            with _whisper_inference_sem:
                segments, _info = model.transcribe(  # type: ignore[attr-defined]
                    str(temp_path),
                    beam_size=cfg.beam_size,
                    vad_filter=cfg.vad_filter,
                    word_timestamps=cfg.word_timestamps,
                )
                # segments is a lazy generator; decoding happens as we iterate.
                parts = [segment.text.strip() for segment in segments]
        text = "\n".join(part for part in parts if part)
        logger.info(
            "Transcribed %d chars from %s (%s)",
            len(text),
            file_name or mime_type,
            mime_type,
        )
        return text, None
    except Exception as exc:
        return "", f"Transcription failed: {exc}"
