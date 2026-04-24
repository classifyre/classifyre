from __future__ import annotations

import json
import logging
from collections.abc import AsyncGenerator
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from ...models.generated_input import (
    MongoDBInput,
    MongoDBMaskedNone,
    MongoDBMaskedUsernamePassword,
    MongoDBOptionalConnection,
    MongoDBOptionalScope,
    MongoDBRequiredAtlas,
    SamplingConfig,
    SamplingStrategy,
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
from ..dependencies import require_module

logger = logging.getLogger(__name__)

_DEFAULT_EXCLUDED_DATABASES = {"admin", "config", "local"}


@dataclass(frozen=True)
class CollectionRef:
    database: str
    collection: str


class MongoDBSource(BaseSource):
    source_type = "mongodb"

    def __init__(
        self,
        recipe: dict[str, Any],
        source_id: str | None = None,
        runner_id: str | None = None,
    ) -> None:
        super().__init__(recipe, source_id, runner_id)
        self.config = MongoDBInput.model_validate(recipe)
        self.runner_id = runner_id or "local-run"
        self._pymongo = require_module(
            module_name="pymongo",
            source_name="MongoDB",
            uv_groups=["mongodb"],
            detail="The MongoDB connector is optional.",
        )
        self._collection_lookup: dict[str, CollectionRef] = {}
        self._content_cache: dict[str, tuple[str, str]] = {}
        self._mongo_client: Any | None = None

    def _asset_type_value(self) -> str:
        type_value = self.config.type
        return type_value.value if hasattr(type_value, "value") else str(type_value)

    def _sampling(self) -> SamplingConfig:
        return self.config.sampling

    def _connection_options(self) -> MongoDBOptionalConnection:
        if self.config.optional and self.config.optional.connection:
            return self.config.optional.connection
        return MongoDBOptionalConnection()

    def _scope_options(self) -> MongoDBOptionalScope:
        if self.config.optional and self.config.optional.scope:
            return self.config.optional.scope
        return MongoDBOptionalScope()

    def _username_password(self) -> tuple[str | None, str | None]:
        masked = self.config.masked
        if isinstance(masked, MongoDBMaskedUsernamePassword):
            return masked.username, masked.password
        if isinstance(masked, MongoDBMaskedNone):
            return None, None
        return None, None

    def _atlas_cluster_host(self) -> str:
        required = self.config.required
        if not isinstance(required, MongoDBRequiredAtlas):
            return ""

        cleaned = required.cluster_host.strip()
        for prefix in ("mongodb+srv://", "mongodb://"):
            if cleaned.startswith(prefix):
                cleaned = cleaned[len(prefix) :]

        if "@" in cleaned:
            cleaned = cleaned.split("@", maxsplit=1)[-1]
        if "/" in cleaned:
            cleaned = cleaned.split("/", maxsplit=1)[0]
        return cleaned

    def _is_atlas(self) -> bool:
        return isinstance(self.config.required, MongoDBRequiredAtlas)

    def _build_connection_uri(self) -> str:
        required = self.config.required
        if isinstance(required, MongoDBRequiredAtlas):
            return f"mongodb+srv://{self._atlas_cluster_host()}"
        return f"mongodb://{required.host}:{int(required.port)}"

    def _build_client_kwargs(self) -> dict[str, Any]:
        options = self._connection_options()
        username, password = self._username_password()

        kwargs: dict[str, Any] = {
            "connectTimeoutMS": int(options.connect_timeout_ms or 30000),
        }
        if username:
            kwargs["username"] = username
        if password:
            kwargs["password"] = password

        if options.auth_mechanism and str(options.auth_mechanism) != "DEFAULT":
            mechanism = (
                options.auth_mechanism.value
                if hasattr(options.auth_mechanism, "value")
                else str(options.auth_mechanism)
            )
            kwargs["authMechanism"] = mechanism
        if options.auth_source:
            kwargs["authSource"] = options.auth_source
        if options.app_name:
            kwargs["appname"] = options.app_name
        if options.tls is not None:
            kwargs["tls"] = bool(options.tls)
        if options.replica_set:
            kwargs["replicaSet"] = options.replica_set
        if options.direct_connection is not None:
            kwargs["directConnection"] = bool(options.direct_connection)

        additional = options.options or {}
        if isinstance(additional, dict):
            kwargs.update(additional)
        return kwargs

    def _client(self) -> Any:
        if self._mongo_client is not None:
            return self._mongo_client

        client = self._pymongo.MongoClient(
            self._build_connection_uri(),
            **self._build_client_kwargs(),
        )
        self._mongo_client = client
        return client

    def _excluded_databases(self) -> set[str]:
        configured = self._scope_options().exclude_databases or []
        excluded = {name.strip() for name in configured if name and name.strip()}
        if not excluded:
            excluded = set(_DEFAULT_EXCLUDED_DATABASES)
        return excluded

    def _collection_allowlist(self) -> set[str]:
        configured = self._scope_options().include_collections or []
        return {entry.strip().lower() for entry in configured if entry and entry.strip()}

    def _collection_denylist(self) -> set[str]:
        configured = self._scope_options().exclude_collections or []
        return {entry.strip().lower() for entry in configured if entry and entry.strip()}

    def _include_system_collections(self) -> bool:
        return bool(self._scope_options().include_system_collections)

    def _resolve_databases(self) -> list[str]:
        scope_options = self._scope_options()
        include_all = scope_options.include_all_databases is not False
        configured_database = scope_options.database

        if not include_all:
            if configured_database:
                return [configured_database]
            raise ValueError(
                "MongoDB source requires optional.scope.database when include_all_databases is false. "
                "Set optional.scope.database (e.g. 'app_db') or enable include_all_databases."
            )

        excluded = self._excluded_databases()
        discovered = [
            database
            for database in self._client().list_database_names()
            if isinstance(database, str) and database and database not in excluded
        ]
        discovered.sort()

        if configured_database and configured_database not in discovered:
            discovered.insert(0, configured_database)
        return discovered

    def _collection_allowed(self, database: str, collection: str) -> bool:
        if not self._include_system_collections() and collection.startswith("system."):
            return False

        normalized_collection = collection.lower()
        normalized_scoped = f"{database}.{collection}".lower()

        allowlist = self._collection_allowlist()
        if (
            allowlist
            and normalized_collection not in allowlist
            and normalized_scoped not in allowlist
        ):
            return False

        denylist = self._collection_denylist()
        if normalized_collection in denylist or normalized_scoped in denylist:
            return False

        return True

    def _list_collections_for_database(self, database: str) -> list[CollectionRef]:
        collection_limit = self._scope_options().collection_limit
        limit = int(collection_limit) if collection_limit else None

        collections: list[CollectionRef] = []
        for collection in self._client()[database].list_collection_names():
            if not isinstance(collection, str) or not collection:
                continue
            if not self._collection_allowed(database, collection):
                continue

            collections.append(CollectionRef(database=database, collection=collection))
            if limit is not None and len(collections) >= limit:
                break

        return collections

    def _iter_collections(self) -> list[CollectionRef]:
        collections: list[CollectionRef] = []
        for database in self._resolve_databases():
            if self._aborted:
                break
            try:
                collections.extend(self._list_collections_for_database(database))
            except Exception as exc:
                logger.warning("Skipping database %s due to listing error: %s", database, exc)
        return collections

    def test_connection(self) -> dict[str, Any]:
        logger.info("Testing connection to MongoDB...")
        result = {
            "timestamp": datetime.now(UTC).isoformat(),
            "source_type": self.recipe.get("type"),
        }

        try:
            self._client().admin.command("ping")
            databases = self._resolve_databases()
            result["status"] = "SUCCESS"
            deployment = "Atlas" if self._is_atlas() else "On-prem"
            result["message"] = (
                f"Successfully connected to MongoDB ({deployment}). "
                f"Reachable databases: {len(databases)}."
            )
        except Exception as exc:
            result["status"] = "FAILURE"
            result["message"] = f"Failed to connect to MongoDB: {exc}"

        return result

    def _collection_raw_id(self, collection_ref: CollectionRef) -> str:
        return f"{collection_ref.database}_#_{collection_ref.collection}"

    def _collection_to_asset(self, collection_ref: CollectionRef) -> SingleAssetScanResults:
        asset_name = f"{collection_ref.database}.{collection_ref.collection}"
        raw_id = self._collection_raw_id(collection_ref)
        asset_hash = self.generate_hash_id(raw_id)
        external_url = self.ensure_location(
            self._collection_external_url(collection_ref),
            fallback=f"mongodb://{asset_name}",
        )

        metadata = {
            "database": collection_ref.database,
            "collection": collection_ref.collection,
            "deployment": "ATLAS" if self._is_atlas() else "ON_PREM",
            "sampling": {
                "strategy": str(self._sampling().strategy),
            },
        }
        now = datetime.now(UTC)

        return SingleAssetScanResults(
            hash=asset_hash,
            checksum=self.calculate_checksum(metadata),
            name=asset_name,
            external_url=external_url,
            links=[],
            asset_type=OutputAssetType.TXT,
            source_id=self.source_id,
            created_at=now,
            updated_at=now,
            runner_id=self.runner_id,
        )

    def _collection_external_url(self, collection_ref: CollectionRef) -> str:
        if self._is_atlas():
            return (
                f"mongodb+srv://{self._atlas_cluster_host()}/"
                f"{collection_ref.database}/{collection_ref.collection}"
            )

        required = self.config.required
        return (
            f"mongodb://{required.host}:{int(required.port)}/"
            f"{collection_ref.database}/{collection_ref.collection}"
        )

    async def extract(self) -> AsyncGenerator[list[SingleAssetScanResults], None]:
        if self._aborted:
            return

        pipeline = None
        if self.config.detectors and any(detector.enabled for detector in self.config.detectors):
            from ...pipeline.detector_pipeline import DetectorPipeline

            pipeline = DetectorPipeline.from_recipe(self.recipe, self, self.runner_id)

        batch: list[SingleAssetScanResults] = []
        for collection_ref in self._iter_collections():
            if self._aborted:
                return

            asset = self._collection_to_asset(collection_ref)
            self._collection_lookup[asset.hash] = collection_ref
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

    def generate_hash_id(self, asset_id: str) -> str:
        return hash_id(self._asset_type_value(), asset_id)

    def _parse_collection_ref(self, asset_id: str) -> CollectionRef | None:
        if asset_id in self._collection_lookup:
            return self._collection_lookup[asset_id]

        decoded = asset_id
        if "_#_" not in decoded:
            try:
                decoded = unhash_id(asset_id)
            except Exception:
                decoded = asset_id

        parts = decoded.split("_#_")
        if len(parts) >= 3 and parts[0].upper() == "MONGODB":
            return CollectionRef(database=parts[-2], collection=parts[-1])
        if len(parts) >= 2:
            return CollectionRef(database=parts[-2], collection=parts[-1])
        return None

    def _latest_order_field(self) -> str:
        sampling = self._sampling()
        if sampling.order_by_column:
            return sampling.order_by_column
        return "_id"

    def _sample_random_documents(self, collection: Any, limit: int) -> list[dict[str, Any]]:
        pipeline = [{"$sample": {"size": limit}}]
        return list(collection.aggregate(pipeline, allowDiskUse=True))

    def _count_collection_documents(self, collection_ref: CollectionRef) -> int | None:
        try:
            collection = self._client()[collection_ref.database][collection_ref.collection]
            return int(collection.count_documents({}))
        except Exception:
            return None

    def _sample_collection_documents(self, collection_ref: CollectionRef) -> list[dict[str, Any]]:
        collection = self._client()[collection_ref.database][collection_ref.collection]
        sampling = self._sampling()
        strategy = sampling.strategy
        rows_per_page = int(sampling.rows_per_page or 100)

        if strategy == SamplingStrategy.ALL:
            return list(collection.find({}).limit(rows_per_page))

        if strategy == SamplingStrategy.RANDOM:
            return self._sample_random_documents(collection, rows_per_page)

        order_field = self._latest_order_field()
        if order_field != "_id":
            try:
                has_field = (
                    collection.count_documents({order_field: {"$exists": True}}, limit=1) > 0
                )
            except Exception:
                has_field = True
            if not has_field and sampling.fallback_to_random is not False:
                return self._sample_random_documents(collection, rows_per_page)

        return list(
            collection.find({}).sort(order_field, self._pymongo.DESCENDING).limit(rows_per_page)
        )

    def _serialize_document(self, document: dict[str, Any]) -> str:
        return json.dumps(document, ensure_ascii=False, default=str, sort_keys=True)

    def _format_collection_content(
        self,
        collection_ref: CollectionRef,
        documents: list[dict[str, Any]],
    ) -> tuple[str, str]:
        sampling = self._sampling()

        strategy = sampling.strategy
        lines = [
            f"collection={collection_ref.database}.{collection_ref.collection}",
            f"sampling_strategy={strategy}",
            f"sampled_documents={len(documents)}",
            "",
        ]

        serialized_documents: list[str] = []
        for index, document in enumerate(documents, start=1):
            serialized = self._serialize_document(document)
            serialized_documents.append(serialized)
            lines.append(f"doc_{index}: {serialized}")

        text_content = "\n".join(lines)
        raw_content = json.dumps(
            {
                "database": collection_ref.database,
                "collection": collection_ref.collection,
                "strategy": str(strategy),
                "documents": serialized_documents,
            },
            ensure_ascii=False,
        )
        return raw_content, text_content

    async def fetch_content(self, asset_id: str) -> tuple[str, str] | None:
        cached = self._content_cache.get(asset_id)
        if cached:
            return cached

        collection_ref = self._parse_collection_ref(asset_id)
        if not collection_ref:
            return None

        documents = self._sample_collection_documents(collection_ref)
        content = self._format_collection_content(collection_ref, documents)

        self._content_cache[asset_id] = content
        return content

    async def fetch_content_pages(self, asset_id: str) -> AsyncGenerator[tuple[str, str], None]:
        sampling = self._sampling()

        if sampling.strategy != SamplingStrategy.ALL:
            result = await self.fetch_content(asset_id)
            if result:
                yield result
            return

        collection_ref = self._parse_collection_ref(asset_id)
        if not collection_ref:
            return

        rows_per_page = int(sampling.rows_per_page or 100)
        collection_label = f"{collection_ref.database}.{collection_ref.collection}"

        total_docs = self._count_collection_documents(collection_ref)
        total_batches = ((total_docs + rows_per_page - 1) // rows_per_page) if total_docs else None
        if total_docs is not None and total_batches is not None:
            logger.info(
                "Full scan %s: %d documents, %d batches of %d",
                collection_label,
                total_docs,
                total_batches,
                rows_per_page,
            )

        collection = self._client()[collection_ref.database][collection_ref.collection]
        offset = 0
        page_num = 1

        while not self._aborted:
            if total_batches is not None:
                logger.info("%s batch %d/%d", collection_label, page_num, total_batches)

            documents = list(collection.find({}).skip(offset).limit(rows_per_page))
            if not documents:
                break

            content = self._format_collection_content(collection_ref, documents)
            self._content_cache[asset_id] = content
            yield content

            offset += rows_per_page
            page_num += 1
            if len(documents) < rows_per_page:
                break

    def enrich_finding_location(
        self,
        finding: DetectionResult,
        asset: SingleAssetScanResults,
        text_content: str,
    ) -> None:
        import re as _re

        collection_ref = self._collection_lookup.get(asset.hash)
        if not collection_ref:
            return

        doc_index: int | None = None
        for line in text_content.splitlines():
            match = _re.match(r"^doc_(\d+):", line)
            if match and finding.matched_content in line:
                doc_index = int(match.group(1))
                break

        path = f"{collection_ref.database}.{collection_ref.collection}"
        if doc_index is not None:
            path += f", document {doc_index}"

        finding.location = Location(path=path)

    def abort(self) -> None:
        logger.info("Aborting MongoDB extraction...")
        super().abort()

    def cleanup(self) -> None:
        if self._mongo_client is not None:
            try:
                self._mongo_client.close()
            except Exception:
                logger.debug("Failed to close MongoDB client cleanly", exc_info=True)
            finally:
                self._mongo_client = None
