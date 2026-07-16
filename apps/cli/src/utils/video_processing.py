"""Sparse, CPU-conscious OCR extraction from video frames."""

from __future__ import annotations

import logging
import math
import os
import re
import tempfile
from collections import deque
from collections.abc import Generator
from pathlib import Path
from threading import Lock, Semaphore
from typing import Any

logger = logging.getLogger(__name__)

_SAMPLE_INTERVAL_SECONDS = 1.0
_FRAME_WIDTH = 320
_CHANGE_THRESHOLD = 3.0
# Only exact global hashes are skipped, and only for unchanged heartbeat frames.
# Changed slides always reach OCR because coarse global hashes can collide when
# the background is static and text occupies a small part of the image.
_HASH_DISTANCE_THRESHOLD = 0
_HEARTBEAT_SECONDS = 30.0
_MIN_OCR_CONFIDENCE = 0.5
_RECENT_HASHES = 256


class VideoOCRError(RuntimeError):
    """Base error for a video OCR coverage failure."""


class VideoOCREngineUnavailableError(VideoOCRError):
    """The video OCR engine or one of its runtime dependencies is unavailable."""


class VideoOCRZeroFramesError(VideoOCRError):
    """The decoder opened the input but produced no frames to inspect."""


class _RapidOcrState:
    def __init__(self) -> None:
        self.engine: object = None
        self.error: str | None = None
        self.attempted = False
        self.install_retry_remaining = 1


_rapidocr_state = _RapidOcrState()
_rapidocr_lock = Lock()
_rapidocr_inference_sem = Semaphore(1)


def _get_cv2() -> object:
    from ..sources.dependencies import require_module

    return require_module(
        "cv2",
        "video frame processing",
        ["video"],
        detail="Video frame OCR requires the OpenCV headless optional dependency.",
    )


def _get_rapidocr_engine() -> tuple[object, str | None]:
    if _rapidocr_state.engine is not None or _rapidocr_state.error is not None:
        return _rapidocr_state.engine, _rapidocr_state.error
    with _rapidocr_lock:
        if _rapidocr_state.attempted:
            return _rapidocr_state.engine, _rapidocr_state.error
        _rapidocr_state.attempted = True
        try:
            from ..sources.dependencies import require_module

            module = require_module(
                "rapidocr_onnxruntime",
                "video frame OCR",
                ["video"],
                detail="Video frame OCR requires the RapidOCR optional dependency.",
            )
            _rapidocr_state.engine = module.RapidOCR()
        except Exception as exc:
            from ..sources.dependencies import MissingSourceDependencyError

            if (
                isinstance(exc, MissingSourceDependencyError)
                and _rapidocr_state.install_retry_remaining > 0
            ):
                _rapidocr_state.install_retry_remaining -= 1
                _rapidocr_state.attempted = False
                logger.warning("Video OCR dependency install failed; will retry once: %s", exc)
            else:
                _rapidocr_state.error = str(exc)
    return _rapidocr_state.engine, _rapidocr_state.error


def _reset_video_singletons() -> None:
    """Reset process-wide video helpers. Intended for test isolation only."""
    with _rapidocr_lock:
        _rapidocr_state.engine = None
        _rapidocr_state.error = None
        _rapidocr_state.attempted = False
        _rapidocr_state.install_retry_remaining = 1


def _env_float(name: str, default: float, *, minimum: float) -> float:
    try:
        return max(minimum, float(os.environ.get(name, default)))
    except (TypeError, ValueError):
        return default


def _sample_interval_seconds() -> float:
    return _env_float(
        "CLASSIFYRE_VIDEO_SAMPLE_INTERVAL_SECONDS",
        _SAMPLE_INTERVAL_SECONDS,
        minimum=0.1,
    )


def _iter_sampled_frames(video_path: Path) -> Generator[tuple[float, Any], None, None]:
    """Yield frames by timestamp, avoiding full-frame-rate decoding when metadata permits."""
    cv2 = _get_cv2()
    capture = cv2.VideoCapture(str(video_path))  # type: ignore[attr-defined]
    if not capture.isOpened():
        capture.release()
        raise ValueError(f"OpenCV could not open video {video_path.name}")

    try:
        orientation_auto = getattr(cv2, "CAP_PROP_ORIENTATION_AUTO", None)
        if orientation_auto is not None:
            capture.set(orientation_auto, 1)

        fps = float(capture.get(cv2.CAP_PROP_FPS))  # type: ignore[attr-defined]
        frame_count = float(capture.get(cv2.CAP_PROP_FRAME_COUNT))  # type: ignore[attr-defined]
        interval = _sample_interval_seconds()
        duration = frame_count / fps if fps > 0 and frame_count > 0 else 0.0

        if math.isfinite(duration) and duration > 0:
            sample_count = max(1, math.ceil(duration / interval))
            for sample_index in range(sample_count):
                timestamp = sample_index * interval
                capture.set(cv2.CAP_PROP_POS_MSEC, timestamp * 1000.0)  # type: ignore[attr-defined]
                ok, frame = capture.read()
                if not ok:
                    break
                yield timestamp, frame
            return

        # Broken/missing duration metadata is uncommon. Fall back to sequential
        # reading while only retaining frames at the configured interval.
        effective_fps = fps if math.isfinite(fps) and fps > 0 else 30.0
        frame_step = max(1, round(effective_fps * interval))
        frame_index = 0
        while True:
            ok, frame = capture.read()
            if not ok:
                break
            if frame_index % frame_step == 0:
                yield frame_index / effective_fps, frame
            frame_index += 1
    finally:
        capture.release()


def _small_grayscale(frame: Any, cv2: object) -> Any:
    height, width = frame.shape[:2]
    target_width = min(_FRAME_WIDTH, width)
    target_height = max(1, round(height * target_width / max(1, width)))
    resized = cv2.resize(frame, (target_width, target_height))  # type: ignore[attr-defined]
    return cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY)  # type: ignore[attr-defined]


def _difference_score(previous: Any, current: Any, cv2: object) -> float:
    if previous.shape != current.shape:
        return float("inf")
    return float(cv2.absdiff(previous, current).mean())  # type: ignore[attr-defined]


def _difference_hash(gray: Any, cv2: object) -> int:
    sample = cv2.resize(gray, (9, 8))  # type: ignore[attr-defined]
    bits = (sample[:, 1:] > sample[:, :-1]).reshape(-1)
    value = 0
    for bit in bits:
        value = (value << 1) | int(bit)
    return value


def _ocr_text(frame: Any) -> str:
    engine, error = _get_rapidocr_engine()
    if error:
        raise RuntimeError(error)
    if engine is None:
        raise RuntimeError("RapidOCR engine unavailable")

    with _rapidocr_inference_sem:
        output = engine(frame)  # type: ignore[operator]
    result = output[0] if isinstance(output, tuple) else output
    if not result:
        return ""

    lines: list[str] = []
    for entry in result:
        text = ""
        confidence = 1.0
        if isinstance(entry, dict):
            text = str(entry.get("text") or "").strip()
            confidence = float(entry.get("score", entry.get("confidence", 1.0)))
        elif isinstance(entry, (list, tuple)) and len(entry) >= 2:
            text = str(entry[1] or "").strip()
            if len(entry) >= 3:
                confidence = float(entry[2])
        if text and confidence >= _MIN_OCR_CONFIDENCE:
            lines.append(text)
    return "\n".join(lines)


def _normalized_text(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().casefold()


def _format_timestamp(seconds: float) -> str:
    total_seconds = max(0, round(seconds))
    hours, remainder = divmod(total_seconds, 3600)
    minutes, secs = divmod(remainder, 60)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}"


def iter_video_ocr_path(video_path: Path) -> Generator[str, None, None]:
    """Yield timestamped OCR from a video already materialized on disk."""
    try:
        cv2 = _get_cv2()
    except Exception as exc:
        raise VideoOCREngineUnavailableError(f"Video OCR engine unavailable: {exc}") from exc
    engine, engine_error = _get_rapidocr_engine()
    if engine_error:
        raise VideoOCREngineUnavailableError(f"Video OCR engine unavailable: {engine_error}")
    if engine is None:
        raise VideoOCREngineUnavailableError("Video OCR engine unavailable")
    previous_gray: Any = None
    last_candidate_at = -_HEARTBEAT_SECONDS
    recent_hashes: deque[int] = deque(maxlen=_RECENT_HASHES)
    seen_text: set[str] = set()
    decoded_frames = 0

    for timestamp, frame in _iter_sampled_frames(video_path):
        decoded_frames += 1
        gray = _small_grayscale(frame, cv2)
        change_score = (
            float("inf") if previous_gray is None else _difference_score(previous_gray, gray, cv2)
        )
        previous_gray = gray
        frame_changed = change_score >= _CHANGE_THRESHOLD
        heartbeat_due = timestamp - last_candidate_at >= _HEARTBEAT_SECONDS
        if not frame_changed and not heartbeat_due:
            continue

        frame_hash = _difference_hash(gray, cv2)
        last_candidate_at = timestamp
        if not frame_changed and any(
            (frame_hash ^ previous_hash).bit_count() <= _HASH_DISTANCE_THRESHOLD
            for previous_hash in recent_hashes
        ):
            continue
        recent_hashes.append(frame_hash)

        text = _ocr_text(frame).strip()
        normalized = _normalized_text(text)
        if not normalized or normalized in seen_text:
            continue
        seen_text.add(normalized)
        yield f"[On-screen text {_format_timestamp(timestamp)}]\n{text}"

    if decoded_frames == 0:
        raise VideoOCRZeroFramesError("Video OCR decoded zero frames")


def iter_video_ocr_segments(
    file_bytes: bytes,
    *,
    file_name: str = "",
) -> Generator[str, None, None]:
    """Yield timestamped OCR for visually distinct sampled frames."""
    if not file_bytes:
        return

    suffix = Path(file_name).suffix.lower() or ".mp4"
    with tempfile.TemporaryDirectory(prefix="classifyre-video-") as temp_dir:
        video_path = Path(temp_dir) / f"input{suffix}"
        video_path.write_bytes(file_bytes)
        yield from iter_video_ocr_path(video_path)


def extract_video_ocr(
    file_bytes: bytes,
    *,
    file_name: str = "",
) -> tuple[str, str | None]:
    """Return all unique timestamped on-screen text from a video."""
    try:
        segments = list(iter_video_ocr_segments(file_bytes, file_name=file_name))
    except Exception as exc:
        return "", f"Video OCR failed: {exc}"
    text = "\n\n".join(segments)
    if text:
        logger.info("Video OCR extracted %d chars from %s", len(text), file_name or "video")
    return text, None


def extract_video_ocr_path(video_path: Path) -> tuple[str, str | None]:
    """Return on-screen text without copying an existing video into memory."""
    try:
        segments = list(iter_video_ocr_path(video_path))
    except Exception as exc:
        return "", f"Video OCR failed: {exc}"
    text = "\n\n".join(segments)
    if text:
        logger.info("Video OCR extracted %d chars from %s", len(text), video_path.name)
    return text, None
