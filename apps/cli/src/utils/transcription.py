"""Audio/video transcription via faster-whisper (CPU-only by default).

Mirrors the lazy, thread-safe singleton pattern used for the Docling converter
in ``file_parser.py``: building a WhisperModel loads model weights (~1.5 GB for
``medium``) so it happens exactly once per process, and a semaphore caps
concurrent inference to avoid OOM under the worker thread pool.

Long audio files are split into ~10-minute WAV chunks using PyAV (bundled with
faster-whisper) before transcription.  This bounds the per-chunk decoded audio
buffer to ~38 MB instead of the ~230 MB required for a full 1-hour file, making
the overall peak memory manageable alongside the 1.5 GB model weights.

Transcription is opt-in (per-source ``sampling.enable_transcription``); callers
treat a returned error the same way they treat any other parse failure.
"""

from __future__ import annotations

import io
import logging
import tempfile
import wave
from collections.abc import Generator
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


def _pcm_to_wav(pcm_bytes: bytes, sample_rate: int) -> bytes:
    """Wrap raw int16 mono PCM bytes in a WAV container."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm_bytes)
    return buf.getvalue()


_AUDIO_CHUNK_SECONDS = 600  # 10-minute chunks → ~38 MB decoded audio per chunk
_TARGET_SAMPLE_RATE = 16_000


def _split_audio_chunks(
    file_bytes: bytes,
    chunk_seconds: int = _AUDIO_CHUNK_SECONDS,
) -> Generator[bytes, None, None]:
    """Decode audio bytes and yield WAV chunks via PyAV (bundled with faster-whisper).

    Streams through the compressed audio frame-by-frame so only
    ``chunk_seconds`` worth of decoded PCM is held in memory at once instead of
    the full decoded duration.  Falls back to yielding the original bytes when
    PyAV is unavailable or decoding fails.
    """
    try:
        import av as pyav  # type: ignore[import-untyped]
    except ImportError:
        yield file_bytes
        return

    bytes_per_chunk = _TARGET_SAMPLE_RATE * chunk_seconds * 2  # int16 = 2 bytes/sample
    current: bytearray = bytearray()

    try:
        container = pyav.open(io.BytesIO(file_bytes), metadata_errors="ignore")
        audio_streams = [s for s in container.streams if s.type == "audio"]
        if not audio_streams:
            yield file_bytes
            return

        resampler = pyav.audio.resampler.AudioResampler(
            format="s16", layout="mono", rate=_TARGET_SAMPLE_RATE
        )

        def _drain(frames: object) -> Generator[bytes, None, None]:
            result = frames if isinstance(frames, list) else ([frames] if frames is not None else [])
            for out_frame in result:
                current.extend(bytes(out_frame.planes[0]))
                while len(current) >= bytes_per_chunk:
                    yield _pcm_to_wav(bytes(current[:bytes_per_chunk]), _TARGET_SAMPLE_RATE)
                    del current[:bytes_per_chunk]

        for frame in container.decode(audio_streams[0]):
            yield from _drain(resampler.resample(frame))

        # Flush the resampler's internal buffer.
        try:
            yield from _drain(resampler.resample(None))
        except Exception:
            pass

        if current:
            yield _pcm_to_wav(bytes(current), _TARGET_SAMPLE_RATE)

    except Exception as exc:
        logger.warning(
            "Audio chunking failed (%s); falling back to full-file transcription: %s",
            type(exc).__name__,
            exc,
        )
        yield file_bytes


def iter_transcription_pages(
    file_bytes: bytes,
    *,
    mime_type: str,
    file_name: str = "",
    segments_per_page: int = 50,
    chunk_seconds: int = _AUDIO_CHUNK_SECONDS,
) -> Generator[str, None, None]:
    """Transcribe audio/video in chunks, yielding pages of transcript text.

    Splits long audio into ``chunk_seconds``-long WAV chunks and transcribes
    each under the inference semaphore, then yields batches of
    ``segments_per_page`` whisper segments as each chunk completes.  This lets
    the detector start receiving text immediately and keeps peak decoded-audio
    memory bounded to one chunk at a time.
    """
    if not file_bytes:
        return

    model, error = _get_whisper_model()
    if error:
        logger.warning("Whisper model unavailable for %s: %s", file_name or mime_type, error)
        return
    if model is None:
        logger.warning("Whisper model not initialized for %s", file_name or mime_type)
        return

    cfg = get_whisper_config()
    suffix = _temp_suffix(file_name, mime_type)

    for chunk_index, chunk_bytes in enumerate(_split_audio_chunks(file_bytes, chunk_seconds), 1):
        is_wav = chunk_bytes[:4] == b"RIFF"
        chunk_suffix = ".wav" if is_wav else suffix
        try:
            with tempfile.TemporaryDirectory(prefix="classifyre-whisper-") as temp_dir:
                temp_path = Path(temp_dir) / f"chunk{chunk_suffix}"
                temp_path.write_bytes(chunk_bytes)
                with _whisper_inference_sem:
                    segments, _info = model.transcribe(  # type: ignore[attr-defined]
                        str(temp_path),
                        beam_size=cfg.beam_size,
                        vad_filter=cfg.vad_filter,
                        word_timestamps=cfg.word_timestamps,
                    )
                    page: list[str] = []
                    total_chars = 0
                    for segment in segments:
                        text = segment.text.strip()
                        if text:
                            page.append(text)
                            total_chars += len(text)
                        if len(page) >= segments_per_page:
                            yield "\n".join(page)
                            page = []
                    if page:
                        yield "\n".join(page)
                logger.info(
                    "Transcribed chunk %d: %d chars from %s (%s)",
                    chunk_index,
                    total_chars,
                    file_name or mime_type,
                    mime_type,
                )
        except Exception as exc:
            logger.warning(
                "Transcription failed for chunk %d of %s: %s",
                chunk_index,
                file_name or mime_type,
                exc,
            )


def transcribe_media(
    file_bytes: bytes,
    *,
    mime_type: str,
    file_name: str = "",
) -> tuple[str, str | None]:
    """Transcribe audio/video bytes to text (full transcript returned at once).

    Prefer ``iter_transcription_pages`` when processing long files; this
    function buffers the entire transcript before returning.
    """
    if not file_bytes:
        return "", None

    pages = list(
        iter_transcription_pages(file_bytes, mime_type=mime_type, file_name=file_name)
    )
    text = "\n".join(pages)
    if text:
        logger.info(
            "Transcribed %d chars from %s (%s)",
            len(text),
            file_name or mime_type,
            mime_type,
        )
    return text, None
