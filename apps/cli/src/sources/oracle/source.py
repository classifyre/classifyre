from __future__ import annotations

import logging
from collections.abc import AsyncGenerator
from contextlib import closing
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from ...models.generated_input import (
    OracleInput,
    OracleOptionalConnection,
    OracleOptionalScope,
    SamplingConfig,
    SamplingStrategy,
)
from ...models.generated_single_asset_scan_results import (
    AssetType as OutputAssetType,
)
from ...models.generated_single_asset_scan_results import (
    DetectionResult,
    SingleAssetScanResults,
)
from ...utils.hashing import hash_id, unhash_id
from ..base import BaseSource
from ..dependencies import require_module
from ..tabular_utils import build_tabular_location, format_tabular_sample_content

logger = logging.getLogger(__name__)

_DEFAULT_EXCLUDED_SCHEMAS = {
    "SYS",
    "SYSTEM",
    "DBSNMP",
    "WMSYS",
    "CTXSYS",
    "XDB",
    "MDSYS",
    "ORDSYS",
    "OUTLN",
    "ORDDATA",
}


@dataclass(frozen=True)
class ObjectRef:
    service_name: str
    schema: str
    name: str
    object_type: str


def _quote_identifier(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


class OracleSource(BaseSource):
    source_type = "oracle"

    def __init__(
        self,
        recipe: dict[str, Any],
        source_id: str | None = None,
        runner_id: str | None = None,
    ) -> None:
        super().__init__(recipe, source_id, runner_id)
        self.config = OracleInput.model_validate(recipe)
        self.runner_id = runner_id or "local-run"
        self._oracledb = require_module(
            module_name="oracledb",
            source_name="Oracle",
            uv_groups=["oracle"],
            detail="The Oracle connector is optional.",
        )
        self._host = self.config.required.host
        self._port = int(self.config.required.port)
        self._service_name = self.config.required.service_name
        self._table_lookup: dict[str, ObjectRef] = {}
        self._content_cache: dict[str, tuple[str, str]] = {}
        self._pk_columns_cache: dict[tuple[str, str], list[str]] = {}

    def _asset_type_value(self) -> str:
        type_value = self.config.type
        return type_value.value if hasattr(type_value, "value") else str(type_value)

    def _sampling(self) -> SamplingConfig:
        return self.config.sampling

    def _connection_options(self) -> OracleOptionalConnection:
        if self.config.optional and self.config.optional.connection:
            return self.config.optional.connection
        return OracleOptionalConnection()

    def _scope_options(self) -> OracleOptionalScope:
        if self.config.optional and self.config.optional.scope:
            return self.config.optional.scope
        return OracleOptionalScope()

    def _username(self) -> str:
        return self.config.masked.username

    def _password(self) -> str:
        return self.config.masked.password

    def _dsn(self) -> str:
        if hasattr(self._oracledb, "makedsn"):
            return str(
                self._oracledb.makedsn(
                    self._host,
                    int(self._port),
                    service_name=self._service_name,
                )
            )
        return f"{self._host}:{self._port}/{self._service_name}"

    def _connect(self):
        connection_options = self._connection_options()
        connect_kwargs: dict[str, Any] = {
            "user": self._username(),
            "password": self._password(),
            "dsn": self._dsn(),
            "tcp_connect_timeout": int(connection_options.connect_timeout_seconds or 10),
        }

        try:
            return self._oracledb.connect(**connect_kwargs)
        except TypeError:
            connect_kwargs.pop("tcp_connect_timeout", None)
            return self._oracledb.connect(**connect_kwargs)

    def _schema_allowlist(self) -> set[str] | None:
        configured = self._scope_options().include_schemas
        if not configured:
            return None
        return {schema.strip().upper() for schema in configured if schema.strip()}

    def _schema_denylist(self) -> set[str]:
        configured = self._scope_options().exclude_schemas or []
        denylist = {schema.strip().upper() for schema in configured if schema.strip()}
        if not denylist:
            denylist = set(_DEFAULT_EXCLUDED_SCHEMAS)
        return denylist

    def _object_allowlist(self) -> set[str]:
        include_objects = self._scope_options().include_objects or []
        return {entry.strip().lower() for entry in include_objects if entry.strip()}

    def _include_tables_enabled(self) -> bool:
        return self._scope_options().include_tables is not False

    def _include_views_enabled(self) -> bool:
        return self._scope_options().include_views is not False

    def _include_view_lineage_enabled(self) -> bool:
        scope = self._scope_options()
        return bool(scope.include_view_lineage or scope.include_view_column_lineage)

    def _list_objects(self) -> list[ObjectRef]:
        include_tables = self._include_tables_enabled()
        include_views = self._include_views_enabled()
        if not include_tables and not include_views:
            return []

        schema_allowlist = self._schema_allowlist()
        schema_denylist = self._schema_denylist()
        object_allowlist = self._object_allowlist()
        table_limit = self._scope_options().table_limit
        limit = int(table_limit) if table_limit else None

        objects: list[ObjectRef] = []

        with closing(self._connect()) as conn:
            with conn.cursor() as cursor:
                if include_tables:
                    cursor.execute(
                        """
                        SELECT owner, table_name
                        FROM all_tables
                        ORDER BY owner, table_name
                        """
                    )
                    for row in cursor.fetchall():
                        if not isinstance(row, tuple) or len(row) < 2:
                            continue
                        schema_name = row[0]
                        object_name = row[1]
                        if not isinstance(schema_name, str) or not isinstance(object_name, str):
                            continue

                        schema_upper = schema_name.upper()
                        if schema_upper in schema_denylist:
                            continue
                        if schema_allowlist and schema_upper not in schema_allowlist:
                            continue

                        scoped_name = f"{schema_upper}.{object_name}".lower()
                        service_scoped_name = (
                            f"{self._service_name}.{schema_upper}.{object_name}".lower()
                        )
                        if (
                            object_allowlist
                            and scoped_name not in object_allowlist
                            and service_scoped_name not in object_allowlist
                        ):
                            continue

                        objects.append(
                            ObjectRef(
                                service_name=self._service_name,
                                schema=schema_upper,
                                name=object_name,
                                object_type="TABLE",
                            )
                        )
                        if limit is not None and len(objects) >= limit:
                            return objects

                if include_views:
                    cursor.execute(
                        """
                        SELECT owner, view_name
                        FROM all_views
                        ORDER BY owner, view_name
                        """
                    )
                    for row in cursor.fetchall():
                        if not isinstance(row, tuple) or len(row) < 2:
                            continue
                        schema_name = row[0]
                        object_name = row[1]
                        if not isinstance(schema_name, str) or not isinstance(object_name, str):
                            continue

                        schema_upper = schema_name.upper()
                        if schema_upper in schema_denylist:
                            continue
                        if schema_allowlist and schema_upper not in schema_allowlist:
                            continue

                        scoped_name = f"{schema_upper}.{object_name}".lower()
                        service_scoped_name = (
                            f"{self._service_name}.{schema_upper}.{object_name}".lower()
                        )
                        if (
                            object_allowlist
                            and scoped_name not in object_allowlist
                            and service_scoped_name not in object_allowlist
                        ):
                            continue

                        objects.append(
                            ObjectRef(
                                service_name=self._service_name,
                                schema=schema_upper,
                                name=object_name,
                                object_type="VIEW",
                            )
                        )
                        if limit is not None and len(objects) >= limit:
                            return objects

        return objects

    def _iter_objects(self) -> list[ObjectRef]:
        try:
            return self._list_objects()
        except Exception as exc:
            logger.warning("Oracle object listing failed: %s", exc)
            return []

    def test_connection(self) -> dict[str, Any]:
        logger.info("Testing connection to Oracle...")
        result = {
            "timestamp": datetime.now(UTC).isoformat(),
            "source_type": self.recipe.get("type"),
        }

        try:
            with closing(self._connect()) as conn:
                with conn.cursor() as cursor:
                    cursor.execute("SELECT 1 FROM dual")
                    cursor.fetchone()

            objects = self._iter_objects()
            result["status"] = "SUCCESS"
            result["message"] = (
                f"Successfully connected to Oracle. Reachable objects: {len(objects)}."
            )
        except Exception as exc:
            result["status"] = "FAILURE"
            result["message"] = f"Failed to connect to Oracle: {exc}"

        return result

    def _object_key(self, object_ref: ObjectRef) -> tuple[str, str]:
        return (object_ref.schema, object_ref.name)

    def _object_raw_id(self, object_ref: ObjectRef) -> str:
        return f"{object_ref.service_name}_#_{object_ref.schema}_#_{object_ref.name}"

    def _collect_foreign_key_links(
        self,
        objects: list[ObjectRef],
    ) -> dict[tuple[str, str], set[tuple[str, str]]]:
        table_keys = {
            self._object_key(object_ref)
            for object_ref in objects
            if object_ref.object_type == "TABLE"
        }
        links: dict[tuple[str, str], set[tuple[str, str]]] = {}

        if not table_keys:
            return links

        try:
            with closing(self._connect()) as conn:
                with conn.cursor() as cursor:
                    cursor.execute(
                        """
                        SELECT
                            src.owner AS source_owner,
                            src.table_name AS source_table,
                            tgt.owner AS target_owner,
                            tgt.table_name AS target_table
                        FROM all_constraints src
                        JOIN all_constraints tgt
                          ON src.r_owner = tgt.owner
                         AND src.r_constraint_name = tgt.constraint_name
                        WHERE src.constraint_type = 'R'
                        """
                    )
                    for row in cursor.fetchall():
                        if not isinstance(row, tuple) or len(row) < 4:
                            continue

                        source_schema = row[0]
                        source_name = row[1]
                        target_schema = row[2]
                        target_name = row[3]
                        if (
                            not isinstance(source_schema, str)
                            or not isinstance(source_name, str)
                            or not isinstance(target_schema, str)
                            or not isinstance(target_name, str)
                        ):
                            continue

                        source_key = (source_schema.upper(), source_name)
                        target_key = (target_schema.upper(), target_name)
                        if source_key not in table_keys or target_key not in table_keys:
                            continue
                        links.setdefault(source_key, set()).add(target_key)
        except Exception as exc:
            logger.warning("Could not resolve Oracle foreign key links: %s", exc)

        return links

    def _collect_view_links(
        self,
        objects: list[ObjectRef],
    ) -> dict[tuple[str, str], set[tuple[str, str]]]:
        if not self._include_view_lineage_enabled():
            return {}

        object_keys = {self._object_key(object_ref) for object_ref in objects}
        view_keys = {
            self._object_key(object_ref)
            for object_ref in objects
            if object_ref.object_type == "VIEW"
        }

        if not view_keys:
            return {}

        links: dict[tuple[str, str], set[tuple[str, str]]] = {}
        try:
            with closing(self._connect()) as conn:
                with conn.cursor() as cursor:
                    cursor.execute(
                        """
                        SELECT
                            owner,
                            name,
                            referenced_owner,
                            referenced_name,
                            referenced_type
                        FROM all_dependencies
                        WHERE type = 'VIEW'
                          AND referenced_type IN ('TABLE', 'VIEW')
                        """
                    )
                    for row in cursor.fetchall():
                        if not isinstance(row, tuple) or len(row) < 5:
                            continue

                        owner = row[0]
                        name = row[1]
                        referenced_owner = row[2]
                        referenced_name = row[3]
                        referenced_type = row[4]
                        if (
                            not isinstance(owner, str)
                            or not isinstance(name, str)
                            or not isinstance(referenced_owner, str)
                            or not isinstance(referenced_name, str)
                        ):
                            continue
                        if not isinstance(referenced_type, str):
                            continue

                        source_key = (owner.upper(), name)
                        target_key = (referenced_owner.upper(), referenced_name)
                        if source_key not in view_keys or target_key not in object_keys:
                            continue

                        links.setdefault(source_key, set()).add(target_key)
        except Exception as exc:
            logger.warning("Could not resolve Oracle view lineage links: %s", exc)

        return links

    def _object_to_asset(
        self,
        object_ref: ObjectRef,
        *,
        links: list[str] | None = None,
    ) -> SingleAssetScanResults:
        asset_name = f"{object_ref.service_name}.{object_ref.schema}.{object_ref.name}"
        raw_id = self._object_raw_id(object_ref)
        asset_hash = self.generate_hash_id(raw_id)
        external_url = (
            f"oracle://{self._host}:{self._port}/{object_ref.service_name}/"
            f"{object_ref.schema}.{object_ref.name}"
        )

        metadata = {
            "service_name": object_ref.service_name,
            "schema": object_ref.schema,
            "object": object_ref.name,
            "object_type": object_ref.object_type,
            "lineage": {
                "include_view_lineage": bool(self._scope_options().include_view_lineage),
                "include_view_column_lineage": bool(
                    self._scope_options().include_view_column_lineage
                ),
            },
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
            links=links or [],
            asset_type=OutputAssetType.TABLE,
            source_id=self.source_id,
            created_at=now,
            updated_at=now,
            runner_id=self.runner_id,
        )

    async def extract(self) -> AsyncGenerator[list[SingleAssetScanResults], None]:
        if self._aborted:
            return

        pipeline = None
        if self.config.detectors and any(detector.enabled for detector in self.config.detectors):
            from ...pipeline.detector_pipeline import DetectorPipeline

            pipeline = DetectorPipeline.from_recipe(self.recipe, self, self.runner_id)

        objects = self._iter_objects()
        object_hash_by_key: dict[tuple[str, str], str] = {
            self._object_key(object_ref): self.generate_hash_id(self._object_raw_id(object_ref))
            for object_ref in objects
        }
        fk_links = self._collect_foreign_key_links(objects)
        view_links = self._collect_view_links(objects)

        batch: list[SingleAssetScanResults] = []
        for object_ref in objects:
            if self._aborted:
                return

            key = self._object_key(object_ref)
            combined_targets = set(fk_links.get(key, set())) | set(view_links.get(key, set()))
            linked_hashes = [
                object_hash_by_key[target]
                for target in sorted(combined_targets)
                if target in object_hash_by_key
            ]

            asset = self._object_to_asset(object_ref, links=linked_hashes)
            self._table_lookup[asset.hash] = object_ref
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

    def _parse_object_ref_from_asset_id(self, asset_id: str) -> ObjectRef | None:
        if asset_id in self._table_lookup:
            return self._table_lookup[asset_id]

        decoded = asset_id
        if "_#_" not in decoded:
            try:
                decoded = unhash_id(asset_id)
            except Exception:
                decoded = asset_id

        parts = decoded.split("_#_")
        if len(parts) >= 5 and parts[0].upper() == "ORACLE":
            # Backward compatibility with older ORACLE_#_ENV_#_SERVICE_#_SCHEMA_#_OBJECT ids.
            return ObjectRef(
                service_name=parts[-3],
                schema=parts[-2],
                name=parts[-1],
                object_type="TABLE",
            )
        if len(parts) >= 4 and parts[0].upper() == "ORACLE":
            return ObjectRef(
                service_name=parts[-3],
                schema=parts[-2],
                name=parts[-1],
                object_type="TABLE",
            )
        if len(parts) >= 4:
            return ObjectRef(
                service_name=parts[-3],
                schema=parts[-2],
                name=parts[-1],
                object_type="TABLE",
            )
        if len(parts) >= 3:
            return ObjectRef(
                service_name=self._service_name,
                schema=parts[-2],
                name=parts[-1],
                object_type="TABLE",
            )
        return None

    def _available_columns(self, object_ref: ObjectRef) -> list[str]:
        with closing(self._connect()) as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT column_name
                    FROM all_tab_columns
                    WHERE owner = :owner
                      AND table_name = :table_name
                    ORDER BY column_id
                    """,
                    {
                        "owner": object_ref.schema,
                        "table_name": object_ref.name,
                    },
                )
                return [
                    row[0]
                    for row in cursor.fetchall()
                    if isinstance(row, tuple) and row and isinstance(row[0], str)
                ]

    def _resolve_latest_order_column(self, columns: list[str]) -> str | None:
        sampling = self._sampling()
        normalized = {column.lower(): column for column in columns}

        configured = sampling.order_by_column
        if configured:
            configured_column = normalized.get(configured.lower())
            if configured_column:
                return configured_column

        priority_candidates = (
            "updated_at",
            "modified_at",
            "created_at",
            "inserted_at",
            "timestamp",
            "ts",
            "date",
        )
        for candidate in priority_candidates:
            resolved = normalized.get(candidate)
            if resolved:
                return resolved
        return None

    def _build_sampling_query(
        self, object_ref: ObjectRef, columns: list[str]
    ) -> tuple[str, list[Any]]:
        sampling = self._sampling()
        if not columns:
            raise ValueError(
                f"Object {object_ref.service_name}.{object_ref.schema}.{object_ref.name} has no readable columns"
            )

        quoted_columns = ", ".join(_quote_identifier(column) for column in columns)
        quoted_object = (
            f"{_quote_identifier(object_ref.schema)}.{_quote_identifier(object_ref.name)}"
        )

        strategy = sampling.strategy
        if strategy == SamplingStrategy.ALL:
            return f"SELECT {quoted_columns} FROM {quoted_object}", []

        rows_per_page = int(sampling.rows_per_page or 100)
        query = f"SELECT {quoted_columns} FROM {quoted_object}"

        if strategy == SamplingStrategy.LATEST:
            order_column = self._resolve_latest_order_column(columns)
            if order_column:
                query += f" ORDER BY {_quote_identifier(order_column)} DESC"
            elif sampling.fallback_to_random is not False:
                query += " ORDER BY DBMS_RANDOM.VALUE"
        elif strategy == SamplingStrategy.RANDOM:
            query += " ORDER BY DBMS_RANDOM.VALUE"

        query += f" FETCH FIRST {rows_per_page} ROWS ONLY"
        return query, []

    def _count_table_rows(self, object_ref: ObjectRef) -> int | None:
        try:
            with closing(self._connect()) as conn:
                with conn.cursor() as cursor:
                    cursor.execute(
                        f"SELECT COUNT(*) FROM {_quote_identifier(object_ref.schema)}.{_quote_identifier(object_ref.name)}"
                    )
                    row = cursor.fetchone()
                    return int(row[0]) if row else None
        except Exception:
            return None

    def _serialize_cell(self, value: Any) -> str:
        if value is None:
            return "null"
        if isinstance(value, memoryview):
            value = value.tobytes()

        if hasattr(value, "read"):
            try:
                value = value.read()
            except Exception:
                value = str(value)

        if isinstance(value, (bytes, bytearray)):
            return f"<{len(value)} bytes>"
        if isinstance(value, datetime):
            return value.isoformat()
        return str(value)

    def _format_sample_content(
        self,
        object_ref: ObjectRef,
        column_names: list[str],
        rows: list[tuple[Any, ...]],
    ) -> tuple[str, str]:
        sampling = self._sampling()
        return format_tabular_sample_content(
            scope_label="object",
            scope_value=f"{object_ref.service_name}.{object_ref.schema}.{object_ref.name}",
            strategy=sampling.strategy,
            rows=rows,
            column_names=column_names,
            serialize_cell=self._serialize_cell,
            include_column_names=sampling.include_column_names is not False,
            object_type=object_ref.object_type,
            raw_metadata={
                "service_name": object_ref.service_name,
                "schema": object_ref.schema,
                "object": object_ref.name,
            },
        )

    def _fetch_one_page(
        self, object_ref: ObjectRef, base_query: str, page_size: int, offset: int
    ) -> tuple[list[tuple[Any, ...]], list[str]]:
        with closing(self._connect()) as conn:
            paginated_query = f"{base_query} OFFSET {offset} ROWS FETCH NEXT {page_size} ROWS ONLY"
            with conn.cursor() as cursor:
                cursor.execute(paginated_query)
                rows = list(cursor.fetchall())
                column_names = (
                    [desc[0] for desc in cursor.description] if cursor.description else []
                )
        return rows, column_names

    def _sample_object_rows(self, object_ref: ObjectRef) -> tuple[str, str] | None:
        columns = self._available_columns(object_ref)
        sampling = self._sampling()
        query, _params = self._build_sampling_query(object_ref, columns)

        if sampling.strategy == SamplingStrategy.ALL:
            rows_per_page = int(sampling.rows_per_page or 100)
            rows, column_names = self._fetch_one_page(object_ref, query, rows_per_page, 0)
        else:
            with closing(self._connect()) as conn:
                with conn.cursor() as cursor:
                    cursor.execute(query)
                    rows = cursor.fetchall()
                    column_names = [desc[0] for desc in cursor.description or []]

        if not column_names:
            return None
        return self._format_sample_content(object_ref, column_names, rows)

    async def fetch_content(self, asset_id: str) -> tuple[str, str] | None:
        cached = self._content_cache.get(asset_id)
        if cached:
            return cached

        object_ref = self._parse_object_ref_from_asset_id(asset_id)
        if not object_ref:
            return None

        sampled = self._sample_object_rows(object_ref)

        if sampled is None:
            return None

        self._content_cache[asset_id] = sampled
        return sampled

    async def fetch_content_pages(self, asset_id: str) -> AsyncGenerator[tuple[str, str], None]:
        sampling = self._sampling()

        if sampling.strategy != SamplingStrategy.ALL:
            result = await self.fetch_content(asset_id)
            if result:
                yield result
            return

        object_ref = self._parse_object_ref_from_asset_id(asset_id)
        if not object_ref:
            return

        columns = self._available_columns(object_ref)
        query, _ = self._build_sampling_query(object_ref, columns)
        rows_per_page = int(sampling.rows_per_page or 100)
        object_label = f"{object_ref.service_name}.{object_ref.schema}.{object_ref.name}"

        total_rows = self._count_table_rows(object_ref)
        total_batches = ((total_rows + rows_per_page - 1) // rows_per_page) if total_rows else None
        if total_rows is not None and total_batches is not None:
            logger.info(
                "Full scan %s: %d rows, %d batches of %d",
                object_label,
                total_rows,
                total_batches,
                rows_per_page,
            )

        offset = 0
        page_num = 1

        while not self._aborted:
            if total_batches is not None:
                logger.info("%s batch %d/%d", object_label, page_num, total_batches)
            rows, column_names = self._fetch_one_page(object_ref, query, rows_per_page, offset)
            if not rows or not column_names:
                break

            result = self._format_sample_content(object_ref, column_names, rows)
            if result:
                self._content_cache[asset_id] = result
                yield result

            offset += rows_per_page
            page_num += 1
            if len(rows) < rows_per_page:
                break

    def _get_primary_key_columns(self, object_ref: ObjectRef) -> list[str]:
        cache_key = (object_ref.schema, object_ref.name)
        if cache_key in self._pk_columns_cache:
            return self._pk_columns_cache[cache_key]

        if object_ref.object_type == "VIEW":
            self._pk_columns_cache[cache_key] = []
            return []

        try:
            with closing(self._connect()) as conn:
                with conn.cursor() as cursor:
                    cursor.execute(
                        """
                        SELECT cols.column_name
                        FROM all_constraints cons
                        JOIN all_cons_columns cols
                          ON cons.owner = cols.owner
                         AND cons.constraint_name = cols.constraint_name
                        WHERE cons.constraint_type = 'P'
                          AND cons.owner = :owner
                          AND cons.table_name = :table_name
                        ORDER BY cols.position
                        """,
                        {
                            "owner": object_ref.schema,
                            "table_name": object_ref.name,
                        },
                    )
                    columns = [
                        row[0]
                        for row in cursor.fetchall()
                        if isinstance(row, tuple) and row and isinstance(row[0], str)
                    ]
        except Exception:
            columns = []

        self._pk_columns_cache[cache_key] = columns
        return columns

    def enrich_finding_location(
        self,
        finding: DetectionResult,
        asset: SingleAssetScanResults,
        text_content: str,
    ) -> None:
        del text_content
        object_ref = self._table_lookup.get(asset.hash)
        if not object_ref:
            return

        path = f"{object_ref.service_name}.{object_ref.schema}.{object_ref.name}"
        cached = self._content_cache.get(asset.hash)
        raw_content = cached[0] if cached else None
        metadata = finding.metadata or {}
        finding.location = build_tabular_location(
            raw_content=raw_content,
            matched_content=finding.matched_content,
            base_path=path,
            primary_key_columns=(
                self._get_primary_key_columns(object_ref)
                if object_ref.object_type == "TABLE"
                else []
            ),
            row_index=metadata.get("tabular_row_index"),
            column_name=metadata.get("tabular_column_name"),
        )

    def abort(self) -> None:
        logger.info("Aborting Oracle extraction...")
        super().abort()
