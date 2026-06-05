"""Base class for all tabular (SQL) database sources.

Provides connection management, metadata queries, sampling, keyset pagination,
streaming via ``fetch_content_pages``, row serialization, and asset creation.
Subclasses only need to provide dialect-specific overrides (connection URL,
excluded schemas, random function, etc.).
"""

from __future__ import annotations

import asyncio
import logging
import threading
from abc import abstractmethod
from collections.abc import AsyncGenerator
from datetime import UTC, datetime
from typing import Any

from ..models.generated_input import SamplingConfig, SamplingStrategy
from ..models.generated_single_asset_scan_results import (
    AssetType as OutputAssetType,
)
from ..models.generated_single_asset_scan_results import (
    DetectionResult,
    SingleAssetScanResults,
)
from ..utils.hashing import hash_id, unhash_id
from .base import BaseSource
from .tabular_utils import TableRef, build_tabular_location, format_tabular_sample_content

logger = logging.getLogger(__name__)

# Every key _table_to_asset emits (before per-dialect _extra_asset_metadata).
# Mirrors the "tabularTable" group in the x-assets-metadata catalog; the catalog
# conformance test asserts equality.
TABULAR_METADATA_KEYS: frozenset[str] = frozenset(
    {
        "database",
        "table_name",
        "table_type",
        "schema",
        "column_names",
        "column_count",
        "column_types",
        "row_count",
    }
)

# ── Timestamp columns tried (in priority order) for the LATEST strategy ──
_LATEST_COLUMN_CANDIDATES = (
    "updated_at",
    "modified_at",
    "created_at",
    "inserted_at",
    "timestamp",
    "ts",
    "date",
)


class BaseTabularSource(BaseSource):
    """Shared logic for SQL-based tabular sources.

    Subclasses **must** implement the abstract methods marked below.
    Hook methods provide sensible defaults that can be overridden per dialect.
    """

    STREAM_DETECTIONS = True

    # ── Subclass identity ────────────────────────────────────────────────

    @property
    @abstractmethod
    def _source_label(self) -> str:
        """Human-readable source name for log messages (e.g. ``"PostgreSQL"``)."""

    @abstractmethod
    def _asset_type_value(self) -> str:
        """Return the source-type string used in hash_id (e.g. ``"postgresql"``)."""

    @abstractmethod
    def _sampling(self) -> SamplingConfig:
        """Return the sampling configuration from the recipe."""

    # ── Connection layer ─────────────────────────────────────────────────

    @abstractmethod
    def _connect(self, database: str | None = None) -> Any:
        """Create a **new** raw DBAPI connection for the given database/service."""

    def _is_connection_alive(self, conn: Any) -> bool:
        """Return ``True`` if *conn* is still usable.  Override per driver."""
        try:
            with conn.cursor() as cur:
                cur.close()
            return True
        except Exception:
            return False

    # ── Built-in connection cache (thread-safe) ──────────────────────────

    def __init__(
        self,
        recipe: dict[str, Any],
        source_id: str | None = None,
        runner_id: str | None = None,
    ) -> None:
        super().__init__(recipe, source_id, runner_id)
        self._conn_cache: dict[str, Any] = {}
        self._conn_lock = threading.Lock()
        self._table_lookup: dict[str, TableRef] = {}
        self._content_cache: dict[str, tuple[str, str]] = {}
        self._pk_columns_cache: dict[tuple[str, ...], list[str]] = {}
        self._columns_meta_cache: dict[tuple[str, ...], list[str]] = {}
        self._column_types_cache: dict[tuple[str, ...], dict[str, str]] = {}

    def _get_cached_connection(self, database: str | None = None) -> Any:
        """Return a cached DBAPI connection, creating one if needed."""
        cache_key = database or "__default__"
        with self._conn_lock:
            conn = self._conn_cache.get(cache_key)
            if conn is not None:
                try:
                    if self._is_connection_alive(conn):
                        return conn
                except Exception:
                    pass
                self._conn_cache.pop(cache_key, None)
            conn = self._connect(database)
            self._conn_cache[cache_key] = conn
            return conn

    def cleanup(self) -> None:
        with self._conn_lock:
            for conn in self._conn_cache.values():
                try:
                    conn.close()
                except Exception:
                    pass
            self._conn_cache.clear()

    # ── Identifier quoting ───────────────────────────────────────────────

    @abstractmethod
    def _quote_identifier(self, identifier: str) -> str:
        """Quote a SQL identifier using the dialect's quoting style."""

    def _table_fqn(self, table_ref: TableRef) -> str:
        """Fully-qualified, quoted table name."""
        parts = table_ref.fqn_parts
        return ".".join(self._quote_identifier(p) for p in parts)

    def _table_select_fqn(self, table_ref: TableRef) -> str:
        """Quoted name suitable for a ``FROM`` clause.

        By default this returns the schema-qualified (or db-qualified for 2-level)
        name *without* the database prefix, since many drivers implicitly route
        queries to the connected database.  Subclasses can override when the full
        path is needed (e.g. Snowflake ``db.schema.table``).
        """
        if table_ref.schema is not None:
            return (
                f"{self._quote_identifier(table_ref.schema)}"
                f".{self._quote_identifier(table_ref.table)}"
            )
        return self._quote_identifier(table_ref.table)

    # ── Dialect hooks (override as needed) ───────────────────────────────

    @abstractmethod
    def _random_order_expr(self) -> str:
        """SQL expression for random ordering (e.g. ``RANDOM()``, ``RAND()``)."""

    def _supports_nulls_last(self) -> bool:
        """Whether the dialect supports ``NULLS LAST``."""
        return False

    def _param_placeholder(self) -> str:
        """Parameter placeholder for the driver (default ``%s``)."""
        return "%s"

    def _limit_clause(self, placeholder: str) -> str:
        """Return a ``LIMIT`` clause template.  *placeholder* is the param marker."""
        return f"LIMIT {placeholder}"

    def _offset_clause(self, limit_ph: str, offset_ph: str) -> str:
        """Return ``LIMIT … OFFSET …`` clause.  Override for MSSQL ``OFFSET/FETCH``."""
        return f"LIMIT {limit_ph} OFFSET {offset_ph}"

    # ── Abstract: external URL / metadata ────────────────────────────────

    @abstractmethod
    def _build_external_url(self, table_ref: TableRef) -> str:
        """Build the ``external_url`` for an asset."""

    def _extra_asset_metadata(self, table_ref: TableRef) -> dict[str, Any]:
        """Extra fields merged into the asset metadata dict."""
        return {}

    def _output_asset_type(self, table_ref: TableRef) -> OutputAssetType:
        """Map object_type to the output enum.  Override for VIEW support."""
        return OutputAssetType.TABLE

    # ── Database / table discovery ───────────────────────────────────────

    @abstractmethod
    def _resolve_databases(self) -> list[str]:
        """Return the list of databases (or catalogs/services) to scan."""

    def _default_excluded_schemas(self) -> set[str]:
        """System schemas excluded by default (e.g. ``information_schema``)."""
        return set()

    def _schema_allowlist(self) -> set[str] | None:
        """Return explicit schema include-list, or ``None`` for no filtering."""
        return None

    def _schema_denylist(self) -> set[str]:
        """Return schema deny-list (defaults to ``_default_excluded_schemas``)."""
        return set(self._default_excluded_schemas())

    def _table_allowlist(self) -> set[str]:
        """Return explicit table include-list (lowercased)."""
        return set()

    def _table_limit(self) -> int | None:
        """Max tables per database, or ``None`` for unlimited."""
        return None

    def _list_tables_for_database(self, database: str) -> list[TableRef]:
        """Discover tables in *database*.  Default uses ``information_schema.tables``."""
        schema_allowlist = self._schema_allowlist()
        schema_denylist = self._schema_denylist()
        table_allowlist = self._table_allowlist()
        limit = self._table_limit()

        tables: list[TableRef] = []
        conn = self._get_cached_connection(database)
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
                if not self._accept_table(table_allowlist, database, schema_name, table_name):
                    continue

                tables.append(TableRef(database=database, schema=schema_name, table=table_name))
                if limit is not None and len(tables) >= limit:
                    break
        return tables

    def _accept_table(
        self,
        allowlist: set[str],
        database: str,
        schema: str | None,
        table: str,
    ) -> bool:
        """Check whether a discovered table passes the user's allowlist filter."""
        if not allowlist:
            return True
        if schema is not None:
            schema_table = f"{schema}.{table}".lower()
            db_schema_table = f"{database}.{schema}.{table}".lower()
            return schema_table in allowlist or db_schema_table in allowlist
        db_table = f"{database}.{table}".lower()
        return table.lower() in allowlist or db_table in allowlist

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

    # ── Primary keys ─────────────────────────────────────────────────────

    def _get_primary_key_columns(self, table_ref: TableRef) -> list[str]:
        cache_key = table_ref.table_key
        if cache_key in self._pk_columns_cache:
            return self._pk_columns_cache[cache_key]
        try:
            cols = self._query_primary_key_columns(table_ref)
        except Exception:
            cols = []
        self._pk_columns_cache[cache_key] = cols
        return cols

    def _query_primary_key_columns(self, table_ref: TableRef) -> list[str]:
        """Query the catalog for PK columns.  Override for non-standard catalogs."""
        ph = self._param_placeholder()
        conn = self._get_cached_connection(table_ref.database)
        with conn.cursor() as cursor:
            cursor.execute(
                f"""
                SELECT kcu.column_name
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                  ON tc.constraint_name = kcu.constraint_name
                 AND tc.table_schema = kcu.table_schema
                 AND tc.table_name = kcu.table_name
                WHERE tc.constraint_type = 'PRIMARY KEY'
                  AND tc.table_schema = {ph}
                  AND tc.table_name = {ph}
                ORDER BY kcu.ordinal_position
                """,
                (table_ref.schema, table_ref.table),
            )
            return [row[0] for row in cursor.fetchall() if isinstance(row[0], str)]

    # ── Foreign key links ────────────────────────────────────────────────

    def _collect_foreign_key_links(
        self,
        tables: list[TableRef],
    ) -> dict[tuple[str, ...], set[tuple[str, ...]]]:
        """Return a mapping from table-key to set of linked table-keys.

        Default returns an empty dict.  Override to query FK metadata.
        """
        return {}

    # ── Column metadata ──────────────────────────────────────────────────

    def _cached_columns(self, table_ref: TableRef) -> list[str]:
        """Best-effort column names for asset metadata (cached, never raises)."""
        key = table_ref.table_key
        cached = self._columns_meta_cache.get(key)
        if cached is not None:
            return cached
        try:
            columns = self._available_columns(table_ref)
        except Exception as exc:
            logger.debug("Could not read columns for %s: %s", table_ref.display_name, exc)
            columns = []
        self._columns_meta_cache[key] = columns
        return columns

    def _cached_column_types(self, table_ref: TableRef) -> dict[str, str]:
        """Best-effort ordered ``{column_name: data_type}`` map (cached)."""
        key = table_ref.table_key
        cached = self._column_types_cache.get(key)
        if cached is not None:
            return cached
        try:
            types = self._available_column_types(table_ref)
        except Exception as exc:
            logger.debug("Could not read column types for %s: %s", table_ref.display_name, exc)
            types = {}
        self._column_types_cache[key] = types
        return types

    def _available_column_types(self, table_ref: TableRef) -> dict[str, str]:
        """Return ordered ``{column_name: data_type}`` via ``information_schema``.

        Default works for dialects exposing ``information_schema.columns`` keyed
        by ``table_schema``/``table_name`` (PostgreSQL, MSSQL). Dialects with a
        different catalog override this; failures degrade to names-only.
        """
        ph = self._param_placeholder()
        conn = self._get_cached_connection(table_ref.database)
        with conn.cursor() as cursor:
            cursor.execute(
                f"""
                SELECT column_name, data_type
                FROM information_schema.columns
                WHERE table_schema = {ph} AND table_name = {ph}
                ORDER BY ordinal_position
                """,
                (table_ref.schema, table_ref.table),
            )
            result: dict[str, str] = {}
            for row in cursor.fetchall():
                if not row or not isinstance(row[0], str):
                    continue
                result[row[0]] = str(row[1]) if row[1] is not None else ""
            return result

    def _estimate_row_count(self, table_ref: TableRef) -> int | None:
        """Cheap row-count estimate for asset metadata.

        Default returns ``None`` (omitted). Dialects with a cheap catalog
        estimate (e.g. PostgreSQL ``pg_class.reltuples``) override this; a full
        ``COUNT(*)`` is intentionally avoided so discovery stays fast on large
        tables.
        """
        return None

    def _available_columns(self, table_ref: TableRef) -> list[str]:
        """Return column names in ordinal order.  Uses ``information_schema``."""
        ph = self._param_placeholder()
        conn = self._get_cached_connection(table_ref.database)
        with conn.cursor() as cursor:
            cursor.execute(
                f"""
                SELECT column_name
                FROM information_schema.columns
                WHERE table_schema = {ph} AND table_name = {ph}
                ORDER BY ordinal_position
                """,
                (table_ref.schema, table_ref.table),
            )
            return [col for (col,) in cursor.fetchall() if isinstance(col, str)]

    # ── Sampling query builder ───────────────────────────────────────────

    def _resolve_latest_order_column(self, columns: list[str]) -> str | None:
        sampling = self._sampling()
        configured = sampling.order_by_column
        if configured and configured in columns:
            return configured
        for candidate in _LATEST_COLUMN_CANDIDATES:
            if candidate in columns:
                return candidate
        return None

    def _build_sampling_query(
        self, table_ref: TableRef, columns: list[str]
    ) -> tuple[str, list[Any]]:
        sampling = self._sampling()
        if not columns:
            raise ValueError(f"Table {table_ref.display_name} has no readable columns")

        ph = self._param_placeholder()
        quoted_columns = ", ".join(self._quote_identifier(c) for c in columns)
        query = f"SELECT {quoted_columns} FROM {self._table_select_fqn(table_ref)}"

        strategy = sampling.strategy
        if strategy == SamplingStrategy.LATEST:
            order_column = self._resolve_latest_order_column(columns)
            if order_column:
                nulls = " NULLS LAST" if self._supports_nulls_last() else ""
                query += f" ORDER BY {self._quote_identifier(order_column)} DESC{nulls}"
            elif sampling.fallback_to_random is not False:
                query += f" ORDER BY {self._random_order_expr()}"
        elif strategy == SamplingStrategy.RANDOM:
            query += f" ORDER BY {self._random_order_expr()}"

        if strategy != SamplingStrategy.ALL:
            query += f" {self._limit_clause(ph)}"
            return query, [int(sampling.rows_per_page or 100)]

        return query, []

    # ── Row counting ─────────────────────────────────────────────────────

    def _count_table_rows(self, table_ref: TableRef) -> int | None:
        try:
            conn = self._get_cached_connection(table_ref.database)
            with conn.cursor() as cursor:
                cursor.execute(f"SELECT COUNT(*) FROM {self._table_select_fqn(table_ref)}")
                row = cursor.fetchone()
                return int(row[0]) if row else None
        except Exception:
            return None

    # ── Cell serialization ───────────────────────────────────────────────

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

    # ── Content formatting ───────────────────────────────────────────────

    def _scope_label(self) -> str:
        """Label used in formatted content (``"table"`` for most sources)."""
        return "table"

    def _format_sample_content(
        self,
        table_ref: TableRef,
        column_names: list[str],
        rows: list[tuple[Any, ...]],
        row_offset: int = 0,
    ) -> tuple[str, str]:
        sampling = self._sampling()
        raw_metadata: dict[str, Any] = {"database": table_ref.database, "table": table_ref.table}
        if table_ref.schema is not None:
            raw_metadata["schema"] = table_ref.schema
        return format_tabular_sample_content(
            scope_label=self._scope_label(),
            scope_value=table_ref.display_name,
            strategy=sampling.strategy,
            rows=rows,
            column_names=column_names,
            serialize_cell=self._serialize_cell,
            include_column_names=sampling.include_column_names is not False,
            object_type=table_ref.object_type if table_ref.object_type != "TABLE" else None,
            raw_metadata=raw_metadata,
            row_offset=row_offset,
        )

    # ── Fetch helpers ────────────────────────────────────────────────────

    def _fetch_one_page(
        self, table_ref: TableRef, base_query: str, page_size: int, offset: int
    ) -> tuple[list[tuple[Any, ...]], list[str]]:
        ph = self._param_placeholder()
        conn = self._get_cached_connection(table_ref.database)
        paginated = f"{base_query} {self._offset_clause(ph, ph)}"
        with conn.cursor() as cursor:
            cursor.execute(paginated, [page_size, offset])
            rows = list(cursor.fetchall())
            column_names = [desc[0] for desc in cursor.description] if cursor.description else []
        return rows, column_names

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
        ph = self._param_placeholder()
        params: list[Any]
        if last_pk_values is None:
            paginated = f"{base_query} ORDER BY {pk_order} {self._limit_clause(ph)}"
            params = [page_size]
        elif len(pk_columns) == 1:
            where = f"WHERE {self._quote_identifier(pk_columns[0])} > {ph}"
            paginated = f"{base_query} {where} ORDER BY {pk_order} {self._limit_clause(ph)}"
            params = [last_pk_values[0], page_size]
        else:
            pk_cols_quoted = ", ".join(self._quote_identifier(c) for c in pk_columns)
            placeholders = ", ".join(ph for _ in pk_columns)
            where = f"WHERE ({pk_cols_quoted}) > ({placeholders})"
            paginated = f"{base_query} {where} ORDER BY {pk_order} {self._limit_clause(ph)}"
            params = [*last_pk_values, page_size]

        with conn.cursor() as cursor:
            cursor.execute(paginated, params)
            rows = list(cursor.fetchall())
            column_names = [desc[0] for desc in cursor.description] if cursor.description else []
        return rows, column_names

    @staticmethod
    def _cursor_execute(cursor: Any, query: str) -> list[str]:
        cursor.execute(query)
        return [desc[0] for desc in cursor.description] if cursor.description else []

    @staticmethod
    def _cursor_fetchmany(cursor: Any, size: int) -> list[tuple[Any, ...]]:
        return list(cursor.fetchmany(size))

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
            conn = self._get_cached_connection(table_ref.database)
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

    # ── Asset creation ───────────────────────────────────────────────────

    def _table_to_asset(
        self, table_ref: TableRef, *, links: list[str] | None = None
    ) -> SingleAssetScanResults:
        raw_id = table_ref.raw_id
        asset_hash = self.generate_hash_id(raw_id)
        external_url = self._build_external_url(table_ref)

        metadata: dict[str, Any] = {
            "database": table_ref.database,
            "table": table_ref.table,
            "sampling": {"strategy": str(self._sampling().strategy)},
        }
        if table_ref.schema is not None:
            metadata["schema"] = table_ref.schema
        metadata.update(self._extra_asset_metadata(table_ref))

        # Normalized asset metadata persisted on the asset (consistent keys
        # across all DB/warehouse sources). _extra_asset_metadata contributes
        # source-specific fields (e.g. catalog/account).
        asset_metadata: dict[str, Any] = {
            "database": table_ref.database,
            "table_name": table_ref.table,
            "table_type": table_ref.object_type,
        }
        if table_ref.schema is not None:
            asset_metadata["schema"] = table_ref.schema
        # Prefer the name→type map (one catalog query gives both); fall back to
        # names-only for dialects without a supported column-types query.
        column_types = self._cached_column_types(table_ref)
        columns = list(column_types.keys()) if column_types else self._cached_columns(table_ref)
        if columns:
            asset_metadata["column_names"] = columns
            asset_metadata["column_count"] = len(columns)
        if column_types:
            asset_metadata["column_types"] = column_types
        row_count = self._estimate_row_count(table_ref)
        if row_count is not None and row_count >= 0:
            asset_metadata["row_count"] = row_count
        asset_metadata.update(self._extra_asset_metadata(table_ref))

        now = datetime.now(UTC)
        return SingleAssetScanResults(
            hash=asset_hash,
            checksum=self.calculate_checksum(metadata),
            name=table_ref.display_name,
            external_url=external_url,
            links=links or [],
            asset_type=self._output_asset_type(table_ref),
            source_id=self.source_id,
            created_at=now,
            updated_at=now,
            runner_id=self.runner_id,
            metadata=self.validated_metadata("table", asset_metadata),
        )

    # ── extract_raw (discovery) ──────────────────────────────────────────

    async def extract_raw(self) -> AsyncGenerator[list[SingleAssetScanResults], None]:
        if self._aborted:
            return

        tables = self._iter_tables()
        table_hash_by_key: dict[tuple[str, ...], str] = {
            t.table_key: self.generate_hash_id(t.raw_id) for t in tables
        }
        fk_links = self._collect_foreign_key_links(tables)

        batch: list[SingleAssetScanResults] = []
        for table_ref in tables:
            if self._aborted:
                return

            key = table_ref.table_key
            linked_hashes = [
                table_hash_by_key[target]
                for target in sorted(fk_links.get(key, set()))
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

    # ── generate_hash_id / parse ─────────────────────────────────────────

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
        return self._table_ref_from_parts(parts)

    @abstractmethod
    def _table_ref_from_parts(self, parts: list[str]) -> TableRef | None:
        """Reconstruct a ``TableRef`` from ``_#_``-split ID parts."""

    # ── fetch_content / fetch_content_pages ──────────────────────────────

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

        # ── Non-ALL strategies: single fetch, yield per row ──────────
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

        # ── ALL strategy: keyset pagination or cursor streaming ──────
        columns = self._available_columns(table_ref)
        query, _ = self._build_sampling_query(table_ref, columns)
        rows_per_page = int(sampling.rows_per_page or 100)
        table_label = table_ref.display_name

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

        pk_columns = self._get_primary_key_columns(table_ref)
        pk_indices: list[int] = []
        use_keyset = False
        if pk_columns:
            column_list = self._available_columns(table_ref)
            indices = [column_list.index(c) for c in pk_columns if c in column_list]
            if len(indices) == len(pk_columns):
                pk_indices = indices
                pk_order = ", ".join(self._quote_identifier(c) for c in pk_columns)
                use_keyset = True

        row_offset = 0
        page_num = 1
        last_pk_values: list[Any] | None = None

        conn = self._connect(table_ref.database)
        cursor = conn.cursor() if not use_keyset else None
        try:
            if cursor is not None:
                column_names = await asyncio.to_thread(self._cursor_execute, cursor, query)
                if not column_names:
                    return

            while not self._aborted:
                if total_batches is not None:
                    logger.info("%s batch %d/%d", table_label, page_num, total_batches)

                if use_keyset:
                    rows, column_names = await asyncio.to_thread(
                        self._fetch_page_keyset,
                        conn,
                        query,
                        rows_per_page,
                        pk_columns,
                        pk_order,
                        last_pk_values,
                    )
                else:
                    rows = await asyncio.to_thread(self._cursor_fetchmany, cursor, rows_per_page)
                    if not rows:
                        break

                if not rows or not column_names:
                    break

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

    # ── Finding enrichment ───────────────────────────────────────────────

    def _finding_base_path(self, table_ref: TableRef) -> str:
        """Path prefix used in ``enrich_finding_location``."""
        if table_ref.schema is not None:
            return f"{table_ref.schema}.{table_ref.table}"
        return table_ref.table

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

        path = self._finding_base_path(table_ref)
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

    # ── Test connection ──────────────────────────────────────────────────

    def test_connection(self) -> dict[str, Any]:
        logger.info("Testing connection to %s...", self._source_label)
        result: dict[str, Any] = {
            "timestamp": datetime.now(UTC).isoformat(),
            "source_type": self.recipe.get("type"),
        }
        try:
            databases = self._resolve_databases()
            conn = self._connect(databases[0])
            try:
                with conn.cursor() as cursor:
                    cursor.execute("SELECT 1")
                    cursor.fetchone()
            finally:
                conn.close()
            result["status"] = "SUCCESS"
            result["message"] = (
                f"Successfully connected to {self._source_label}. "
                f"Reachable databases: {len(databases)}."
            )
        except Exception as exc:
            result["status"] = "FAILURE"
            result["message"] = f"Failed to connect to {self._source_label}: {exc}"
        return result

    # ── Abort ────────────────────────────────────────────────────────────

    def abort(self) -> None:
        logger.info("Aborting %s extraction...", self._source_label)
        super().abort()
