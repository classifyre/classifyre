"""Shared REST logic for Elasticsearch and OpenSearch sources.

Both engines expose the same read-only REST surface for index discovery and
document sampling (``_cat/indices``, ``_search``, ``_cluster/health``), so this
mixin implements the connector once; ``ElasticsearchSource``/``OpenSearchSource``
are thin subclasses that only set ``source_type``, ``ENGINE_LABEL``, and which
generated Input model to validate against. Uses plain ``requests`` (already a
CLI dependency) rather than the ``elasticsearch-py``/``opensearch-py`` client
SDKs, matching the pattern used by every other REST-based source (WordPress,
Tableau, Notion, Kafka).
"""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncGenerator
from datetime import UTC, datetime
from typing import Any

import requests

from ..models.generated_input import (
    APIKeyBearerToken1,
    BasicUsernamePassword1,
    SamplingStrategy,
)
from ..models.generated_single_asset_scan_results import (
    AssetType as OutputAssetType,
)
from ..models.generated_single_asset_scan_results import (
    SingleAssetScanResults,
)

logger = logging.getLogger(__name__)


class SearchEngineSourceMixin:
    """Mixin providing index discovery + document sampling over the REST API.

    Concrete sources mix this in ahead of ``BaseSource`` and must set
    ``self.config`` (an ``ElasticsearchInput``/``OpenSearchInput``) and the
    class attribute ``ENGINE_LABEL`` before use.
    """

    ENGINE_LABEL: str = "search engine"

    # ── Config accessors ─────────────────────────────────────────────────

    def _base_url(self) -> str:
        return str(self.config.required.url).rstrip("/")

    def _connection(self) -> Any:
        optional = self.config.optional
        return optional.connection if optional is not None else None

    def _scope(self) -> Any:
        optional = self.config.optional
        return optional.scope if optional is not None else None

    def _request_timeout(self) -> float:
        connection = self._connection()
        timeout = getattr(connection, "request_timeout_seconds", None) if connection else None
        return float(timeout) if timeout else 30.0

    def _session(self) -> requests.Session:
        session = requests.Session()
        masked = self.config.masked
        if isinstance(masked, BasicUsernamePassword1):
            session.auth = (masked.username, masked.password)
        elif isinstance(masked, APIKeyBearerToken1):
            session.headers["Authorization"] = f"ApiKey {masked.api_key}"
        connection = self._connection()
        verify_ssl = getattr(connection, "verify_ssl", None) if connection else None
        session.verify = True if verify_ssl is None else bool(verify_ssl)
        return session

    def _get(self, session: requests.Session, path: str, **params: Any) -> Any:
        url = f"{self._base_url()}{path}"
        response = session.get(url, params=params or None, timeout=self._request_timeout())
        response.raise_for_status()
        return response.json()

    # ── Index discovery ──────────────────────────────────────────────────

    def _list_indices(self) -> list[dict[str, Any]]:
        session = self._session()
        rows = self._get(session, "/_cat/indices", format="json", bytes="b")
        scope = self._scope()
        include_system = bool(getattr(scope, "include_system_indices", False)) if scope else False
        include = {i.strip() for i in (getattr(scope, "include_indices", None) or []) if i.strip()}
        exclude = {i.strip() for i in (getattr(scope, "exclude_indices", None) or []) if i.strip()}
        limit = getattr(scope, "index_limit", None) if scope else None
        limit = int(limit) if limit else None

        selected: list[dict[str, Any]] = []
        for row in rows or []:
            name = row.get("index", "")
            if not name:
                continue
            if not include_system and name.startswith("."):
                continue
            if include and name not in include:
                continue
            if name in exclude:
                continue
            selected.append(row)
            if limit is not None and len(selected) >= limit:
                break
        return selected

    @staticmethod
    def _index_metadata(row: dict[str, Any]) -> dict[str, Any]:
        metadata: dict[str, Any] = {"index_name": row.get("index", "")}
        health = row.get("health")
        if health:
            metadata["health"] = health
        doc_count = row.get("docs.count")
        try:
            metadata["doc_count"] = int(doc_count) if doc_count not in (None, "") else 0
        except (TypeError, ValueError):
            metadata["doc_count"] = 0
        size_bytes = row.get("store.size")
        if size_bytes not in (None, ""):
            try:
                metadata["store_size_bytes"] = int(size_bytes)
            except (TypeError, ValueError):
                pass
        primary_shards = row.get("pri")
        if primary_shards not in (None, ""):
            try:
                metadata["primary_shards"] = int(primary_shards)
            except (TypeError, ValueError):
                pass
        replica_shards = row.get("rep")
        if replica_shards not in (None, ""):
            try:
                metadata["replica_shards"] = int(replica_shards)
            except (TypeError, ValueError):
                pass
        return metadata

    # ── Asset ────────────────────────────────────────────────────────────

    def _build_external_url(self, index_name: str) -> str:
        return f"{self._base_url()}/{index_name}"

    def _index_to_asset(self, row: dict[str, Any]) -> SingleAssetScanResults:
        metadata = self._index_metadata(row)
        index_name = metadata["index_name"]
        asset_hash = self.generate_hash_id(index_name)
        now = datetime.now(UTC)
        return SingleAssetScanResults(
            hash=asset_hash,
            checksum=self.calculate_checksum(metadata),
            name=index_name,
            external_url=self._build_external_url(index_name),
            links=[],
            asset_type=OutputAssetType.OTHER,
            source_id=self.source_id,
            created_at=now,
            updated_at=now,
            runner_id=self.runner_id,
            **self.metadata_fields("index", metadata),
        )

    async def extract_raw(self) -> AsyncGenerator[list[SingleAssetScanResults], None]:
        if self._aborted:
            return
        batch: list[SingleAssetScanResults] = []
        for row in self._list_indices():
            if self._aborted:
                return
            asset = self._index_to_asset(row)
            self._index_lookup[asset.hash] = row.get("index", "")
            batch.append(asset)
            if len(batch) >= self.BATCH_SIZE:
                yield batch
                batch = []
        if batch:
            yield batch

    # ── Document sampling ────────────────────────────────────────────────
    #
    # Strategy handling mirrors MongoDB's per-collection document sampling
    # (``mongodb/source.py:_sample_collection_documents``): AUTOMATIC pages
    # forward through the index each run using the generic offset cursor
    # helpers on ``BaseSource`` (keyed per index, wraps to 0 once a page
    # underfills); RANDOM uses a real random query rather than natural order;
    # LATEST sorts by ``order_by_column`` when given, else falls back to
    # reverse index order (no generic timestamp field is knowable ahead of
    # time); ALL is only ever fetched one bounded page at a time here —
    # ``fetch_content_pages`` does the true unbounded, batched full scan.

    def _execute_search(self, index_name: str, body: dict[str, Any]) -> list[dict[str, Any]]:
        session = self._session()
        url = f"{self._base_url()}/{index_name}/_search"
        response = session.post(url, json=body, timeout=self._request_timeout())
        response.raise_for_status()
        data = response.json()
        hits = ((data.get("hits") or {}).get("hits")) or []
        return [hit.get("_source", {}) for hit in hits]

    def _count_documents(self, index_name: str) -> int | None:
        try:
            session = self._session()
            data = self._get(session, f"/{index_name}/_count")
            return int(data.get("count"))
        except Exception:
            return None

    def _order_by_field(self) -> str | None:
        order = getattr(self.config.sampling, "order_by_column", None)
        return order.strip() if isinstance(order, str) and order.strip() else None

    def _latest_sort(self) -> list[dict[str, Any]]:
        order_field = self._order_by_field()
        if order_field:
            return [{order_field: {"order": "desc", "unmapped_type": "date"}}]
        # Best-effort recency: no generic timestamp field is known ahead of
        # time, so fall back to reverse insertion/doc order.
        return [{"_doc": "desc"}]

    def _sample_documents(self, index_name: str, max_count: int) -> list[dict[str, Any]]:
        strategy = self.config.sampling.strategy

        if strategy == SamplingStrategy.AUTOMATIC:
            key = f"index:{index_name}"
            offset = self.automatic_offset(key)
            docs = self._execute_search(
                index_name, {"size": max_count, "from": offset, "sort": [{"_doc": "asc"}]}
            )
            self.record_automatic_offset(key, prev_offset=offset, fetched=len(docs))
            return docs

        if strategy == SamplingStrategy.RANDOM:
            body = {
                "size": max_count,
                "query": {"function_score": {"query": {"match_all": {}}, "random_score": {}}},
            }
            return self._execute_search(index_name, body)

        if strategy == SamplingStrategy.LATEST:
            return self._execute_search(index_name, {"size": max_count, "sort": self._latest_sort()})

        # ALL: bounded first page only; fetch_content_pages does the full scan.
        return self._execute_search(
            index_name, {"size": max_count, "from": 0, "sort": [{"_doc": "asc"}]}
        )

    @staticmethod
    def _format_documents(
        index_name: str, docs: list[dict[str, Any]], offset: int = 0
    ) -> tuple[str, str]:
        lines = [f"index={index_name}", f"sampled_documents={len(docs)}", ""]
        for i, doc in enumerate(docs, start=1 + offset):
            lines.append(f"document_{i}:")
            for line in json.dumps(doc, ensure_ascii=False, indent=2).splitlines():
                lines.append(f"  {line}")
            lines.append("")
        raw = json.dumps(
            {"index": index_name, "documents": docs, "offset": offset}, ensure_ascii=False
        )
        return raw, "\n".join(lines).rstrip()

    async def fetch_content(self, asset_id: str) -> tuple[str, str] | None:
        index_name = self._index_lookup.get(asset_id)
        if index_name is None:
            return None
        max_count = int(self.config.sampling.rows_per_page or 100)
        docs = self._sample_documents(index_name, max_count)
        if not docs:
            return None
        return self._format_documents(index_name, docs)

    async def fetch_content_pages(self, asset_id: str) -> AsyncGenerator[tuple[str, str], None]:
        index_name = self._index_lookup.get(asset_id)
        if index_name is None:
            return

        sampling = self.config.sampling
        max_count = int(sampling.rows_per_page or 100)

        if sampling.strategy != SamplingStrategy.ALL:
            docs = self._sample_documents(index_name, max_count)
            for i, doc in enumerate(docs):
                yield self._format_documents(index_name, [doc], offset=i)
            return

        total = self._count_documents(index_name)
        total_batches = ((total + max_count - 1) // max_count) if total else None
        if total is not None:
            logger.info(
                "Full scan %s: %d documents, %s batches of %d",
                index_name,
                total,
                total_batches,
                max_count,
            )

        offset = 0
        page_num = 1
        while not self._aborted:
            if total_batches is not None:
                logger.debug("%s batch %d/%d", index_name, page_num, total_batches)
            docs = self._execute_search(
                index_name, {"size": max_count, "from": offset, "sort": [{"_doc": "asc"}]}
            )
            if not docs:
                break
            for i, doc in enumerate(docs):
                yield self._format_documents(index_name, [doc], offset=offset + i)
            if len(docs) < max_count:
                break
            offset += len(docs)
            page_num += 1

    # ── Plumbing ─────────────────────────────────────────────────────────

    def generate_hash_id(self, asset_id: str) -> str:
        from ..utils.hashing import hash_id

        return hash_id(self.source_type, asset_id)

    def test_connection(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "timestamp": datetime.now(UTC).isoformat(),
            "source_type": self.recipe.get("type"),
        }
        try:
            session = self._session()
            health = self._get(session, "/_cluster/health")
            status = health.get("status", "unknown")
            result["status"] = "SUCCESS"
            result["message"] = (
                f"Successfully connected to {self.ENGINE_LABEL}. Cluster status: {status}."
            )
        except Exception as exc:
            result["status"] = "FAILURE"
            result["message"] = f"Failed to connect to {self.ENGINE_LABEL}: {exc}"
        return result

    def abort(self) -> None:
        logger.info("Aborting %s extraction...", self.ENGINE_LABEL)
        self._aborted = True
