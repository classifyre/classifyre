from __future__ import annotations

import logging
from collections.abc import AsyncGenerator
from contextlib import closing
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from ...models.generated_input import (
    HiveInput,
    HiveOptionalConnection,
    HiveOptionalScope,
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

_DEFAULT_EXCLUDED_DATABASES = {"information_schema", "sys"}


@dataclass(frozen=True)
class TableRef:
    database: str
    table: str
    object_type: str


def _quote_identifier(identifier: str) -> str:
    return f"`{identifier.replace('`', '``')}`"


class HiveSource(BaseSource):
    source_type = "hive"

    def __init__(
        self,
        recipe: dict[str, Any],
        source_id: str | None = None,
        runner_id: str | None = None,
    ) -> None:
        super().__init__(recipe, source_id, runner_id)
        self.config = HiveInput.model_validate(recipe)
        self.runner_id = runner_id or "local-run"
        self._pyhive_hive = require_module(
            module_name="pyhive.hive",
            source_name="Hive",
            uv_groups=["hive"],
            detail="The Hive connector is optional.",
        )
        self._host = self.config.required.host
        self._port = int(self.config.required.port)
        self._table_lookup: dict[str, TableRef] = {}
        self._content_cache: dict[str, tuple[str, str]] = {}
        self._table_type_cache: dict[tuple[str, str], str] = {}

    def _asset_type_value(self) -> str:
        type_value = self.config.type
        return type_value.value if hasattr(type_value, "value") else str(type_value)

    def _sampling(self) -> SamplingConfig:
        return self.config.sampling

    def _connection_options(self) -> HiveOptionalConnection:
        if self.config.optional and self.config.optional.connection:
            return self.config.optional.connection
        return HiveOptionalConnection()

    def _scope_options(self) -> HiveOptionalScope:
        if self.config.optional and self.config.optional.scope:
            return self.config.optional.scope
        return HiveOptionalScope()

    def _username(self) -> str:
        return self.config.masked.username

    def _password(self) -> str:
        return self.config.masked.password

    def _connection_scheme(self) -> str:
        connection = self._connection_options()
        scheme = (
            connection.scheme.value if hasattr(connection.scheme, "value") else connection.scheme
        )
        if not scheme:
            return "hive"
        return str(scheme)

    def _connect(self, database: str | None = None):
        connection_options = self._connection_options()
        scope_options = self._scope_options()

        target_database = database or scope_options.database or "default"
        connect_kwargs: dict[str, Any] = {
            "host": self._host,
            "port": int(self._port),
            "username": self._username(),
            "password": self._password(),
            "database": target_database,
        }

        scheme = self._connection_scheme().lower()
        if scheme == "hive+http":
            connect_kwargs.setdefault("scheme", "http")
        elif scheme in {"hive+https", "databricks+pyhive"}:
            connect_kwargs.setdefault("scheme", "https")

        connect_args = connection_options.connect_args or {}
        if isinstance(connect_args, dict):
            connect_kwargs.update(connect_args)

        hive_module = self._pyhive_hive
        if not hasattr(hive_module, "connect"):
            raise RuntimeError("PyHive module does not expose hive.connect")

        return hive_module.connect(**connect_kwargs)

    def _excluded_databases(self) -> set[str]:
        configured = self._scope_options().exclude_databases or []
        excluded = {name.strip() for name in configured if name.strip()}
        if not excluded:
            excluded = set(_DEFAULT_EXCLUDED_DATABASES)
        return excluded

    def _object_allowlist(self) -> set[str]:
        include_objects = self._scope_options().include_objects or []
        return {entry.strip().lower() for entry in include_objects if entry.strip()}

    def _include_tables_enabled(self) -> bool:
        return self._scope_options().include_tables is not False

    def _include_views_enabled(self) -> bool:
        return self._scope_options().include_views is not False

    def _resolve_databases(self) -> list[str]:
        scope_options = self._scope_options()
        include_all = bool(scope_options.include_all_databases)
        configured_database = scope_options.database

        if not include_all:
            if configured_database:
                return [configured_database]
            raise ValueError(
                "Hive source requires optional.scope.database when include_all_databases is false. "
                "Set optional.scope.database (e.g. 'default') or enable include_all_databases."
            )

        excluded = self._excluded_databases()
        databases: list[str] = []

        seed_database = configured_database or "default"
        with closing(self._connect(seed_database)) as conn:
            with conn.cursor() as cursor:
                cursor.execute("SHOW DATABASES")
                for row in cursor.fetchall():
                    database_name = row[0] if isinstance(row, tuple) and row else None
                    if not isinstance(database_name, str) or not database_name:
                        continue
                    if database_name in excluded:
                        continue
                    databases.append(database_name)

        if configured_database and configured_database not in databases:
            databases.insert(0, configured_database)

        return databases

    def _resolve_object_type(self, database: str, table: str) -> str:
        cache_key = (database, table)
        if cache_key in self._table_type_cache:
            return self._table_type_cache[cache_key]

        object_type = "TABLE"
        try:
            query = f"DESCRIBE FORMATTED {_quote_identifier(database)}.{_quote_identifier(table)}"
            with closing(self._connect(database)) as conn:
                with conn.cursor() as cursor:
                    cursor.execute(query)
                    for row in cursor.fetchall():
                        if not isinstance(row, tuple) or not row:
                            continue

                        field_name = row[0]
                        details = row[1] if len(row) > 1 else ""
                        if not isinstance(field_name, str):
                            continue

                        if field_name.strip().lower() == "table type:":
                            detail_text = str(details).strip().upper()
                            if "VIRTUAL_VIEW" in detail_text or "VIEW" in detail_text:
                                object_type = "VIEW"
                            break
        except Exception:
            object_type = "TABLE"

        self._table_type_cache[cache_key] = object_type
        return object_type

    def _list_tables_for_database(self, database: str) -> list[TableRef]:
        include_tables = self._include_tables_enabled()
        include_views = self._include_views_enabled()
        if not include_tables and not include_views:
            return []

        object_allowlist = self._object_allowlist()
        table_limit = self._scope_options().table_limit
        limit = int(table_limit) if table_limit else None

        tables: list[TableRef] = []
        with closing(self._connect(database)) as conn:
            with conn.cursor() as cursor:
                cursor.execute(f"SHOW TABLES IN {_quote_identifier(database)}")
                for row in cursor.fetchall():
                    table_name = row[0] if isinstance(row, tuple) and row else None
                    if not isinstance(table_name, str) or not table_name:
                        continue

                    normalized_table = table_name.lower()
                    normalized_db_table = f"{database}.{table_name}".lower()
                    if (
                        object_allowlist
                        and normalized_table not in object_allowlist
                        and normalized_db_table not in object_allowlist
                    ):
                        continue

                    object_type = self._resolve_object_type(database, table_name)
                    if object_type == "VIEW" and not include_views:
                        continue
                    if object_type != "VIEW" and not include_tables:
                        continue

                    tables.append(
                        TableRef(
                            database=database,
                            table=table_name,
                            object_type=object_type,
                        )
                    )
                    if limit is not None and len(tables) >= limit:
                        break

        return tables

    def _iter_tables(self) -> list[TableRef]:
        tables: list[TableRef] = []
        for database in self._resolve_databases():
            if self._aborted:
                break
            try:
                tables.extend(self._list_tables_for_database(database))
            except Exception as exc:
                logger.warning("Skipping database %s due to listing error: %s", database, exc)
        return tables

    def test_connection(self) -> dict[str, Any]:
        logger.info("Testing connection to Hive...")
        result = {
            "timestamp": datetime.now(UTC).isoformat(),
            "source_type": self.recipe.get("type"),
        }

        try:
            databases = self._resolve_databases()
            if not databases:
                raise ValueError("No databases available for scanning")

            with closing(self._connect(databases[0])) as conn:
                with conn.cursor() as cursor:
                    cursor.execute("SELECT 1")
                    cursor.fetchone()

            result["status"] = "SUCCESS"
            result["message"] = (
                f"Successfully connected to Hive. Reachable databases: {len(databases)}."
            )
        except Exception as exc:
            result["status"] = "FAILURE"
            result["message"] = f"Failed to connect to Hive: {exc}"

        return result

    def _table_key(self, table_ref: TableRef) -> tuple[str, str]:
        return (table_ref.database, table_ref.table)

    def _table_raw_id(self, table_ref: TableRef) -> str:
        return f"{table_ref.database}_#_{table_ref.table}"

    def _collect_foreign_key_links(
        self,
        _tables: list[TableRef],
    ) -> dict[tuple[str, str], set[tuple[str, str]]]:
        return {}

    def _table_to_asset(
        self,
        table_ref: TableRef,
        *,
        links: list[str] | None = None,
    ) -> SingleAssetScanResults:
        asset_name = f"{table_ref.database}.{table_ref.table}"
        raw_id = self._table_raw_id(table_ref)
        asset_hash = self.generate_hash_id(raw_id)
        external_url = (
            f"{self._connection_scheme()}://{self._host}:{self._port}/"
            f"{table_ref.database}/{table_ref.table}"
        )

        metadata = {
            "database": table_ref.database,
            "table": table_ref.table,
            "object_type": table_ref.object_type,
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

        tables = self._iter_tables()
        table_hash_by_key: dict[tuple[str, str], str] = {
            self._table_key(table_ref): self.generate_hash_id(self._table_raw_id(table_ref))
            for table_ref in tables
        }
        table_fk_links = self._collect_foreign_key_links(tables)

        batch: list[SingleAssetScanResults] = []
        for table_ref in tables:
            if self._aborted:
                return

            key = self._table_key(table_ref)
            linked_hashes = [
                table_hash_by_key[target]
                for target in sorted(table_fk_links.get(key, set()))
                if target in table_hash_by_key
            ]

            asset = self._table_to_asset(table_ref, links=linked_hashes)
            self._table_lookup[asset.hash] = table_ref
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

    def _parse_table_ref_from_asset_id(self, asset_id: str) -> TableRef | None:
        if asset_id in self._table_lookup:
            return self._table_lookup[asset_id]

        decoded = asset_id
        if "_#_" not in decoded:
            try:
                decoded = unhash_id(asset_id)
            except Exception:
                decoded = asset_id

        parts = decoded.split("_#_")
        if len(parts) >= 3 and parts[0].upper() == "HIVE":
            return TableRef(
                database=parts[-2],
                table=parts[-1],
                object_type="TABLE",
            )
        if len(parts) >= 2:
            return TableRef(
                database=parts[-2],
                table=parts[-1],
                object_type="TABLE",
            )
        return None

    def _available_columns(self, table_ref: TableRef) -> list[str]:
        query = (
            f"DESCRIBE {_quote_identifier(table_ref.database)}.{_quote_identifier(table_ref.table)}"
        )
        with closing(self._connect(table_ref.database)) as conn:
            with conn.cursor() as cursor:
                cursor.execute(query)
                columns: list[str] = []
                for row in cursor.fetchall():
                    if not isinstance(row, tuple) or not row:
                        continue
                    column_name = row[0]
                    if not isinstance(column_name, str):
                        continue
                    normalized = column_name.strip()
                    if not normalized or normalized.startswith("#"):
                        continue
                    columns.append(normalized)
                return columns

    def _resolve_latest_order_column(self, columns: list[str]) -> str | None:
        sampling = self._sampling()
        configured = sampling.order_by_column
        if configured and configured in columns:
            return configured

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
            if candidate in columns:
                return candidate
        return None

    def _build_sampling_query(
        self, table_ref: TableRef, columns: list[str]
    ) -> tuple[str, list[Any]]:
        sampling = self._sampling()
        if not columns:
            raise ValueError(
                f"Table {table_ref.database}.{table_ref.table} has no readable columns"
            )

        quoted_columns = ", ".join(_quote_identifier(column) for column in columns)
        from_expr = f"{_quote_identifier(table_ref.database)}.{_quote_identifier(table_ref.table)}"

        strategy = sampling.strategy
        if strategy == SamplingStrategy.ALL:
            query = f"SELECT {quoted_columns} FROM {from_expr}"
            return query, []

        query = f"SELECT {quoted_columns} FROM {from_expr}"

        if strategy == SamplingStrategy.LATEST:
            order_column = self._resolve_latest_order_column(columns)
            if order_column:
                query += f" ORDER BY {_quote_identifier(order_column)} DESC"
            elif sampling.fallback_to_random is not False:
                query += " ORDER BY rand()"
        elif strategy == SamplingStrategy.RANDOM:
            query += " ORDER BY rand()"

        query += f" LIMIT {int(sampling.rows_per_page or 100)}"
        return query, []

    def _count_table_rows(self, table_ref: TableRef) -> int | None:
        try:
            with closing(self._connect(table_ref.database)) as conn:
                with conn.cursor() as cursor:
                    cursor.execute(
                        f"SELECT COUNT(*) FROM {_quote_identifier(table_ref.database)}.{_quote_identifier(table_ref.table)}"
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
        if isinstance(value, (bytes, bytearray)):
            return f"<{len(value)} bytes>"
        if isinstance(value, datetime):
            return value.isoformat()
        return str(value)

    def _format_sample_content(
        self,
        table_ref: TableRef,
        column_names: list[str],
        rows: list[tuple[Any, ...]],
    ) -> tuple[str, str]:
        sampling = self._sampling()
        return format_tabular_sample_content(
            scope_label="table",
            scope_value=f"{table_ref.database}.{table_ref.table}",
            strategy=sampling.strategy,
            rows=rows,
            column_names=column_names,
            serialize_cell=self._serialize_cell,
            include_column_names=sampling.include_column_names is not False,
            object_type=table_ref.object_type,
            raw_metadata={
                "database": table_ref.database,
                "table": table_ref.table,
            },
        )

    def _fetch_one_page(
        self, table_ref: TableRef, base_query: str, page_size: int, offset: int
    ) -> tuple[list[tuple[Any, ...]], list[str]]:
        with closing(self._connect(table_ref.database)) as conn:
            paginated_query = f"{base_query} LIMIT {page_size} OFFSET {offset}"
            with conn.cursor() as cursor:
                cursor.execute(paginated_query)
                rows = list(cursor.fetchall())
                column_names = (
                    [desc[0] for desc in cursor.description] if cursor.description else []
                )
        return rows, column_names

    def _sample_table_rows(self, table_ref: TableRef) -> tuple[str, str] | None:
        columns = self._available_columns(table_ref)
        sampling = self._sampling()
        query, _params = self._build_sampling_query(table_ref, columns)

        if sampling.strategy == SamplingStrategy.ALL:
            rows_per_page = int(sampling.rows_per_page or 100)
            rows, column_names = self._fetch_one_page(table_ref, query, rows_per_page, 0)
        else:
            with closing(self._connect(table_ref.database)) as conn:
                with conn.cursor() as cursor:
                    cursor.execute(query)
                    rows = cursor.fetchall()
                    column_names = [desc[0] for desc in cursor.description or []]

        if not column_names:
            return None
        return self._format_sample_content(table_ref, column_names, rows)

    async def fetch_content(self, asset_id: str) -> tuple[str, str] | None:
        cached = self._content_cache.get(asset_id)
        if cached:
            return cached

        table_ref = self._parse_table_ref_from_asset_id(asset_id)
        if not table_ref:
            return None

        sampled = self._sample_table_rows(table_ref)

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

        table_ref = self._parse_table_ref_from_asset_id(asset_id)
        if not table_ref:
            return

        columns = self._available_columns(table_ref)
        query, _ = self._build_sampling_query(table_ref, columns)
        rows_per_page = int(sampling.rows_per_page or 100)
        table_label = f"{table_ref.database}.{table_ref.table}"

        total_rows = self._count_table_rows(table_ref)
        total_batches = ((total_rows + rows_per_page - 1) // rows_per_page) if total_rows else None
        if total_rows is not None and total_batches is not None:
            logger.info(
                "Full scan %s: %d rows, %d batches of %d",
                table_label,
                total_rows,
                total_batches,
                rows_per_page,
            )

        offset = 0
        page_num = 1

        while not self._aborted:
            if total_batches is not None:
                logger.info("%s batch %d/%d", table_label, page_num, total_batches)
            rows, column_names = self._fetch_one_page(table_ref, query, rows_per_page, offset)
            if not rows or not column_names:
                break

            result = self._format_sample_content(table_ref, column_names, rows)
            if result:
                self._content_cache[asset_id] = result
                yield result

            offset += rows_per_page
            page_num += 1
            if len(rows) < rows_per_page:
                break

    def enrich_finding_location(
        self,
        finding: DetectionResult,
        asset: SingleAssetScanResults,
        text_content: str,
    ) -> None:
        del text_content
        table_ref = self._table_lookup.get(asset.hash)
        if not table_ref:
            return

        path = f"{table_ref.database}.{table_ref.table}"
        cached = self._content_cache.get(asset.hash)
        raw_content = cached[0] if cached else None
        metadata = finding.metadata or {}
        finding.location = build_tabular_location(
            raw_content=raw_content,
            matched_content=finding.matched_content,
            base_path=path,
            row_index=metadata.get("tabular_row_index"),
            column_name=metadata.get("tabular_column_name"),
        )

    def abort(self) -> None:
        logger.info("Aborting Hive extraction...")
        super().abort()
