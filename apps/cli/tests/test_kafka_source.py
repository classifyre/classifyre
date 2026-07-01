from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import pytest

from src.sources.kafka.source import KafkaSource

# ── kafka-python fakes ───────────────────────────────────────────────────


@dataclass(frozen=True)
class _TopicPartition:
    topic: str
    partition: int


class _FakeMessage:
    def __init__(self, partition: int, offset: int, key: bytes, value: bytes) -> None:
        self.partition = partition
        self.offset = offset
        self.key = key
        self.value = value


class _FakeConsumer:
    def __init__(self, topics: list[str], messages: list[_FakeMessage], **_kwargs: Any) -> None:
        self._topics = topics
        self._messages = messages

    def topics(self) -> set[str]:
        return set(self._topics)

    def partitions_for_topic(self, _topic: str) -> set[int]:
        return {0}

    def assign(self, _tps: list[_TopicPartition]) -> None:
        pass

    def seek(self, _tp: _TopicPartition, _offset: int) -> None:
        pass

    def seek_to_beginning(self, *_tps: _TopicPartition) -> None:
        pass

    def beginning_offsets(self, tps: list[_TopicPartition]) -> dict[_TopicPartition, int]:
        return dict.fromkeys(tps, 0)

    def end_offsets(self, tps: list[_TopicPartition]) -> dict[_TopicPartition, int]:
        return dict.fromkeys(tps, 100)

    def __iter__(self) -> Any:
        return iter(self._messages)

    def close(self) -> None:
        pass


class _FakeAdmin:
    def describe_topics(self, _topics: list[str]) -> list[dict[str, Any]]:
        return [{"partitions": [{"replicas": [0, 1, 2]}]}]

    def describe_configs(self, _resources: list[Any]) -> list[Any]:
        return []

    def close(self) -> None:
        pass


class _FakeKafkaModule:
    def __init__(self, topics: list[str], messages: list[_FakeMessage]) -> None:
        self._topics = topics
        self._messages = messages
        self.TopicPartition = _TopicPartition

    def KafkaConsumer(self, **kwargs: Any) -> _FakeConsumer:  # noqa: N802
        return _FakeConsumer(self._topics, self._messages, **kwargs)

    def KafkaAdminClient(self, **_kwargs: Any) -> _FakeAdmin:  # noqa: N802
        return _FakeAdmin()


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


async def test_kafka_fetch_content_samples_messages(_patch_kafka: _FakeKafkaModule) -> None:
    src = KafkaSource(_recipe(sampling={"strategy": "RANDOM", "rows_per_page": 10}))
    assets = [a async for batch in src.extract_raw() for a in batch]
    result = await src.fetch_content(assets[0].hash)
    assert result is not None
    _raw, text = result
    # capped at rows_per_page (10), even though 12 messages are available
    assert text.count("message_") == 10
    assert "value-0" in text


def _self_signed_cert_and_key() -> tuple[str, str]:
    import datetime

    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = issuer = x509.Name(
        [x509.NameAttribute(NameOID.COMMON_NAME, "kafka-test-client")]
    )
    now = datetime.datetime.now(datetime.UTC)
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now)
        .not_valid_after(now + datetime.timedelta(days=1))
        .sign(key, hashes.SHA256())
    )
    cert_pem = cert.public_bytes(serialization.Encoding.PEM).decode()
    key_pem = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode()
    return cert_pem, key_pem


def test_kafka_sasl_credentials_wire_into_client_kwargs(
    _patch_kafka: _FakeKafkaModule,
) -> None:
    src = KafkaSource(
        _recipe(
            required={"auth_mode": "SASL", "bootstrap_servers": "broker:9093"},
            masked={"sasl_username": "avnadmin", "sasl_password": "secret"},
            optional={
                "connection": {"security_protocol": "SASL_SSL", "sasl_mechanism": "PLAIN"}
            },
        )
    )
    kwargs = src._client_kwargs()
    assert kwargs["security_protocol"] == "SASL_SSL"
    assert kwargs["sasl_mechanism"] == "PLAIN"
    assert kwargs["sasl_plain_username"] == "avnadmin"
    assert kwargs["sasl_plain_password"] == "secret"
    assert "ssl_context" not in kwargs


def test_kafka_client_cert_auth_builds_ssl_context(_patch_kafka: _FakeKafkaModule) -> None:
    cert_pem, key_pem = _self_signed_cert_and_key()
    src = KafkaSource(
        _recipe(
            required={"auth_mode": "CLIENT_CERT", "bootstrap_servers": "broker:9094"},
            masked={"ssl_certfile": cert_pem, "ssl_keyfile": key_pem},
            optional={"connection": {"security_protocol": "SSL", "ssl_ca": cert_pem}},
        )
    )
    kwargs = src._client_kwargs()
    assert kwargs["security_protocol"] == "SSL"
    assert "ssl_context" in kwargs
    assert "sasl_plain_username" not in kwargs
