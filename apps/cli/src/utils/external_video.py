"""Shared analysis of externally hosted videos (YouTube, Vimeo, v.redd.it, …).

Any connector that runs into a video link needs the same four steps: resolve
metadata with yt-dlp, prefer the platform's own caption track, fall back to
transcribing the audio with faster-whisper when there is none, and always OCR the
frames that change. The YouTube source needs it for every asset it emits; a
Reddit submission needs it whenever it links a video rather than hosting one.
Keeping the steps here means a fix to one connector's video handling is a fix to
every connector's.

``yt-dlp`` and ``youtube-transcript-api`` are optional dependencies (the
``youtube`` and ``reddit`` uv groups) and are imported lazily, so the base CLI
loads without them.
"""

from __future__ import annotations

import logging
import tempfile
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit

from ..sources.dependencies import require_module

logger = logging.getLogger(__name__)

WATCH_URL = "https://www.youtube.com/watch?v={video_id}"

# Hosts yt-dlp handles well and that carry spoken/on-screen content worth
# scanning. Deliberately a short allow-list rather than "anything yt-dlp
# supports": a scan should not start downloading arbitrary links a post happens
# to contain.
_VIDEO_HOST_HINTS: tuple[str, ...] = (
    "youtube.com",
    "youtu.be",
    "vimeo.com",
    "dailymotion.com",
    "streamable.com",
    "twitch.tv",
    "v.redd.it",
)


@dataclass
class TranscriptResult:
    """Transcript text plus where it came from."""

    text: str
    language: str | None
    is_generated: bool | None
    available_languages: list[str] = field(default_factory=list)
    # Where the text came from: "captions" (the platform's own caption track) or
    # "whisper" (downloaded audio transcribed with faster-whisper).
    source: str = "captions"


def is_external_video_url(url: str) -> bool:
    """Whether this URL points at a video host worth handing to yt-dlp."""
    if not url:
        return False
    host = urlsplit(url.strip()).netloc.lower()
    if not host:
        return False
    host = host.removeprefix("www.")
    return any(
        host == hint or host.endswith(f".{hint}") or host == hint for hint in _VIDEO_HOST_HINTS
    )


def video_provider(url: str) -> str:
    """Bare host of a video URL, e.g. ``youtube.com``."""
    return urlsplit(url.strip()).netloc.lower().removeprefix("www.")


def is_youtube_url(url: str) -> bool:
    host = video_provider(url)
    return host in {"youtu.be", "youtube.com"} or host.endswith(".youtube.com")


def youtube_video_id(url: str) -> str | None:
    """Extract the 11-character watch id from any YouTube URL form."""
    value = url.strip()
    parsed = urlsplit(value)
    host = parsed.netloc.lower()
    if "youtu.be" in host:
        vid = parsed.path.lstrip("/").split("/")[0]
        return vid or None
    if "youtube.com" in host:
        if parsed.path == "/watch":
            ids = parse_qs(parsed.query).get("v")
            return ids[0] if ids else None
        parts = [p for p in parsed.path.split("/") if p]
        # /shorts/<id>, /embed/<id>, /live/<id>, /v/<id>
        if len(parts) >= 2 and parts[0] in {"shorts", "embed", "live", "v"}:
            return parts[1]
    # Otherwise assume the raw value is already an id.
    if value and "/" not in value and " " not in value:
        return value
    return None


# ---------------------------------------------------------------- yt-dlp


def ydl_class(caller: str, uv_groups: Sequence[str]) -> Any:
    """The lazily-imported ``yt_dlp.YoutubeDL`` class."""
    module = require_module("yt_dlp", caller, list(uv_groups))
    return module.YoutubeDL


def base_ydl_opts(
    *,
    timeout_seconds: int = 30,
    ignore_errors: bool = True,
    proxy_url: str | None = None,
    cookiefile: str | None = None,
) -> dict[str, Any]:
    """Metadata-only yt-dlp options shared by every caller."""
    opts: dict[str, Any] = {
        "skip_download": True,
        "quiet": True,
        "no_warnings": True,
        "ignoreerrors": ignore_errors,
        "socket_timeout": timeout_seconds,
    }
    if proxy_url:
        opts["proxy"] = proxy_url
    if cookiefile:
        opts["cookiefile"] = cookiefile
    return opts


def extract_video_info(
    url: str,
    opts: dict[str, Any],
    *,
    caller: str,
    uv_groups: Sequence[str],
) -> dict[str, Any] | None:
    """Resolve a video's metadata without downloading it."""
    try:
        with ydl_class(caller, uv_groups)(opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as exc:
        logger.warning("Failed to extract video metadata for %s: %s", url, exc)
        return None
    return info or None


def download_video(
    url: str,
    dest_dir: Path,
    opts: dict[str, Any],
    *,
    caller: str,
    uv_groups: Sequence[str],
) -> Path | None:
    """Download one muxed stream, preferring at most 480p to bound CPU/network."""
    download_opts = dict(opts)
    download_opts["skip_download"] = False
    # Requiring both codecs avoids yt-dlp's ffmpeg merge path. Visual OCR only
    # needs readable text, while the audio track remains suitable for Whisper.
    download_opts["format"] = (
        "best[height<=480][acodec!=none][vcodec!=none]/best[acodec!=none][vcodec!=none]"
    )
    download_opts["noplaylist"] = True
    download_opts["outtmpl"] = str(dest_dir / "%(id)s.%(ext)s")
    try:
        with ydl_class(caller, uv_groups)(download_opts) as ydl:
            ydl.extract_info(url, download=True)
    except Exception as exc:
        logger.warning("Failed to download video %s: %s", url, exc)
        return None
    files = [p for p in dest_dir.iterdir() if p.is_file()]
    if not files:
        logger.warning("Video download produced no file for %s", url)
        return None
    # The selected format yields one file; pick the largest if a sidecar slipped in.
    return max(files, key=lambda p: p.stat().st_size)


def analyze_video_file(path: Path, *, transcribe: bool) -> tuple[TranscriptResult | None, str]:
    """Transcribe (when asked) and always OCR the changed frames of a local video."""
    from .transcription import transcribe_media_path
    from .video_processing import extract_video_ocr_path

    visual_text, visual_error = extract_video_ocr_path(path)
    if visual_error:
        logger.warning("Visual OCR failed for %s: %s", path.name, visual_error)

    transcript: TranscriptResult | None = None
    if transcribe:
        text, error = transcribe_media_path(path, mime_type="video/mp4")
        if error:
            logger.warning("Whisper transcription failed for %s: %s", path.name, error)
        elif text:
            logger.info("Transcribed %s via faster-whisper (%d chars)", path.name, len(text))
            transcript = TranscriptResult(
                text=text,
                language=None,
                is_generated=True,
                available_languages=[],
                source="whisper",
            )
    return transcript, visual_text


def download_and_analyze_video(
    url: str,
    opts: dict[str, Any],
    *,
    caller: str,
    uv_groups: Sequence[str],
    transcribe: bool,
) -> tuple[TranscriptResult | None, str]:
    """Download once, then transcribe when needed and always OCR changed frames."""
    with tempfile.TemporaryDirectory(prefix="classifyre-video-") as tmp:
        path = download_video(url, Path(tmp), opts, caller=caller, uv_groups=uv_groups)
        if path is None:
            return None, ""
        return analyze_video_file(path, transcribe=transcribe)


# ------------------------------------------------------------- captions


def youtube_transcript_api(
    *,
    caller: str,
    uv_groups: Sequence[str],
    proxy_url: str | None = None,
) -> Any:
    """A ``YouTubeTranscriptApi`` instance, optionally routed through a proxy."""
    module = require_module("youtube_transcript_api", caller, list(uv_groups))
    proxy_config = None
    if proxy_url:
        proxies_module = require_module("youtube_transcript_api.proxies", caller, list(uv_groups))
        proxy_config = proxies_module.GenericProxyConfig(http_url=proxy_url, https_url=proxy_url)
    return module.YouTubeTranscriptApi(proxy_config=proxy_config)


def fetch_youtube_transcript(
    video_id: str,
    *,
    caller: str,
    uv_groups: Sequence[str],
    languages: Sequence[str] | None = None,
    proxy_url: str | None = None,
) -> TranscriptResult | None:
    """Fetch captions for a YouTube video. Returns None when unavailable.

    Handles the documented failure cases (captions disabled, no captions,
    age-restricted/private, rate limiting) by logging and returning None, so the
    caller can still emit the asset and fall back to transcribing the audio.
    """
    yt_module = require_module("youtube_transcript_api", caller, list(uv_groups))

    try:
        api = youtube_transcript_api(caller=caller, uv_groups=uv_groups, proxy_url=proxy_url)
        available: list[str] = []
        transcript_list = None
        try:
            transcript_list = api.list(video_id)
            available = [t.language_code for t in transcript_list]
        except Exception:
            transcript_list = None

        if languages:
            fetched = api.fetch(video_id, languages=list(languages))
        elif transcript_list is not None:
            # Accept any available language: take the first track.
            fetched = next(iter(transcript_list)).fetch()
        else:
            fetched = api.fetch(video_id)

        text = "\n".join(snippet.text for snippet in fetched.snippets).strip()
        if not text:
            return None
        return TranscriptResult(
            text=text,
            language=fetched.language_code,
            is_generated=fetched.is_generated,
            available_languages=available or [fetched.language_code],
        )
    except (
        yt_module.CouldNotRetrieveTranscript,
        yt_module.YouTubeTranscriptApiException,
    ) as exc:
        logger.warning("No transcript for video %s: %s", video_id, exc)
        return None
    except Exception as exc:
        logger.warning("Transcript fetch failed for video %s: %s", video_id, exc)
        return None


def analyze_external_video(
    url: str,
    *,
    caller: str,
    uv_groups: Sequence[str],
    opts: dict[str, Any] | None = None,
    languages: Sequence[str] | None = None,
    proxy_url: str | None = None,
) -> tuple[dict[str, Any] | None, TranscriptResult | None, str]:
    """Resolve one linked video end-to-end.

    Returns ``(info, transcript, visual_text)``. Captions are preferred because
    they cost one HTTP request; the download+Whisper path only runs when there
    are none, and frame OCR runs whenever the file was downloaded.
    """
    ydl_opts = opts if opts is not None else base_ydl_opts()
    info = extract_video_info(url, ydl_opts, caller=caller, uv_groups=uv_groups)

    transcript: TranscriptResult | None = None
    if is_youtube_url(url):
        video_id = youtube_video_id(url)
        if video_id:
            transcript = fetch_youtube_transcript(
                video_id,
                caller=caller,
                uv_groups=uv_groups,
                languages=languages,
                proxy_url=proxy_url,
            )

    media_transcript, visual_text = download_and_analyze_video(
        url,
        ydl_opts,
        caller=caller,
        uv_groups=uv_groups,
        transcribe=transcript is None,
    )
    return info, transcript or media_transcript, visual_text
