"""Pictures and sound prepared for embedding as what they are.

Text read out of an asset (OCR, transcription) is embedded as text. A model
that also embeds pictures or sound can find an asset by what it shows or how it
sounds, which is the only way to find a photograph with no writing in it. This
module prepares that media the way the API asks for it: one small JPEG per
picture, mono 16 kHz WAV clips per recording. The API stores the prepared copy,
because a later rebuild re-embeds from it and the scan will not send it again.

What to prepare is the API's decision (``GET /embeddings/collection``), since
it follows the workspace's embedding model. With nothing asked for, nothing
here runs.
"""

from __future__ import annotations

import io
import logging
import wave
from dataclasses import dataclass, field
from typing import Any

from ..detectors.dependencies import MissingDependencyError, require_module

logger = logging.getLogger(__name__)

# uv groups that carry Pillow, and PyAV (which arrives with faster-whisper). A
# picture or a recording has normally been through OCR or transcription by the
# time it gets here, so these are already installed; a scan that somehow is
# not installs the first one on demand.
_IMAGE_UV_GROUPS = ["file-processing", "content", "llm", "custom"]
_AUDIO_UV_GROUPS = ["transcription"]

# Scan-cache key under which an asset's state records that its media was
# collected. Lives beside the detector fingerprints because it answers the same
# question for the same reason: was this work done for this asset under the
# rules in force now. The API names the key with the plan (it is the one that
# takes the record back when the media is deleted); this is the same name, for
# an API that does not send one.
MEDIA_CACHE_KEY_PREFIX = "EMBED_MEDIA::"

# Shortest clip worth sending: of a whole recording, and of what is left over
# after the full clips of a longer one.
_MIN_CLIP_SECONDS = 1
_MIN_TAIL_SECONDS = 5

# Asset types whose own bytes are a picture or a recording.
_MODALITY_BY_ASSET_TYPE = {"IMAGE": "image", "AUDIO": "audio"}


@dataclass(frozen=True)
class MediaSpec:
    """How one kind of media is prepared."""

    modality: str
    mime_type: str
    max_items: int = 1
    max_edge: int = 768
    quality: int = 85
    sample_rate: int = 16_000
    clip_seconds: int = 10
    cache_key: str = ""
    # Changes when the way this kind of media is prepared changes.
    fingerprint: str = ""

    @classmethod
    def from_payload(cls, raw: Any) -> MediaSpec | None:
        if not isinstance(raw, dict):
            return None
        modality = str(raw.get("modality") or "").strip().lower()
        if modality not in {"image", "audio"}:
            return None

        def number(key: str, default: int, minimum: int) -> int:
            value = raw.get(key)
            return max(minimum, int(value)) if isinstance(value, int | float) else default

        return cls(
            modality=modality,
            mime_type=str(
                raw.get("mimeType") or ("image/jpeg" if modality == "image" else "audio/wav")
            ),
            max_items=number("maxItems", 1, 1),
            max_edge=number("maxEdge", 768, 32),
            quality=min(100, number("quality", 85, 1)),
            sample_rate=number("sampleRate", 16_000, 8_000),
            clip_seconds=number("clipSeconds", 10, 1),
            cache_key=str(raw.get("cacheKey") or f"{MEDIA_CACHE_KEY_PREFIX}{modality}"),
            fingerprint=str(raw.get("fingerprint") or ""),
        )


@dataclass(frozen=True)
class EmbeddingPlan:
    """What this workspace wants sent for embedding."""

    media: dict[str, MediaSpec] = field(default_factory=dict)

    @classmethod
    def from_payload(cls, raw: Any) -> EmbeddingPlan:
        if not isinstance(raw, dict):
            return cls()
        specs: dict[str, MediaSpec] = {}
        entries = raw.get("media")
        for entry in entries if isinstance(entries, list) else []:
            spec = MediaSpec.from_payload(entry)
            if spec is not None:
                specs[spec.modality] = spec
        return cls(media=specs)

    @property
    def collects_media(self) -> bool:
        return bool(self.media)

    def spec_for(self, asset_type: Any) -> MediaSpec | None:
        """The spec for an asset whose own bytes are media, if it is collected."""
        name = str(getattr(asset_type, "value", asset_type) or "").upper()
        modality = _MODALITY_BY_ASSET_TYPE.get(name)
        return self.media.get(modality) if modality else None

    def cache_entry_for(self, asset_type: Any) -> tuple[str, str] | None:
        """Scan-cache (key, fingerprint) proving this asset's media was sent.

        Per kind of media, so that starting to embed sound does not make every
        picture read as not yet sent.
        """
        spec = self.spec_for(asset_type)
        if spec is None:
            return None
        key = spec.cache_key or f"{MEDIA_CACHE_KEY_PREFIX}{spec.modality}"
        return key, spec.fingerprint or "1"


def prepare_image(raw: bytes, spec: MediaSpec) -> bytes | None:
    """Re-encode a picture as an RGB JPEG no larger than ``spec.max_edge``.

    Vision encoders work at a few hundred pixels a side, so a larger copy is
    only storage. Returns None when the bytes are not a picture Pillow can
    read, or Pillow is not available; the asset is then embedded by its text
    alone, as it would have been anyway.
    """
    if not raw:
        return None
    try:
        pil = require_module("PIL.Image", "media embedding", _IMAGE_UV_GROUPS)
        ops = require_module("PIL.ImageOps", "media embedding", _IMAGE_UV_GROUPS)
    except MissingDependencyError as exc:
        logger.warning("Cannot prepare a picture for embedding: %s", exc)
        return None
    try:
        # HEIC (every recent phone photograph) is read through a plug-in that
        # has to be registered; without it Pillow does not know the format.
        try:
            import pillow_heif  # type: ignore[import-not-found]

            pillow_heif.register_heif_opener()
        except Exception:
            pass
        with pil.open(io.BytesIO(raw)) as image:
            # A phone photograph is stored sideways with a tag saying which way
            # is up; the encoder only sees pixels.
            upright = ops.exif_transpose(image) or image
            # Flatten transparency onto white: JPEG has no alpha, and dropping
            # the channel turns a transparent background black.
            if upright.mode in {"RGBA", "LA"} or "transparency" in upright.info:
                rgba = upright.convert("RGBA")
                canvas = pil.new("RGB", rgba.size, (255, 255, 255))
                canvas.paste(rgba, mask=rgba.getchannel("A"))
                rgb = canvas
            else:
                rgb = upright.convert("RGB")
            rgb.thumbnail((spec.max_edge, spec.max_edge), pil.Resampling.LANCZOS)
            buffer = io.BytesIO()
            rgb.save(buffer, format="JPEG", quality=spec.quality, optimize=True)
            return buffer.getvalue()
    except Exception as exc:
        logger.warning("Could not prepare a picture for embedding: %s", exc)
        return None


def _pcm_to_wav(pcm: bytes, sample_rate: int) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(sample_rate)
        out.writeframes(pcm)
    return buffer.getvalue()


def prepare_audio_clips(raw: bytes, spec: MediaSpec) -> list[bytes]:
    """Decode a recording to mono 16-bit WAV clips at ``spec.sample_rate``.

    At most ``spec.max_items`` clips of ``spec.clip_seconds`` each, from the
    start: the opening minutes say what a recording is, and every clip is a
    megabyte kept. Decoding stops once enough has been read, so a long file is
    not decoded to its end. Returns [] when the bytes hold no audio PyAV can
    read, or PyAV is not available.
    """
    if not raw:
        return []
    try:
        pyav = require_module("av", "media embedding", _AUDIO_UV_GROUPS)
    except MissingDependencyError as exc:
        logger.warning("Cannot prepare a recording for embedding: %s", exc)
        return []

    clip_bytes = spec.sample_rate * spec.clip_seconds * 2
    wanted = clip_bytes * spec.max_items
    pcm = bytearray()
    container = None
    try:
        container = pyav.open(io.BytesIO(raw), metadata_errors="ignore")
        streams = [stream for stream in container.streams if stream.type == "audio"]
        if not streams:
            return []
        resampler = pyav.audio.resampler.AudioResampler(
            format="s16", layout="mono", rate=spec.sample_rate
        )

        def drain(frames: Any) -> None:
            for frame in frames if isinstance(frames, list) else [frames]:
                if frame is not None:
                    pcm.extend(bytes(frame.planes[0])[: frame.samples * 2])

        for frame in container.decode(streams[0]):
            drain(resampler.resample(frame))
            if len(pcm) >= wanted:
                break
        else:
            # Only a file read to its end has a resampler tail worth flushing.
            try:
                drain(resampler.resample(None))
            except Exception:
                pass
    except Exception as exc:
        logger.warning("Could not prepare a recording for embedding: %s", exc)
        return []
    finally:
        if container is not None:
            container.close()

    clips: list[bytes] = []
    for start in range(0, min(len(pcm), wanted), clip_bytes):
        chunk = bytes(pcm[start : start + clip_bytes])
        # A short recording is sent whole: a second of sound can be all there
        # is. The tail of a long one is different, since the clips before it
        # already say what the recording is and a few seconds more add a vector
        # of their own for almost nothing.
        leftover = bool(clips) and len(chunk) < clip_bytes
        shortest = _MIN_TAIL_SECONDS if leftover else _MIN_CLIP_SECONDS
        if len(chunk) >= spec.sample_rate * 2 * shortest:
            clips.append(_pcm_to_wav(chunk, spec.sample_rate))
    return clips


def prepare_media(raw: bytes, spec: MediaSpec) -> list[tuple[str, bytes]]:
    """Prepared (mime type, bytes) items for one asset under ``spec``."""
    if spec.modality == "image":
        image = prepare_image(raw, spec)
        return [(spec.mime_type, image)] if image else []
    return [(spec.mime_type, clip) for clip in prepare_audio_clips(raw, spec)]
