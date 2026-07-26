"""Kafka REST Proxy transport for the Kafka source.

Talks to a Confluent REST Proxy / Karapace deployment over its v2 HTTP API
using ``requests`` (already a CLI dependency), so a REST-only Kafka source
needs neither broker protocol access nor the ``confluent-kafka`` wheel.

Only the read-only surface the connector needs is implemented: topic listing,
partition metadata/watermarks, and offset-positioned consumption through a
short-lived consumer instance that is always deleted afterwards.
"""

from __future__ import annotations

import base64
import binascii
import logging
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import requests

logger = logging.getLogger(__name__)

_V2_JSON = "application/vnd.kafka.v2+json"
_V2_BINARY = "application/vnd.kafka.binary.v2+json"


class KafkaRestClient:
    """Read-only client for the Kafka REST Proxy v2 API."""

    def __init__(
        self,
        *,
        base_url: str,
        username: str | None = None,
        password: str | None = None,
        timeout_seconds: float = 30.0,
        group_id: str = "classifyre-scan",
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout_seconds
        self.group_id = group_id
        self._session = requests.Session()
        if username and password:
            self._session.auth = (username, password)

    # ── HTTP plumbing ────────────────────────────────────────────────────

    def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        url = path if path.startswith("http") else f"{self.base_url}{path}"
        headers = {"Accept": _V2_JSON, **kwargs.pop("headers", {})}
        if kwargs.get("json") is not None:
            headers.setdefault("Content-Type", _V2_JSON)
        response = self._session.request(
            method, url, headers=headers, timeout=self.timeout, **kwargs
        )
        response.raise_for_status()
        if not response.content:
            return None
        return response.json()

    # ── Topic discovery / metadata ───────────────────────────────────────

    def list_topics(self) -> list[str]:
        topics = self._request("GET", "/topics")
        return [str(t) for t in topics or []]

    def topic_metadata(self, topic: str) -> dict[str, Any]:
        """Partition count, replication factor, and retention for a topic."""
        meta: dict[str, Any] = {}
        try:
            described = self._request("GET", f"/topics/{topic}") or {}
        except Exception as exc:
            logger.debug("REST topic describe failed for %s: %s", topic, exc)
            described = {}

        partitions = described.get("partitions") or []
        if not partitions:
            try:
                partitions = self._request("GET", f"/topics/{topic}/partitions") or []
            except Exception as exc:
                logger.debug("REST partition list failed for %s: %s", topic, exc)
                partitions = []
        meta["partition_count"] = len(partitions)
        replicas = [len(p.get("replicas") or []) for p in partitions if isinstance(p, dict)]
        if replicas:
            meta["replication_factor"] = min(replicas)

        configs = described.get("configs") or {}
        retention = configs.get("retention.ms")
        if retention not in (None, ""):
            try:
                meta["retention_ms"] = int(retention)
            except (TypeError, ValueError):
                pass
        cleanup_policy = configs.get("cleanup.policy")
        if cleanup_policy:
            meta["cleanup_policy"] = str(cleanup_policy)
        return meta

    def partition_ids(self, topic: str) -> list[int]:
        try:
            partitions = self._request("GET", f"/topics/{topic}/partitions") or []
        except Exception as exc:
            logger.debug("REST partition list failed for %s: %s", topic, exc)
            return []
        ids: list[int] = []
        for partition in partitions:
            if isinstance(partition, dict) and partition.get("partition") is not None:
                ids.append(int(partition["partition"]))
        return sorted(ids)

    def watermarks(self, topic: str, partition: int) -> tuple[int, int] | None:
        """Return ``(low, high)`` offsets, or ``None`` if unavailable."""
        try:
            data = self._request("GET", f"/topics/{topic}/partitions/{partition}/offsets") or {}
        except Exception as exc:
            logger.debug("REST watermark lookup failed for %s[%s]: %s", topic, partition, exc)
            return None
        low = data.get("beginning_offset")
        high = data.get("end_offset")
        if low is None or high is None:
            return None
        return int(low), int(high)

    # ── Consumption ──────────────────────────────────────────────────────

    @contextmanager
    def _consumer_instance(self) -> Iterator[str]:
        """Create a consumer instance, yield its URI, and always delete it."""
        instance_name = f"{self.group_id}-{uuid.uuid4().hex[:12]}"
        created = self._request(
            "POST",
            f"/consumers/{self.group_id}",
            json={
                "name": instance_name,
                "format": "binary",
                "auto.offset.reset": "earliest",
                "auto.commit.enable": "false",
            },
        )
        instance_id = (created or {}).get("instance_id", instance_name)
        # Build the instance URI from the configured base rather than the
        # proxy-reported base_uri, which often carries an internal hostname
        # that is not resolvable from here.
        instance_uri = f"{self.base_url}/consumers/{self.group_id}/instances/{instance_id}"
        try:
            yield instance_uri
        finally:
            try:
                self._request("DELETE", instance_uri)
            except Exception as exc:
                logger.debug("Deleting REST consumer instance failed: %s", exc)

    @staticmethod
    def _decode(value: Any) -> str:
        """Decode a base64 record field (``format=binary``) to text."""
        if value is None:
            return "null"
        if isinstance(value, str):
            try:
                raw = base64.b64decode(value, validate=True)
            except (binascii.Error, ValueError):
                return value
            try:
                return raw.decode("utf-8")
            except UnicodeDecodeError:
                return f"<{len(raw)} bytes>"
        return str(value)

    def consume(
        self,
        topic: str,
        starts: dict[int, int],
        max_count: int,
        *,
        poll_timeout_ms: int = 5000,
    ) -> list[dict[str, Any]]:
        """Read up to ``max_count`` records from the given partition offsets."""
        if not starts:
            return []
        out: list[dict[str, Any]] = []
        with self._consumer_instance() as instance_uri:
            self._request(
                "POST",
                f"{instance_uri}/assignments",
                json={
                    "partitions": [
                        {"topic": topic, "partition": partition} for partition in sorted(starts)
                    ]
                },
            )
            self._request(
                "POST",
                f"{instance_uri}/positions",
                json={
                    "offsets": [
                        {"topic": topic, "partition": partition, "offset": offset}
                        for partition, offset in sorted(starts.items())
                    ]
                },
            )
            while len(out) < max_count:
                records = self._request(
                    "GET",
                    f"{instance_uri}/records",
                    params={"timeout": poll_timeout_ms},
                    headers={"Accept": _V2_BINARY},
                )
                if not records:
                    break
                for record in records:
                    out.append(
                        {
                            "partition": int(record.get("partition", 0)),
                            "offset": int(record.get("offset", 0)),
                            "key": self._decode(record.get("key")),
                            "value": self._decode(record.get("value")),
                        }
                    )
                    if len(out) >= max_count:
                        break
        return out

    def close(self) -> None:
        self._session.close()
