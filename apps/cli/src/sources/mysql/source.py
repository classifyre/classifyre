from __future__ import annotations

import logging
import ssl as ssl_module
from collections.abc import AsyncGenerator
from contextlib import closing
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from ...models.generated_input import (
    MySQLInput,
    MySQLOptionalConnection,
    MySQLOptionalScope,
    MySQLSSLMode,
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

_DEFAULT_EXCLUDED_DATABASES = {
    "information_schema",
    "mysql",
    "performance_schema",
    "sys",
}


@dataclass(frozen=True)
class TableRef:
    database: str
    table: str


def _quote_identifier(identifier: str) -> str:
    return f"`{identifier.replace('`', '``')}`"


def _truncate_text(value: str, max_chars: int) -> str:
    if len(value) <= max_chars:
        return value
    if max_chars <= 3:
        return value[:max_chars]
    return f"{value[: max_chars - 3]}..."


class MySQLSource(BaseSource):
    source_type = "mysql"

    def __init__(
        self,
        recipe: dict[str, Any],
        source_id: str | None = None,
        runner_id: str | None = None,
    ) -> None:
        super().__init__(recipe, source_id, runner_id)
        self.config = MySQLInput.model_validate(recipe)
        self.runner_id = runner_id or "local-run"
        self._pymysql = require_module(
            module_name="pymysql",
            source_name="MySQL",
            uv_groups=["mysql"],
            detail="The MySQL connector is optional.",
        )
        self._table_lookup: dict[str, TableRef] = {}
        self._content_cache: dict[str, tuple[str, str]] = {}
        self._pk_columns_cache: dict[tuple[str, str], list[str]] = {}

    def _asset_type_value(self) -> str:
        type_value = self.config.type
        return type_value.value if hasattr(type_value, "value") else str(type_value)

    def _sampling(self) -> SamplingConfig:
        return self.config.sampling

    def _connection_options(self) -> MySQLOptionalConnection:
        if self.config.optional and self.config.optional.connection:
            return self.config.optional.connection
        return MySQLOptionalConnection()

    def _scope_options(self) -> MySQLOptionalScope:
        if self.config.optional and self.config.optional.scope:
            return self.config.optional.scope
        return MySQLOptionalScope()

    def _username(self) -> str:
        return self.config.masked.username

    def _password(self) -> str:
        return self.config.masked.password

    def _build_ssl_kwargs(self, connection_options: MySQLOptionalConnection) -> dict[str, Any]:
        ssl_mode = connection_options.ssl_mode or MySQLSSLMode.PREFERRED
        ssl_ca_pem = self.config.masked.ssl_ca

        if ssl_mode == MySQLSSLMode.DISABLED:
            return {"ssl_disabled": True}

        if ssl_mode == MySQLSSLMode.PREFERRED and not ssl_ca_pem:
            return {}

        ctx = ssl_module.create_default_context()
        if ssl_ca_pem:
            # Normalize PEM: fix escaped newlines from JSON/env round-trips, strip whitespace
            normalized = ssl_ca_pem.replace("\\n", "\n").replace("\r\n", "\n").strip()
            ctx.load_verify_locations(cadata=normalized)

        if ssl_mode == MySQLSSLMode.VERIFY_IDENTITY:
            ctx.check_hostname = True
            ctx.verify_mode = ssl_module.CERT_REQUIRED
        elif ssl_mode == MySQLSSLMode.VERIFY_CA:
            ctx.check_hostname = False
            ctx.verify_mode = ssl_module.CERT_REQUIRED
        else:
            # REQUIRED or PREFERRED with a CA cert — encrypt but don't verify
            ctx.check_hostname = False
            ctx.verify_mode = ssl_module.CERT_NONE

        return {"ssl": ctx}

    def _connect(self, database: str | None = None):
        connection_options = self._connection_options()
        connect_kwargs: dict[str, Any] = {
            "host": self.config.required.host,
            "port": int(self.config.required.port),
            "user": self._username(),
            "password": self._password(),
            "connect_timeout": int(connection_options.connect_timeout_seconds or 10),
        }
        if database:
            connect_kwargs["database"] = database

        connect_kwargs.update(self._build_ssl_kwargs(connection_options))

        if connection_options.allow_public_key_retrieval:
            connect_kwargs["allow_public_key_retrieval"] = True

        connection = self._pymysql.connect(**connect_kwargs)
        connection.autocommit(True)
        return connection

    def _excluded_databases(self) -> set[str]:
        configured = self._scope_options().exclude_databases or []
        excluded = {db.strip() for db in configured if db.strip()}
        if not excluded:
            excluded = set(_DEFAULT_EXCLUDED_DATABASES)
        return excluded

    def _resolve_databases(self) -> list[str]:
        scope_options = self._scope_options()
        include_all = bool(scope_options.include_all_databases)
        configured_database = scope_options.database

        if not include_all:
            if configured_database:
                return [configured_database]
            raise ValueError(
                "MySQL source requires optional.scope.database when include_all_databases is false. "
                "Set optional.scope.database (e.g. 'app_db') or enable include_all_databases."
            )

        excluded = self._excluded_databases()
        databases: list[str] = []
        with closing(self._connect()) as conn:
            with conn.cursor() as cursor:
                cursor.execute("SHOW DATABASES")
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

    def _table_allowlist(self) -> set[str]:
        allowlist: set[str] = set()
        include_tables = self._scope_options().include_tables or []
        for item in include_tables:
            normalized = item.strip().lower()
            if normalized:
                allowlist.add(normalized)
        return allowlist

    def _get_primary_key_columns(self, table_ref: TableRef) -> list[str]:
        cache_key = (table_ref.database, table_ref.table)
        if cache_key in self._pk_columns_cache:
            return self._pk_columns_cache[cache_key]
        try:
            with self._connect(table_ref.database) as conn:
                with conn.cursor() as cursor:
                    cursor.execute(
                        """
                        SELECT column_name
                        FROM information_schema.key_column_usage
                        WHERE constraint_name = 'PRIMARY'
                          AND table_schema = %s
                          AND table_name = %s
                        ORDER BY ordinal_position
                        """,
                        (table_ref.database, table_ref.table),
                    )
                    cols = [row[0] for row in cursor.fetchall() if isinstance(row[0], str)]
        except Exception:
            cols = []
        self._pk_columns_cache[cache_key] = cols
        return cols

    def _list_tables_for_database(self, database: str) -> list[TableRef]:
        table_allowlist = self._table_allowlist()
        table_limit = self._scope_options().table_limit
        limit = int(table_limit) if table_limit else None

        tables: list[TableRef] = []
        with closing(self._connect(database)) as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT table_name
                    FROM information_schema.tables
                    WHERE table_schema = %s
                      AND table_type = 'BASE TABLE'
                    ORDER BY table_name
                    """,
                    (database,),
                )
                for row in cursor.fetchall():
                    table_name = row[0] if isinstance(row, tuple) else None
                    if not isinstance(table_name, str) or not table_name:
                        continue

                    normalized_table = table_name.lower()
                    normalized_db_table = f"{database}.{table_name}".lower()
                    if (
                        table_allowlist
                        and normalized_table not in table_allowlist
                        and normalized_db_table not in table_allowlist
                    ):
                        continue

                    tables.append(TableRef(database=database, table=table_name))
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
        logger.info("Testing connection to MySQL...")
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
                f"Successfully connected to MySQL. Reachable databases: {len(databases)}."
            )
        except Exception as exc:
            result["status"] = "FAILURE"
            result["message"] = f"Failed to connect to MySQL: {exc}"

        return result

    def _table_key(self, table_ref: TableRef) -> tuple[str, str]:
        return (table_ref.database, table_ref.table)

    def _table_raw_id(self, table_ref: TableRef) -> str:
        return f"{table_ref.database}_#_{table_ref.table}"

    def _collect_foreign_key_links(
        self,
        tables: list[TableRef],
    ) -> dict[tuple[str, str], set[tuple[str, str]]]:
        table_keys = {self._table_key(table_ref) for table_ref in tables}
        by_database: dict[str, set[tuple[str, str]]] = {}
        for table_ref in tables:
            by_database.setdefault(table_ref.database, set()).add(self._table_key(table_ref))

        links: dict[tuple[str, str], set[tuple[str, str]]] = {}
        for database, scoped_keys in by_database.items():
            try:
                with closing(self._connect(database)) as conn:
                    with conn.cursor() as cursor:
                        cursor.execute(
                            """
                            SELECT
                                TABLE_SCHEMA AS source_database,
                                TABLE_NAME AS source_table,
                                REFERENCED_TABLE_SCHEMA AS target_database,
                                REFERENCED_TABLE_NAME AS target_table
                            FROM information_schema.KEY_COLUMN_USAGE
                            WHERE TABLE_SCHEMA = %s
                              AND REFERENCED_TABLE_SCHEMA IS NOT NULL
                              AND REFERENCED_TABLE_NAME IS NOT NULL
                            """,
                            (database,),
                        )
                        for source_db, source_table, target_db, target_table in cursor.fetchall():
                            source_key = (source_db, source_table)
                            target_key = (target_db, target_table)
                            if source_key not in scoped_keys:
                                continue
                            if target_key not in table_keys:
                                continue
                            links.setdefault(source_key, set()).add(target_key)
            except Exception as exc:
                logger.warning(
                    "Could not resolve foreign key links for database %s: %s",
                    database,
                    exc,
                )

        return links

    def _table_to_asset(
        self, table_ref: TableRef, *, links: list[str] | None = None
    ) -> SingleAssetScanResults:
        asset_name = f"{table_ref.database}.{table_ref.table}"
        raw_id = self._table_raw_id(table_ref)
        asset_hash = self.generate_hash_id(raw_id)
        external_url = (
            f"mysql://{self.config.required.host}:{self.config.required.port}/"
            f"{table_ref.database}/{table_ref.table}"
        )

        metadata = {
            "database": table_ref.database,
            "table": table_ref.table,
            "sampling": {
                "limit": int(self._sampling().limit or 100),
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
        if len(parts) >= 3 and parts[0].upper() == "MYSQL":
            return TableRef(database=parts[-2], table=parts[-1])
        if len(parts) >= 2:
            return TableRef(database=parts[-2], table=parts[-1])
        return None

    def _available_columns(self, table_ref: TableRef) -> list[str]:
        with closing(self._connect(table_ref.database)) as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT column_name
                    FROM information_schema.columns
                    WHERE table_schema = %s
                      AND table_name = %s
                    ORDER BY ordinal_position
                    """,
                    (table_ref.database, table_ref.table),
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
        max_columns = int(sampling.max_columns or 25)
        selected_columns = columns[:max_columns] if columns else []
        if not selected_columns:
            raise ValueError(
                f"Table {table_ref.database}.{table_ref.table} has no readable columns"
            )

        quoted_columns = ", ".join(_quote_identifier(column) for column in selected_columns)
        query = (
            f"SELECT {quoted_columns} FROM "
            f"{_quote_identifier(table_ref.database)}.{_quote_identifier(table_ref.table)}"
        )

        strategy = sampling.strategy
        if strategy == SamplingStrategy.LATEST:
            order_column = self._resolve_latest_order_column(selected_columns)
            if order_column:
                query += f" ORDER BY {_quote_identifier(order_column)} DESC"
            elif sampling.fallback_to_random is not False:
                query += " ORDER BY RAND()"
        elif strategy == SamplingStrategy.RANDOM:
            query += " ORDER BY RAND()"
        # SamplingStrategy.ALL: no ORDER BY, no LIMIT — return all rows

        if strategy != SamplingStrategy.ALL:
            query += " LIMIT %s"
            return query, [int(sampling.limit or 100)]

        return query, []

    def _serialize_cell(self, value: Any) -> str:
        max_cell_chars = int(self._sampling().max_cell_chars or 512)

        if value is None:
            return "null"
        if isinstance(value, memoryview):
            value = value.tobytes()
        if isinstance(value, (bytes, bytearray)):
            rendered = f"<{len(value)} bytes>"
            return _truncate_text(rendered, max_cell_chars)
        if isinstance(value, datetime):
            return _truncate_text(value.isoformat(), max_cell_chars)
        return _truncate_text(str(value), max_cell_chars)

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
            max_total_chars=int(sampling.max_total_chars or 20000),
            include_column_names=sampling.include_column_names is not False,
            raw_metadata={
                "database": table_ref.database,
                "table": table_ref.table,
            },
        )

    def _fetch_all_rows_batched(
        self, table_ref: TableRef, base_query: str
    ) -> tuple[list[tuple[Any, ...]], list[str]]:
        sampling = self._sampling()
        batch_size = int(sampling.content_batch_size or self.CONTENT_BATCH_SIZE)

        all_rows: list[tuple[Any, ...]] = []
        column_names: list[str] = []
        offset = 0
        batch_num = 0

        with closing(self._connect(table_ref.database)) as conn:
            while True:
                paginated_query = f"{base_query} LIMIT %s OFFSET %s"
                with conn.cursor() as cursor:
                    cursor.execute(paginated_query, [batch_size, offset])
                    batch = list(cursor.fetchall())
                    if not column_names and cursor.description:
                        column_names = [desc[0] for desc in cursor.description]

                if not batch:
                    break

                batch_num += 1
                logger.debug(
                    "Content batch %d: fetched %d rows from %s.%s (offset=%d)",
                    batch_num,
                    len(batch),
                    table_ref.database,
                    table_ref.table,
                    offset,
                )
                all_rows.extend(batch)
                offset += batch_size

                if len(batch) < batch_size:
                    break

        logger.info(
            "Fetched %d rows from %s.%s in %d content batch(es)",
            len(all_rows),
            table_ref.database,
            table_ref.table,
            batch_num,
        )
        return all_rows, column_names

    def _sample_table_rows(self, table_ref: TableRef) -> tuple[str, str] | None:
        columns = self._available_columns(table_ref)
        sampling = self._sampling()
        query, params = self._build_sampling_query(table_ref, columns)

        if sampling.strategy == SamplingStrategy.ALL:
            rows, column_names = self._fetch_all_rows_batched(table_ref, query)
        else:
            with closing(self._connect(table_ref.database)) as conn:
                with conn.cursor() as cursor:
                    cursor.execute(query, params if params else None)
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

        try:
            sampled = self._sample_table_rows(table_ref)
        except Exception as exc:
            logger.error(
                "Failed to sample content for table %s.%s: %s",
                table_ref.database,
                table_ref.table,
                exc,
            )
            return None

        if sampled is None:
            return None

        self._content_cache[asset_id] = sampled
        return sampled

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

        path = table_ref.table
        cached = self._content_cache.get(asset.hash)
        raw_content = cached[0] if cached else None
        metadata = finding.metadata or {}
        finding.location = build_tabular_location(
            raw_content=raw_content,
            matched_content=finding.matched_content,
            base_path=path,
            primary_key_columns=self._get_primary_key_columns(table_ref),
            row_index=metadata.get("tabular_row_index"),
            column_name=metadata.get("tabular_column_name"),
        )

    def abort(self) -> None:
        logger.info("Aborting MySQL extraction...")
        super().abort()
