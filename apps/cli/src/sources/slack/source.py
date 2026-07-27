"""Slack ingestion built on the official slack_sdk WebClient.

Authentication is bot-token only: a bot token is the credential a workspace admin
can scope, audit and revoke, and it is the only one Slack's own app-installation
flow hands out. Conversations the bot has not been invited to are invisible to it,
which is the intended boundary.

Each message becomes a TXT asset. Files shared in messages become their own
assets, downloaded on demand and put through ``utils/file_parser`` so PDFs,
Office documents, images (OCR) and media (transcription) all get scanned with the
same pipeline used for local files.
"""

from __future__ import annotations

import logging
import time
from collections.abc import AsyncGenerator, Iterable, Iterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from ...models.generated_input import (
    SamplingStrategy,
    SlackInput,
    SlackOptionalAttachments,
    SlackOptionalChannels,
    SlackOptionalIngestion,
    SlackOptionalTimeRange,
)
from ...models.generated_single_asset_scan_results import (
    AssetType as OutputAssetType,
)
from ...models.generated_single_asset_scan_results import (
    DetectionResult,
    Location,
    SingleAssetScanResults,
)
from ...utils.file_parser import resolve_mime_type
from ...utils.hashing import hash_id, unhash_id
from ..atlassian_common import deterministic_sample, is_tabular_mime_type
from ..base import BaseSource
from ..dependencies import require_module

logger = logging.getLogger(__name__)

# Slack caps conversations.list at 1000 but recommends far smaller pages; 200 is
# the documented sweet spot before Tier 2 rate limiting starts to bite.
_CHANNEL_PAGE_LIMIT = 200

# conversations.replies pages at the same ceiling as conversations.history.
_REPLIES_PAGE_LIMIT = 200

# Fallback asset typing for the rare file Slack reports without a mimetype.
_ASSET_TYPE_BY_EXTENSION: dict[str, OutputAssetType] = {
    ".png": OutputAssetType.IMAGE,
    ".jpg": OutputAssetType.IMAGE,
    ".jpeg": OutputAssetType.IMAGE,
    ".gif": OutputAssetType.IMAGE,
    ".webp": OutputAssetType.IMAGE,
    ".heic": OutputAssetType.IMAGE,
    ".mp4": OutputAssetType.VIDEO,
    ".mov": OutputAssetType.VIDEO,
    ".webm": OutputAssetType.VIDEO,
    ".mp3": OutputAssetType.AUDIO,
    ".wav": OutputAssetType.AUDIO,
    ".m4a": OutputAssetType.AUDIO,
    ".csv": OutputAssetType.TABLE,
    ".tsv": OutputAssetType.TABLE,
    ".xls": OutputAssetType.TABLE,
    ".xlsx": OutputAssetType.TABLE,
    ".json": OutputAssetType.TXT,
    ".txt": OutputAssetType.TXT,
    ".md": OutputAssetType.TXT,
}


class SlackSource(BaseSource):
    source_type = "slack"

    def __init__(
        self,
        recipe: dict[str, Any],
        source_id: str | None = None,
        runner_id: str | None = None,
    ):
        super().__init__(recipe, source_id, runner_id)
        self.config = SlackInput.model_validate(recipe)
        required = self.config.required
        self.workspace = (
            self._normalize_workspace(required.workspace)
            if required and required.workspace
            else None
        )
        self.team_id: str | None = None

        self._client: Any | None = None
        self.rate_limit_delay = float(self._ingestion_options().rate_limit_delay_seconds or 0)

        # Download URL and display name per attachment asset hash, populated while
        # messages are streamed and read back when detectors ask for content.
        self._attachment_download_url_by_hash: dict[str, str] = {}
        self._attachment_mime_by_hash: dict[str, str] = {}
        self._message_text_cache: dict[str, tuple[str, str]] = {}
        # Asset IDs already downloaded and put through extraction. Suppresses the
        # pipeline's fallback re-fetch for assets that yield no text (see
        # ParsedContentProvider.fetch_text_pages).
        self._content_pages_processed: set[str] = set()
        self._joined_channel_ids: set[str] = set()

    # --------------------------------------------------------------- client
    @property
    def client(self) -> Any:
        """The Slack WebClient, created on first use.

        Built lazily so that constructing the source — validating a recipe,
        computing asset hash IDs — does not require the optional slack_sdk
        dependency to be installed. The import cost is paid on the first API
        call instead, where a missing dependency is the right thing to report.
        """
        if self._client is None:
            self._client = self._build_client()
        return self._client

    def _build_client(self) -> Any:
        """Create a WebClient that retries Slack's own rate-limit responses."""
        web = require_module(
            "slack_sdk.web",
            "Slack",
            ["slack"],
            detail="Slack ingestion requires the official slack_sdk package.",
        )
        retry_handlers = require_module(
            "slack_sdk.http_retry.builtin_handlers",
            "Slack",
            ["slack"],
        )

        client = web.WebClient(token=self.config.masked.bot_token)
        # Slack answers 429 with Retry-After during normal operation on any
        # workspace of size; without this handler ingestion aborts on the first
        # burst. The SDK sleeps for the advertised interval and retries.
        client.retry_handlers.append(retry_handlers.RateLimitErrorRetryHandler(max_retry_count=3))
        return client

    # -------------------------------------------------------------- options
    def _channels_options(self) -> SlackOptionalChannels:
        optional = self.config.optional
        if optional and optional.channels:
            return optional.channels
        return SlackOptionalChannels()

    def _time_range_options(self) -> SlackOptionalTimeRange:
        optional = self.config.optional
        if optional and optional.time_range:
            return optional.time_range
        return SlackOptionalTimeRange()

    def _ingestion_options(self) -> SlackOptionalIngestion:
        optional = self.config.optional
        if optional and optional.ingestion:
            return optional.ingestion
        return SlackOptionalIngestion()

    def _attachment_options(self) -> SlackOptionalAttachments:
        optional = self.config.optional
        if optional and optional.attachments:
            return optional.attachments
        return SlackOptionalAttachments()

    def _normalize_workspace(self, workspace: str) -> str:
        cleaned = workspace.strip()
        for prefix in ("https://", "http://"):
            if cleaned.startswith(prefix):
                cleaned = cleaned[len(prefix) :]
        return cleaned.strip("/").replace(".slack.com", "")

    # ------------------------------------------------------------ API calls
    def _call(self, method: str, **params: Any) -> dict[str, Any]:
        """Invoke a WebClient method, pausing afterwards if a delay is configured."""
        api_method = getattr(self.client, method)
        response = api_method(**{k: v for k, v in params.items() if v is not None})
        if self.rate_limit_delay > 0:
            time.sleep(self.rate_limit_delay)
        return dict(response.data)

    def _paginate(self, method: str, items_key: str, **params: Any) -> Iterator[dict[str, Any]]:
        """Yield items across every cursor page of a Slack list endpoint."""
        cursor: str | None = None
        while True:
            if self._aborted:
                return
            payload = self._call(method, cursor=cursor, **params)
            for item in payload.get(items_key) or []:
                if isinstance(item, dict):
                    yield item
            cursor = (payload.get("response_metadata") or {}).get("next_cursor")
            if not cursor:
                return

    def test_connection(self) -> dict[str, Any]:
        logger.info("Testing connection to Slack API...")
        result: dict[str, Any] = {
            "timestamp": datetime.now(UTC).isoformat(),
            "source_type": self.recipe.get("type"),
        }

        try:
            payload = self._call("auth_test")
            self.team_id = payload.get("team_id")
            team_name = payload.get("team")
            bot_id = payload.get("bot_id")
            if not bot_id:
                # auth.test answers for user tokens too; refuse them explicitly so
                # the failure names the cause instead of surfacing later as a
                # missing-scope error on the first conversations.history call.
                result["status"] = "FAILURE"
                result["message"] = (
                    "The supplied token is not a bot token. Install the Slack app "
                    "into the workspace and use its xoxb- bot token."
                )
                return result
            result["status"] = "SUCCESS"
            result["message"] = (
                f"Successfully connected to Slack workspace {team_name}."
                if team_name
                else "Successfully connected to Slack."
            )
        except Exception as exc:
            result["status"] = "FAILURE"
            result["message"] = self._describe_error(exc)

        return result

    def _describe_error(self, exc: Exception) -> str:
        """Turn a SlackApiError into something a user can act on."""
        response = getattr(exc, "response", None)
        error_code = ""
        if response is not None:
            try:
                error_code = str(response.get("error") or "")
            except Exception:
                error_code = ""
        hints = {
            "invalid_auth": "The bot token was rejected. Check that it is current and not revoked.",
            "account_inactive": "The Slack app has been uninstalled or disabled for this workspace.",
            "missing_scope": (
                "The bot token is missing a required OAuth scope. Add the channels/groups/im/mpim "
                "read and history scopes, then reinstall the app."
            ),
            "not_in_channel": (
                "The bot is not a member of this conversation. Invite it, or enable "
                "optional.channels.auto_join_public_channels for public channels."
            ),
        }
        if error_code:
            return f"{error_code}: {hints.get(error_code, str(exc))}"
        return str(exc)

    def _ensure_team_id(self) -> None:
        if self.team_id:
            return
        try:
            payload = self._call("auth_test")
        except Exception:
            logger.debug("Slack auth.test failed while resolving team_id", exc_info=True)
            return
        team_id = payload.get("team_id")
        if isinstance(team_id, str) and team_id.strip():
            self.team_id = team_id.strip()

    # ------------------------------------------------------------- channels
    def _list_channels(self) -> list[dict[str, Any]]:
        channel_options = self._channels_options()
        channel_types = [
            str(channel_type) for channel_type in (channel_options.channel_types or [])
        ] or ["public_channel", "private_channel", "mpim", "im"]

        return list(
            self._paginate(
                "conversations_list",
                "channels",
                types=",".join(channel_types),
                limit=_CHANNEL_PAGE_LIMIT,
                exclude_archived=channel_options.exclude_archived is not False,
            )
        )

    def discover(self) -> dict[str, Any]:
        logger.info("Discovering Slack channels...")
        return {
            "channels": [
                {
                    "id": channel.get("id"),
                    "name": self._channel_display_name(channel),
                    "is_private": channel.get("is_private"),
                    "type": "SLACK_CHANNEL",
                }
                for channel in self._list_channels()
            ]
        }

    def _channel_display_name(self, channel: dict[str, Any]) -> str:
        """Human-readable conversation name, including for DMs which have none."""
        name = channel.get("name")
        if isinstance(name, str) and name:
            return name
        if channel.get("is_im"):
            user = channel.get("user")
            return f"dm-{user}" if user else "dm"
        if channel.get("is_mpim"):
            return "group-dm"
        return str(channel.get("id") or "")

    def _resolve_channels(self) -> list[tuple[str, str]]:
        """Return (channel_id, display_name) pairs to scan, in a stable order."""
        channel_options = self._channels_options()
        explicit_ids = channel_options.channel_ids or []
        if explicit_ids:
            return [(channel_id, channel_id) for channel_id in explicit_ids]

        channels = [channel for channel in self._list_channels() if channel.get("id")]
        # Stable ordering keeps the AUTOMATIC cursor meaningful between runs.
        resolved = sorted(
            ((str(channel["id"]), self._channel_display_name(channel)) for channel in channels),
            key=lambda pair: pair[0],
        )
        return resolved

    def _join_if_needed(self, channel_id: str) -> None:
        """Join a public channel so conversations.history stops returning not_in_channel."""
        if not self._channels_options().auto_join_public_channels:
            return
        if channel_id in self._joined_channel_ids:
            return
        self._joined_channel_ids.add(channel_id)
        try:
            self._call("conversations_join", channel=channel_id)
        except Exception as exc:
            # Private channels, DMs and group DMs cannot be joined this way; that
            # is expected and not worth failing the run over.
            logger.debug("Could not join Slack channel %s: %s", channel_id, exc)

    # ------------------------------------------------------------ extraction
    STREAM_DETECTIONS = True

    async def extract_raw(self) -> AsyncGenerator[list[SingleAssetScanResults], None]:
        if self._aborted:
            return

        logger.info("Extracting Slack messages...")
        self._ensure_team_id()

        channels = self._sample_channels(self._resolve_channels())
        if not channels:
            logger.warning("No Slack channels found to extract.")
            return

        batch: list[SingleAssetScanResults] = []
        for channel_id, channel_name in channels:
            if self._aborted:
                return
            self._join_if_needed(channel_id)

            for asset in self._iter_channel_assets(channel_id, channel_name):
                batch.append(asset)
                if len(batch) >= self.BATCH_SIZE:
                    yield batch
                    batch = []

        if batch:
            yield batch

    def _sample_channels(self, channels: list[tuple[str, str]]) -> list[tuple[str, str]]:
        """Apply the sampling strategy at channel granularity.

        AUTOMATIC keeps its own per-channel message cursor (see
        ``_iter_channel_messages``), so every channel is visited on every run and
        the window advances inside each one. The other strategies bound the work
        by choosing which channels to visit: ALL visits all of them, RANDOM takes a
        deterministic subset, and LATEST relies on conversations.history already
        returning newest-first within each channel.
        """
        strategy = self.config.sampling.strategy
        if strategy in (SamplingStrategy.ALL, SamplingStrategy.AUTOMATIC, SamplingStrategy.LATEST):
            return channels

        if strategy == SamplingStrategy.RANDOM:
            # A stable pseudo-random subset: reproducible between runs, so
            # findings stay comparable rather than churning on every scan.
            limit = max(1, self.sampling_window_size() // 10)
            return deterministic_sample(channels, min(limit, len(channels)))

        return channels

    def _iter_channel_assets(
        self,
        channel_id: str,
        channel_name: str,
    ) -> Iterable[SingleAssetScanResults]:
        for message in self._iter_channel_messages(channel_id):
            if self._aborted:
                return
            yield self._message_to_asset(message, channel_id, channel_name)
            yield from self._attachment_assets(message, channel_id, channel_name)

    def _iter_channel_messages(self, channel_id: str) -> Iterable[dict[str, Any]]:
        """Stream messages for one channel according to the sampling strategy.

        conversations.history returns newest-first, which is what LATEST wants
        directly. ALL walks every page. RANDOM and LATEST both stop after one
        window; RANDOM's randomness is applied across channels (see
        ``_sample_channels``) because Slack offers no way to sample within a
        channel's history. AUTOMATIC resumes from the cursor saved last run and
        wraps once the channel is exhausted, so successive runs cover the whole
        history at a bounded cost each.
        """
        ingestion_options = self._ingestion_options()
        time_range_options = self._time_range_options()
        strategy = self.config.sampling.strategy
        is_automatic = strategy == SamplingStrategy.AUTOMATIC

        max_total: int | None = None
        if strategy != SamplingStrategy.ALL:
            max_total = self.sampling_window_size()

        oldest = self._normalize_ts(time_range_options.oldest)
        latest = self._normalize_ts(time_range_options.latest)
        batch_size = min(int(ingestion_options.batch_size or 200), 200)

        # Slack cursors are page-granular: there is no way to resume from the
        # middle of a page. For AUTOMATIC the request size is therefore clamped to
        # the window so one page is exactly one window — otherwise the run would
        # have to either overshoot to the page boundary or throw away the position
        # of the messages it did not emit.
        if is_automatic and max_total is not None:
            batch_size = max(1, min(batch_size, max_total))

        cursor_key = f"channel:{channel_id}"
        cursor: str | None = None
        if is_automatic:
            saved = self._sampling_cursor.get(cursor_key)
            if isinstance(saved, str) and saved:
                cursor = saved

        fetched = 0
        resume_cursor: str | None = None
        exhausted = False
        try:
            while True:
                if self._aborted:
                    break

                try:
                    payload = self._call(
                        "conversations_history",
                        channel=channel_id,
                        limit=batch_size,
                        cursor=cursor,
                        oldest=oldest,
                        latest=latest,
                    )
                except Exception as exc:
                    logger.warning(
                        "Slack conversations.history failed for %s: %s",
                        channel_id,
                        self._describe_error(exc),
                    )
                    exhausted = True
                    break

                messages = [m for m in (payload.get("messages") or []) if isinstance(m, dict)]
                if not messages:
                    exhausted = True
                    break

                for message in messages:
                    yield message
                    fetched += 1
                    if max_total is not None and fetched >= max_total and not is_automatic:
                        return

                cursor = (payload.get("response_metadata") or {}).get("next_cursor")
                if not payload.get("has_more") or not cursor:
                    exhausted = True
                    break
                if max_total is not None and fetched >= max_total:
                    resume_cursor = cursor
                    break
        finally:
            if is_automatic:
                # Wrap on exhaustion, otherwise remember where to resume.
                self._record_cursor_key(cursor_key, None if exhausted else resume_cursor)

    def _normalize_ts(self, value: str | None) -> str | None:
        if not value:
            return None

        try:
            float(value)
            return value
        except ValueError:
            pass

        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None

        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=UTC)
        return f"{parsed.timestamp():.6f}"

    # -------------------------------------------------------------- messages
    def _message_to_asset(
        self,
        message: dict[str, Any],
        channel_id: str,
        channel_name: str,
    ) -> SingleAssetScanResults:
        ts = str(message.get("ts", ""))
        thread_ts = message.get("thread_ts")
        edited_ts = (message.get("edited") or {}).get("ts")
        text = message.get("text", "") or ""
        user = message.get("user") or message.get("bot_id") or message.get("username")

        created_at = self._parse_ts(ts)
        updated_at = self._parse_ts(edited_ts) if edited_ts else created_at

        snippet = self._message_snippet(text)
        display_channel = f"#{channel_name}" if channel_name else channel_id
        name = f"{display_channel}: {snippet}" if snippet else f"{display_channel} message {ts}"

        checksum_source = {
            "channel_id": channel_id,
            "ts": ts,
            "thread_ts": thread_ts,
            "edited_ts": edited_ts,
            "user": user,
            "text": text,
            "subtype": message.get("subtype"),
            "reply_count": message.get("reply_count"),
        }

        hashed_id = self.generate_hash_id(f"{channel_id}_#_{ts}")

        # Thread replies are resolved lazily in fetch_content so extraction stays
        # one API call per page; cache only the parent text keyed by asset hash.
        self._message_text_cache[hashed_id] = (text, text)

        external_url = self.ensure_location(
            self._message_permalink(channel_id, ts),
            fallback=f"slack://channel?channel={channel_id}&message={ts}",
        )

        asset_metadata: dict[str, Any] = {"channel_id": channel_id, "ts": ts}
        if channel_name:
            asset_metadata["channel_name"] = channel_name
        if isinstance(user, str) and user:
            asset_metadata["author"] = user
        if isinstance(thread_ts, str) and thread_ts:
            asset_metadata["thread_ts"] = thread_ts
        reply_count = message.get("reply_count")
        if isinstance(reply_count, int) and reply_count > 0:
            asset_metadata["reply_count"] = reply_count

        return SingleAssetScanResults(
            hash=hashed_id,
            checksum=self.calculate_checksum(checksum_source),
            name=name,
            external_url=external_url,
            links=[],
            asset_type=OutputAssetType.TXT,
            created_at=created_at,
            updated_at=updated_at,
            source_id=self.source_id,
            runner_id=self.runner_id,
            **self.metadata_fields("message", asset_metadata),
        )

    def _message_snippet(self, text: str, max_length: int = 120) -> str:
        cleaned = " ".join(text.strip().split())
        if not cleaned:
            return ""
        if len(cleaned) <= max_length:
            return cleaned
        return f"{cleaned[:max_length].rstrip()}..."

    def _parse_ts(self, ts: str | None) -> datetime:
        if not ts:
            return datetime.now(UTC)
        try:
            return datetime.fromtimestamp(float(ts), tz=UTC)
        except (TypeError, ValueError):
            return datetime.now(UTC)

    def _message_permalink(self, channel_id: str, ts: str) -> str:
        if self.workspace:
            ts_compact = ts.replace(".", "")
            return f"https://{self.workspace}.slack.com/archives/{channel_id}/p{ts_compact}"
        return f"slack://channel?channel={channel_id}&message={ts}"

    def generate_hash_id(self, asset_id: str) -> str:
        identity = self.workspace or self.team_id or "slack"
        raw_id = f"{identity}_#_{asset_id}"
        type_value = (
            self.config.type.value if hasattr(self.config.type, "value") else str(self.config.type)
        )
        return hash_id(type_value, raw_id)

    # ----------------------------------------------------------- attachments
    def _attachment_assets(
        self,
        message: dict[str, Any],
        channel_id: str,
        channel_name: str,
    ) -> Iterable[SingleAssetScanResults]:
        options = self._attachment_options()
        if options.include_attachments is False:
            return

        for file_obj in message.get("files") or []:
            if not isinstance(file_obj, dict):
                continue
            asset = self._attachment_asset(file_obj, message, channel_id, channel_name, options)
            if asset is not None:
                yield asset

    def _attachment_asset(
        self,
        file_obj: dict[str, Any],
        message: dict[str, Any],
        channel_id: str,
        channel_name: str,
        options: SlackOptionalAttachments,
    ) -> SingleAssetScanResults | None:
        file_id = str(file_obj.get("id") or "")
        file_name = str(file_obj.get("name") or file_obj.get("title") or file_id or "file")

        # Tombstoned or externally hosted files carry no downloadable content.
        if file_obj.get("mode") in ("tombstone", "external", "hidden_by_limit"):
            return None

        download_url = file_obj.get("url_private_download") or file_obj.get("url_private")
        if not isinstance(download_url, str) or not download_url:
            return None

        if not self._extension_allowed(file_name, options):
            logger.debug("Skipping Slack file %s: extension filtered out", file_name)
            return None

        size = file_obj.get("size")
        max_bytes = options.max_attachment_bytes
        if isinstance(size, int) and max_bytes is not None and size > int(max_bytes):
            logger.info(
                "Skipping Slack file %s: %d bytes exceeds max_attachment_bytes (%d)",
                file_name,
                size,
                int(max_bytes),
            )
            return None

        ts = str(message.get("ts", ""))
        # Keyed on the Slack file ID so the same file shared twice resolves to one
        # asset, and so the identity survives the signed URL rotating.
        attachment_hash = self.generate_hash_id(f"file_#_{file_id or download_url}")
        self._attachment_download_url_by_hash[attachment_hash] = download_url
        self._attachment_name_by_hash[attachment_hash] = file_name

        declared_mime = str(file_obj.get("mimetype") or "")
        if declared_mime:
            self._attachment_mime_by_hash[attachment_hash] = declared_mime

        permalink = file_obj.get("permalink")
        external_url = self.ensure_location(
            permalink if isinstance(permalink, str) and permalink else "",
            fallback=self._message_permalink(channel_id, ts),
        )

        created = file_obj.get("created") or file_obj.get("timestamp")
        created_at = (
            datetime.fromtimestamp(float(created), tz=UTC)
            if isinstance(created, int | float)
            else self._parse_ts(ts)
        )

        asset_metadata: dict[str, Any] = {
            "channel_id": channel_id,
            "file_id": file_id,
            "file_name": file_name,
            "message_ts": ts,
        }
        if channel_name:
            asset_metadata["channel_name"] = channel_name
        if declared_mime:
            asset_metadata["mime_type"] = declared_mime
        if isinstance(size, int):
            asset_metadata["size_bytes"] = size
        user = file_obj.get("user") or message.get("user")
        if isinstance(user, str) and user:
            asset_metadata["author"] = user

        return SingleAssetScanResults(
            hash=attachment_hash,
            checksum=self.calculate_checksum(
                {
                    "file_id": file_id,
                    "name": file_name,
                    "size": size,
                    "mimetype": declared_mime,
                }
            ),
            name=file_name,
            external_url=external_url,
            links=[],
            asset_type=self._asset_type_for_file(declared_mime, file_name),
            created_at=created_at,
            updated_at=created_at,
            source_id=self.source_id,
            runner_id=self.runner_id,
            **self.metadata_fields("attachment", asset_metadata),
        )

    def _extension_allowed(self, file_name: str, options: SlackOptionalAttachments) -> bool:
        extension = Path(file_name).suffix.lower()
        include = [self._normalize_extension(e) for e in (options.include_file_extensions or [])]
        exclude = [self._normalize_extension(e) for e in (options.exclude_file_extensions or [])]

        if include and extension not in include:
            return False
        return extension not in exclude

    @staticmethod
    def _normalize_extension(extension: str) -> str:
        cleaned = str(extension).strip().lower()
        if not cleaned:
            return ""
        return cleaned if cleaned.startswith(".") else f".{cleaned}"

    def _asset_type_for_file(self, mime_type: str, file_name: str) -> OutputAssetType:
        normalized = (mime_type or "").lower()
        if normalized.startswith("image/"):
            return OutputAssetType.IMAGE
        if normalized.startswith("video/"):
            return OutputAssetType.VIDEO
        if normalized.startswith("audio/"):
            return OutputAssetType.AUDIO
        if is_tabular_mime_type(normalized):
            return OutputAssetType.TABLE
        if normalized.startswith("text/"):
            return OutputAssetType.TXT

        extension = Path(file_name).suffix.lower()
        return _ASSET_TYPE_BY_EXTENSION.get(extension, OutputAssetType.BINARY)

    # -------------------------------------------------------------- content
    async def fetch_content_bytes(self, asset_id: str) -> tuple[bytes, str] | None:
        download_url = self._attachment_download_url_by_hash.get(asset_id)
        if not download_url:
            return None

        try:
            file_bytes = self._download_file(download_url)
        except Exception as exc:
            logger.warning(
                "Failed to download Slack file %s: %s", download_url, self._describe_error(exc)
            )
            return None
        if not file_bytes:
            return None

        mime_type = resolve_mime_type(
            file_bytes,
            declared_mime_type=self._attachment_mime_by_hash.get(asset_id),
            file_name=self._attachment_file_name(asset_id, download_url),
        )
        return file_bytes, mime_type

    def _download_file(self, download_url: str) -> bytes:
        """Fetch private file bytes.

        Slack's url_private_download is not public: it needs the bot token in an
        Authorization header, and answers with an HTML login page (not an error)
        when the header is missing or the token lacks files:read.
        """
        import requests

        response = requests.get(
            download_url,
            headers={"Authorization": f"Bearer {self.config.masked.bot_token}"},
            timeout=60,
            allow_redirects=True,
        )
        response.raise_for_status()
        content_type = str(response.headers.get("Content-Type") or "").lower()
        if "text/html" in content_type:
            raise RuntimeError(
                "Slack returned an HTML page instead of file bytes — the bot token "
                "is missing the files:read scope or cannot see this file."
            )
        return response.content

    async def fetch_content(self, asset_id: str) -> tuple[str, str] | None:
        if asset_id in self._attachment_download_url_by_hash:
            return await self._fetch_attachment_text(asset_id)

        cached = self._message_text_cache.get(asset_id)
        if cached is None:
            decoded = self._decode_asset_id(asset_id)
            if decoded is None:
                return None
            channel_id, ts = decoded
            message = self._fetch_message(channel_id, ts)
            if not message:
                return None
            text = message.get("text", "") or ""
            cached = (text, text)
        else:
            decoded = self._decode_asset_id(asset_id)

        raw_text, text = cached
        if self._ingestion_options().include_thread_replies and decoded is not None:
            channel_id, ts = decoded
            replies_text = self._thread_replies_text(channel_id, ts)
            if replies_text:
                text = f"{text}\n{replies_text}".strip()
                raw_text = text

        return raw_text, text

    async def _fetch_attachment_text(self, asset_id: str) -> tuple[str, str] | None:
        bytes_result = await self.fetch_content_bytes(asset_id)
        if bytes_result is None:
            return None
        file_bytes, mime_type = bytes_result

        parsed = self.parse_asset_bytes(
            file_bytes,
            declared_mime_type=mime_type,
            file_name=self._attachment_file_name(asset_id, asset_id),
        )
        # Marked processed even with no text: the download and extraction already
        # ran, and the pipeline's fallback would repeat both to the same end.
        self._content_pages_processed.add(asset_id)
        if parsed.text_content:
            return parsed.raw_content, parsed.text_content
        return None

    def _decode_asset_id(self, asset_id: str) -> tuple[str, str] | None:
        """Recover (channel_id, ts) from a message asset hash or raw id."""
        decoded = asset_id
        if "_#_" not in asset_id:
            try:
                decoded = unhash_id(asset_id)
            except Exception:
                return None

        # Format: SLACK_#_{workspace}_#_{channel_id}_#_{ts}
        parts = decoded.split("_#_")
        if len(parts) < 2:
            return None
        channel_id, ts = parts[-2], parts[-1]
        if not channel_id or not ts:
            return None
        return channel_id, ts

    def _fetch_message(self, channel_id: str, ts: str) -> dict[str, Any] | None:
        try:
            payload = self._call(
                "conversations_history",
                channel=channel_id,
                oldest=ts,
                latest=ts,
                inclusive=True,
                limit=1,
            )
        except Exception as exc:
            logger.warning(
                "Failed to fetch Slack message %s/%s: %s",
                channel_id,
                ts,
                self._describe_error(exc),
            )
            return None
        messages = [m for m in (payload.get("messages") or []) if isinstance(m, dict)]
        return messages[0] if messages else None

    def _thread_replies_text(self, channel_id: str, ts: str) -> str:
        """Return the thread's replies as text, excluding the parent message.

        conversations.replies always returns the parent as the first element of
        the first page, so it is dropped rather than counted twice; later pages
        contain replies only.
        """
        replies: list[dict[str, Any]] = []
        cursor: str | None = None
        first_page = True

        while True:
            if self._aborted:
                break
            try:
                payload = self._call(
                    "conversations_replies",
                    channel=channel_id,
                    ts=ts,
                    limit=_REPLIES_PAGE_LIMIT,
                    cursor=cursor,
                )
            except Exception as exc:
                logger.debug(
                    "Slack conversations.replies failed for %s/%s: %s",
                    channel_id,
                    ts,
                    self._describe_error(exc),
                )
                break

            messages = [m for m in (payload.get("messages") or []) if isinstance(m, dict)]
            if first_page:
                messages = messages[1:]
                first_page = False
            replies.extend(messages)

            cursor = (payload.get("response_metadata") or {}).get("next_cursor")
            if not payload.get("has_more") or not cursor:
                break

        return "\n".join(self._format_reply(reply) for reply in replies if reply.get("text"))

    def _format_reply(self, reply: dict[str, Any]) -> str:
        user = reply.get("user") or reply.get("bot_id") or "unknown"
        text = reply.get("text", "") or ""
        return f"{user}: {text}".strip()

    # ------------------------------------------------------------- lifecycle
    def enrich_finding_location(
        self,
        finding: DetectionResult,
        asset: SingleAssetScanResults,
        text_content: str,
    ) -> None:
        _ = text_content
        finding.location = Location(path=asset.external_url)

    def abort(self) -> None:
        logger.info("Aborting Slack extraction...")
        super().abort()

    def cleanup(self) -> None:
        self._attachment_download_url_by_hash.clear()
        self._attachment_mime_by_hash.clear()
        self._message_text_cache.clear()
