from __future__ import annotations

from typing import Any

import pytest

from src.models.generated_input import SamplingStrategy
from src.sources.kafka.source import KafkaSource

# ── confluent-kafka fakes ────────────────────────────────────────────────


class _TopicPartition:
    def __init__(self, topic: str, partition: int, offset: int = -1001) -> None:
        self.topic = topic
        self.partition = partition
        self.offset = offset


class _KafkaError:
    _PARTITION_EOF = -191


class _FakeMessage:
    def __init__(self, partition: int, offset: int, key: bytes, value: bytes) -> None:
        self._partition = partition
        self._offset = offset
        self._key = key
        self._value = value

    def error(self) -> None:
        return None

    def partition(self) -> int:
        return self._partition

    def offset(self) -> int:
        return self._offset

    def key(self) -> bytes:
        return self._key

    def value(self) -> bytes:
        return self._value


class _PartitionMetadata:
    def __init__(self) -> None:
        self.replicas = [0, 1, 2]


class _TopicMetadata:
    def __init__(self) -> None:
        self.partitions = {0: _PartitionMetadata()}


class _ClusterMetadata:
    def __init__(self, topics: list[str]) -> None:
        self.topics = {t: _TopicMetadata() for t in topics}


class _FakeConsumer:
    def __init__(self, module: _FakeKafkaModule, conf: dict[str, Any]) -> None:
        self._module = module
        self.conf = conf
        self.assigned: list[_TopicPartition] = []
        self._consumed = False

    def list_topics(self, topic: str | None = None, timeout: float = 0) -> _ClusterMetadata:
        if topic is not None:
            return _ClusterMetadata([topic] if topic in self._module.topic_names else [])
        return _ClusterMetadata(self._module.topic_names)

    def get_watermark_offsets(self, _tp: _TopicPartition, timeout: float = 0) -> tuple[int, int]:
        return (0, 100)

    def assign(self, tps: list[_TopicPartition]) -> None:
        self.assigned = tps
        self._module.last_assigned = tps

    def consume(self, num_messages: int, timeout: float = 0) -> list[_FakeMessage]:
        if self._consumed:
            return []
        self._consumed = True
        return self._module.messages[:num_messages]

    def close(self) -> None:
        pass


class _FakeAdmin:
    def __init__(self, conf: dict[str, Any]) -> None:
        self.conf = conf

    def describe_configs(self, resources: list[Any]) -> dict[Any, Any]:
        class _Entry:
            def __init__(self, value: str) -> None:
                self.value = value

        class _Future:
            def result(self, timeout: float = 0) -> dict[str, Any]:
                return {
                    "retention.ms": _Entry("604800000"),
                    "cleanup.policy": _Entry("delete"),
                }

        return {resource: _Future() for resource in resources}


class _ConfigResource:
    class Type:
        TOPIC = 2

    def __init__(self, _type: int, name: str) -> None:
        self.name = name


class _FakeKafkaModule:
    """Serves both confluent_kafka and confluent_kafka.admin require calls."""

    def __init__(self, topics: list[str], messages: list[_FakeMessage]) -> None:
        self.topic_names = topics
        self.messages = messages
        self.TopicPartition = _TopicPartition
        self.KafkaError = _KafkaError
        self.ConfigResource = _ConfigResource
        self.last_consumer_conf: dict[str, Any] | None = None
        self.last_assigned: list[_TopicPartition] = []

    def Consumer(self, conf: dict[str, Any]) -> _FakeConsumer:  # noqa: N802
        self.last_consumer_conf = conf
        return _FakeConsumer(self, conf)

    def AdminClient(self, conf: dict[str, Any]) -> _FakeAdmin:  # noqa: N802
        return _FakeAdmin(conf)


def _recipe(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "type": "KAFKA",
        "required": {"auth_mode": "NONE", "bootstrap_servers": "broker:9092"},
        "optional": {"connection": {"security_protocol": "PLAINTEXT"}},
        "sampling": {"strategy": "RANDOM", "rows_per_page": 10},
    }
    base.update(overrides)
    return base


def _messages(count: int) -> list[_FakeMessage]:
    return [_FakeMessage(0, i, f"k{i}".encode(), f"value-{i}".encode()) for i in range(count)]


@pytest.fixture
def _patch_kafka(monkeypatch: pytest.MonkeyPatch) -> _FakeKafkaModule:
    module = _FakeKafkaModule(["payments", "__consumer_offsets"], _messages(12))
    monkeypatch.setattr(
        "src.sources.kafka.source.require_module",
        lambda **_kwargs: module,
    )
    return module


def test_kafka_test_connection_success(_patch_kafka: _FakeKafkaModule) -> None:
    src = KafkaSource(_recipe())
    assert src.test_connection()["status"] == "SUCCESS"


def test_kafka_excludes_internal_topics_by_default(_patch_kafka: _FakeKafkaModule) -> None:
    src = KafkaSource(_recipe())
    assert src._list_topics() == ["payments"]


async def test_kafka_extract_emits_topic_assets(_patch_kafka: _FakeKafkaModule) -> None:
    src = KafkaSource(_recipe())
    assets = [a async for batch in src.extract_raw() for a in batch]
    assert len(assets) == 1
    asset = assets[0]
    assert asset.asset_kind == "topic"
    assert asset.name == "payments"
    meta = asset.metadata
    assert meta["partition_count"] == 1
    assert meta["replication_factor"] == 3
    assert meta["earliest_offset"] == 0
    assert meta["latest_offset"] == 100
    assert meta["retention_ms"] == 604800000
    assert meta["cleanup_policy"] == "delete"


async def test_kafka_fetch_content_samples_messages(_patch_kafka: _FakeKafkaModule) -> None:
    src = KafkaSource(_recipe(sampling={"strategy": "RANDOM", "rows_per_page": 10}))
    assets = [a async for batch in src.extract_raw() for a in batch]
    result = await src.fetch_content(assets[0].hash)
    assert result is not None
    _raw, text = result
    # capped at rows_per_page (10), even though 12 messages are available
    assert text.count("message_") == 10
    assert "value-0" in text


def test_kafka_sasl_credentials_wire_into_client_config(
    _patch_kafka: _FakeKafkaModule,
) -> None:
    src = KafkaSource(
        _recipe(
            required={"auth_mode": "SASL", "bootstrap_servers": "broker:9093"},
            masked={"sasl_username": "avnadmin", "sasl_password": "secret"},
            optional={"connection": {"security_protocol": "SASL_SSL", "sasl_mechanism": "PLAIN"}},
        )
    )
    conf = src._client_config()
    assert conf["bootstrap.servers"] == "broker:9093"
    assert conf["security.protocol"] == "SASL_SSL"
    assert conf["sasl.mechanism"] == "PLAIN"
    assert conf["sasl.username"] == "avnadmin"
    assert conf["sasl.password"] == "secret"
    assert "ssl.certificate.pem" not in conf


def test_kafka_client_cert_auth_wires_pem_config(_patch_kafka: _FakeKafkaModule) -> None:
    src = KafkaSource(
        _recipe(
            required={"auth_mode": "CLIENT_CERT", "bootstrap_servers": "broker:9094"},
            masked={"ssl_certfile": "fake-cert-pem", "ssl_keyfile": "fake-key-pem"},
            optional={"connection": {"security_protocol": "SSL", "ssl_ca": "fake-ca-pem"}},
        )
    )
    conf = src._client_config()
    assert conf["security.protocol"] == "SSL"
    assert conf["ssl.ca.pem"] == "fake-ca-pem"
    assert conf["ssl.certificate.pem"] == "fake-cert-pem"
    assert conf["ssl.key.pem"] == "fake-key-pem"
    assert "sasl.username" not in conf


def test_kafka_start_offsets_respect_sampling_strategy(
    _patch_kafka: _FakeKafkaModule,
) -> None:
    src = KafkaSource(_recipe())
    assert src._start_offset(SamplingStrategy.LATEST, 0, 100, 10) == 90
    assert src._start_offset(SamplingStrategy.AUTOMATIC, 5, 100, 10) == 5
    assert src._start_offset(SamplingStrategy.ALL, 5, 100, 10) == 5
    random_offset = src._start_offset(SamplingStrategy.RANDOM, 0, 100, 10)
    assert 0 <= random_offset <= 90


def test_kafka_latest_strategy_assigns_tail_offsets(_patch_kafka: _FakeKafkaModule) -> None:
    module = _patch_kafka
    src = KafkaSource(_recipe(sampling={"strategy": "LATEST", "rows_per_page": 10}))
    src._consume("payments", 10)
    assert len(module.last_assigned) == 1
    assert module.last_assigned[0].offset == 90
