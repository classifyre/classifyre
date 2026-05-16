from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncGenerator
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from ...models.generated_input import (
    PostgreSQLInput,
    PostgreSQLOptionalConnection,
    PostgreSQLOptionalScope,
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

_DEFAULT_EXCLUDED_SCHEMAS = {"information_schema", "pg_catalog", "pg_toast"}


@dataclass(frozen=True)
class TableRef:
    database: str
    schema: str
    table: str


def _quote_identifier(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


class PostgreSQLSource(BaseSource):
    source_type = "postgresql"

    def __init__(
        self,
        recipe: dict[str, Any],
        source_id: str | None = None,
        runner_id: str | None = None,
    ) -> None:
        super().__init__(recipe, source_id, runner_id)
        self.config = PostgreSQLInput.model_validate(recipe)
        self.runner_id = runner_id or "local-run"
        self._psycopg2 = require_module(
            module_name="psycopg2",
            source_name="PostgreSQL",
            uv_groups=["postgresql"],
            detail="The PostgreSQL connector is optional.",
        )
        self._table_lookup: dict[str, TableRef] = {}
        self._content_cache: dict[str, tuple[str, str]] = {}
        self._pk_columns_cache: dict[tuple[str, str, str], list[str]] = {}

    def _asset_type_value(self) -> str:
        type_value = self.config.type
        return type_value.value if hasattr(type_value, "value") else str(type_value)

    def _sampling(self) -> SamplingConfig:
        return self.config.sampling

    def _connection_options(self) -> PostgreSQLOptionalConnection:
        if self.config.optional and self.config.optional.connection:
            return self.config.optional.connection
        return PostgreSQLOptionalConnection()

    def _scope_options(self) -> PostgreSQLOptionalScope:
        if self.config.optional and self.config.optional.scope:
            return self.config.optional.scope
        return PostgreSQLOptionalScope()

    def _username(self) -> str:
        return self.config.masked.username

    def _password(self) -> str:
        return self.config.masked.password

    def _connect(self, database: str):
        connection_options = self._connection_options()
        connect_kwargs = {
            "host": self.config.required.host,
            "port": int(self.config.required.port),
            "user": self._username(),
            "password": self._password(),
            "dbname": database,
            "connect_timeout": int(connection_options.connect_timeout_seconds or 30),
            "sslmode": str(connection_options.ssl_mode or "prefer"),
        }
        connection = self._psycopg2.connect(**connect_kwargs)
        connection.autocommit = True
        return connection

    def _resolve_databases(self) -> list[str]:
        scope_options = self._scope_options()
        include_all = bool(scope_options.include_all_databases)
        configured_database = scope_options.database

        if not include_all:
            # Default to "postgres" maintenance database when no explicit database is configured,
            # so that connection tests can proceed and report actual auth/connectivity errors.
            return [configured_database or "postgres"]

        maintenance_database = scope_options.maintenance_database or "postgres"
        databases: list[str] = []
        with self._connect(maintenance_database) as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT datname
                    FROM pg_database
                    WHERE datistemplate = false
                      AND datallowconn = true
                      AND datname <> 'rdsadmin'
                    ORDER BY datname
                    """
                )
                for (database_name,) in cursor.fetchall():
                    if isinstance(database_name, str) and database_name:
                        databases.append(database_name)

        if configured_database and configured_database not in databases:
            databases.insert(0, configured_database)

        if not databases:
            return [maintenance_database]
        return databases

    def _table_allowlist(self) -> set[str]:
        allowlist: set[str] = set()
        include_tables = self._scope_options().include_tables or []
        for item in include_tables:
            normalized = item.strip().lower()
            if normalized:
                allowlist.add(normalized)
        return allowlist

    def _schema_allowlist(self) -> set[str] | None:
        include_schemas = self._scope_options().include_schemas
        if not include_schemas:
            return None
        return {schema.strip() for schema in include_schemas if schema.strip()}

    def _schema_denylist(self) -> set[str]:
        configured = self._scope_options().exclude_schemas or []
        denylist = {schema.strip() for schema in configured if schema.strip()}
        if not denylist:
            denylist = set(_DEFAULT_EXCLUDED_SCHEMAS)
        return denylist

    def _get_primary_key_columns(self, table_ref: TableRef) -> list[str]:
        cache_key = (table_ref.database, table_ref.schema, table_ref.table)
        if cache_key in self._pk_columns_cache:
            return self._pk_columns_cache[cache_key]
        try:
            with self._connect(table_ref.database) as conn:
                with conn.cursor() as cursor:
                    cursor.execute(
                        """
                        SELECT kcu.column_name
                        FROM information_schema.table_constraints tc
                        JOIN information_schema.key_column_usage kcu
                          ON tc.constraint_name = kcu.constraint_name
                         AND tc.table_schema = kcu.table_schema
                         AND tc.table_name = kcu.table_name
                        WHERE tc.constraint_type = 'PRIMARY KEY'
                          AND tc.table_schema = %s
                          AND tc.table_name = %s
                        ORDER BY kcu.ordinal_position
                        """,
                        (table_ref.schema, table_ref.table),
                    )
                    cols = [row[0] for row in cursor.fetchall() if isinstance(row[0], str)]
        except Exception:
            cols = []
        self._pk_columns_cache[cache_key] = cols
        return cols

    def _list_tables_for_database(self, database: str) -> list[TableRef]:
        schema_allowlist = self._schema_allowlist()
        schema_denylist = self._schema_denylist()
        table_allowlist = self._table_allowlist()
        table_limit = self._scope_options().table_limit
        limit = int(table_limit) if table_limit else None

        tables: list[TableRef] = []
        with self._connect(database) as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT table_schema, table_name
                    FROM information_schema.tables
                    WHERE table_type = 'BASE TABLE'
                    ORDER BY table_schema, table_name
                    """
                )
                for schema_name, table_name in cursor.fetchall():
                    if not isinstance(schema_name, str) or not isinstance(table_name, str):
                        continue
                    if schema_name in schema_denylist:
                        continue
                    if schema_allowlist and schema_name not in schema_allowlist:
                        continue

                    schema_table = f"{schema_name}.{table_name}".lower()
                    db_schema_table = f"{database}.{schema_name}.{table_name}".lower()
                    if (
                        table_allowlist
                        and schema_table not in table_allowlist
                        and db_schema_table not in table_allowlist
                    ):
                        continue

                    tables.append(TableRef(database=database, schema=schema_name, table=table_name))
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
        logger.info("Testing connection to PostgreSQL...")
        result = {
            "timestamp": datetime.now(UTC).isoformat(),
            "source_type": self.recipe.get("type"),
        }

        try:
            databases = self._resolve_databases()
            with self._connect(databases[0]) as conn:
                with conn.cursor() as cursor:
                    cursor.execute("SELECT 1")
                    cursor.fetchone()
            result["status"] = "SUCCESS"
            result["message"] = (
                f"Successfully connected to PostgreSQL. Reachable databases: {len(databases)}."
            )
        except Exception as exc:
            result["status"] = "FAILURE"
            result["message"] = f"Failed to connect to PostgreSQL: {exc}"

        return result

    def _table_key(self, table_ref: TableRef) -> tuple[str, str, str]:
        return (table_ref.database, table_ref.schema, table_ref.table)

    def _table_raw_id(self, table_ref: TableRef) -> str:
        return f"{table_ref.database}_#_{table_ref.schema}_#_{table_ref.table}"

    def _collect_foreign_key_links(
        self,
        tables: list[TableRef],
    ) -> dict[tuple[str, str, str], set[tuple[str, str, str]]]:
        by_database: dict[str, set[tuple[str, str, str]]] = {}
        for table_ref in tables:
            by_database.setdefault(table_ref.database, set()).add(self._table_key(table_ref))

        links: dict[tuple[str, str, str], set[tuple[str, str, str]]] = {}
        for database, scoped_keys in by_database.items():
            try:
                with self._connect(database) as conn:
                    with conn.cursor() as cursor:
                        cursor.execute(
                            """
                            SELECT
                                source_ns.nspname AS source_schema,
                                source_tbl.relname AS source_table,
                                target_ns.nspname AS target_schema,
                                target_tbl.relname AS target_table
                            FROM pg_constraint AS fk
                            JOIN pg_class AS source_tbl
                              ON source_tbl.oid = fk.conrelid
                            JOIN pg_namespace AS source_ns
                              ON source_ns.oid = source_tbl.relnamespace
                            JOIN pg_class AS target_tbl
                              ON target_tbl.oid = fk.confrelid
                            JOIN pg_namespace AS target_ns
                              ON target_ns.oid = target_tbl.relnamespace
                            WHERE fk.contype = 'f'
                            """
                        )
                        for (
                            source_schema,
                            source_table,
                            target_schema,
                            target_table,
                        ) in cursor.fetchall():
                            source_key = (database, source_schema, source_table)
                            target_key = (database, target_schema, target_table)
                            if source_key not in scoped_keys or target_key not in scoped_keys:
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
        asset_name = f"{table_ref.database}.{table_ref.schema}.{table_ref.table}"
        raw_id = self._table_raw_id(table_ref)
        asset_hash = self.generate_hash_id(raw_id)
        external_url = (
            f"postgresql://{self.config.required.host}:{self.config.required.port}/"
            f"{table_ref.database}/{table_ref.schema}.{table_ref.table}"
        )

        metadata = {
            "database": table_ref.database,
            "schema": table_ref.schema,
            "table": table_ref.table,
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

    STREAM_DETECTIONS = True

    async def extract_raw(self) -> AsyncGenerator[list[SingleAssetScanResults], None]:
        if self._aborted:
            return

        tables = self._iter_tables()
        table_hash_by_key: dict[tuple[str, str, str], str] = {
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
                yield batch
                batch = []

        if batch:
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
        if len(parts) >= 4 and parts[0].upper() == "POSTGRESQL":
            return TableRef(database=parts[-3], schema=parts[-2], table=parts[-1])
        if len(parts) >= 3:
            return TableRef(database=parts[-3], schema=parts[-2], table=parts[-1])
        return None

    def _available_columns(self, table_ref: TableRef) -> list[str]:
        with self._connect(table_ref.database) as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT column_name
                    FROM information_schema.columns
                    WHERE table_schema = %s AND table_name = %s
                    ORDER BY ordinal_position
                    """,
                    (table_ref.schema, table_ref.table),
                )
                columns = [column for (column,) in cursor.fetchall() if isinstance(column, str)]
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
                f"Table {table_ref.database}.{table_ref.schema}.{table_ref.table} has no readable columns"
            )

        quoted_columns = ", ".join(_quote_identifier(column) for column in columns)
        query = (
            f"SELECT {quoted_columns} FROM "
            f"{_quote_identifier(table_ref.schema)}.{_quote_identifier(table_ref.table)}"
        )

        strategy = sampling.strategy
        if strategy == SamplingStrategy.LATEST:
            order_column = self._resolve_latest_order_column(columns)
            if order_column:
                query += f" ORDER BY {_quote_identifier(order_column)} DESC NULLS LAST"
            elif sampling.fallback_to_random is not False:
                query += " ORDER BY RANDOM()"
        elif strategy == SamplingStrategy.RANDOM:
            query += " ORDER BY RANDOM()"
        # SamplingStrategy.ALL: no ORDER BY, no LIMIT — paginated by fetch_content_pages

        if strategy != SamplingStrategy.ALL:
            query += " LIMIT %s"
            return query, [int(sampling.rows_per_page or 100)]

        return query, []

    def _count_table_rows(self, table_ref: TableRef) -> int | None:
        try:
            with self._connect(table_ref.database) as conn:
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
        row_offset: int = 0,
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
            raw_metadata={
                "database": table_ref.database,
                "schema": table_ref.schema,
                "table": table_ref.table,
            },
            row_offset=row_offset,
        )

    def _fetch_one_page(
        self, table_ref: TableRef, base_query: str, page_size: int, offset: int
    ) -> tuple[list[tuple[Any, ...]], list[str]]:
        with self._connect(table_ref.database) as conn:
            paginated_query = f"{base_query} LIMIT %s OFFSET %s"
            with conn.cursor() as cursor:
                cursor.execute(paginated_query, [page_size, offset])
                rows = list(cursor.fetchall())
                column_names = (
                    [desc[0] for desc in cursor.description] if cursor.description else []
                )
        return rows, column_names

    def _fetch_one_page_on_conn(
        self,
        conn: Any,
        base_query: str,
        page_size: int,
        offset: int,
    ) -> tuple[list[tuple[Any, ...]], list[str]]:
        paginated_query = f"{base_query} LIMIT %s OFFSET %s"
        with conn.cursor() as cursor:
            cursor.execute(paginated_query, [page_size, offset])
            rows = list(cursor.fetchall())
            column_names = (
                [desc[0] for desc in cursor.description] if cursor.description else []
            )
        return rows, column_names

    @staticmethod
    def _cursor_execute(cursor: Any, query: str) -> list[str]:
        cursor.execute(query)
        return [desc[0] for desc in cursor.description] if cursor.description else []

    @staticmethod
    def _cursor_fetchmany(cursor: Any, size: int) -> list[tuple[Any, ...]]:
        return list(cursor.fetchmany(size))

    def _fetch_page_keyset(
        self,
        conn: Any,
        base_query: str,
        page_size: int,
        pk_columns: list[str],
        pk_order: str,
        last_pk_values: list[Any] | None,
    ) -> tuple[list[tuple[Any, ...]], list[str]]:
        """Fetch one page using keyset pagination — O(1) cost at any offset."""
        params: list[Any]
        if last_pk_values is None:
            paginated_query = f"{base_query} ORDER BY {pk_order} LIMIT %s"
            params = [page_size]
        elif len(pk_columns) == 1:
            where = f"WHERE {_quote_identifier(pk_columns[0])} > %s"
            paginated_query = f"{base_query} {where} ORDER BY {pk_order} LIMIT %s"
            params = [last_pk_values[0], page_size]
        else:
            pk_cols_quoted = ", ".join(_quote_identifier(col) for col in pk_columns)
            placeholders = ", ".join("%s" for _ in pk_columns)
            where = f"WHERE ({pk_cols_quoted}) > ({placeholders})"
            paginated_query = f"{base_query} {where} ORDER BY {pk_order} LIMIT %s"
            params = [*last_pk_values, page_size]

        with conn.cursor() as cursor:
            cursor.execute(paginated_query, params)
            rows = list(cursor.fetchall())
            column_names = (
                [desc[0] for desc in cursor.description] if cursor.description else []
            )
        return rows, column_names

    def _fetch_sample_rows(
        self, table_ref: TableRef
    ) -> tuple[list[tuple[Any, ...]], list[str]] | None:
        columns = self._available_columns(table_ref)
        sampling = self._sampling()
        query, params = self._build_sampling_query(table_ref, columns)

        if sampling.strategy == SamplingStrategy.ALL:
            rows_per_page = int(sampling.rows_per_page or 100)
            rows, column_names = self._fetch_one_page(table_ref, query, rows_per_page, 0)
        else:
            with self._connect(table_ref.database) as conn:
                with conn.cursor() as cursor:
                    cursor.execute(query, params if params else None)
                    rows = cursor.fetchall()
                    column_names = [desc[0] for desc in cursor.description or []]

        if not column_names:
            return None
        return rows, column_names

    def _sample_table_rows(self, table_ref: TableRef) -> tuple[str, str] | None:
        result = self._fetch_sample_rows(table_ref)
        if result is None:
            return None
        rows, column_names = result
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
        table_ref = self._parse_table_ref_from_asset_id(asset_id)
        if not table_ref:
            return

        if sampling.strategy != SamplingStrategy.ALL:
            result = self._fetch_sample_rows(table_ref)
            if result is None:
                return
            rows, column_names = result
            for i, row in enumerate(rows):
                formatted = self._format_sample_content(
                    table_ref, column_names, [row], row_offset=i
                )
                if formatted:
                    yield formatted
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

        # Prefer keyset pagination (O(1) per page) with a PK-ordered cursor.
        # Fall back to streaming fetchmany (also O(1)) for tables without a primary key.
        pk_columns = self._get_primary_key_columns(table_ref)
        pk_indices: list[int] = []
        use_keyset = False
        if pk_columns:
            column_list = self._available_columns(table_ref)
            indices = [column_list.index(col) for col in pk_columns if col in column_list]
            if len(indices) == len(pk_columns):
                pk_indices = indices
                pk_order = ", ".join(_quote_identifier(col) for col in pk_columns)
                use_keyset = True

        row_offset = 0
        page_num = 1
        last_pk_values: list[Any] | None = None

        conn = self._connect(table_ref.database)
        cursor = conn.cursor() if not use_keyset else None
        try:
            if cursor is not None:
                # Streaming path: execute once, fetchmany in a loop — no OFFSET cost.
                column_names = await asyncio.to_thread(self._cursor_execute, cursor, query)
                if not column_names:
                    return

            while not self._aborted:
                if total_batches is not None:
                    logger.info("%s batch %d/%d", table_label, page_num, total_batches)

                if use_keyset:
                    rows, column_names = await asyncio.to_thread(
                        self._fetch_page_keyset,
                        conn, query, rows_per_page, pk_columns, pk_order, last_pk_values,
                    )
                else:
                    rows = await asyncio.to_thread(self._cursor_fetchmany, cursor, rows_per_page)
                    if not rows:
                        break

                if not rows or not column_names:
                    break

                # Yield each row individually so the detection pipeline can start
                # processing rows while the next page is being fetched in a thread.
                for i, row in enumerate(rows):
                    formatted = self._format_sample_content(
                        table_ref, column_names, [row], row_offset=row_offset + i
                    )
                    if formatted:
                        self._content_cache[asset_id] = formatted
                        yield formatted

                if use_keyset:
                    last_row = rows[-1]
                    last_pk_values = [last_row[pk_indices[j]] for j in range(len(pk_columns))]

                row_offset += len(rows)
                page_num += 1
                if len(rows) < rows_per_page:
                    break
        finally:
            if cursor is not None:
                try:
                    cursor.close()
                except Exception:
                    pass
            conn.close()

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

        path = f"{table_ref.schema}.{table_ref.table}"
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
        logger.info("Aborting PostgreSQL extraction...")
        super().abort()
