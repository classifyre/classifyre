"""YouTube ingestion source.

Pipeline:

    yt-dlp (list channel videos + per-video metadata)
        -> video ids
        -> youtube-transcript-api (fetch captions)
            -> transcript found -> asset + metadata, transcript is detector content
            -> no transcript:
                -> sampling.enable_transcription set -> download audio (yt-dlp) and
                   transcribe with faster-whisper -> transcript is detector content
                -> otherwise -> asset + metadata only (no detector content)

Both libraries scrape public data and need no API key. ``yt-dlp`` and
``youtube-transcript-api`` are optional dependencies (``[youtube]`` group) and
are imported lazily so the base CLI loads without them. The Whisper fallback
additionally requires the ``[transcription]`` group (faster-whisper).
"""

from __future__ import annotations

import logging
import random
import tempfile
from collections.abc import AsyncGenerator
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

from ...models.generated_input import (
    SamplingStrategy,
    YouTubeInput,
    YouTubeOptionalConnection,
    YouTubeOptionalTranscript,
)
from ...models.generated_single_asset_scan_results import (
    AssetType as OutputAssetType,
)
from ...models.generated_single_asset_scan_results import (
    DetectionResult,
    Location,
    SingleAssetScanResults,
)
from ...utils.hashing import hash_id
from ..base import BaseSource

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)

_WATCH_URL = "https://www.youtube.com/watch?v={video_id}"
_INSTALL_HINT = (
    "YouTube source requires yt-dlp and youtube-transcript-api. "
    "Install with: uv sync --group youtube"
)


@dataclass
class _TranscriptResult:
    text: str
    language: str | None
    is_generated: bool | None
    available_languages: list[str] = field(default_factory=list)
    # Where the text came from: "captions" (youtube-transcript-api) or
    # "whisper" (downloaded audio transcribed via faster-whisper).
    source: str = "captions"


class YouTubeSource(BaseSource):
    """Extract YouTube videos (one ``video`` asset per video) with transcripts."""

    source_type = "youtube"

    def __init__(
        self,
        recipe: dict[str, Any],
        source_id: str | None = None,
        runner_id: str | None = None,
    ):
        super().__init__(recipe, source_id=source_id, runner_id=runner_id)
        self.config = YouTubeInput.model_validate(recipe)
        self.runner_id = runner_id or "local-run"

        required = self.config.required
        self.channels: list[str] = list(required.channels or [])
        self.video_urls: list[str] = list(required.video_urls or [])
        if not self.channels and not self.video_urls:
            raise ValueError("YouTube source requires at least one of 'channels' or 'video_urls'.")

        # Transcript text keyed by hash / external_url / video_id so the detector
        # pipeline (which probes both external_url and hash) resolves content.
        self._transcripts: dict[str, str] = {}
        self._cookiefile: str | None = None

    # ------------------------------------------------------------------
    # Option helpers
    # ------------------------------------------------------------------

    def _transcript_options(self) -> YouTubeOptionalTranscript:
        if self.config.optional and self.config.optional.transcript:
            return self.config.optional.transcript
        return YouTubeOptionalTranscript()

    def _connection_options(self) -> YouTubeOptionalConnection:
        if self.config.optional and self.config.optional.connection:
            return self.config.optional.connection
        return YouTubeOptionalConnection()

    def _proxy_url(self) -> str | None:
        return self._connection_options().proxy_url or None

    def _timeout_seconds(self) -> int:
        return int(self._connection_options().request_timeout_seconds or 30)

    def _ignore_errors(self) -> bool:
        return self._connection_options().ignore_errors is not False

    def _sample_limit(self) -> int | None:
        sampling = self.config.sampling
        if sampling.strategy == SamplingStrategy.ALL:
            return None
        return int(sampling.rows_per_page or 100)

    def _cookie_file_path(self) -> str | None:
        """Materialize masked cookie contents to a temp file for yt-dlp/transcripts."""
        if self._cookiefile is not None:
            return self._cookiefile
        cookies = self.config.masked.cookies if self.config.masked else None
        if not cookies:
            return None
        handle = tempfile.NamedTemporaryFile(
            mode="w", suffix=".txt", prefix="yt_cookies_", delete=False
        )
        handle.write(cookies)
        handle.close()
        self._cookiefile = handle.name
        return self._cookiefile

    # ------------------------------------------------------------------
    # yt-dlp helpers (lazy import)
    # ------------------------------------------------------------------

    def _ydl_class(self) -> Any:
        try:
            from yt_dlp import YoutubeDL
        except ImportError as exc:  # pragma: no cover - exercised via test_connection
            raise ImportError(_INSTALL_HINT) from exc
        return YoutubeDL

    def _base_ydl_opts(self) -> dict[str, Any]:
        opts: dict[str, Any] = {
            "skip_download": True,
            "quiet": True,
            "no_warnings": True,
            "ignoreerrors": self._ignore_errors(),
            "socket_timeout": self._timeout_seconds(),
        }
        proxy = self._proxy_url()
        if proxy:
            opts["proxy"] = proxy
        cookiefile = self._cookie_file_path()
        if cookiefile:
            opts["cookiefile"] = cookiefile
        return opts

    @staticmethod
    def _normalize_channel_url(channel: str) -> str:
        """Resolve a handle or channel URL to its uploads ('/videos') tab."""
        value = channel.strip()
        if value.startswith("@"):
            return f"https://www.youtube.com/{value}/videos"
        lowered = value.lower()
        if "youtube.com" in lowered or "youtu.be" in lowered:
            if "/watch" in lowered or "list=" in lowered:
                return value
            if not lowered.rstrip("/").endswith("/videos"):
                return f"{value.rstrip('/')}/videos"
            return value
        # Bare name fallback (treat as a handle).
        return f"https://www.youtube.com/@{value.lstrip('@')}/videos"

    @staticmethod
    def _video_id_from_url(url: str) -> str | None:
        from urllib.parse import parse_qs, urlsplit

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
            # /shorts/<id>, /embed/<id>, /live/<id>
            if len(parts) >= 2 and parts[0] in {"shorts", "embed", "live", "v"}:
                return parts[1]
        # Otherwise assume the raw value is already an id.
        if value and "/" not in value and " " not in value:
            return value
        return None

    def _list_channel_video_ids(self, channel_url: str, limit: int | None) -> list[str]:
        """Cheap flat extraction of a channel's video ids (metadata bypassed)."""
        opts = self._base_ydl_opts()
        opts["extract_flat"] = "in_playlist"
        opts["lazy_playlist"] = True
        # LATEST: the /videos tab is already newest-first, so slice the first N.
        if limit is not None and self.config.sampling.strategy == SamplingStrategy.LATEST:
            opts["playlist_items"] = f"1:{limit}"
        normalized = self._normalize_channel_url(channel_url)
        try:
            with self._ydl_class()(opts) as ydl:
                info = ydl.extract_info(normalized, download=False)
        except Exception as exc:
            logger.warning("Failed to list videos for channel %s: %s", channel_url, exc)
            return []
        if not info:
            return []
        entries = info.get("entries") or []
        ids: list[str] = []
        for entry in entries:
            if not entry:
                continue
            vid = entry.get("id")
            if isinstance(vid, str) and vid and vid not in ids:
                ids.append(vid)
        return ids

    def _resolve_target_video_ids(self) -> list[str]:
        """Build the ordered, deduped set of video ids honoring the sampling strategy."""
        strategy = self.config.sampling.strategy
        limit = self._sample_limit()

        explicit_ids: list[str] = []
        for url in self.video_urls:
            vid = self._video_id_from_url(url)
            if vid and vid not in explicit_ids:
                explicit_ids.append(vid)

        channel_ids: list[str] = []
        for channel in self.channels:
            for vid in self._list_channel_video_ids(channel, limit):
                if vid not in channel_ids:
                    channel_ids.append(vid)

        if strategy == SamplingStrategy.RANDOM and limit is not None and channel_ids:
            sample_size = min(limit, len(channel_ids))
            channel_ids = random.sample(channel_ids, sample_size)
        elif strategy == SamplingStrategy.LATEST and limit is not None:
            channel_ids = channel_ids[:limit]

        # Explicit videos are always included, in addition to sampled channel videos.
        ordered: list[str] = []
        for vid in [*explicit_ids, *channel_ids]:
            if vid not in ordered:
                ordered.append(vid)
        return ordered

    def _extract_video_info(self, video_id: str) -> dict[str, Any] | None:
        opts = self._base_ydl_opts()
        url = _WATCH_URL.format(video_id=video_id)
        try:
            with self._ydl_class()(opts) as ydl:
                info = ydl.extract_info(url, download=False)
        except Exception as exc:
            logger.warning("Failed to extract metadata for video %s: %s", video_id, exc)
            return None
        return info or None

    # ------------------------------------------------------------------
    # Transcript helpers (lazy import)
    # ------------------------------------------------------------------

    def _transcript_api(self) -> Any:
        try:
            from youtube_transcript_api import YouTubeTranscriptApi
            from youtube_transcript_api.proxies import GenericProxyConfig
        except ImportError as exc:  # pragma: no cover - exercised via test_connection
            raise ImportError(_INSTALL_HINT) from exc

        proxy = self._proxy_url()
        proxy_config = GenericProxyConfig(http_url=proxy, https_url=proxy) if proxy else None
        return YouTubeTranscriptApi(proxy_config=proxy_config)

    def _fetch_transcript(self, video_id: str) -> _TranscriptResult | None:
        """Fetch captions for a video. Returns None when unavailable.

        Handles the documented failure cases (captions disabled, no captions,
        age-restricted/private, rate limiting) by logging and returning None so
        the asset is still emitted without detector content. When no captions
        exist, ``_build_video_asset`` falls back to ``_transcribe_audio`` if the
        source has ``sampling.enable_transcription`` set.
        """
        try:
            from youtube_transcript_api import (
                CouldNotRetrieveTranscript,
                YouTubeTranscriptApiException,
            )
        except ImportError as exc:  # pragma: no cover
            raise ImportError(_INSTALL_HINT) from exc

        languages = self._transcript_options().languages or []
        try:
            api = self._transcript_api()
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
                transcript = next(iter(transcript_list))
                fetched = transcript.fetch()
            else:
                fetched = api.fetch(video_id)

            text = "\n".join(snippet.text for snippet in fetched.snippets).strip()
            if not text:
                return None
            return _TranscriptResult(
                text=text,
                language=fetched.language_code,
                is_generated=fetched.is_generated,
                available_languages=available or [fetched.language_code],
            )
        except (CouldNotRetrieveTranscript, YouTubeTranscriptApiException) as exc:
            logger.warning("No transcript for video %s: %s", video_id, exc)
            return None
        except Exception as exc:
            logger.warning("Transcript fetch failed for video %s: %s", video_id, exc)
            return None

    def _download_audio(self, video_id: str, dest_dir: Path) -> Path | None:
        """Download the best audio-only stream for a video into ``dest_dir``.

        Returns the path to the downloaded file, or None on failure. No yt-dlp
        post-processing is used, so the raw audio container (.m4a/.webm/…) is
        written directly — faster-whisper decodes it via bundled PyAV, so no
        system ffmpeg is required.
        """
        opts = self._base_ydl_opts()
        opts["skip_download"] = False
        opts["format"] = "bestaudio/best"
        opts["noplaylist"] = True
        opts["outtmpl"] = str(dest_dir / "%(id)s.%(ext)s")
        url = _WATCH_URL.format(video_id=video_id)
        try:
            with self._ydl_class()(opts) as ydl:
                ydl.extract_info(url, download=True)
        except Exception as exc:
            logger.warning("Failed to download audio for video %s: %s", video_id, exc)
            return None
        files = [p for p in dest_dir.iterdir() if p.is_file()]
        if not files:
            logger.warning("Audio download produced no file for video %s", video_id)
            return None
        # bestaudio yields a single file; pick the largest if a sidecar slipped in.
        return max(files, key=lambda p: p.stat().st_size)

    def _transcribe_audio(self, video_id: str) -> _TranscriptResult | None:
        """Download a video's audio and transcribe it with faster-whisper.

        Used as a fallback when captions are unavailable. Returns None when the
        download or transcription fails so the asset is still emitted.
        """
        from ...utils.transcription import transcribe_media

        with tempfile.TemporaryDirectory(prefix="yt_audio_") as tmp:
            path = self._download_audio(video_id, Path(tmp))
            if path is None:
                return None
            text, error = transcribe_media(
                path.read_bytes(),
                mime_type="",
                file_name=path.name,
            )
        if error:
            logger.warning("Whisper transcription failed for video %s: %s", video_id, error)
            return None
        if not text:
            return None
        logger.info("Transcribed video %s via faster-whisper (%d chars)", video_id, len(text))
        return _TranscriptResult(
            text=text,
            language=None,
            is_generated=True,
            available_languages=[],
            source="whisper",
        )

    # ------------------------------------------------------------------
    # Asset construction
    # ------------------------------------------------------------------

    @staticmethod
    def _coerce_int(value: Any) -> int | None:
        if isinstance(value, bool):
            return None
        if isinstance(value, int):
            return value
        if isinstance(value, float):
            return int(value)
        return None

    def _build_video_asset(self, video_id: str, info: dict[str, Any]) -> SingleAssetScanResults:
        title = str(info.get("title") or "").strip() or f"YouTube video {video_id}"
        external_url = str(info.get("webpage_url") or _WATCH_URL.format(video_id=video_id))
        asset_hash = self.generate_hash_id(video_id)

        upload_date = info.get("upload_date")
        timestamp = info.get("timestamp")
        if isinstance(timestamp, (int, float)):
            created_at = datetime.fromtimestamp(float(timestamp), tz=UTC)
        elif isinstance(upload_date, str) and len(upload_date) == 8 and upload_date.isdigit():
            created_at = datetime.strptime(upload_date, "%Y%m%d").replace(tzinfo=UTC)
        else:
            created_at = datetime.now(UTC)

        transcript: _TranscriptResult | None = None
        if not self._transcript_options().skip_transcript:
            transcript = self._fetch_transcript(video_id)
            # No captions: fall back to downloading the audio and transcribing it
            # with faster-whisper when the source has transcription enabled.
            if transcript is None and self.transcription_enabled():
                transcript = self._transcribe_audio(video_id)
        if transcript is not None:
            self._transcripts[asset_hash] = transcript.text
            self._transcripts[external_url] = transcript.text
            self._transcripts[video_id] = transcript.text

        asset_metadata: dict[str, Any] = {
            "video_id": video_id,
            "title": title,
        }
        channel_id = info.get("channel_id") or info.get("uploader_id")
        if isinstance(channel_id, str) and channel_id:
            asset_metadata["channel_id"] = channel_id
        channel_name = info.get("channel") or info.get("uploader")
        if isinstance(channel_name, str) and channel_name:
            asset_metadata["channel_name"] = channel_name
        duration = self._coerce_int(info.get("duration"))
        if duration is not None:
            asset_metadata["duration_seconds"] = duration
        view_count = self._coerce_int(info.get("view_count"))
        if view_count is not None:
            asset_metadata["view_count"] = view_count
        like_count = self._coerce_int(info.get("like_count"))
        if like_count is not None:
            asset_metadata["like_count"] = like_count
        if isinstance(upload_date, str) and upload_date:
            asset_metadata["upload_date"] = upload_date

        asset_metadata["transcript_available"] = transcript is not None
        if transcript is not None:
            asset_metadata["transcript_source"] = transcript.source
            if transcript.language:
                asset_metadata["transcript_language"] = transcript.language
            if transcript.is_generated is not None:
                asset_metadata["transcript_is_generated"] = transcript.is_generated
            if transcript.available_languages:
                asset_metadata["caption_tracks"] = transcript.available_languages

        checksum_data = {
            "video_id": video_id,
            "title": title,
            "view_count": asset_metadata.get("view_count"),
            "like_count": asset_metadata.get("like_count"),
            "transcript_available": asset_metadata["transcript_available"],
        }

        return SingleAssetScanResults(
            hash=asset_hash,
            checksum=self.calculate_checksum(checksum_data),
            name=title,
            external_url=external_url,
            links=[],
            asset_type=OutputAssetType.TXT,
            source_id=self.source_id,
            created_at=created_at,
            updated_at=created_at,
            runner_id=self.runner_id,
            **self.metadata_fields("video", asset_metadata),
        )

    # ------------------------------------------------------------------
    # BaseSource interface
    # ------------------------------------------------------------------

    def test_connection(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "timestamp": datetime.now(UTC).isoformat(),
            "source_type": self.recipe.get("type"),
        }
        try:
            ydl_cls = self._ydl_class()
            self._transcript_api()  # surfaces missing youtube-transcript-api
        except ImportError as exc:
            result["status"] = "FAILURE"
            result["message"] = str(exc)
            return result

        probe = self._normalize_channel_url(self.channels[0]) if self.channels else None
        if probe is None and self.video_urls:
            vid = self._video_id_from_url(self.video_urls[0])
            probe = _WATCH_URL.format(video_id=vid) if vid else None

        try:
            opts = self._base_ydl_opts()
            opts["extract_flat"] = "in_playlist"
            opts["playlist_items"] = "1:1"
            with ydl_cls(opts) as ydl:
                info = ydl.extract_info(probe, download=False) if probe else None
            if info is None and probe is not None:
                result["status"] = "FAILURE"
                result["message"] = f"yt-dlp could not resolve {probe}."
            else:
                result["status"] = "SUCCESS"
                result["message"] = "Successfully reached YouTube via yt-dlp."
        except Exception as exc:
            result["status"] = "FAILURE"
            result["message"] = f"Failed to connect to YouTube: {exc}"
        return result

    async def extract_raw(self) -> AsyncGenerator[list[SingleAssetScanResults], None]:
        if self._aborted:
            return

        self._transcripts = {}
        video_ids = self._resolve_target_video_ids()
        logger.info("Resolved %d YouTube video(s) to extract", len(video_ids))

        batch: list[SingleAssetScanResults] = []
        for video_id in video_ids:
            if self._aborted:
                break
            info = self._extract_video_info(video_id)
            if info is None:
                continue
            try:
                asset = self._build_video_asset(video_id, info)
            except Exception as exc:
                logger.error("Failed to build asset for video %s: %s", video_id, exc)
                continue
            batch.append(asset)
            if len(batch) >= self.BATCH_SIZE:
                yield batch
                batch = []

        if batch:
            yield batch

    def generate_hash_id(self, asset_id: str) -> str:
        type_value = (
            self.config.type.value if hasattr(self.config.type, "value") else str(self.config.type)
        )
        return hash_id(type_value, asset_id)

    async def fetch_content(self, asset_id: str) -> tuple[str, str] | None:
        """Return the cached transcript text for detector scanning.

        Returns ``None`` when no transcript was found, so videos without captions
        produce an asset + metadata but skip Phase 2 (detectors).
        """
        text = self._transcripts.get(asset_id)
        if not text:
            return None
        return text, text

    def evict_asset_cache(self, asset_hash: str) -> None:
        self._transcripts.pop(asset_hash, None)

    def enrich_finding_location(
        self,
        finding: DetectionResult,
        asset: SingleAssetScanResults,
        text_content: str,
    ) -> None:
        finding.location = Location(path=asset.external_url)

    def abort(self) -> None:
        logger.info("Aborting YouTube extraction...")
        super().abort()

    def cleanup(self) -> None:
        if self._cookiefile:
            try:
                Path(self._cookiefile).unlink(missing_ok=True)
            except OSError:
                pass
            self._cookiefile = None
        self._transcripts.clear()
