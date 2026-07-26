from __future__ import annotations

import base64
import json
from typing import Any

import pytest

from src.models.generated_input import SamplingStrategy
from src.sources.kafka.source import KafkaSource

CURSOR_ENV = "CLASSIFYRE_SAMPLING_CURSOR"


def _encode_cursor(cursor: dict[str, Any]) -> str:
    return base64.b64encode(json.dumps(cursor).encode()).decode()


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
        self._assigned_offsets: dict[int, int] = {}
        self._pointer = 0

    def list_topics(self, topic: str | None = None, timeout: float = 0) -> _ClusterMetadata:
        if topic is not None:
            return _ClusterMetadata([topic] if topic in self._module.topic_names else [])
        return _ClusterMetadata(self._module.topic_names)

    def get_watermark_offsets(self, tp: _TopicPartition, timeout: float = 0) -> tuple[int, int]:
        return self._module.watermarks.get((tp.topic, tp.partition), (0, 100))

    def assign(self, tps: list[_TopicPartition]) -> None:
        self.assigned = tps
        self._module.last_assigned = tps
        self._assigned_offsets = {tp.partition: tp.offset for tp in tps}

    def consume(self, num_messages: int, timeout: float = 0) -> list[_FakeMessage]:
        assigned_partitions = set(self._assigned_offsets)
        available = [
            m
            for m in self._module.messages
            if m.partition() in assigned_partitions
            and m.offset() >= self._assigned_offsets[m.partition()]
        ]
        batch = available[self._pointer : self._pointer + num_messages]
        self._pointer += len(batch)
        return batch

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
        # Optional per-(topic, partition) watermark override; defaults to (0, 100).
        self.watermarks: dict[tuple[str, int], tuple[int, int]] = {}

    def Consumer(self, conf: dict[str, Any]) -> _FakeConsumer:  # noqa: N802
        self.last_consumer_conf = conf
        return _FakeConsumer(self, conf)

    def AdminClient(self, conf: dict[str, Any]) -> _FakeAdmin:  # noqa: N802
        return _FakeAdmin(conf)


def _recipe(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "type": "KAFKA",
        "required": {"auth_mode": "NONE", "host": "broker", "port": 9092},
        "optional": {"connection": {"security_protocol": "PLAINTEXT"}},
        "sampling": {"strategy": "RANDOM", "rows_per_page": 10},
    }
    base.update(overrides)
    return base


def _messages(count: int, *, start: int = 0, partition: int = 0) -> list[_FakeMessage]:
    return [
        _FakeMessage(partition, start + i, f"k{start + i}".encode(), f"value-{start + i}".encode())
        for i in range(count)
    ]


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


async def test_kafka_fetch_content_samples_messages(
    _patch_kafka: _FakeKafkaModule, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Keep the random start offset within the range of fake messages available (0-11),
    # and pin it deterministically so the sampled window is known.
    _patch_kafka.watermarks[("payments", 0)] = (0, 12)
    monkeypatch.setattr("src.sources.kafka.source.random.randint", lambda _a, _b: 0)
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
            required={"auth_mode": "SASL", "host": "broker", "port": 9093},
            masked={
                "sasl_username": "avnadmin",
                "sasl_password": "secret",
                "ssl_ca": "fake-ca-pem",
            },
            optional={"connection": {"security_protocol": "SASL_SSL", "sasl_mechanism": "PLAIN"}},
        )
    )
    conf = src._client_config()
    assert conf["bootstrap.servers"] == "broker:9093"
    assert conf["security.protocol"] == "SASL_SSL"
    assert conf["sasl.mechanism"] == "PLAIN"
    assert conf["sasl.username"] == "avnadmin"
    assert conf["sasl.password"] == "secret"
    # The CA travels with the credentials, not in unmasked connection options.
    assert conf["ssl.ca.pem"] == "fake-ca-pem"
    assert "ssl.certificate.pem" not in conf


def test_kafka_client_cert_auth_wires_pem_config(_patch_kafka: _FakeKafkaModule) -> None:
    src = KafkaSource(
        _recipe(
            required={"auth_mode": "CLIENT_CERT", "host": "broker", "port": 9094},
            masked={
                "ssl_certfile": "fake-cert-pem",
                "ssl_keyfile": "fake-key-pem",
                "ssl_ca": "fake-ca-pem",
            },
            optional={"connection": {"security_protocol": "SSL"}},
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


# ── AUTOMATIC sampling ───────────────────────────────────────────────────


def test_kafka_automatic_first_run_starts_at_low_and_records_cursor(
    _patch_kafka: _FakeKafkaModule, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv(CURSOR_ENV, raising=False)
    module = _patch_kafka
    module.watermarks[("payments", 0)] = (0, 100)
    module.messages = _messages(12, start=0)

    src = KafkaSource(_recipe(sampling={"strategy": "AUTOMATIC", "rows_per_page": 10}))
    out = src._consume("payments", 5)

    assert module.last_assigned[0].offset == 0  # first run: start at low
    assert [m["offset"] for m in out] == [0, 1, 2, 3, 4]
    # advanced past the highest offset consumed
    assert src.current_sampling_cursor() == {"payments:0": 5}


def test_kafka_automatic_second_run_resumes_from_saved_cursor(
    _patch_kafka: _FakeKafkaModule, monkeypatch: pytest.MonkeyPatch
) -> None:
    module = _patch_kafka
    module.watermarks[("payments", 0)] = (0, 100)
    module.messages = _messages(12, start=0)
    monkeypatch.setenv(CURSOR_ENV, _encode_cursor({"payments:0": 5}))

    src = KafkaSource(_recipe(sampling={"strategy": "AUTOMATIC", "rows_per_page": 10}))
    out = src._consume("payments", 5)

    assert module.last_assigned[0].offset == 5
    assert [m["offset"] for m in out] == [5, 6, 7, 8, 9]
    assert src.current_sampling_cursor() == {"payments:0": 10}


def test_kafka_automatic_wraps_to_low_when_caught_up(
    _patch_kafka: _FakeKafkaModule, monkeypatch: pytest.MonkeyPatch
) -> None:
    module = _patch_kafka
    module.watermarks[("payments", 0)] = (0, 10)
    # Only two messages left before the high watermark.
    module.messages = _messages(2, start=8)
    monkeypatch.setenv(CURSOR_ENV, _encode_cursor({"payments:0": 8}))

    src = KafkaSource(_recipe(sampling={"strategy": "AUTOMATIC", "rows_per_page": 10}))
    out = src._consume("payments", 5)

    assert module.last_assigned[0].offset == 8
    assert [m["offset"] for m in out] == [8, 9]
    # 9 + 1 == 10 == high watermark → wraps back to low (0) for the next run
    assert src.current_sampling_cursor() == {"payments:0": 0}


def test_kafka_automatic_stale_cursor_below_low_clamps_to_low(
    _patch_kafka: _FakeKafkaModule, monkeypatch: pytest.MonkeyPatch
) -> None:
    module = _patch_kafka
    # Retention has advanced: earliest retained offset is now 20.
    module.watermarks[("payments", 0)] = (20, 100)
    module.messages = _messages(5, start=20)
    monkeypatch.setenv(CURSOR_ENV, _encode_cursor({"payments:0": 5}))

    src = KafkaSource(_recipe(sampling={"strategy": "AUTOMATIC", "rows_per_page": 10}))
    out = src._consume("payments", 5)

    assert module.last_assigned[0].offset == 20  # clamped up to low, not the stale 5
    assert [m["offset"] for m in out] == [20, 21, 22, 23, 24]
    assert src.current_sampling_cursor() == {"payments:0": 25}


# ── REST Proxy transport ─────────────────────────────────────────────────


class _FakeRestResponse:
    def __init__(self, payload: Any, status: int = 200) -> None:
        self._payload = payload
        self.status_code = status
        self.content = b"" if payload is None else b"{}"

    def raise_for_status(self) -> None:
        pass

    def json(self) -> Any:
        return self._payload


@pytest.fixture
def _patch_rest(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    """Serve the REST Proxy v2 endpoints the connector uses."""
    calls: dict[str, Any] = {"requests": [], "records_cursor": 0}
    records = [
        {
            "partition": 0,
            "offset": i,
            "key": base64.b64encode(f"k{i}".encode()).decode(),
            "value": base64.b64encode(f"value-{i}".encode()).decode(),
        }
        for i in range(12)
    ]

    def fake_request(self: Any, method: str, url: str, **kwargs: Any) -> _FakeRestResponse:
        calls["requests"].append((method, url, kwargs.get("json")))
        calls["auth"] = self.auth
        if url.endswith("/topics"):
            return _FakeRestResponse(["payments", "__consumer_offsets"])
        if url.endswith("/topics/payments"):
            return _FakeRestResponse(
                {
                    "name": "payments",
                    "configs": {"retention.ms": "604800000", "cleanup.policy": "delete"},
                    "partitions": [{"partition": 0, "replicas": [{}, {}, {}]}],
                }
            )
        if url.endswith("/topics/payments/partitions"):
            return _FakeRestResponse([{"partition": 0, "replicas": [{}, {}, {}]}])
        if url.endswith("/partitions/0/offsets"):
            return _FakeRestResponse({"beginning_offset": 0, "end_offset": 12})
        if "/records" in url:
            start = calls["records_cursor"]
            calls["records_cursor"] = len(records)
            return _FakeRestResponse(records[start:] if start < len(records) else [])
        if method == "DELETE":
            calls["deleted_instance"] = url
            return _FakeRestResponse(None)
        if url.endswith("/consumers/classifyre-scan-local-run"):
            return _FakeRestResponse(
                {"instance_id": "inst-1", "base_uri": "http://internal:8082/x"}
            )
        # assignments / positions
        return _FakeRestResponse(None)

    monkeypatch.setattr("requests.Session.request", fake_request)
    return calls


def _rest_recipe(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "type": "KAFKA",
        "required": {"auth_mode": "REST", "host": "kafka-rest.example.com", "port": 8082},
        "masked": {"username": "user", "password": "secret"},
        "sampling": {"strategy": "ALL", "rows_per_page": 10},
    }
    base.update(overrides)
    return base


def test_kafka_rest_needs_no_confluent_kafka(
    _patch_rest: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    def _explode(**_kwargs: Any) -> Any:
        raise AssertionError("REST transport must not require confluent-kafka")

    monkeypatch.setattr("src.sources.kafka.source.require_module", _explode)
    src = KafkaSource(_rest_recipe())
    assert src.is_rest is True
    assert src.test_connection()["status"] == "SUCCESS"


async def test_kafka_rest_extract_emits_topic_assets(_patch_rest: dict[str, Any]) -> None:
    src = KafkaSource(_rest_recipe())
    assets = [a async for batch in src.extract_raw() for a in batch]

    assert [a.name for a in assets] == ["payments"]
    asset = assets[0]
    assert asset.asset_type == "TABLE"
    assert asset.external_url == "https://kafka-rest.example.com:8082/topics/payments"
    assert asset.metadata["partition_count"] == 1
    assert asset.metadata["replication_factor"] == 3
    assert asset.metadata["retention_ms"] == 604800000
    assert asset.metadata["latest_offset"] == 12
    assert _patch_rest["auth"] == ("user", "secret")


async def test_kafka_rest_fetch_content_decodes_records(_patch_rest: dict[str, Any]) -> None:
    src = KafkaSource(_rest_recipe())
    assets = [a async for batch in src.extract_raw() for a in batch]
    result = await src.fetch_content(assets[0].hash)

    assert result is not None
    _raw, text = result
    # capped at rows_per_page (10) even though 12 records are available
    assert text.count("message_") == 10
    assert "value-0" in text  # base64 payloads are decoded to text
    # The consumer instance is always cleaned up.
    assert _patch_rest["deleted_instance"].endswith("/instances/inst-1")


def test_kafka_rest_automatic_positions_from_saved_cursor(
    _patch_rest: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv(CURSOR_ENV, _encode_cursor({"payments:0": 5}))
    src = KafkaSource(_rest_recipe(sampling={"strategy": "AUTOMATIC", "rows_per_page": 10}))
    src._consume("payments", 10)

    positions = [
        body for method, url, body in _patch_rest["requests"] if url.endswith("/positions")
    ]
    assert positions == [{"offsets": [{"topic": "payments", "partition": 0, "offset": 5}]}]


def test_kafka_rest_plain_http_when_tls_disabled(_patch_rest: dict[str, Any]) -> None:
    src = KafkaSource(_rest_recipe(optional={"connection": {"rest_use_tls": False}}))
    assert src._rest_base_url() == "http://kafka-rest.example.com:8082"


# ── Security protocol resolution ─────────────────────────────────────────


def test_kafka_sasl_forces_a_sasl_security_protocol(_patch_kafka: _FakeKafkaModule) -> None:
    """SASL credentials over a non-SASL protocol fail with an opaque transport
    error, so the auth mode wins over the override."""
    src = KafkaSource(
        _recipe(
            required={"auth_mode": "SASL", "host": "broker", "port": 9093},
            masked={"sasl_username": "u", "sasl_password": "p"},
            optional={"connection": {"security_protocol": "SSL", "sasl_mechanism": "PLAIN"}},
        )
    )
    conf = src._client_config()
    assert conf["security.protocol"] == "SASL_SSL"
    assert conf["sasl.mechanism"] == "PLAIN"


def test_kafka_sasl_defaults_to_sasl_ssl_without_an_override(
    _patch_kafka: _FakeKafkaModule,
) -> None:
    src = KafkaSource(
        _recipe(
            required={"auth_mode": "SASL", "host": "broker", "port": 9093},
            masked={"sasl_username": "u", "sasl_password": "p"},
            optional={},
        )
    )
    assert src._client_config()["security.protocol"] == "SASL_SSL"


def test_kafka_sasl_plaintext_override_is_honoured(_patch_kafka: _FakeKafkaModule) -> None:
    src = KafkaSource(
        _recipe(
            required={"auth_mode": "SASL", "host": "broker", "port": 9093},
            masked={"sasl_username": "u", "sasl_password": "p"},
            optional={"connection": {"security_protocol": "SASL_PLAINTEXT"}},
        )
    )
    assert src._client_config()["security.protocol"] == "SASL_PLAINTEXT"


def test_kafka_plaintext_override_upgrades_to_sasl_plaintext(
    _patch_kafka: _FakeKafkaModule,
) -> None:
    src = KafkaSource(
        _recipe(
            required={"auth_mode": "SASL", "host": "broker", "port": 9093},
            masked={"sasl_username": "u", "sasl_password": "p"},
            optional={"connection": {"security_protocol": "PLAINTEXT"}},
        )
    )
    assert src._client_config()["security.protocol"] == "SASL_PLAINTEXT"


def test_kafka_client_cert_always_uses_ssl(_patch_kafka: _FakeKafkaModule) -> None:
    src = KafkaSource(
        _recipe(
            required={"auth_mode": "CLIENT_CERT", "host": "broker", "port": 9094},
            masked={"ssl_certfile": "cert", "ssl_keyfile": "key"},
            optional={"connection": {"security_protocol": "PLAINTEXT"}},
        )
    )
    conf = src._client_config()
    assert conf["security.protocol"] == "SSL"
    assert "sasl.mechanism" not in conf


def test_kafka_no_auth_defaults_to_plaintext(_patch_kafka: _FakeKafkaModule) -> None:
    src = KafkaSource(
        _recipe(required={"auth_mode": "NONE", "host": "broker", "port": 9092}, optional={})
    )
    assert src._client_config()["security.protocol"] == "PLAINTEXT"
