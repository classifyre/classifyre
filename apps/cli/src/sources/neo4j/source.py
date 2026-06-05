from __future__ import annotations

import json
import logging
from collections.abc import AsyncGenerator, Iterator
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from ...models.generated_input import (
    Neo4jInput,
    Neo4jMaskedNone,
    Neo4jMaskedUsernamePassword,
    Neo4jOptionalConnection,
    Neo4jOptionalScope,
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

_DEFAULT_EXCLUDED_LABELS = {
    "_Bloom_Perspective_",
    "_Bloom_Scene_",
    "__Neo4jMigration",
}

# Maximum relationship targets to query per label (avoids unbounded DISTINCT scans)
_RELATIONSHIP_SCAN_LIMIT = 1000


@dataclass(frozen=True)
class LabelRef:
    label: str
    database: str


def _escape_label(label: str) -> str:
    """Backtick-escape a Neo4j label identifier."""
    return f"`{label.replace('`', '``')}`"


class Neo4jSource(BaseSource):
    source_type = "neo4j"
    STREAM_DETECTIONS = True
    CONTENT_BATCH_SIZE = 500

    def __init__(
        self,
        recipe: dict[str, Any],
        source_id: str | None = None,
        runner_id: str | None = None,
    ) -> None:
        super().__init__(recipe, source_id, runner_id)
        self.config = Neo4jInput.model_validate(recipe)
        self.runner_id = runner_id or "local-run"

        self._neo4j = require_module(
            module_name="neo4j",
            source_name="Neo4j",
            uv_groups=["neo4j"],
            detail="The Neo4j connector is optional.",
        )

        self._label_lookup: dict[str, LabelRef] = {}
        self._content_cache: dict[str, tuple[str, str]] = {}
        self._driver_instance: Any | None = None

    def _asset_type_value(self) -> str:
        type_value = self.config.type
        return type_value.value if hasattr(type_value, "value") else str(type_value)

    def _sampling(self) -> SamplingConfig:
        return self.config.sampling

    def _connection_options(self) -> Neo4jOptionalConnection:
        if self.config.optional and self.config.optional.connection:
            return self.config.optional.connection
        return Neo4jOptionalConnection()

    def _scope_options(self) -> Neo4jOptionalScope:
        if self.config.optional and self.config.optional.scope:
            return self.config.optional.scope
        return Neo4jOptionalScope()

    def _uri(self) -> str:
        return str(self.config.required.uri).strip()

    def _database(self) -> str:
        db = self.config.required.database
        return str(db).strip() if db else "neo4j"

    def _auth(self) -> Any:
        masked = self.config.masked
        if isinstance(masked, Neo4jMaskedUsernamePassword):
            return self._neo4j.basic_auth(masked.username, masked.password)
        if isinstance(masked, Neo4jMaskedNone):
            return None
        return None

    def _driver(self) -> Any:
        if self._driver_instance is not None:
            return self._driver_instance

        options = self._connection_options()
        kwargs: dict[str, Any] = {
            "connection_timeout": int(options.connection_timeout_ms or 30000) / 1000.0,
            "max_connection_pool_size": int(options.max_connection_pool_size or 10),
        }

        if options.encrypted is not None:
            kwargs["encrypted"] = bool(options.encrypted)

        if options.trust_strategy is not None:
            strategy = str(options.trust_strategy)
            if strategy == "TRUST_ALL_CERTIFICATES":
                kwargs["trust"] = self._neo4j.TRUST_ALL_CERTIFICATES
            else:
                kwargs["trust"] = self._neo4j.TRUST_SYSTEM_CA_SIGNED_CERTIFICATES

        auth = self._auth()
        self._driver_instance = self._neo4j.GraphDatabase.driver(self._uri(), auth=auth, **kwargs)
        return self._driver_instance

    def _session(self, **kwargs: Any) -> Any:
        db = self._database()
        return self._driver().session(database=db, **kwargs)

    def _label_allowlist(self) -> set[str]:
        configured = self._scope_options().include_labels or []
        return {entry.strip() for entry in configured if entry and entry.strip()}

    def _label_denylist(self) -> set[str]:
        configured = self._scope_options().exclude_labels or []
        denylist = {entry.strip() for entry in configured if entry and entry.strip()}
        if not denylist:
            denylist = set(_DEFAULT_EXCLUDED_LABELS)
        return denylist

    def _label_allowed(self, label: str) -> bool:
        denylist = self._label_denylist()
        if label in denylist:
            return False

        allowlist = self._label_allowlist()
        if allowlist and label not in allowlist:
            return False

        return True

    def _discover_labels(self) -> list[LabelRef]:
        limit = self._scope_options().node_limit_per_label
        max_labels = int(limit) if limit else None

        with self._session() as session:
            result = session.run("CALL db.labels() YIELD label RETURN label ORDER BY label")
            labels: list[LabelRef] = []
            for record in result:
                label = record["label"]
                if not isinstance(label, str) or not label:
                    continue
                if not self._label_allowed(label):
                    continue
                labels.append(LabelRef(label=label, database=self._database()))
                if max_labels is not None and len(labels) >= max_labels:
                    break

        logger.info("Discovered %d node label(s) in database '%s'", len(labels), self._database())
        return labels

    def _resolve_relationship_links(
        self,
        ref: LabelRef,
        label_hash_map: dict[str, str],
    ) -> list[str]:
        """Return hashes of related labels reachable from this label via any relationship."""
        cypher = (
            f"MATCH ({_escape_label(ref.label)})-[r]->(b) "
            f"WITH DISTINCT labels(b) AS bl UNWIND bl AS target_label "
            f"RETURN DISTINCT target_label LIMIT {_RELATIONSHIP_SCAN_LIMIT}"
        )
        linked_hashes: list[str] = []
        try:
            with self._session() as session:
                result = session.run(cypher)
                for record in result:
                    target = record["target_label"]
                    if isinstance(target, str) and target in label_hash_map:
                        linked_hashes.append(label_hash_map[target])
        except Exception as exc:
            logger.warning("Could not resolve relationships for label '%s': %s", ref.label, exc)

        return sorted(set(linked_hashes))

    def _label_raw_id(self, ref: LabelRef) -> str:
        return f"{ref.database}_#_{ref.label}"

    def _label_to_asset(self, ref: LabelRef, links: list[str]) -> SingleAssetScanResults:
        raw_id = self._label_raw_id(ref)
        asset_hash = self.generate_hash_id(raw_id)
        external_url = self.ensure_location(
            f"{self._uri()}/{ref.database}/{ref.label}",
            fallback=f"neo4j://{ref.database}/{ref.label}",
        )

        metadata = {
            "label": ref.label,
            "database": ref.database,
            "uri": self._uri(),
            "sampling": {"strategy": str(self._sampling().strategy)},
        }
        now = datetime.now(UTC)

        asset_metadata: dict[str, Any] = {"label": ref.label, "database": ref.database}
        node_count, property_keys = self._label_stats(ref)
        if node_count is not None:
            asset_metadata["node_count"] = node_count
        if property_keys:
            asset_metadata["sample_property_keys"] = property_keys

        return SingleAssetScanResults(
            hash=asset_hash,
            checksum=self.calculate_checksum(metadata),
            name=f"{ref.database}:{ref.label}",
            external_url=external_url,
            links=links,
            asset_type=OutputAssetType.TXT,
            source_id=self.source_id,
            created_at=now,
            updated_at=now,
            runner_id=self.runner_id,
            **self.metadata_fields("label", asset_metadata),
        )

    def _label_stats(self, ref: LabelRef) -> tuple[int | None, list[str]]:
        """Best-effort node count + sampled property keys for a label (cheap)."""
        node_count: int | None = None
        keys: list[str] = []
        label = _escape_label(ref.label)
        try:
            with self._session() as session:
                record = session.run(f"MATCH (n:{label}) RETURN count(n) AS c").single()
                if record is not None and record["c"] is not None:
                    node_count = int(record["c"])
                rows = session.run(
                    f"MATCH (n:{label}) WITH n LIMIT 100 "
                    "UNWIND keys(n) AS k RETURN DISTINCT k AS k LIMIT 50"
                )
                keys = [row["k"] for row in rows if isinstance(row["k"], str)]
        except Exception as exc:
            logger.debug("Could not read stats for label %s: %s", ref.label, exc)
        return node_count, keys

    def test_connection(self) -> dict[str, Any]:
        logger.info("Testing connection to Neo4j at %s...", self._uri())
        result: dict[str, Any] = {
            "timestamp": datetime.now(UTC).isoformat(),
            "source_type": self.recipe.get("type"),
        }

        try:
            self._driver().verify_connectivity()
            labels = self._discover_labels()
            result["status"] = "SUCCESS"
            result["message"] = (
                f"Successfully connected to Neo4j at {self._uri()} "
                f"(database='{self._database()}'). "
                f"Reachable node labels: {len(labels)}."
            )
        except Exception as exc:
            result["status"] = "FAILURE"
            result["message"] = f"Failed to connect to Neo4j: {exc}"

        return result

    STREAM_DETECTIONS = True

    async def extract_raw(self) -> AsyncGenerator[list[SingleAssetScanResults], None]:
        if self._aborted:
            return

        logger.info("Starting Neo4j extraction: discovering node labels...")
        labels = self._discover_labels()

        # Build hash map for relationship link resolution
        label_hash_map: dict[str, str] = {
            ref.label: self.generate_hash_id(self._label_raw_id(ref)) for ref in labels
        }

        include_rels = self._scope_options().include_relationships is not False

        batch: list[SingleAssetScanResults] = []
        total = len(labels)

        for i, ref in enumerate(labels, 1):
            if self._aborted:
                return

            logger.info("Processing label %d/%d: %s", i, total, ref.label)

            links: list[str] = []
            if include_rels:
                links = self._resolve_relationship_links(ref, label_hash_map)
                if links:
                    logger.debug("Label '%s' has %d relationship link(s)", ref.label, len(links))

            asset = self._label_to_asset(ref, links)
            self._label_lookup[asset.hash] = ref
            batch.append(asset)

            if len(batch) >= self.BATCH_SIZE:
                logger.info("Emitting batch of %d label asset(s) (total so far: %d)", len(batch), i)
                yield batch
                batch = []

        if batch:
            logger.info("Emitting final batch of %d asset(s)", len(batch))
            yield batch

        logger.info("Extraction complete: %d node label(s) emitted", total)

    def generate_hash_id(self, asset_id: str) -> str:
        return hash_id(self._asset_type_value(), asset_id)

    def _parse_label_ref(self, asset_id: str) -> LabelRef | None:
        if asset_id in self._label_lookup:
            return self._label_lookup[asset_id]

        decoded = asset_id
        if "_#_" not in decoded:
            try:
                decoded = unhash_id(asset_id)
            except Exception:
                decoded = asset_id

        parts = decoded.split("_#_")
        if len(parts) >= 2:
            return LabelRef(database=parts[-2], label=parts[-1])
        return None

    def _fetch_nodes_page(self, ref: LabelRef, skip: int, limit: int) -> list[dict[str, Any]]:
        cypher = f"MATCH (n:{_escape_label(ref.label)}) RETURN n SKIP {skip} LIMIT {limit}"
        nodes: list[dict[str, Any]] = []
        with self._session() as session:
            result = session.run(cypher)
            for record in result:
                node = record["n"]
                props = dict(node) if node is not None else {}
                nodes.append(props)
        return nodes

    def _fetch_all_nodes_batched(self, ref: LabelRef) -> Iterator[list[dict[str, Any]]]:
        sampling = self._sampling()
        batch_size = int(sampling.rows_per_page or self.CONTENT_BATCH_SIZE)
        label_name = f"{ref.database}:{ref.label}"

        offset = 0
        batch_num = 0

        while not self._aborted:
            batch_num += 1
            nodes = self._fetch_nodes_page(ref, skip=offset, limit=batch_size)
            logger.debug(
                "Content batch %d: fetched %d nodes from %s (offset=%d)",
                batch_num,
                len(nodes),
                label_name,
                offset,
            )
            if not nodes:
                break
            yield nodes
            offset += len(nodes)
            if len(nodes) < batch_size:
                break

        logger.info("Fetched nodes from %s in %d content batch(es)", label_name, batch_num)

    def _fetch_sample_nodes(self, ref: LabelRef) -> list[dict[str, Any]]:
        sampling = self._sampling()
        strategy = sampling.strategy
        rows = int(sampling.rows_per_page or 100)

        if strategy == SamplingStrategy.RANDOM:
            cypher = (
                f"MATCH (n:{_escape_label(ref.label)}) "
                f"WITH n, rand() AS r ORDER BY r LIMIT {rows} RETURN n"
            )
        elif strategy == SamplingStrategy.LATEST:
            order_col = sampling.order_by_column
            if order_col:
                cypher = (
                    f"MATCH (n:{_escape_label(ref.label)}) "
                    f"WHERE n.{order_col} IS NOT NULL "
                    f"RETURN n ORDER BY n.{order_col} DESC LIMIT {rows}"
                )
            else:
                # Fallback: ID-ordered (stable and often insertion-ordered)
                cypher = (
                    f"MATCH (n:{_escape_label(ref.label)}) "
                    f"RETURN n ORDER BY id(n) DESC LIMIT {rows}"
                )
        else:
            # ALL — first page only for fetch_content; full pagination via fetch_content_pages
            batch_size = int(sampling.rows_per_page or self.CONTENT_BATCH_SIZE)
            return self._fetch_nodes_page(ref, skip=0, limit=batch_size)

        nodes: list[dict[str, Any]] = []
        with self._session() as session:
            result = session.run(cypher)
            for record in result:
                node = record["n"]
                props = dict(node) if node is not None else {}
                nodes.append(props)
        return nodes

    def _serialize_node(self, props: dict[str, Any]) -> str:
        return json.dumps(props, ensure_ascii=False, default=str, sort_keys=True)

    def _format_label_content(
        self,
        ref: LabelRef,
        nodes: list[dict[str, Any]],
        node_offset: int = 0,
    ) -> tuple[str, str]:
        sampling = self._sampling()
        strategy = sampling.strategy
        lines = [
            f"label={ref.database}:{ref.label}",
            f"sampling_strategy={strategy}",
            f"sampled_nodes={len(nodes)}",
            "",
        ]

        serialized_nodes: list[str] = []
        for index, props in enumerate(nodes, start=1 + node_offset):
            serialized = self._serialize_node(props)
            serialized_nodes.append(serialized)
            lines.append(f"node_{index}: {serialized}")

        text_content = "\n".join(lines)
        raw_content = json.dumps(
            {
                "database": ref.database,
                "label": ref.label,
                "strategy": str(strategy),
                "nodes": serialized_nodes,
                "node_offset": node_offset,
            },
            ensure_ascii=False,
        )
        return raw_content, text_content

    async def fetch_content(self, asset_id: str) -> tuple[str, str] | None:
        cached = self._content_cache.get(asset_id)
        if cached:
            return cached

        ref = self._parse_label_ref(asset_id)
        if not ref:
            return None

        nodes = self._fetch_sample_nodes(ref)
        content = self._format_label_content(ref, nodes)
        self._content_cache[asset_id] = content
        return content

    async def fetch_content_pages(self, asset_id: str) -> AsyncGenerator[tuple[str, str], None]:
        sampling = self._sampling()
        ref = self._parse_label_ref(asset_id)
        if not ref:
            return

        if sampling.strategy != SamplingStrategy.ALL:
            nodes = self._fetch_sample_nodes(ref)
            for i, props in enumerate(nodes):
                content = self._format_label_content(ref, [props], node_offset=i)
                yield content
            return

        label_name = f"{ref.database}:{ref.label}"
        batch_size = int(sampling.rows_per_page or self.CONTENT_BATCH_SIZE)
        offset = 0
        batch_num = 0

        for node_batch in self._fetch_all_nodes_batched(ref):
            batch_num += 1
            logger.info(
                "%s batch %d: %d node(s) (offset=%d)",
                label_name,
                batch_num,
                len(node_batch),
                offset,
            )
            for i, props in enumerate(node_batch):
                content = self._format_label_content(ref, [props], node_offset=offset + i)
                self._content_cache[asset_id] = content
                yield content
            offset += len(node_batch)
            if len(node_batch) < batch_size:
                break

    def enrich_finding_location(
        self,
        finding: DetectionResult,
        asset: SingleAssetScanResults,
        text_content: str,
    ) -> None:
        import re as _re

        ref = self._label_lookup.get(asset.hash)
        if not ref:
            return

        node_index: int | None = None
        for line in text_content.splitlines():
            match = _re.match(r"^node_(\d+):", line)
            if match and finding.matched_content in line:
                node_index = int(match.group(1))
                break

        path = f"{ref.database}:{ref.label}"
        if node_index is not None:
            path += f", node {node_index}"

        finding.location = Location(path=path)

    def abort(self) -> None:
        logger.info("Aborting Neo4j extraction...")
        super().abort()

    def cleanup(self) -> None:
        if self._driver_instance is not None:
            try:
                self._driver_instance.close()
            except Exception:
                logger.debug("Failed to close Neo4j driver cleanly", exc_info=True)
            finally:
                self._driver_instance = None
