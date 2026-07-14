"""Audio/video transcription via faster-whisper (CPU-only by default).

Mirrors the lazy, thread-safe singleton pattern used for the Docling converter
in ``file_parser.py``: building a WhisperModel loads model weights (~1.5 GB for
``medium``) so it happens exactly once per process, and a semaphore caps
concurrent inference to avoid OOM under the worker thread pool.

Long audio files are split into ~10-minute WAV chunks using PyAV (bundled with
faster-whisper) before transcription.  This bounds the per-chunk decoded audio
buffer to ~19 MB instead of the ~115 MB required for a full 1-hour file, making
the overall peak memory manageable alongside the 1.5 GB model weights.

Transcription runs whenever parsing discovers audio or video content. Callers
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

            import os

            explicit_model = os.environ.get("CLASSIFYRE_WHISPER_MODEL", "").strip()
            if explicit_model:
                model_name = cfg.model
                model_source = "env"
            else:
                available_mb = _whisper_available_mb()
                model_name = select_whisper_model(available_mb)
                model_source = f"auto ({available_mb} MB available)"

            _whisper_state.model = whisper_module.WhisperModel(
                model_name,
                device=cfg.device,
                compute_type=cfg.compute_type,
            )
            logger.info(
                "Loaded faster-whisper model %s [%s] (device=%s, compute_type=%s)",
                model_name,
                model_source,
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

# ---------------------------------------------------------------------------
# Memory-aware model selection
# ---------------------------------------------------------------------------

# Budget to reserve for the detector worker process (presidio + spaCy) and
# OS / Python overhead, before the remainder is available to the Whisper model.
_DETECTOR_WORKER_RESERVE_MB = 1536  # ~1 GB presidio/spaCy + 512 MB headroom
_OS_RESERVE_MB = 256

# (model_name, min_available_mb) ordered largest → smallest.
# min_available_mb accounts for beam-search working memory on top of the model
# weights: tiny≈75 MB, base≈150 MB, small≈500 MB, medium≈1.5 GB.
_WHISPER_MODEL_TIERS: tuple[tuple[str, int], ...] = (
    ("medium", 2560),  # needs ≥ 2.5 GB available
    ("small", 1000),  # needs ≥ 1 GB available
    ("base", 512),  # needs ≥ 512 MB available
    ("tiny", 0),  # always fits
)


def select_whisper_model(available_mb: int) -> str:
    """Return the largest Whisper model that fits in *available_mb* of RAM.

    Mirrors the logic of ``compute_pool_workers`` in the detector worker pool:
    query the cgroup-aware memory budget, subtract reserved headroom, then pick
    the best model tier that fits.  Callers pass *available_mb* so the function
    is unit-testable without mocking cgroup files.

    Example: a 4 GB pod with one detector worker has
    ``4096 - 1536 - 256 = 2304 MB`` available → auto-selects "small" instead
    of the default "medium", keeping peak RSS safely under the pod limit.
    """
    for model, threshold in _WHISPER_MODEL_TIERS:
        if available_mb >= threshold:
            return model
    return "tiny"


def _whisper_available_mb() -> int:
    """Return MB available to the Whisper model after reserving headroom."""
    from .resources import get_effective_memory_mb

    total = get_effective_memory_mb()
    return max(0, total - _DETECTOR_WORKER_RESERVE_MB - _OS_RESERVE_MB)


def _split_audio_chunks(
    media: bytes | Path,
    chunk_seconds: int = _AUDIO_CHUNK_SECONDS,
) -> Generator[bytes | Path, None, None]:
    """Decode audio and yield bounded WAV chunks via PyAV.

    Streams through the compressed audio frame-by-frame so only
    ``chunk_seconds`` worth of decoded PCM is held in memory at once instead of
    the full decoded duration. A path source stays on disk even if decoding
    falls back to direct faster-whisper processing.
    """
    try:
        import av as pyav  # type: ignore[import-untyped]
    except ImportError:
        yield media
        return

    bytes_per_chunk = _TARGET_SAMPLE_RATE * chunk_seconds * 2  # int16 = 2 bytes/sample
    current: bytearray = bytearray()
    container: object | None = None

    try:
        source = io.BytesIO(media) if isinstance(media, bytes) else str(media)
        container = pyav.open(source, metadata_errors="ignore")
        audio_streams = [s for s in container.streams if s.type == "audio"]
        if not audio_streams:
            yield media
            return

        resampler = pyav.audio.resampler.AudioResampler(
            format="s16", layout="mono", rate=_TARGET_SAMPLE_RATE
        )

        def _drain(frames: object) -> Generator[bytes, None, None]:
            result = (
                frames if isinstance(frames, list) else ([frames] if frames is not None else [])
            )
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
        yield media
    finally:
        if container is not None:
            container.close()  # type: ignore[attr-defined]


def _transcribe_path_pages(
    model: object,
    media_path: Path,
    *,
    file_name: str,
    mime_type: str,
    segments_per_page: int,
    chunk_index: int,
) -> Generator[str, None, None]:
    """Transcribe one on-disk media chunk while holding the inference limit."""
    cfg = get_whisper_config()
    with _whisper_inference_sem:
        segments, _info = model.transcribe(  # type: ignore[attr-defined]
            str(media_path),
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


def _iter_transcription_pages(
    media: bytes | Path,
    *,
    mime_type: str,
    file_name: str,
    segments_per_page: int,
    chunk_seconds: int,
) -> Generator[str, None, None]:
    model, error = _get_whisper_model()
    if error:
        logger.warning("Whisper model unavailable for %s: %s", file_name or mime_type, error)
        return
    if model is None:
        logger.warning("Whisper model not initialized for %s", file_name or mime_type)
        return

    suffix = _temp_suffix(file_name, mime_type)
    for chunk_index, chunk in enumerate(_split_audio_chunks(media, chunk_seconds), 1):
        try:
            if isinstance(chunk, Path):
                yield from _transcribe_path_pages(
                    model,
                    chunk,
                    file_name=file_name,
                    mime_type=mime_type,
                    segments_per_page=segments_per_page,
                    chunk_index=chunk_index,
                )
                continue

            is_wav = chunk[:4] == b"RIFF"
            chunk_suffix = ".wav" if is_wav else suffix
            with tempfile.TemporaryDirectory(prefix="classifyre-whisper-") as temp_dir:
                temp_path = Path(temp_dir) / f"chunk{chunk_suffix}"
                temp_path.write_bytes(chunk)
                yield from _transcribe_path_pages(
                    model,
                    temp_path,
                    file_name=file_name,
                    mime_type=mime_type,
                    segments_per_page=segments_per_page,
                    chunk_index=chunk_index,
                )
        except Exception as exc:
            logger.warning(
                "Transcription failed for chunk %d of %s: %s",
                chunk_index,
                file_name or mime_type,
                exc,
            )
            raise


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

    yield from _iter_transcription_pages(
        file_bytes,
        mime_type=mime_type,
        file_name=file_name,
        segments_per_page=segments_per_page,
        chunk_seconds=chunk_seconds,
    )


def iter_transcription_path_pages(
    media_path: Path,
    *,
    mime_type: str,
    segments_per_page: int = 50,
    chunk_seconds: int = _AUDIO_CHUNK_SECONDS,
) -> Generator[str, None, None]:
    """Transcribe an on-disk media file without loading the container into RAM."""
    if not media_path.is_file() or media_path.stat().st_size == 0:
        return
    yield from _iter_transcription_pages(
        media_path,
        mime_type=mime_type,
        file_name=media_path.name,
        segments_per_page=segments_per_page,
        chunk_seconds=chunk_seconds,
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

    model, model_error = _get_whisper_model()
    if model_error:
        return "", model_error
    if model is None:
        return "", "Whisper model not initialized"

    try:
        pages = list(iter_transcription_pages(file_bytes, mime_type=mime_type, file_name=file_name))
    except Exception as exc:
        logger.warning("Transcription failed for %s: %s", file_name or mime_type, exc)
        return "", f"Transcription failed: {exc}"

    text = "\n".join(pages)
    if text:
        logger.info(
            "Transcribed %d chars from %s (%s)",
            len(text),
            file_name or mime_type,
            mime_type,
        )
    return text, None


def transcribe_media_path(
    media_path: Path,
    *,
    mime_type: str,
) -> tuple[str, str | None]:
    """Transcribe media already on disk without buffering the container bytes."""
    if not media_path.is_file() or media_path.stat().st_size == 0:
        return "", None

    model, model_error = _get_whisper_model()
    if model_error:
        return "", model_error
    if model is None:
        return "", "Whisper model not initialized"

    try:
        pages = list(iter_transcription_path_pages(media_path, mime_type=mime_type))
    except Exception as exc:
        logger.warning("Transcription failed for %s: %s", media_path.name, exc)
        return "", f"Transcription failed: {exc}"

    text = "\n".join(pages)
    if text:
        logger.info(
            "Transcribed %d chars from %s (%s)",
            len(text),
            media_path.name,
            mime_type,
        )
    return text, None
