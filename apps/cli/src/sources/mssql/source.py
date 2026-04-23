from __future__ import annotations

import logging
from collections.abc import AsyncGenerator
from contextlib import closing
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from ...models.generated_input import (
    MSSQLInput,
    MSSQLOptionalConnection,
    MSSQLOptionalExtraction,
    MSSQLOptionalScope,
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

_DEFAULT_EXCLUDED_DATABASES = {"master", "tempdb", "model"}
_DEFAULT_EXCLUDED_SCHEMAS = {"INFORMATION_SCHEMA", "sys"}


@dataclass(frozen=True)
class TableRef:
    database: str
    schema: str
    table: str
    object_type: str


def _quote_identifier(identifier: str) -> str:
    return f"[{identifier.replace(']', ']]')}]"


class MSSQLSource(BaseSource):
    source_type = "mssql"

    def __init__(
        self,
        recipe: dict[str, Any],
        source_id: str | None = None,
        runner_id: str | None = None,
    ) -> None:
        super().__init__(recipe, source_id, runner_id)
        self.config = MSSQLInput.model_validate(recipe)
        self.runner_id = runner_id or "local-run"
        self._pymssql = require_module(
            module_name="pymssql",
            source_name="MSSQL",
            uv_groups=["mssql"],
            detail="The MSSQL connector is optional.",
        )
        self._host = self.config.required.host
        self._port = int(self.config.required.port)
        self._table_lookup: dict[str, TableRef] = {}
        self._content_cache: dict[str, tuple[str, str]] = {}
        self._pk_columns_cache: dict[tuple[str, str, str], list[str]] = {}
        self._unsupported_feature_warning_logged = False

    def _asset_type_value(self) -> str:
        type_value = self.config.type
        return type_value.value if hasattr(type_value, "value") else str(type_value)

    def _sampling(self) -> SamplingConfig:
        return self.config.sampling

    def _connection_options(self) -> MSSQLOptionalConnection:
        if self.config.optional and self.config.optional.connection:
            return self.config.optional.connection
        return MSSQLOptionalConnection()

    def _scope_options(self) -> MSSQLOptionalScope:
        if self.config.optional and self.config.optional.scope:
            return self.config.optional.scope
        return MSSQLOptionalScope()

    def _extraction_options(self) -> MSSQLOptionalExtraction:
        if self.config.optional and self.config.optional.extraction:
            return self.config.optional.extraction
        return MSSQLOptionalExtraction()

    def _auth_mode(self) -> str:
        connection = self._connection_options()
        mode = getattr(connection, "auth_mode", None)
        if hasattr(mode, "root"):
            mode = mode.root
        value = mode.value if hasattr(mode, "value") else mode
        normalized = str(value or "CUSTOM").strip().upper()
        return normalized if normalized else "CUSTOM"

    def _ldap_domain(self) -> str | None:
        connection = self._connection_options()
        domain = getattr(connection, "ldap_domain", None)
        if not isinstance(domain, str):
            return None
        cleaned = domain.strip()
        return cleaned if cleaned else None

    def _username(self) -> str:
        username = self.config.masked.username
        if self._auth_mode() != "LDAP":
            return username

        if "\\" in username or "@" in username:
            return username

        domain = self._ldap_domain()
        if domain:
            return f"{domain}\\{username}"
        return username

    def _password(self) -> str:
        return self.config.masked.password

    def _is_aws_rds(self) -> bool:
        configured = self._connection_options().is_aws_rds
        if isinstance(configured, bool):
            return configured
        hostname = self._host.strip().lower()
        return hostname.endswith(".rds.amazonaws.com") or ".rds." in hostname

    def _connect(self, database: str | None = None):
        connection_options = self._connection_options()
        connect_kwargs: dict[str, Any] = {
            "server": self._host,
            "port": int(self._port),
            "user": self._username(),
            "password": self._password(),
            "login_timeout": int(connection_options.connect_timeout_seconds or 10),
            "timeout": int(connection_options.connect_timeout_seconds or 10),
        }
        if database:
            connect_kwargs["database"] = database

        connection = self._pymssql.connect(**connect_kwargs)
        try:
            connection.autocommit(True)
        except Exception:
            pass
        return connection

    def _excluded_databases(self) -> set[str]:
        configured = self._scope_options().exclude_databases or []
        excluded = {name.strip() for name in configured if name.strip()}
        if not excluded:
            excluded = set(_DEFAULT_EXCLUDED_DATABASES)
        return excluded

    def _schema_allowlist(self) -> set[str] | None:
        configured = self._scope_options().include_schemas
        if not configured:
            return None
        return {schema.strip() for schema in configured if schema.strip()}

    def _schema_denylist(self) -> set[str]:
        configured = self._scope_options().exclude_schemas or []
        denylist = {schema.strip() for schema in configured if schema.strip()}
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

    def _include_table_lineage_enabled(self) -> bool:
        return self._extraction_options().include_table_lineage is not False

    def _include_view_lineage_enabled(self) -> bool:
        return self._extraction_options().include_view_lineage is not False

    def _log_unsupported_extraction_features(self) -> None:
        if self._unsupported_feature_warning_logged:
            return
        self._unsupported_feature_warning_logged = True

        extraction = self._extraction_options()
        unsupported: list[str] = []
        if extraction.include_view_column_lineage:
            unsupported.append("include_view_column_lineage")
        if extraction.include_stored_procedures:
            unsupported.append("include_stored_procedures")
        if extraction.include_stored_procedures_code:
            unsupported.append("include_stored_procedures_code")
        if extraction.include_jobs:
            unsupported.append("include_jobs")
        if extraction.include_query_lineage:
            unsupported.append("include_query_lineage")
        if extraction.include_usage_statistics:
            unsupported.append("include_usage_statistics")

        if unsupported:
            logger.warning(
                "MSSQL extraction options currently not implemented in this connector: %s",
                ", ".join(sorted(unsupported)),
            )

    def _resolve_databases(self) -> list[str]:
        scope_options = self._scope_options()
        include_all = bool(scope_options.include_all_databases)
        configured_database = scope_options.database

        if not include_all:
            if configured_database:
                return [configured_database]
            raise ValueError(
                "MSSQL source requires optional.scope.database when include_all_databases is false. "
                "Set optional.scope.database (e.g. 'msdb') or enable include_all_databases."
            )

        excluded = self._excluded_databases()
        databases: list[str] = []
        with closing(self._connect()) as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT name
                    FROM sys.databases
                    WHERE state_desc = 'ONLINE'
                    ORDER BY name
                    """
                )
                for row in cursor.fetchall():
                    database_name = row[0] if isinstance(row, tuple) else None
                    if not isinstance(database_name, str) or not database_name:
                        continue
                    if database_name in excluded:
                        continue
                    databases.append(database_name)

        if configured_database and configured_database not in databases:
            databases.insert(0, configured_database)

        return databases

    def _get_primary_key_columns(self, table_ref: TableRef) -> list[str]:
        cache_key = (table_ref.database, table_ref.schema, table_ref.table)
        if cache_key in self._pk_columns_cache:
            return self._pk_columns_cache[cache_key]

        if table_ref.object_type == "VIEW":
            self._pk_columns_cache[cache_key] = []
            return []

        try:
            with closing(self._connect(table_ref.database)) as conn:
                with conn.cursor() as cursor:
                    cursor.execute(
                        """
                        SELECT kcu.COLUMN_NAME
                        FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
                        JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
                          ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
                         AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA
                         AND tc.TABLE_NAME = kcu.TABLE_NAME
                        WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
                          AND tc.TABLE_CATALOG = %s
                          AND tc.TABLE_SCHEMA = %s
                          AND tc.TABLE_NAME = %s
                        ORDER BY kcu.ORDINAL_POSITION
                        """,
                        (table_ref.database, table_ref.schema, table_ref.table),
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

    def _list_tables_for_database(self, database: str) -> list[TableRef]:
        include_tables = self._include_tables_enabled()
        include_views = self._include_views_enabled()
        if not include_tables and not include_views:
            return []

        schema_allowlist = self._schema_allowlist()
        schema_denylist = self._schema_denylist()
        object_allowlist = self._object_allowlist()
        table_limit = self._scope_options().table_limit
        limit = int(table_limit) if table_limit else None

        tables: list[TableRef] = []
        with closing(self._connect(database)) as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE
                    FROM INFORMATION_SCHEMA.TABLES
                    WHERE TABLE_CATALOG = %s
                    ORDER BY TABLE_SCHEMA, TABLE_NAME
                    """,
                    (database,),
                )
                for row in cursor.fetchall():
                    if not isinstance(row, tuple) or len(row) < 3:
                        continue

                    schema_name = row[0]
                    table_name = row[1]
                    table_type = row[2]
                    if not isinstance(schema_name, str) or not isinstance(table_name, str):
                        continue
                    if schema_name in schema_denylist:
                        continue
                    if schema_allowlist and schema_name not in schema_allowlist:
                        continue

                    is_view = str(table_type).upper() == "VIEW"
                    if is_view and not include_views:
                        continue
                    if not is_view and not include_tables:
                        continue

                    scoped_name = f"{schema_name}.{table_name}".lower()
                    db_scoped_name = f"{database}.{schema_name}.{table_name}".lower()
                    if (
                        object_allowlist
                        and scoped_name not in object_allowlist
                        and db_scoped_name not in object_allowlist
                    ):
                        continue

                    tables.append(
                        TableRef(
                            database=database,
                            schema=schema_name,
                            table=table_name,
                            object_type="VIEW" if is_view else "TABLE",
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
        logger.info("Testing connection to MSSQL...")
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
                f"Successfully connected to MSSQL. Reachable databases: {len(databases)}."
            )
        except Exception as exc:
            result["status"] = "FAILURE"
            result["message"] = f"Failed to connect to MSSQL: {exc}"

        return result

    def _table_key(self, table_ref: TableRef) -> tuple[str, str, str]:
        return (table_ref.database, table_ref.schema, table_ref.table)

    def _table_raw_id(self, table_ref: TableRef) -> str:
        return f"{table_ref.database}_#_{table_ref.schema}_#_{table_ref.table}"

    def _collect_foreign_key_links(
        self,
        tables: list[TableRef],
    ) -> dict[tuple[str, str, str], set[tuple[str, str, str]]]:
        table_keys = {
            self._table_key(table_ref) for table_ref in tables if table_ref.object_type == "TABLE"
        }
        by_database: dict[str, set[tuple[str, str, str]]] = {}
        for table_ref in tables:
            if table_ref.object_type != "TABLE":
                continue
            by_database.setdefault(table_ref.database, set()).add(self._table_key(table_ref))

        links: dict[tuple[str, str, str], set[tuple[str, str, str]]] = {}
        for database, scoped_keys in by_database.items():
            try:
                with closing(self._connect(database)) as conn:
                    with conn.cursor() as cursor:
                        cursor.execute(
                            """
                            SELECT
                                OBJECT_SCHEMA_NAME(fk.parent_object_id) AS source_schema,
                                OBJECT_NAME(fk.parent_object_id) AS source_table,
                                OBJECT_SCHEMA_NAME(fk.referenced_object_id) AS target_schema,
                                OBJECT_NAME(fk.referenced_object_id) AS target_table
                            FROM sys.foreign_keys fk
                            """
                        )
                        for row in cursor.fetchall():
                            if not isinstance(row, tuple) or len(row) < 4:
                                continue
                            source_schema, source_table, target_schema, target_table = row
                            source_key = (database, str(source_schema), str(source_table))
                            target_key = (database, str(target_schema), str(target_table))
                            if source_key not in scoped_keys or target_key not in table_keys:
                                continue
                            links.setdefault(source_key, set()).add(target_key)
            except Exception as exc:
                logger.warning(
                    "Could not resolve foreign key links for database %s: %s",
                    database,
                    exc,
                )

        return links

    def _collect_view_dependency_links(
        self,
        tables: list[TableRef],
    ) -> dict[tuple[str, str, str], set[tuple[str, str, str]]]:
        table_keys = {self._table_key(table_ref) for table_ref in tables}
        view_keys = {
            self._table_key(table_ref) for table_ref in tables if table_ref.object_type == "VIEW"
        }

        by_database: dict[str, set[tuple[str, str, str]]] = {}
        for table_ref in tables:
            if table_ref.object_type != "VIEW":
                continue
            by_database.setdefault(table_ref.database, set()).add(self._table_key(table_ref))

        links: dict[tuple[str, str, str], set[tuple[str, str, str]]] = {}
        for database, scoped_views in by_database.items():
            try:
                with closing(self._connect(database)) as conn:
                    with conn.cursor() as cursor:
                        cursor.execute(
                            """
                            SELECT
                              OBJECT_SCHEMA_NAME(dep.referencing_id) AS source_schema,
                              OBJECT_NAME(dep.referencing_id) AS source_name,
                              OBJECT_SCHEMA_NAME(dep.referenced_id) AS target_schema,
                              OBJECT_NAME(dep.referenced_id) AS target_name
                            FROM sys.sql_expression_dependencies dep
                            JOIN sys.views v ON dep.referencing_id = v.object_id
                            WHERE dep.referenced_id IS NOT NULL
                            """
                        )
                        for row in cursor.fetchall():
                            if not isinstance(row, tuple) or len(row) < 4:
                                continue

                            source_schema, source_name, target_schema, target_name = row
                            source_key = (database, str(source_schema), str(source_name))
                            target_key = (database, str(target_schema), str(target_name))

                            if source_key not in scoped_views:
                                continue
                            if target_key not in table_keys:
                                continue
                            if source_key not in view_keys:
                                continue

                            links.setdefault(source_key, set()).add(target_key)
            except Exception as exc:
                logger.warning(
                    "Could not resolve view lineage links for database %s: %s",
                    database,
                    exc,
                )

        return links

    def _collect_dependency_links(
        self,
        tables: list[TableRef],
    ) -> dict[tuple[str, str, str], set[tuple[str, str, str]]]:
        links: dict[tuple[str, str, str], set[tuple[str, str, str]]] = {}

        if self._include_table_lineage_enabled():
            fk_links = self._collect_foreign_key_links(tables)
            for source, targets in fk_links.items():
                links.setdefault(source, set()).update(targets)

        if self._include_view_lineage_enabled():
            view_links = self._collect_view_dependency_links(tables)
            for source, targets in view_links.items():
                links.setdefault(source, set()).update(targets)

        return links

    def _table_to_asset(
        self,
        table_ref: TableRef,
        *,
        links: list[str] | None = None,
    ) -> SingleAssetScanResults:
        asset_name = f"{table_ref.database}.{table_ref.schema}.{table_ref.table}"
        raw_id = self._table_raw_id(table_ref)
        asset_hash = self.generate_hash_id(raw_id)
        external_url = (
            f"mssql://{self._host}:{self._port}/"
            f"{table_ref.database}/{table_ref.schema}.{table_ref.table}"
        )

        metadata = {
            "database": table_ref.database,
            "schema": table_ref.schema,
            "table": table_ref.table,
            "object_type": table_ref.object_type,
            "is_aws_rds": self._is_aws_rds(),
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

        self._log_unsupported_extraction_features()

        pipeline = None
        if self.config.detectors and any(detector.enabled for detector in self.config.detectors):
            from ...pipeline.detector_pipeline import DetectorPipeline

            pipeline = DetectorPipeline.from_recipe(self.recipe, self, self.runner_id)

        tables = self._iter_tables()
        table_hash_by_key: dict[tuple[str, str, str], str] = {
            self._table_key(table_ref): self.generate_hash_id(self._table_raw_id(table_ref))
            for table_ref in tables
        }
        table_fk_links = self._collect_dependency_links(tables)

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
        if len(parts) >= 4 and parts[0].upper() == "MSSQL":
            return TableRef(
                database=parts[-3],
                schema=parts[-2],
                table=parts[-1],
                object_type="TABLE",
            )
        if len(parts) >= 3:
            return TableRef(
                database=parts[-3],
                schema=parts[-2],
                table=parts[-1],
                object_type="TABLE",
            )
        return None

    def _available_columns(self, table_ref: TableRef) -> list[str]:
        with closing(self._connect(table_ref.database)) as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT COLUMN_NAME
                    FROM INFORMATION_SCHEMA.COLUMNS
                    WHERE TABLE_CATALOG = %s
                      AND TABLE_SCHEMA = %s
                      AND TABLE_NAME = %s
                    ORDER BY ORDINAL_POSITION
                    """,
                    (table_ref.database, table_ref.schema, table_ref.table),
                )
                return [
                    row[0]
                    for row in cursor.fetchall()
                    if isinstance(row, tuple) and row and isinstance(row[0], str)
                ]

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
                f"Table {table_ref.database}.{table_ref.schema}.{table_ref.table} has no readable columns"
            )

        quoted_columns = ", ".join(_quote_identifier(column) for column in columns)

        strategy = sampling.strategy
        if strategy == SamplingStrategy.ALL:
            query = (
                f"SELECT {quoted_columns} FROM "
                f"{_quote_identifier(table_ref.schema)}.{_quote_identifier(table_ref.table)}"
            )
            return query, []

        rows_per_page = int(sampling.rows_per_page or 100)
        query = (
            f"SELECT TOP {rows_per_page} {quoted_columns} FROM "
            f"{_quote_identifier(table_ref.schema)}.{_quote_identifier(table_ref.table)}"
        )

        if strategy == SamplingStrategy.LATEST:
            order_column = self._resolve_latest_order_column(columns)
            if order_column:
                query += f" ORDER BY {_quote_identifier(order_column)} DESC"
            elif sampling.fallback_to_random is not False:
                query += " ORDER BY NEWID()"
        elif strategy == SamplingStrategy.RANDOM:
            query += " ORDER BY NEWID()"

        return query, []

    def _count_table_rows(self, table_ref: TableRef) -> int | None:
        try:
            with closing(self._connect(table_ref.database)) as conn:
                with conn.cursor() as cursor:
                    cursor.execute(
                        f"SELECT COUNT(*) FROM {_quote_identifier(table_ref.schema)}.{_quote_identifier(table_ref.table)}"
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
            scope_value=f"{table_ref.database}.{table_ref.schema}.{table_ref.table}",
            strategy=sampling.strategy,
            rows=rows,
            column_names=column_names,
            serialize_cell=self._serialize_cell,
            include_column_names=sampling.include_column_names is not False,
            object_type=table_ref.object_type,
            raw_metadata={
                "database": table_ref.database,
                "schema": table_ref.schema,
                "table": table_ref.table,
            },
        )

    def _fetch_one_page(
        self, table_ref: TableRef, base_query: str, page_size: int, offset: int
    ) -> tuple[list[tuple[Any, ...]], list[str]]:
        with closing(self._connect(table_ref.database)) as conn:
            paginated_query = (
                f"{base_query} ORDER BY (SELECT NULL) "
                f"OFFSET {offset} ROWS FETCH NEXT {page_size} ROWS ONLY"
            )
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
        table_label = f"{table_ref.database}.{table_ref.schema}.{table_ref.table}"

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

        path = f"{table_ref.database}.{table_ref.schema}.{table_ref.table}"
        cached = self._content_cache.get(asset.hash)
        raw_content = cached[0] if cached else None
        metadata = finding.metadata or {}
        finding.location = build_tabular_location(
            raw_content=raw_content,
            matched_content=finding.matched_content,
            base_path=path,
            primary_key_columns=(
                self._get_primary_key_columns(table_ref) if table_ref.object_type == "TABLE" else []
            ),
            row_index=metadata.get("tabular_row_index"),
            column_name=metadata.get("tabular_column_name"),
        )

    def abort(self) -> None:
        logger.info("Aborting MSSQL extraction...")
        super().abort()
