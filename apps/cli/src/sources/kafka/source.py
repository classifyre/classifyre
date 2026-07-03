"""Apache Kafka source — discovers topics and samples messages.

Uses ``confluent-kafka`` (librdkafka, bundled wheels — no JVM). Each topic
becomes one ``topic`` asset with partition/offset/retention metadata; message
samples are streamed as content for detectors.

Sampling strategies map to consumer positioning:

* ``LATEST``    — start near the tail of each partition (newest messages).
* ``RANDOM``    — start at a random offset within each partition.
* ``AUTOMATIC`` / ``ALL`` — start at the earliest retained offset.

All strategies read up to ``sampling.rows_per_page`` messages per topic.
"""

from __future__ import annotations

import logging
import random
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

_CONSUME_TIMEOUT_SECONDS = 5.0


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
            module_name="confluent_kafka",
            source_name="Apache Kafka",
            uv_groups=["kafka"],
            detail="confluent-kafka is required for the Kafka connector.",
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

    def _request_timeout_seconds(self) -> float:
        connection = self._connection()
        timeout_ms = getattr(connection, "request_timeout_ms", None) if connection else None
        return int(timeout_ms) / 1000.0 if timeout_ms else 30.0

    def _client_config(self) -> dict[str, Any]:
        conf: dict[str, Any] = {
            "bootstrap.servers": ",".join(self._bootstrap_servers()),
            # Log via callbacks instead of stderr noise.
            "logger": logger,
        }
        connection = self._connection()
        if connection is not None:
            protocol = getattr(connection, "security_protocol", None)
            if protocol is not None:
                conf["security.protocol"] = (
                    protocol.value if hasattr(protocol, "value") else str(protocol)
                )
            mechanism = getattr(connection, "sasl_mechanism", None)
            if mechanism is not None:
                conf["sasl.mechanism"] = (
                    mechanism.value if hasattr(mechanism, "value") else str(mechanism)
                )
            if getattr(connection, "request_timeout_ms", None):
                conf["socket.timeout.ms"] = int(connection.request_timeout_ms)
            ssl_ca = getattr(connection, "ssl_ca", None)
            if ssl_ca:
                conf["ssl.ca.pem"] = ssl_ca

        masked = self.config.masked
        if getattr(masked, "sasl_username", None):
            conf["sasl.username"] = masked.sasl_username
        if getattr(masked, "sasl_password", None):
            conf["sasl.password"] = masked.sasl_password
        ssl_certfile = getattr(masked, "ssl_certfile", None)
        ssl_keyfile = getattr(masked, "ssl_keyfile", None)
        if ssl_certfile:
            conf["ssl.certificate.pem"] = ssl_certfile
        if ssl_keyfile:
            conf["ssl.key.pem"] = ssl_keyfile
        return conf

    def _make_consumer(self) -> Any:
        conf = {
            **self._client_config(),
            "group.id": f"classifyre-scan-{self.runner_id}",
            "enable.auto.commit": False,
            "auto.offset.reset": "earliest",
        }
        return self._kafka.Consumer(conf)

    def _make_admin(self) -> Any:
        admin_module = require_module(
            module_name="confluent_kafka.admin",
            source_name="Apache Kafka",
            uv_groups=["kafka"],
            detail="confluent-kafka is required for the Kafka connector.",
        )
        return admin_module.AdminClient(self._client_config())

    def _cluster_metadata(self, consumer: Any, topic: str | None = None) -> Any:
        timeout = self._request_timeout_seconds()
        if topic is None:
            return consumer.list_topics(timeout=timeout)
        return consumer.list_topics(topic, timeout=timeout)

    # ── Topic discovery ──────────────────────────────────────────────────

    def _list_topics(self) -> list[str]:
        consumer = self._make_consumer()
        try:
            metadata = self._cluster_metadata(consumer)
            topics = sorted(metadata.topics.keys())
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
        timeout = self._request_timeout_seconds()
        try:
            metadata = self._cluster_metadata(consumer, topic)
            topic_meta = metadata.topics.get(topic)
            partitions = dict(topic_meta.partitions) if topic_meta is not None else {}
            meta["partition_count"] = len(partitions)
            replicas = [len(p.replicas or []) for p in partitions.values()]
            if replicas:
                meta["replication_factor"] = min(replicas)
            earliest = 0
            latest = 0
            for partition_id in partitions:
                try:
                    low, high = consumer.get_watermark_offsets(
                        self._kafka.TopicPartition(topic, partition_id),
                        timeout=timeout,
                    )
                except Exception as exc:
                    logger.debug("Watermark lookup failed for %s[%s]: %s", topic, partition_id, exc)
                    continue
                earliest += int(low)
                latest += int(high)
            if partitions:
                meta["earliest_offset"] = earliest
                meta["latest_offset"] = latest
        finally:
            consumer.close()
        meta.update(self._admin_topic_metadata(topic))
        return meta

    def _admin_topic_metadata(self, topic: str) -> dict[str, Any]:
        meta: dict[str, Any] = {}
        try:
            admin = self._make_admin()
            configs = self._describe_topic_configs(admin, topic)
        except Exception as exc:
            logger.debug("Kafka admin unavailable: %s", exc)
            return meta
        if "retention.ms" in configs:
            try:
                meta["retention_ms"] = int(configs["retention.ms"])
            except (TypeError, ValueError):
                pass
        if "cleanup.policy" in configs:
            meta["cleanup_policy"] = configs["cleanup.policy"]
        return meta

    def _describe_topic_configs(self, admin: Any, topic: str) -> dict[str, str]:
        try:
            admin_module = require_module(
                module_name="confluent_kafka.admin",
                source_name="Apache Kafka",
                uv_groups=["kafka"],
            )
            resource = admin_module.ConfigResource(admin_module.ConfigResource.Type.TOPIC, topic)
            futures = admin.describe_configs([resource])
            configs: dict[str, str] = {}
            for future in futures.values():
                entries = future.result(timeout=self._request_timeout_seconds())
                for name, entry in entries.items():
                    value = getattr(entry, "value", None)
                    if value is not None:
                        configs[str(name)] = str(value)
            return configs
        except Exception as exc:
            logger.debug("Kafka topic describe failed for %s: %s", topic, exc)
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

    def _start_offset(self, strategy: SamplingStrategy, low: int, high: int, per: int) -> int:
        """Pick the partition start offset for the configured sampling strategy."""
        if strategy == SamplingStrategy.LATEST:
            return max(low, high - per)
        if strategy == SamplingStrategy.RANDOM:
            return random.randint(low, max(low, high - per))
        # AUTOMATIC / ALL: read from the earliest retained offset.
        return low

    def _consume(self, topic: str, max_count: int) -> list[dict[str, Any]]:
        strategy = self._sampling().strategy
        consumer = self._make_consumer()
        timeout = self._request_timeout_seconds()
        out: list[dict[str, Any]] = []
        try:
            metadata = self._cluster_metadata(consumer, topic)
            topic_meta = metadata.topics.get(topic)
            partition_ids = sorted(topic_meta.partitions.keys()) if topic_meta else []
            if not partition_ids:
                return out
            per = max(1, max_count // len(partition_ids))
            assignments = []
            for partition_id in partition_ids:
                tp = self._kafka.TopicPartition(topic, partition_id)
                try:
                    low, high = consumer.get_watermark_offsets(tp, timeout=timeout)
                except Exception as exc:
                    logger.debug("Watermark lookup failed for %s[%s]: %s", topic, partition_id, exc)
                    continue
                if high <= low:
                    continue  # empty partition
                tp.offset = self._start_offset(strategy, int(low), int(high), per)
                assignments.append(tp)
            if not assignments:
                return out
            consumer.assign(assignments)

            deadline = _CONSUME_TIMEOUT_SECONDS
            while len(out) < max_count:
                messages = consumer.consume(num_messages=max_count - len(out), timeout=deadline)
                if not messages:
                    break
                for message in messages:
                    error = message.error()
                    if error is not None:
                        if error.code() == self._kafka.KafkaError._PARTITION_EOF:
                            continue
                        logger.debug("Kafka consume error on %s: %s", topic, error)
                        continue
                    out.append(
                        {
                            "partition": message.partition(),
                            "offset": message.offset(),
                            "key": self._decode(message.key()),
                            "value": self._decode(message.value()),
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
