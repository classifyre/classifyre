"""Apache Kafka source — discovers topics and samples messages.

Two transports, selected by ``required.auth_mode``:

* Native broker protocol (``NONE`` / ``SASL`` / ``CLIENT_CERT``) via
  ``confluent-kafka`` (librdkafka, bundled wheels — no JVM).
* Kafka REST Proxy (``REST``) via plain HTTP — see :mod:`.rest`. Needs no
  broker protocol access and no ``confluent-kafka`` install.

Each topic becomes one ``topic`` asset with partition/offset/retention
metadata; message samples are streamed as content for detectors.

Sampling strategies map to consumer positioning (identically on both
transports):

* ``LATEST``    — start near the tail of each partition (newest messages).
* ``RANDOM``    — start at a random offset within each partition.
* ``ALL``       — start at the earliest retained offset.
* ``AUTOMATIC`` — keep, per partition (keyed ``"{topic}:{partition}"``), the
  range of offsets already read. The first run reads the newest messages.
  After that a run reads what was produced since, and when there is nothing
  new it reads the next slice of older messages, until the earliest retained
  offset is reached. From then on only new messages are read.

All strategies read up to ``sampling.rows_per_page`` messages per topic.
"""

from __future__ import annotations

import logging
import random
import re
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
from ...utils.file_parser import render_bytes_cell
from ...utils.hashing import hash_id
from ...utils.sampling_frontier import FRONTIER_VERSION
from ..base import BaseSource
from ..dependencies import require_module
from .rest import KafkaRestClient

logger = logging.getLogger(__name__)

_CONSUME_TIMEOUT_SECONDS = 5.0


def _is_offset(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


_PEM_BEGIN = re.compile(r"-----BEGIN ([A-Z0-9 ]+)-----")


def _normalize_pem(value: str | None) -> str | None:
    """Accept a PEM however it survived the trip through a form or an env var.

    Values copied out of JSON or a shell variable often arrive with literal
    ``\\n`` escapes instead of real newlines; OpenSSL rejects those outright.
    """
    if not value:
        return None
    text = value.strip()
    if "\\n" in text and "\n" not in text:
        text = text.replace("\\n", "\n")
    return text or None


def _pem_block_kinds(value: str | None) -> list[str]:
    """The PEM block types present, e.g. ``["CERTIFICATE"]``."""
    return _PEM_BEGIN.findall(value or "")


def _has_certificate(kinds: list[str]) -> bool:
    return any(kind.strip() == "CERTIFICATE" for kind in kinds)


def _has_private_key(kinds: list[str]) -> bool:
    return any(kind.strip().endswith("PRIVATE KEY") for kind in kinds)


class _BrokerLogCollector(logging.Handler):
    """Captures what librdkafka logs during one connection attempt."""

    def __init__(self) -> None:
        super().__init__()
        self.messages: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.messages.append(record.getMessage())


def _last_broker_error(messages: list[str]) -> str | None:
    """The most recent broker log line that explains a failure."""
    for message in reversed(messages):
        if any(marker in message for marker in ("FAIL", "SSL", "ERROR", "Disconnected")):
            # librdkafka prefixes every line with "[rdkafka#...] [thrd:...]:";
            # the part after the last colon-space is the readable bit.
            return message.split("]: ", 1)[-1].strip()[:300]
    return None


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
        self._rest_client: KafkaRestClient | None = None
        # The REST transport speaks plain HTTP, so it must not drag in
        # librdkafka — that is the whole point of offering it.
        self._kafka = (
            None
            if self.is_rest
            else require_module(
                module_name="confluent_kafka",
                source_name="Apache Kafka",
                uv_groups=["kafka"],
                detail="confluent-kafka is required for the Kafka connector.",
            )
        )
        self._topic_lookup: dict[str, str] = {}

    # ── Config / client construction ─────────────────────────────────────

    @property
    def is_rest(self) -> bool:
        return str(getattr(self.config.required, "auth_mode", "")) == "REST"

    def _sampling(self) -> SamplingConfig:
        return self.config.sampling

    def _connection(self) -> Any:
        optional = self.config.optional
        return optional.connection if optional is not None else None

    def _scope(self) -> Any:
        optional = self.config.optional
        return optional.scope if optional is not None else None

    def _bootstrap_servers(self) -> str:
        required = self.config.required
        return f"{str(required.host).strip()}:{int(required.port)}"

    def _rest_base_url(self) -> str:
        required = self.config.required
        connection = self._connection()
        use_tls = getattr(connection, "rest_use_tls", None) if connection else None
        scheme = "http" if use_tls is False else "https"
        return f"{scheme}://{str(required.host).strip()}:{int(required.port)}"

    def _rest(self) -> KafkaRestClient:
        if self._rest_client is None:
            masked = self.config.masked
            self._rest_client = KafkaRestClient(
                base_url=self._rest_base_url(),
                username=getattr(masked, "username", None),
                password=getattr(masked, "password", None),
                timeout_seconds=self._request_timeout_seconds(),
                group_id=f"classifyre-scan-{self.runner_id}",
            )
        return self._rest_client

    def _request_timeout_seconds(self) -> float:
        connection = self._connection()
        timeout_ms = getattr(connection, "request_timeout_ms", None) if connection else None
        return int(timeout_ms) / 1000.0 if timeout_ms else 30.0

    def _security_protocol(self) -> str:
        """Resolve ``security.protocol`` from the auth mode and any override.

        The auth mode dictates which protocol family can work at all: SASL
        credentials are only sent over ``SASL_*``, and a client certificate
        only over ``SSL``. Handing librdkafka a mismatched pair (SASL creds
        with plain ``SSL``, say) fails at connect time with an opaque
        transport error, so the mode wins and the override only picks within
        its family — SASL_PLAINTEXT for a SASL broker without TLS.

        A supplied CA certificate also forces TLS: a CA exists only to verify
        a TLS handshake, so pairing one with a plaintext protocol is always a
        misconfiguration (and managed brokers, which is where CAs come from,
        are TLS-only).
        """
        connection = self._connection()
        raw = getattr(connection, "security_protocol", None) if connection else None
        override = (raw.value if hasattr(raw, "value") else str(raw)) if raw is not None else None
        auth_mode = str(getattr(self.config.required, "auth_mode", "") or "")
        has_ca = bool(getattr(self.config.masked, "ca_certificate", None))

        if auth_mode == "SASL":
            resolved = override if override in ("SASL_SSL", "SASL_PLAINTEXT") else "SASL_SSL"
            if override == "PLAINTEXT":
                resolved = "SASL_PLAINTEXT"
            if has_ca and resolved == "SASL_PLAINTEXT":
                resolved = "SASL_SSL"
        elif auth_mode == "CLIENT_CERT":
            resolved = "SSL"
        else:
            resolved = override or "PLAINTEXT"
            if has_ca and resolved == "PLAINTEXT":
                resolved = "SSL"

        if override is not None and override != resolved:
            reason = (
                "a CA certificate was supplied, which requires TLS"
                if has_ca and override in ("PLAINTEXT", "SASL_PLAINTEXT")
                else f"it is not usable with {auth_mode} authentication"
            )
            logger.info("security_protocol %s ignored (%s); using %s.", override, reason, resolved)
        return resolved

    def _client_config(self) -> dict[str, Any]:
        conf: dict[str, Any] = {
            "bootstrap.servers": self._bootstrap_servers(),
            "security.protocol": self._security_protocol(),
            # Log via callbacks instead of stderr noise.
            "logger": logger,
        }
        connection = self._connection()
        if connection is not None:
            # Only meaningful under SASL_*; librdkafka warns when it is set
            # alongside a non-SASL protocol.
            mechanism = getattr(connection, "sasl_mechanism", None)
            if mechanism is not None and conf["security.protocol"].startswith("SASL_"):
                conf["sasl.mechanism"] = (
                    mechanism.value if hasattr(mechanism, "value") else str(mechanism)
                )
            if getattr(connection, "request_timeout_ms", None):
                conf["socket.timeout.ms"] = int(connection.request_timeout_ms)

        masked = self.config.masked
        if getattr(masked, "sasl_username", None):
            conf["sasl.username"] = masked.sasl_username
        if getattr(masked, "sasl_password", None):
            conf["sasl.password"] = masked.sasl_password

        access_certificate = _normalize_pem(getattr(masked, "access_certificate", None))
        access_key = _normalize_pem(getattr(masked, "access_key", None))
        # The CA lives with the credentials it validates, not in plain config.
        ca_certificate = _normalize_pem(getattr(masked, "ca_certificate", None))
        self._check_pem_fields(
            access_certificate=access_certificate,
            access_key=access_key,
            ca_certificate=ca_certificate,
        )
        if access_certificate:
            conf["ssl.certificate.pem"] = access_certificate
        if access_key:
            conf["ssl.key.pem"] = access_key
        if ca_certificate:
            conf["ssl.ca.pem"] = ca_certificate
        return conf

    @staticmethod
    def _check_pem_fields(
        *,
        access_certificate: str | None,
        access_key: str | None,
        ca_certificate: str | None,
    ) -> None:
        """Reject PEM values that are in the wrong field, while we still know
        which field they came from.

        librdkafka only reports ``ssl.certificate.pem failed: not in PEM
        format?``, which names an internal setting rather than anything on the
        form, and says nothing about the usual cause: the access key and access
        certificate pasted into each other's boxes.
        """
        cert_kinds = _pem_block_kinds(access_certificate)
        key_kinds = _pem_block_kinds(access_key)
        ca_kinds = _pem_block_kinds(ca_certificate)

        if _has_private_key(cert_kinds) and _has_certificate(key_kinds):
            raise ValueError(
                "Access certificate and access key are swapped: the access certificate "
                "field holds a private key and the access key field holds a certificate. "
                "Swap them — the access certificate is the -----BEGIN CERTIFICATE----- "
                "block, the access key the -----BEGIN PRIVATE KEY----- block."
            )

        for label, value, kinds, expected, ok in (
            (
                "Access certificate",
                access_certificate,
                cert_kinds,
                "-----BEGIN CERTIFICATE-----",
                _has_certificate(cert_kinds),
            ),
            (
                "Access key",
                access_key,
                key_kinds,
                "-----BEGIN PRIVATE KEY-----",
                _has_private_key(key_kinds),
            ),
            (
                "CA certificate",
                ca_certificate,
                ca_kinds,
                "-----BEGIN CERTIFICATE-----",
                _has_certificate(ca_kinds),
            ),
        ):
            if not value or ok:
                continue
            found = f"a {', '.join(kinds)} block" if kinds else "no PEM block at all"
            raise ValueError(
                f"{label} is not a {expected} block — it contains {found}. "
                "Paste the whole PEM, including its BEGIN and END lines."
            )

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

    def _all_topics(self) -> list[str]:
        if self.is_rest:
            return sorted(self._rest().list_topics())
        consumer = self._make_consumer()
        try:
            metadata = self._cluster_metadata(consumer)
            return sorted(metadata.topics.keys())
        finally:
            consumer.close()

    def _list_topics(self) -> list[str]:
        topics = self._all_topics()
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
        if self.is_rest:
            return self._rest_topic_metadata(topic)
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

    def _rest_topic_metadata(self, topic: str) -> dict[str, Any]:
        rest = self._rest()
        meta = rest.topic_metadata(topic)
        earliest = 0
        latest = 0
        partition_ids = rest.partition_ids(topic)
        for partition_id in partition_ids:
            watermarks = rest.watermarks(topic, partition_id)
            if watermarks is None:
                continue
            low, high = watermarks
            earliest += low
            latest += high
        if partition_ids:
            meta["earliest_offset"] = earliest
            meta["latest_offset"] = latest
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
            # TABLE (not OTHER): sampled messages are the topic's text payload.
            # OTHER resolves to no text content type in the detector pipeline,
            # so every text detector is skipped and nothing is ever found.
            asset_type=OutputAssetType.TABLE,
            source_id=self.source_id,
            created_at=now,
            updated_at=now,
            runner_id=self.runner_id,
            **self.metadata_fields("topic", metadata),
        )

    def _build_external_url(self, topic: str) -> str:
        if self.is_rest:
            return f"{self._rest_base_url()}/topics/{topic}"
        return f"kafka://{self._bootstrap_servers()}/{topic}"

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
            # A decode that succeeds is not proof of readability: control bytes
            # are valid UTF-8, so the old UnicodeDecodeError fallback never fired
            # for a binary payload and emitted raw control characters instead.
            return render_bytes_cell(bytes(value))
        return str(value)

    def _start_offset(self, strategy: SamplingStrategy, low: int, high: int, per: int) -> int:
        """Pick the partition start offset for the configured sampling strategy."""
        if strategy == SamplingStrategy.LATEST:
            return max(low, high - per)
        if strategy == SamplingStrategy.RANDOM:
            return random.randint(low, max(low, high - per))
        # ALL: read from the earliest retained offset.
        return low

    # ── AUTOMATIC ────────────────────────────────────────────────────────
    #
    # A partition is a log: offsets only grow, so "new" is everything at or
    # above the offset the last run stopped at. Per partition the cursor holds
    # ``head`` (the next unread offset above the covered range), ``tail`` (the
    # lowest offset covered) and, rarely, ``fill`` (a stretch inside the
    # covered range that a run timed out before finishing).
    #
    # A consumer reads forward from one position, so each partition gets one
    # ``[start, stop)`` range per run, chosen in this order: what is new; an
    # unfinished stretch; the next slice below the tail. A partition with
    # nothing new and nothing left below is not read at all.

    def _saved_partition_state(self, key: str, low: int, high: int) -> dict[str, Any] | None:
        """The saved range for a partition, fitted to what the broker still has."""
        saved = self._sampling_cursor.get(key)
        if not isinstance(saved, dict) or saved.get("v") != FRONTIER_VERSION:
            return None
        saved_head, saved_tail = saved.get("head"), saved.get("tail")
        if not (_is_offset(saved_head) and _is_offset(saved_tail)):
            return None
        head, tail = int(saved_head), int(saved_tail)
        if tail > head or head > high:
            # The log is shorter than what was read from it: the topic was
            # recreated. Start over.
            return None
        # Retention may have removed part of what was covered, or all of it.
        head, tail = max(head, low), max(tail, low)
        state: dict[str, Any] = {"v": FRONTIER_VERSION, "head": head, "tail": tail}
        fill = saved.get("fill")
        if isinstance(fill, list) and len(fill) == 2 and all(_is_offset(v) for v in fill):
            fill_from, fill_to = max(fill[0], low), min(fill[1], head)
            if fill_from < fill_to:
                state["fill"] = [fill_from, fill_to]
        return state

    def _plan_partition(
        self, key: str, low: int, high: int, per: int
    ) -> tuple[str, int, int, dict[str, Any] | None] | None:
        """``(kind, start, stop, state)`` for this run, or None when there is nothing to read."""
        state = self._saved_partition_state(key, low, high)
        if state is None:
            return "fresh", max(low, high - per), high, None
        head, tail = state["head"], state["tail"]
        if head < high:
            return "new", head, min(high, head + per), state
        fill = state.get("fill")
        if fill:
            return "fill", fill[0], min(fill[1], fill[0] + per), state
        if tail > low:
            return "backfill", max(low, tail - per), tail, state
        return None

    def _record_automatic_cursors(
        self,
        topic: str,
        messages: list[dict[str, Any]],
        plans: dict[int, tuple[str, int, int, dict[str, Any] | None]],
        positions: dict[int, int] | None = None,
    ) -> None:
        """Fold what each partition's range actually yielded into its cursor.

        ``positions`` is where the consumer stands in each partition, when the
        transport can say: it moves past compacted offsets and transaction
        markers that never arrive as messages, so a range ending in those is
        still known to have been read to its end.
        """
        consumed_next: dict[int, int] = {}
        for message in messages:
            partition_id = int(message["partition"])
            next_offset = int(message["offset"]) + 1
            if next_offset > consumed_next.get(partition_id, -1):
                consumed_next[partition_id] = next_offset

        for partition_id, (kind, start, stop, saved) in plans.items():
            reached = max(
                consumed_next.get(partition_id, start),
                (positions or {}).get(partition_id, start),
            )
            reached = min(max(reached, start), stop)
            if reached <= start:
                continue  # nothing read: the cursor stays where it was

            state: dict[str, Any] = dict(saved or {"v": FRONTIER_VERSION})
            if kind == "fresh":
                state["head"], state["tail"] = reached, start
            elif kind == "new":
                state["head"] = reached
            elif kind == "fill":
                if reached >= state["fill"][1]:
                    state.pop("fill", None)
                else:
                    state["fill"] = [reached, state["fill"][1]]
            else:
                # The slice below the tail. Read short of the tail, the rest
                # is remembered and finished before going any lower.
                if reached < stop:
                    state["fill"] = [reached, stop]
                state["tail"] = start
            self._record_cursor_key(f"{topic}:{partition_id}", state)

    def _plan_partition_starts(
        self,
        topic: str,
        max_count: int,
        watermarks_by_partition: dict[int, tuple[int, int]],
    ) -> tuple[dict[int, int], dict[int, tuple[str, int, int, dict[str, Any] | None]]]:
        """Map each non-empty partition to its start offset for this strategy.

        Returns ``(starts, automatic_plans)``; the second value is only
        populated for AUTOMATIC, which reads a bounded range per partition and
        needs the plan again afterwards to advance its cursor.
        """
        strategy = self._sampling().strategy
        non_empty = {
            p: (low, high) for p, (low, high) in watermarks_by_partition.items() if high > low
        }
        if not non_empty:
            return {}, {}
        per = max(1, max_count // len(non_empty))

        starts: dict[int, int] = {}
        automatic_plans: dict[int, tuple[str, int, int, dict[str, Any] | None]] = {}
        for partition_id, (low, high) in sorted(non_empty.items()):
            if strategy == SamplingStrategy.AUTOMATIC:
                plan = self._plan_partition(f"{topic}:{partition_id}", low, high, per)
                if plan is None:
                    continue
                automatic_plans[partition_id] = plan
                start = plan[1]
            else:
                start = self._start_offset(strategy, low, high, per)
            starts[partition_id] = start
        return starts, automatic_plans

    def _consume_rest(self, topic: str, max_count: int) -> list[dict[str, Any]]:
        rest = self._rest()
        watermarks_by_partition: dict[int, tuple[int, int]] = {}
        for partition_id in rest.partition_ids(topic):
            watermarks = rest.watermarks(topic, partition_id)
            if watermarks is not None:
                watermarks_by_partition[partition_id] = watermarks

        starts, plans = self._plan_partition_starts(topic, max_count, watermarks_by_partition)
        if not starts:
            return []

        stops = {partition_id: plan[2] for partition_id, plan in plans.items()}
        messages = rest.consume(topic, starts, max_count, stops=stops or None)
        if plans:
            self._record_automatic_cursors(topic, messages, plans)
        return messages

    def _consume(self, topic: str, max_count: int) -> list[dict[str, Any]]:
        if self.is_rest:
            return self._consume_rest(topic, max_count)
        strategy = self._sampling().strategy
        consumer = self._make_consumer()
        timeout = self._request_timeout_seconds()
        out: list[dict[str, Any]] = []
        starts: dict[int, int] = {}
        plans: dict[int, tuple[str, int, int, dict[str, Any] | None]] = {}
        positions: dict[int, int] = {}
        try:
            metadata = self._cluster_metadata(consumer, topic)
            topic_meta = metadata.topics.get(topic)
            partition_ids = sorted(topic_meta.partitions.keys()) if topic_meta else []
            if not partition_ids:
                return out

            watermarks_by_partition: dict[int, tuple[int, int]] = {}
            for partition_id in partition_ids:
                try:
                    low, high = consumer.get_watermark_offsets(
                        self._kafka.TopicPartition(topic, partition_id), timeout=timeout
                    )
                except Exception as exc:
                    logger.debug("Watermark lookup failed for %s[%s]: %s", topic, partition_id, exc)
                    continue
                watermarks_by_partition[partition_id] = (int(low), int(high))

            starts, plans = self._plan_partition_starts(topic, max_count, watermarks_by_partition)
            if not starts:
                return out
            # AUTOMATIC reads a bounded range per partition; the rest read on
            # from their start until the budget is spent.
            stops = {partition_id: plan[2] for partition_id, plan in plans.items()}
            finished: set[int] = set()

            assignments = []
            for partition_id, start in sorted(starts.items()):
                tp = self._kafka.TopicPartition(topic, partition_id)
                tp.offset = start
                assignments.append(tp)
            consumer.assign(assignments)

            deadline = _CONSUME_TIMEOUT_SECONDS
            while len(out) < max_count:
                if stops and len(finished) >= len(stops):
                    break
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
                    partition_id, offset = message.partition(), message.offset()
                    stop = stops.get(partition_id)
                    if stop is not None and offset >= stop:
                        # Past this partition's range for the run.
                        self._finish_partition(consumer, topic, partition_id, finished)
                        continue
                    out.append(
                        {
                            "partition": partition_id,
                            "offset": offset,
                            "key": self._decode(message.key()),
                            "value": self._decode(message.value()),
                        }
                    )
                    if stop is not None and offset >= stop - 1:
                        self._finish_partition(consumer, topic, partition_id, finished)
                    if len(out) >= max_count:
                        break
            if plans:
                positions = self._consumer_positions(consumer, assignments)
        finally:
            consumer.close()

        if strategy == SamplingStrategy.AUTOMATIC and plans:
            self._record_automatic_cursors(topic, out, plans, positions)

        return out

    def _finish_partition(
        self, consumer: Any, topic: str, partition_id: int, finished: set[int]
    ) -> None:
        """Stop fetching a partition whose range for this run has been read."""
        if partition_id in finished:
            return
        finished.add(partition_id)
        try:
            consumer.pause([self._kafka.TopicPartition(topic, partition_id)])
        except Exception as exc:
            logger.debug("Could not pause %s[%s]: %s", topic, partition_id, exc)

    @staticmethod
    def _consumer_positions(consumer: Any, assignments: list[Any]) -> dict[int, int]:
        """Where the consumer stands in each assigned partition, when it can say."""
        try:
            positioned = consumer.position(assignments)
        except Exception as exc:
            logger.debug("Kafka consumer positions unavailable: %s", exc)
            return {}
        positions: dict[int, int] = {}
        for entry in positioned or []:
            offset = getattr(entry, "offset", None)
            partition_id = getattr(entry, "partition", None)
            if _is_offset(offset) and isinstance(partition_id, int):
                positions[partition_id] = offset
        return positions

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
        transport = "Kafka REST Proxy" if self.is_rest else "Kafka"
        # librdkafka reports the *reason* (TLS alerts, rejected certificates,
        # refused connections) through its log callback and returns only a
        # generic error object, so collect the log while the attempt runs.
        broker_log = _BrokerLogCollector()
        logger.addHandler(broker_log)
        try:
            topics = self._list_topics()
            result["status"] = "SUCCESS"
            result["message"] = (
                f"Successfully connected to {transport}. Reachable topics: {len(topics)}."
            )
        except Exception as exc:
            result["status"] = "FAILURE"
            result["message"] = (
                f"Failed to connect to {transport}: {exc}"
                f"{self._failure_hint(exc, broker_log.messages)}"
            )
        finally:
            logger.removeHandler(broker_log)
        return result

    def _failure_hint(self, exc: Exception, broker_messages: list[str]) -> str:
        """Turn librdkafka's opaque transport error into something actionable.

        ``Broker transport failure`` only means nothing came back that looked
        like the Kafka protocol. What actually went wrong is in the broker log
        — a TLS alert, a rejected client certificate — plus a couple of
        configuration mistakes that are invisible in either.
        """
        if self.is_rest or "_TRANSPORT" not in str(exc):
            return ""

        joined = " ".join(broker_messages)
        auth_mode = str(getattr(self.config.required, "auth_mode", "") or "")

        if "not sending any client certificates" in joined or "certificate required" in joined:
            hint = (
                " The broker asked for a client certificate and rejected the one supplied: "
                "it is not issued by a CA the broker trusts. Use the access certificate and "
                "access key issued by this Kafka service itself (Aiven: service.cert and "
                "service.key), not a self-signed or unrelated pair."
            )
        elif "certificate verify failed" in joined or "unable to get local issuer" in joined:
            hint = (
                " The broker's own TLS certificate could not be verified. Paste the service's "
                "CA certificate (Aiven: ca.pem) into the CA certificate field."
            )
        else:
            hint = (
                f" Nothing answered the Kafka protocol at {self._bootstrap_servers()} over "
                f"{self._security_protocol()}. Check that the port is the broker's — an HTTP "
                "REST proxy port will not answer it, and needs the 'Kafka REST Proxy' "
                "authentication mode instead"
                + (
                    " — and that the security protocol matches the broker (managed services "
                    "such as Aiven and Confluent Cloud are TLS-only, so they need SASL_SSL, "
                    "not SASL_PLAINTEXT)."
                    if auth_mode == "SASL"
                    else "."
                )
            )

        last = _last_broker_error(broker_messages)
        return f"{hint} Broker reported: {last}" if last else hint

    def cleanup(self) -> None:
        if self._rest_client is not None:
            self._rest_client.close()
            self._rest_client = None

    def abort(self) -> None:
        logger.info("Aborting Kafka extraction...")
        self._aborted = True
