"""Meilisearch source — discovers indexes and samples documents.

Uses plain REST calls (``requests``) — Meilisearch has no official heavyweight
Python client dependency worth pulling in for read-only discovery/search.
Auth is modeled as NONE or API_KEY only: Meilisearch has no native HTTP Basic
(username/password) authentication, just an optional master/API key sent as
``Authorization: Bearer <key>``.

Pagination mirrors the sampling-strategy conventions used across sources
(see ``search_engine_base.py`` / ``mongodb/source.py``): AUTOMATIC pages
forward via the generic ``BaseSource`` offset cursor; ALL streams the full
index in ``rows_per_page``-sized batches via ``offset``/``limit``, stopping
on the first underfilled page; RANDOM has no server-side equivalent in the
Meilisearch API, so a random offset within the index's document count is
chosen client-side; LATEST sorts by ``sampling.order_by_column`` when given
(only works if that attribute is configured as sortable in the index) and
falls back to default ranking order otherwise.
"""

from __future__ import annotations

import json
import logging
import random
from collections.abc import AsyncGenerator
from datetime import UTC, datetime
from typing import Any

import requests

from ...models.generated_input import MeilisearchInput, SamplingStrategy
from ...models.generated_single_asset_scan_results import (
    AssetType as OutputAssetType,
)
from ...models.generated_single_asset_scan_results import (
    SingleAssetScanResults,
)
from ..base import BaseSource

logger = logging.getLogger(__name__)


class MeilisearchSource(BaseSource):
    source_type = "meilisearch"

    INDEX_LIST_PAGE_SIZE = 100

    def __init__(
        self,
        recipe: dict[str, Any],
        source_id: str | None = None,
        runner_id: str | None = None,
    ) -> None:
        super().__init__(recipe, source_id, runner_id)
        self.config = MeilisearchInput.model_validate(recipe)
        self.runner_id = runner_id or "local-run"
        self._index_lookup: dict[str, str] = {}

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
        api_key = getattr(self.config.masked, "api_key", None)
        if api_key:
            session.headers["Authorization"] = f"Bearer {api_key}"
        connection = self._connection()
        verify_ssl = getattr(connection, "verify_ssl", None) if connection else None
        session.verify = True if verify_ssl is None else bool(verify_ssl)
        return session

    def _get(self, session: requests.Session, path: str, **params: Any) -> Any:
        url = f"{self._base_url()}{path}"
        response = session.get(url, params=params or None, timeout=self._request_timeout())
        response.raise_for_status()
        return response.json()

    def _post_search(self, index_uid: str, body: dict[str, Any]) -> dict[str, Any]:
        session = self._session()
        url = f"{self._base_url()}/indexes/{index_uid}/search"
        response = session.post(url, json=body, timeout=self._request_timeout())
        response.raise_for_status()
        return response.json()

    # ── Index discovery ──────────────────────────────────────────────────

    def _list_indices(self) -> list[dict[str, Any]]:
        session = self._session()
        scope = self._scope()
        include = {i.strip() for i in (getattr(scope, "include_indices", None) or []) if i.strip()}
        exclude = {i.strip() for i in (getattr(scope, "exclude_indices", None) or []) if i.strip()}
        limit = getattr(scope, "index_limit", None) if scope else None
        limit = int(limit) if limit else None

        selected: list[dict[str, Any]] = []
        offset = 0
        while True:
            data = self._get(
                session, "/indexes", offset=offset, limit=self.INDEX_LIST_PAGE_SIZE
            )
            results = data.get("results") or []
            if not results:
                break
            for row in results:
                uid = row.get("uid", "")
                if not uid:
                    continue
                if include and uid not in include:
                    continue
                if uid in exclude:
                    continue
                selected.append(row)
                if limit is not None and len(selected) >= limit:
                    return selected
            offset += len(results)
            total = data.get("total")
            if (total is not None and offset >= total) or len(results) < self.INDEX_LIST_PAGE_SIZE:
                break
        return selected

    def _index_stats(self, index_uid: str) -> dict[str, Any] | None:
        try:
            session = self._session()
            return self._get(session, f"/indexes/{index_uid}/stats")
        except Exception:
            return None

    def _document_count(self, index_uid: str) -> int | None:
        stats = self._index_stats(index_uid)
        if not stats:
            return None
        count = stats.get("numberOfDocuments")
        try:
            return int(count) if count is not None else None
        except (TypeError, ValueError):
            return None

    def _index_metadata(self, row: dict[str, Any]) -> dict[str, Any]:
        uid = row.get("uid", "")
        metadata: dict[str, Any] = {"index_name": uid}
        primary_key = row.get("primaryKey")
        if primary_key:
            metadata["primary_key"] = primary_key

        stats = self._index_stats(uid)
        if stats:
            doc_count = stats.get("numberOfDocuments")
            try:
                metadata["doc_count"] = int(doc_count) if doc_count is not None else 0
            except (TypeError, ValueError):
                metadata["doc_count"] = 0
            if "isIndexing" in stats:
                metadata["is_indexing"] = bool(stats["isIndexing"])
        else:
            metadata["doc_count"] = 0
        return metadata

    # ── Asset ────────────────────────────────────────────────────────────

    def _build_external_url(self, index_uid: str) -> str:
        return f"{self._base_url()}/indexes/{index_uid}"

    def _index_to_asset(self, row: dict[str, Any]) -> SingleAssetScanResults:
        metadata = self._index_metadata(row)
        index_uid = metadata["index_name"]
        asset_hash = self.generate_hash_id(index_uid)
        now = datetime.now(UTC)
        return SingleAssetScanResults(
            hash=asset_hash,
            checksum=self.calculate_checksum(metadata),
            name=index_uid,
            external_url=self._build_external_url(index_uid),
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
            self._index_lookup[asset.hash] = row.get("uid", "")
            batch.append(asset)
            if len(batch) >= self.BATCH_SIZE:
                yield batch
                batch = []
        if batch:
            yield batch

    # ── Document sampling ────────────────────────────────────────────────

    def _order_by_field(self) -> str | None:
        order = getattr(self.config.sampling, "order_by_column", None)
        return order.strip() if isinstance(order, str) and order.strip() else None

    def _sample_documents(self, index_uid: str, max_count: int) -> list[dict[str, Any]]:
        strategy = self.config.sampling.strategy

        if strategy == SamplingStrategy.AUTOMATIC:
            key = f"index:{index_uid}"
            offset = self.automatic_offset(key)
            data = self._post_search(index_uid, {"q": "", "offset": offset, "limit": max_count})
            hits = data.get("hits") or []
            self.record_automatic_offset(key, prev_offset=offset, fetched=len(hits))
            return hits

        if strategy == SamplingStrategy.RANDOM:
            total = self._document_count(index_uid) or 0
            max_offset = max(0, total - max_count)
            random_offset = random.randint(0, max_offset) if max_offset > 0 else 0
            data = self._post_search(
                index_uid, {"q": "", "offset": random_offset, "limit": max_count}
            )
            return data.get("hits") or []

        if strategy == SamplingStrategy.LATEST:
            order_field = self._order_by_field()
            if order_field:
                try:
                    data = self._post_search(
                        index_uid,
                        {"q": "", "limit": max_count, "sort": [f"{order_field}:desc"]},
                    )
                    return data.get("hits") or []
                except requests.exceptions.HTTPError:
                    logger.warning(
                        "Meilisearch sort by %r failed for index %s (not a sortable "
                        "attribute?); falling back to default ranking order",
                        order_field,
                        index_uid,
                    )
            data = self._post_search(index_uid, {"q": "", "limit": max_count})
            return data.get("hits") or []

        # ALL: bounded first page only; fetch_content_pages does the full scan.
        data = self._post_search(index_uid, {"q": "", "offset": 0, "limit": max_count})
        return data.get("hits") or []

    @staticmethod
    def _format_documents(
        index_uid: str, docs: list[dict[str, Any]], offset: int = 0
    ) -> tuple[str, str]:
        lines = [f"index={index_uid}", f"sampled_documents={len(docs)}", ""]
        for i, doc in enumerate(docs, start=1 + offset):
            lines.append(f"document_{i}:")
            for line in json.dumps(doc, ensure_ascii=False, indent=2).splitlines():
                lines.append(f"  {line}")
            lines.append("")
        raw = json.dumps(
            {"index": index_uid, "documents": docs, "offset": offset}, ensure_ascii=False
        )
        return raw, "\n".join(lines).rstrip()

    async def fetch_content(self, asset_id: str) -> tuple[str, str] | None:
        index_uid = self._index_lookup.get(asset_id)
        if index_uid is None:
            return None
        max_count = int(self.config.sampling.rows_per_page or 100)
        docs = self._sample_documents(index_uid, max_count)
        if not docs:
            return None
        return self._format_documents(index_uid, docs)

    async def fetch_content_pages(self, asset_id: str) -> AsyncGenerator[tuple[str, str], None]:
        index_uid = self._index_lookup.get(asset_id)
        if index_uid is None:
            return

        sampling = self.config.sampling
        max_count = int(sampling.rows_per_page or 100)

        if sampling.strategy != SamplingStrategy.ALL:
            docs = self._sample_documents(index_uid, max_count)
            for i, doc in enumerate(docs):
                yield self._format_documents(index_uid, [doc], offset=i)
            return

        total = self._document_count(index_uid)
        total_batches = ((total + max_count - 1) // max_count) if total else None
        if total is not None:
            logger.info(
                "Full scan %s: %d documents, %s batches of %d",
                index_uid,
                total,
                total_batches,
                max_count,
            )

        offset = 0
        page_num = 1
        while not self._aborted:
            if total_batches is not None:
                logger.debug("%s batch %d/%d", index_uid, page_num, total_batches)
            data = self._post_search(index_uid, {"q": "", "offset": offset, "limit": max_count})
            docs = data.get("hits") or []
            if not docs:
                break
            for i, doc in enumerate(docs):
                yield self._format_documents(index_uid, [doc], offset=offset + i)
            if len(docs) < max_count:
                break
            offset += len(docs)
            page_num += 1

    # ── Plumbing ─────────────────────────────────────────────────────────

    def generate_hash_id(self, asset_id: str) -> str:
        from ...utils.hashing import hash_id

        return hash_id(self.source_type, asset_id)

    def test_connection(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "timestamp": datetime.now(UTC).isoformat(),
            "source_type": self.recipe.get("type"),
        }
        try:
            session = self._session()
            health = self._get(session, "/health")
            status = health.get("status", "unknown")
            result["status"] = "SUCCESS"
            result["message"] = f"Successfully connected to Meilisearch. Status: {status}."
        except Exception as exc:
            result["status"] = "FAILURE"
            result["message"] = f"Failed to connect to Meilisearch: {exc}"
        return result

    def abort(self) -> None:
        logger.info("Aborting Meilisearch extraction...")
        self._aborted = True
