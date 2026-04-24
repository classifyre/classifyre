import logging
import time
from collections.abc import AsyncGenerator, Iterable
from datetime import UTC, datetime
from typing import Any

import requests

from ...models.generated_input import (
    SamplingStrategy,
    SlackInput,
    SlackMaskedBotToken,
    SlackMaskedToken,
    SlackMaskedUserToken,
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
from ...utils.hashing import hash_id, unhash_id
from ..base import BaseSource

logger = logging.getLogger(__name__)


class SlackSource(BaseSource):
    source_type = "slack"
    API_BASE = "https://slack.com/api"

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

        self.session = requests.Session()
        self.session.headers.update({"Authorization": f"Bearer {self._get_token()}"})
        self.rate_limit_delay = float(self._ingestion_options().rate_limit_delay_seconds or 0)

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

    def _get_token(self) -> str:
        masked = self.config.masked
        if isinstance(masked, SlackMaskedBotToken):
            return masked.bot_token
        if isinstance(masked, SlackMaskedUserToken):
            return masked.user_token
        if isinstance(masked, SlackMaskedToken):
            return masked.token
        raise ValueError("Slack token is required in masked configuration")

    def _normalize_workspace(self, workspace: str) -> str:
        cleaned = workspace.strip()
        for prefix in ("https://", "http://"):
            if cleaned.startswith(prefix):
                cleaned = cleaned[len(prefix) :]
        return cleaned.strip("/").replace(".slack.com", "")

    def _request(
        self,
        method: str,
        endpoint: str,
        *,
        params: dict[str, Any] | None = None,
        data: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        url = f"{self.API_BASE}/{endpoint}"

        while True:
            try:
                response = self.session.request(
                    method,
                    url,
                    params=params,
                    data=data,
                    timeout=30,
                )
            except requests.RequestException as exc:
                raise RuntimeError(f"Slack API request failed: {exc}") from exc

            if response.status_code == 429:
                retry_after = int(response.headers.get("Retry-After", "1"))
                logger.warning(
                    "Slack rate limit hit. Retrying after %s seconds...",
                    retry_after,
                )
                time.sleep(retry_after)
                continue

            try:
                payload = response.json()
            except ValueError as exc:
                raise RuntimeError("Slack API returned invalid JSON") from exc

            if payload.get("ok"):
                if self.rate_limit_delay > 0:
                    time.sleep(self.rate_limit_delay)
                return payload

            if payload.get("error") == "ratelimited":
                retry_after = int(response.headers.get("Retry-After", "1"))
                logger.warning(
                    "Slack rate limit hit. Retrying after %s seconds...",
                    retry_after,
                )
                time.sleep(retry_after)
                continue

            raise RuntimeError(f"{endpoint} error: {payload.get('error')}")

    def test_connection(self) -> dict[str, Any]:
        logger.info("Testing connection to Slack API...")
        result = {
            "timestamp": datetime.now(UTC).isoformat(),
            "source_type": self.recipe.get("type"),
        }

        try:
            payload = self._request("get", "auth.test")
            self.team_id = payload.get("team_id")
            team_name = payload.get("team")
            result["status"] = "SUCCESS"
            result["message"] = (
                f"Successfully connected to Slack workspace {team_name}."
                if team_name
                else "Successfully connected to Slack."
            )
        except Exception as exc:
            result["status"] = "FAILURE"
            result["message"] = str(exc)

        return result

    def _normalize_ts(self, value: str | None) -> str | None:
        if not value:
            return None

        try:
            float(value)
            return value
        except ValueError:
            pass

        try:
            cleaned = value.replace("Z", "+00:00")
            parsed = datetime.fromisoformat(cleaned)
        except ValueError:
            return None

        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=UTC)
        return f"{parsed.timestamp():.6f}"

    def _list_channels(self) -> list[dict[str, Any]]:
        channel_options = self._channels_options()
        channel_types = channel_options.channel_types or ["public_channel"]
        types_param = ",".join(channel_types)
        exclude_archived = channel_options.exclude_archived is not False
        channels: list[dict[str, Any]] = []
        cursor: str | None = None

        while True:
            params: dict[str, Any] = {
                "types": types_param,
                "limit": 200,
                "exclude_archived": str(exclude_archived).lower(),
            }
            if cursor:
                params["cursor"] = cursor

            payload = self._request("get", "conversations.list", params=params)
            channels.extend(payload.get("channels", []))
            cursor = payload.get("response_metadata", {}).get("next_cursor")
            if not cursor:
                break

        return channels

    def discover(self) -> dict[str, Any]:
        logger.info("Discovering Slack channels...")
        channels = self._list_channels()
        results = []
        for channel in channels:
            results.append(
                {
                    "id": channel.get("id"),
                    "name": channel.get("name"),
                    "is_private": channel.get("is_private"),
                    "type": "SLACK_CHANNEL",
                }
            )
        return {"channels": results}

    async def extract(self) -> AsyncGenerator[list[SingleAssetScanResults], None]:
        if self._aborted:
            return

        logger.info("Extracting Slack messages...")

        pipeline = None
        if self.config.detectors and any(d.enabled for d in self.config.detectors):
            from ...pipeline.detector_pipeline import DetectorPipeline

            pipeline = DetectorPipeline.from_recipe(self.recipe, self, self.runner_id)
            logger.info("Detector pipeline initialized")

        channel_ids, channel_lookup = self._resolve_channels()

        if not channel_ids:
            logger.warning("No Slack channels found to extract.")
            return

        for channel_id in channel_ids:
            if self._aborted:
                return

            channel_name = channel_lookup.get(channel_id, channel_id)
            async for batch in self._stream_channel_batches(
                channel_id,
                channel_name,
                pipeline,
            ):
                yield batch

    def _resolve_channels(self) -> tuple[list[str], dict[str, str]]:
        channel_ids = self._channels_options().channel_ids or []
        channel_lookup: dict[str, str] = {}

        if channel_ids:
            return list(channel_ids), channel_lookup

        channels = self._list_channels()
        channel_lookup = {
            channel.get("id"): channel.get("name", "") for channel in channels if channel.get("id")
        }
        return list(channel_lookup.keys()), channel_lookup

    async def _stream_channel_batches(
        self,
        channel_id: str,
        channel_name: str,
        pipeline: Any | None,
    ) -> AsyncGenerator[list[SingleAssetScanResults], None]:
        assets = self._iter_channel_assets(channel_id, channel_name)
        async for batch in self._yield_batches(assets, pipeline):
            yield batch

    def _iter_channel_assets(
        self,
        channel_id: str,
        channel_name: str,
    ) -> Iterable[SingleAssetScanResults]:
        for message in self._iter_channel_messages(channel_id):
            if self._aborted:
                return
            yield self._message_to_asset(message, channel_id, channel_name)

    async def _yield_batches(
        self,
        assets: Iterable[SingleAssetScanResults],
        pipeline: Any | None,
    ) -> AsyncGenerator[list[SingleAssetScanResults], None]:
        batch: list[SingleAssetScanResults] = []

        for asset in assets:
            if self._aborted:
                return
            batch.append(asset)

            if len(batch) >= self.BATCH_SIZE:
                if pipeline:
                    batch = await pipeline.process(batch)
                yield batch
                batch = []

        if batch:
            if pipeline:
                batch = await pipeline.process(batch)
            yield batch

    def _iter_channel_messages(self, channel_id: str) -> Iterable[dict[str, Any]]:
        cursor: str | None = None
        fetched = 0
        ingestion_options = self._ingestion_options()
        time_range_options = self._time_range_options()
        sampling = self.config.sampling
        max_total: int | None = None if sampling.strategy == SamplingStrategy.ALL else 100
        oldest = self._normalize_ts(time_range_options.oldest)
        latest = self._normalize_ts(time_range_options.latest)
        batch_size = min(int(ingestion_options.batch_size or 200), 200)

        while True:
            if self._aborted:
                break

            payload_data: dict[str, Any] = {
                "channel": channel_id,
                "limit": batch_size,
            }

            if cursor:
                payload_data["cursor"] = cursor
            if oldest:
                payload_data["oldest"] = oldest
            if latest:
                payload_data["latest"] = latest

            payload = self._request("post", "conversations.history", data=payload_data)
            messages = payload.get("messages", [])

            if not messages:
                break

            for message in messages:
                yield message
                fetched += 1
                if max_total and fetched >= max_total:
                    return

            cursor = payload.get("response_metadata", {}).get("next_cursor")
            has_more = payload.get("has_more", False)
            if not has_more or not cursor:
                break

    def _message_to_asset(
        self,
        message: dict[str, Any],
        channel_id: str,
        channel_name: str,
    ) -> SingleAssetScanResults:
        ts = str(message.get("ts", ""))
        thread_ts = message.get("thread_ts")
        edited_ts = message.get("edited", {}).get("ts")
        text = message.get("text", "") or ""
        user = message.get("user") or message.get("bot_id") or message.get("username")

        created_at = self._parse_ts(ts)
        updated_at = self._parse_ts(edited_ts) if edited_ts else created_at

        snippet = self._message_snippet(text)
        display_channel = f"#{channel_name}" if channel_name else channel_id
        name = f"{display_channel}: {snippet}" if snippet else f"{display_channel} message {ts}"

        metadata = {
            "channel_id": channel_id,
            "ts": ts,
            "thread_ts": thread_ts,
            "edited_ts": edited_ts,
            "user": user,
            "text": text,
            "subtype": message.get("subtype"),
        }

        raw_id = f"{channel_id}_#_{ts}"
        hashed_id = self.generate_hash_id(raw_id)

        external_url = self.ensure_location(
            self._message_permalink(channel_id, ts),
            fallback=f"slack://channel?channel={channel_id}&message={ts}",
        )

        return SingleAssetScanResults(
            hash=hashed_id,
            checksum=self.calculate_checksum(metadata),
            name=name,
            external_url=external_url,
            links=[],
            asset_type=OutputAssetType.TXT,
            created_at=created_at,
            updated_at=updated_at,
            source_id=self.source_id,
            runner_id=self.runner_id,
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
        workspace = self.workspace or self.team_id or "slack"
        raw_id = f"{workspace}_#_{asset_id}"
        type_value = (
            self.config.type.value if hasattr(self.config.type, "value") else str(self.config.type)
        )
        return hash_id(type_value, raw_id)

    async def fetch_content(self, asset_id: str) -> tuple[str, str] | None:
        try:
            decoded = asset_id
            if "_#_" not in asset_id:
                try:
                    decoded = unhash_id(asset_id)
                except Exception:
                    decoded = asset_id

            # Format: SLACK_#_{workspace}_#_{channel_id}_#_{ts}
            parts = decoded.split("_#_")
            if len(parts) < 4:
                return None
            channel_id = parts[-2]
            ts = parts[-1]

            message = self._fetch_message(channel_id, ts)
            if not message:
                return None

            text = message.get("text", "") or ""
            combined_text = text

            if self._ingestion_options().include_thread_replies:
                thread_ts = message.get("thread_ts") or ts
                replies = self._fetch_thread_replies(channel_id, thread_ts)
                if replies:
                    replies_text = "\n".join(self._format_reply(reply) for reply in replies)
                    combined_text = f"{text}\n{replies_text}".strip()

            return combined_text, combined_text
        except Exception as exc:
            logger.error("Failed to fetch Slack message content: %s", exc)
            return None

    def _fetch_message(self, channel_id: str, ts: str) -> dict[str, Any] | None:
        payload = self._request(
            "post",
            "conversations.history",
            data={
                "channel": channel_id,
                "oldest": ts,
                "latest": ts,
                "inclusive": "true",
                "limit": 1,
            },
        )
        messages = payload.get("messages", [])
        return messages[0] if messages else None

    def _fetch_thread_replies(self, channel_id: str, thread_ts: str) -> list[dict[str, Any]]:
        replies: list[dict[str, Any]] = []
        cursor: str | None = None

        while True:
            payload_data: dict[str, Any] = {
                "channel": channel_id,
                "ts": thread_ts,
                "limit": 200,
            }
            if cursor:
                payload_data["cursor"] = cursor

            payload = self._request("post", "conversations.replies", data=payload_data)
            messages = payload.get("messages", [])
            if messages:
                replies.extend(messages[1:] if cursor is None else messages)

            cursor = payload.get("response_metadata", {}).get("next_cursor")
            if not payload.get("has_more") or not cursor:
                break

        return replies

    def _format_reply(self, reply: dict[str, Any]) -> str:
        user = reply.get("user") or reply.get("bot_id") or "unknown"
        text = reply.get("text", "") or ""
        return f"{user}: {text}".strip()

    def enrich_finding_location(
        self,
        finding: DetectionResult,
        asset: SingleAssetScanResults,
        text_content: str,
    ) -> None:
        finding.location = Location(path=asset.external_url)

    def abort(self) -> None:
        logger.info("Aborting Slack extraction...")
        super().abort()
        if hasattr(self, "session"):
            self.session.close()

    def cleanup(self) -> None:
        if hasattr(self, "session"):
            self.session.close()
