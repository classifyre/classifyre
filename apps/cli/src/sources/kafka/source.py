"""Apache Kafka source — discovers topics and samples messages.

Uses a lightweight ``kafka-python`` consumer/admin client (no Spark). Each topic
becomes one ``topic`` asset with partition/offset/retention metadata; message
samples are streamed as content for detectors.
"""

from __future__ import annotations

import logging
import ssl as ssl_module
import tempfile
from collections.abc import AsyncGenerator
from datetime import UTC, datetime
from typing import Any

from ...models.generated_input import KafkaInput, SamplingConfig, SamplingStrategy
from ...models.generated_single_asset_scan_results import (
    AssetType as OutputAssetType,
)
from ...models.generated_single_asset_scan_results import (
    SingleAssetScanResults,
)
from ...utils.hashing import hash_id
from ..base import BaseSource
from ..dependencies import require_module

logger = logging.getLogger(__name__)


class KafkaSource(BaseSource):
    source_type = "kafka"
    STREAM_DETECTIONS = True

    def __init__(
        self,
        recipe: dict[str, Any],
        source_id: str | None = None,
        runner_id: str | None = None,
    ) -> None:
        super().__init__(recipe, source_id, runner_id)
        self.config = KafkaInput.model_validate(recipe)
        self.runner_id = runner_id or "local-run"
        self._kafka = require_module(
            module_name="kafka",
            source_name="Apache Kafka",
            uv_groups=["kafka"],
            detail="kafka-python is required for the Kafka connector.",
        )
        self._topic_lookup: dict[str, str] = {}

    # ── Config / client construction ─────────────────────────────────────

    def _sampling(self) -> SamplingConfig:
        return self.config.sampling

    def _connection(self) -> Any:
        optional = self.config.optional
        return optional.connection if optional is not None else None

    def _scope(self) -> Any:
        optional = self.config.optional
        return optional.scope if optional is not None else None

    def _bootstrap_servers(self) -> list[str]:
        return [s.strip() for s in self.config.required.bootstrap_servers.split(",") if s.strip()]

    def _client_kwargs(self) -> dict[str, Any]:
        kwargs: dict[str, Any] = {"bootstrap_servers": self._bootstrap_servers()}
        connection = self._connection()
        ssl_ca = getattr(connection, "ssl_ca", None) if connection is not None else None
        if connection is not None:
            protocol = getattr(connection, "security_protocol", None)
            if protocol is not None:
                kwargs["security_protocol"] = (
                    protocol.value if hasattr(protocol, "value") else str(protocol)
                )
            mechanism = getattr(connection, "sasl_mechanism", None)
            if mechanism is not None:
                kwargs["sasl_mechanism"] = (
                    mechanism.value if hasattr(mechanism, "value") else str(mechanism)
                )
            if getattr(connection, "request_timeout_ms", None):
                kwargs["request_timeout_ms"] = int(connection.request_timeout_ms)
        masked = self.config.masked
        if getattr(masked, "sasl_username", None):
            kwargs["sasl_plain_username"] = masked.sasl_username
        if getattr(masked, "sasl_password", None):
            kwargs["sasl_plain_password"] = masked.sasl_password
        ssl_certfile = getattr(masked, "ssl_certfile", None)
        ssl_keyfile = getattr(masked, "ssl_keyfile", None)
        if ssl_ca or ssl_certfile:
            context = ssl_module.create_default_context(cadata=ssl_ca)
            if ssl_certfile and ssl_keyfile:
                self._load_client_cert_chain(context, ssl_certfile, ssl_keyfile)
            kwargs["ssl_context"] = context
        return kwargs

    @staticmethod
    def _load_client_cert_chain(
        context: ssl_module.SSLContext, certfile: str, keyfile: str
    ) -> None:
        with (
            tempfile.NamedTemporaryFile("w", suffix=".pem") as cert_tmp,
            tempfile.NamedTemporaryFile("w", suffix=".pem") as key_tmp,
        ):
            cert_tmp.write(certfile)
            cert_tmp.flush()
            key_tmp.write(keyfile)
            key_tmp.flush()
            context.load_cert_chain(certfile=cert_tmp.name, keyfile=key_tmp.name)

    def _make_consumer(self, **extra: Any) -> Any:
        kwargs = {**self._client_kwargs(), "enable_auto_commit": False, **extra}
        return self._kafka.KafkaConsumer(**kwargs)

    def _make_admin(self) -> Any:
        return self._kafka.KafkaAdminClient(**self._client_kwargs())

    # ── Topic discovery ──────────────────────────────────────────────────

    def _list_topics(self) -> list[str]:
        consumer = self._make_consumer()
        try:
            topics = sorted(consumer.topics() or [])
        finally:
            consumer.close()
        scope = self._scope()
        include_internal = bool(getattr(scope, "include_internal", False)) if scope else False
        include = {t.strip() for t in (getattr(scope, "include_topics", None) or []) if t.strip()}
        exclude = {t.strip() for t in (getattr(scope, "exclude_topics", None) or []) if t.strip()}
        limit = getattr(scope, "topic_limit", None) if scope else None
        limit = int(limit) if limit else None

        selected: list[str] = []
        for topic in topics:
            if not include_internal and topic.startswith("__"):
                continue
            if include and topic not in include:
                continue
            if topic in exclude:
                continue
            selected.append(topic)
            if limit is not None and len(selected) >= limit:
                break
        return selected

    # ── Topic metadata ───────────────────────────────────────────────────

    def _topic_metadata(self, topic: str) -> dict[str, Any]:
        consumer = self._make_consumer()
        meta: dict[str, Any] = {}
        try:
            partitions = consumer.partitions_for_topic(topic) or set()
            meta["partition_count"] = len(partitions)
            tps = [self._kafka.TopicPartition(topic, p) for p in partitions]
            if tps:
                begin = consumer.beginning_offsets(tps)
                end = consumer.end_offsets(tps)
                meta["earliest_offset"] = int(sum(begin.values()))
                meta["latest_offset"] = int(sum(end.values()))
        finally:
            consumer.close()
        meta.update(self._admin_topic_metadata(topic))
        return meta

    def _admin_topic_metadata(self, topic: str) -> dict[str, Any]:
        meta: dict[str, Any] = {}
        try:
            admin = self._make_admin()
        except Exception as exc:
            logger.debug("Kafka admin unavailable: %s", exc)
            return meta
        try:
            described = admin.describe_topics([topic])
            for entry in described or []:
                parts = entry.get("partitions") or []
                if parts:
                    replicas = parts[0].get("replicas") or []
                    meta["replication_factor"] = len(replicas)
            configs = self._describe_topic_configs(admin, topic)
            if "retention.ms" in configs:
                try:
                    meta["retention_ms"] = int(configs["retention.ms"])
                except (TypeError, ValueError):
                    pass
            if "cleanup.policy" in configs:
                meta["cleanup_policy"] = configs["cleanup.policy"]
        except Exception as exc:
            logger.debug("Kafka topic describe failed for %s: %s", topic, exc)
        finally:
            try:
                admin.close()
            except Exception:
                pass
        return meta

    def _describe_topic_configs(self, admin: Any, topic: str) -> dict[str, str]:
        try:
            from kafka.admin import ConfigResource, ConfigResourceType

            resource = ConfigResource(ConfigResourceType.TOPIC, topic)
            result = admin.describe_configs([resource])
            configs: dict[str, str] = {}
            for response in result or []:
                for entry in getattr(response, "resources", []) or []:
                    for config in entry[4]:
                        configs[config[0]] = config[1]
            return configs
        except Exception:
            return {}

    # ── Asset ────────────────────────────────────────────────────────────

    def _topic_to_asset(self, topic: str) -> SingleAssetScanResults:
        asset_hash = self.generate_hash_id(topic)
        metadata = self._topic_metadata(topic)
        metadata.setdefault("partition_count", 0)
        now = datetime.now(UTC)
        return SingleAssetScanResults(
            hash=asset_hash,
            checksum=self.calculate_checksum(metadata),
            name=topic,
            external_url=self._build_external_url(topic),
            links=[],
            asset_type=OutputAssetType.OTHER,
            source_id=self.source_id,
            created_at=now,
            updated_at=now,
            runner_id=self.runner_id,
            **self.metadata_fields("topic", metadata),
        )

    def _build_external_url(self, topic: str) -> str:
        servers = ",".join(self._bootstrap_servers())
        return f"kafka://{servers}/{topic}"

    async def extract_raw(self) -> AsyncGenerator[list[SingleAssetScanResults], None]:
        if self._aborted:
            return
        batch: list[SingleAssetScanResults] = []
        for topic in self._list_topics():
            if self._aborted:
                return
            asset = self._topic_to_asset(topic)
            self._topic_lookup[asset.hash] = topic
            batch.append(asset)
            if len(batch) >= self.BATCH_SIZE:
                yield batch
                batch = []
        if batch:
            yield batch

    # ── Message sampling ─────────────────────────────────────────────────

    @staticmethod
    def _decode(value: Any) -> str:
        if value is None:
            return "null"
        if isinstance(value, (bytes, bytearray)):
            try:
                return bytes(value).decode("utf-8")
            except UnicodeDecodeError:
                return f"<{len(bytes(value))} bytes>"
        return str(value)

    def _consume(self, topic: str, max_count: int) -> list[dict[str, Any]]:
        sampling = self._sampling()
        consumer = self._make_consumer(consumer_timeout_ms=5000)
        out: list[dict[str, Any]] = []
        try:
            partitions = consumer.partitions_for_topic(topic) or set()
            tps = [self._kafka.TopicPartition(topic, p) for p in partitions]
            if not tps:
                return out
            consumer.assign(tps)
            if sampling.strategy == SamplingStrategy.LATEST:
                end = consumer.end_offsets(tps)
                per = max(1, max_count // max(1, len(tps)))
                begin = consumer.beginning_offsets(tps)
                for tp in tps:
                    target = max(begin.get(tp, 0), end.get(tp, 0) - per)
                    consumer.seek(tp, target)
            else:
                consumer.seek_to_beginning(*tps)
            for message in consumer:
                out.append(
                    {
                        "partition": message.partition,
                        "offset": message.offset,
                        "key": self._decode(message.key),
                        "value": self._decode(message.value),
                    }
                )
                if len(out) >= max_count:
                    break
        finally:
            consumer.close()
        return out

    def _format_messages(
        self, topic: str, messages: list[dict[str, Any]], offset: int = 0
    ) -> tuple[str, str]:
        import json

        lines = [f"topic={topic}", f"sampled_messages={len(messages)}", ""]
        for index, msg in enumerate(messages, start=1 + offset):
            lines.append(f"message_{index}:")
            lines.append(f"  partition: {msg['partition']}")
            lines.append(f"  offset: {msg['offset']}")
            lines.append(f"  key: {msg['key']}")
            value_lines = msg["value"].splitlines() or [""]
            lines.append(f"  value: {value_lines[0]}")
            for cont in value_lines[1:]:
                lines.append(f"    {cont}")
            lines.append("")
        raw = json.dumps(
            {"topic": topic, "messages": messages, "offset": offset}, ensure_ascii=False
        )
        return raw, "\n".join(lines).rstrip()

    async def fetch_content(self, asset_id: str) -> tuple[str, str] | None:
        topic = self._topic_lookup.get(asset_id)
        if topic is None:
            return None
        max_count = int(self._sampling().rows_per_page or 100)
        messages = self._consume(topic, max_count)
        if not messages:
            return None
        return self._format_messages(topic, messages)

    async def fetch_content_pages(self, asset_id: str) -> AsyncGenerator[tuple[str, str], None]:
        topic = self._topic_lookup.get(asset_id)
        if topic is None:
            return
        max_count = int(self._sampling().rows_per_page or 100)
        messages = self._consume(topic, max_count)
        for i, message in enumerate(messages):
            yield self._format_messages(topic, [message], offset=i)

    # ── Plumbing ─────────────────────────────────────────────────────────

    def generate_hash_id(self, asset_id: str) -> str:
        return hash_id("kafka", asset_id)

    def test_connection(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "timestamp": datetime.now(UTC).isoformat(),
            "source_type": self.recipe.get("type"),
        }
        try:
            topics = self._list_topics()
            result["status"] = "SUCCESS"
            result["message"] = f"Successfully connected to Kafka. Reachable topics: {len(topics)}."
        except Exception as exc:
            result["status"] = "FAILURE"
            result["message"] = f"Failed to connect to Kafka: {exc}"
        return result

    def abort(self) -> None:
        logger.info("Aborting Kafka extraction...")
        self._aborted = True
