"""Base class for Spark-backed lakehouse sources (Delta Lake, Hudi, Spark Catalog).

PySpark has no DBAPI cursor, so this module provides a thin cursor adapter over a
``SparkSession`` (:class:`SparkCursor` / :class:`SparkConnectionAdapter`) that lets
the existing :class:`BaseTabularSource` machinery — discovery, sampling, ``LIMIT``/
``OFFSET`` pagination, ``fetch_content_pages``, asset metadata — be reused unchanged.

Following the Databricks precedent, queries are built with **inline** ``LIMIT``/
``OFFSET`` (no bind params) and keyset pagination is disabled. Operational runtime
controls (master URL, JAR coordinates, executor memory) come from environment
variables, not per-source schema fields — see :mod:`src.utils.spark_runtime`.
"""

from __future__ import annotations

import logging
from abc import abstractmethod
from datetime import UTC, datetime
from typing import Any

from ..models.generated_input import SamplingConfig, SamplingStrategy
from ..utils.hashing import hash_id
from ..utils.spark_runtime import apply_runtime_config
from .tabular_base import BaseTabularSource
from .tabular_utils import TableRef

logger = logging.getLogger(__name__)


def _quote_identifier(identifier: str) -> str:
    return f"`{identifier.replace('`', '``')}`"


class SparkCursor:
    """A minimal DBAPI-style cursor over ``SparkSession.sql``.

    ``execute`` runs the statement and captures the resulting DataFrame; rows are
    materialised lazily via ``toLocalIterator`` for ``fetchmany``/``fetchone`` (so
    full-table ``ALL`` scans stream partition-by-partition without OOM) and via
    ``collect`` for ``fetchall``.
    """

    def __init__(self, session: Any) -> None:
        self._session = session
        self._df: Any = None
        self._iter: Any = None
        self.description: list[tuple[str, ...]] | None = None

    def __enter__(self) -> SparkCursor:
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()

    def execute(self, sql: str, params: Any = None) -> SparkCursor:
        # Spark sources build inline queries; params are unused but accepted for
        # BaseTabularSource compatibility.
        del params
        self._df = self._session.sql(sql)
        self.description = [(field.name,) for field in self._df.schema.fields]
        self._iter = None
        return self

    def _ensure_iter(self) -> None:
        if self._iter is None:
            self._iter = self._df.toLocalIterator()

    def fetchall(self) -> list[tuple[Any, ...]]:
        if self._df is None:
            return []
        return [tuple(row) for row in self._df.collect()]

    def fetchone(self) -> tuple[Any, ...] | None:
        if self._df is None:
            return None
        self._ensure_iter()
        for row in self._iter:
            return tuple(row)
        return None

    def fetchmany(self, size: int) -> list[tuple[Any, ...]]:
        if self._df is None:
            return []
        self._ensure_iter()
        out: list[tuple[Any, ...]] = []
        for row in self._iter:
            out.append(tuple(row))
            if len(out) >= size:
                break
        return out

    def close(self) -> None:
        self._iter = None
        self._df = None


class SparkConnectionAdapter:
    """Wrap a shared ``SparkSession`` so it looks like a DBAPI connection.

    The session lifecycle is owned by the source (see ``BaseSparkSource.cleanup``);
    ``close`` here is a no-op so per-database cache eviction does not stop the
    shared session.
    """

    def __init__(self, session: Any) -> None:
        self.session = session

    def cursor(self) -> SparkCursor:
        return SparkCursor(self.session)

    def close(self) -> None:  # session owned by the source
        pass


class BaseSparkSource(BaseTabularSource):
    """Shared logic for Spark-backed tabular sources.

    Subclasses provide ``self.config`` (a validated ``*Input`` model) and override
    identity + session-config hooks. Catalog discovery (``SHOW DATABASES``/``SHOW
    TABLES``) and inline ``LIMIT``/``OFFSET`` pagination are handled here.
    """

    # Default Maven coordinates for format JARs (overridable via SPARK_JARS_PACKAGES).
    DEFAULT_JARS_PACKAGES: str | None = None

    def __init__(
        self,
        recipe: dict[str, Any],
        source_id: str | None = None,
        runner_id: str | None = None,
    ) -> None:
        super().__init__(recipe, source_id, runner_id)
        # Subclasses call require_module with their literal uv group so the static
        # dependency-group test can map source_type -> group from each source file.
        self._pyspark = self._require_pyspark()
        self._spark: Any = None
        self._path_views: dict[str, str] = {}

    @abstractmethod
    def _require_pyspark(self) -> Any:
        """Import and return the ``pyspark.sql`` module via ``require_module``."""

    # ── Session lifecycle ────────────────────────────────────────────────

    def _session(self) -> Any:
        if self._spark is not None:
            return self._spark
        spark_session = self._pyspark.SparkSession
        builder = spark_session.builder.appName("classifyre")

        remote = self._spark_remote()
        if remote:
            builder = builder.remote(remote)
        else:
            builder = apply_runtime_config(
                builder,
                master=self._spark_master(),
                jars_packages=self._jars_packages(),
                extra_conf=self._extra_spark_conf(),
            )
        self._spark = builder.getOrCreate()
        return self._spark

    def _spark_remote(self) -> str | None:
        """Spark Connect endpoint (sc://...), or None for a classic/local master."""
        return None

    def _spark_master(self) -> str | None:
        """Classic master URL override, or None to use the SPARK_MASTER env var."""
        return None

    def _jars_packages(self) -> str | None:
        """Default Maven coordinates for format runtime JARs (env may override)."""
        return self.DEFAULT_JARS_PACKAGES

    def _extra_spark_conf(self) -> dict[str, str]:
        """Format-specific Spark config (extensions, catalog, storage creds)."""
        return {}

    def _connect(self, database: str | None = None) -> Any:
        del database  # one shared session serves every namespace
        return SparkConnectionAdapter(self._session())

    def _is_connection_alive(self, conn: Any) -> bool:
        try:
            return not conn.session.sparkContext._jsc.sc().isStopped()
        except AttributeError:
            # Spark Connect sessions have no sparkContext; assume alive and let
            # the next SQL call surface any real connectivity failure.
            return True
        except Exception:
            return False

    def cleanup(self) -> None:
        super().cleanup()
        if self._spark is not None:
            try:
                self._spark.stop()
            except Exception:
                pass
            self._spark = None

    # ── Dialect hooks ────────────────────────────────────────────────────

    def _quote_identifier(self, identifier: str) -> str:
        return _quote_identifier(identifier)

    def _random_order_expr(self) -> str:
        return "rand()"

    def _param_placeholder(self) -> str:
        return "%s"  # unused; queries are inline

    def _automatic_supports_keyset(self) -> bool:
        # Lakehouse tables have no enforced primary keys; AUTOMATIC pages via OFFSET.
        return False

    def _get_primary_key_columns(self, table_ref: TableRef) -> list[str]:
        return []

    # ── Scope helpers (duck-typed across the *OptionalScope models) ──────

    def _scope(self) -> Any:
        optional = getattr(self.config, "optional", None)
        return getattr(optional, "scope", None) if optional is not None else None

    def _catalog(self) -> str | None:
        scope = self._scope()
        return getattr(scope, "catalog", None) if scope is not None else None

    def _table_allowlist(self) -> set[str]:
        scope = self._scope()
        configured = getattr(scope, "include_tables", None) if scope is not None else None
        if not configured:
            return set()
        return {entry.strip().lower() for entry in configured if entry and entry.strip()}

    def _table_limit(self) -> int | None:
        scope = self._scope()
        limit = getattr(scope, "table_limit", None) if scope is not None else None
        return int(limit) if limit else None

    # ── Discovery (Spark SQL) ────────────────────────────────────────────

    def _resolve_databases(self) -> list[str]:
        scope = self._scope()
        catalog = self._catalog()
        if (
            scope is not None
            and getattr(scope, "database", None)
            and not getattr(scope, "include_all_databases", False)
        ):
            return [scope.database]
        if scope is not None and getattr(scope, "include_all_databases", False):
            excluded = set(getattr(scope, "exclude_databases", None) or [])
            stmt = "SHOW DATABASES"
            if catalog:
                stmt += f" IN {_quote_identifier(catalog)}"
            conn = self._connect()
            with conn.cursor() as cursor:
                cursor.execute(stmt)
                rows = cursor.fetchall()
            names = [row[-1] for row in rows if row and isinstance(row[-1], str)]
            return [name for name in names if name not in excluded]
        if scope is not None and getattr(scope, "database", None):
            return [scope.database]
        return ["default"]

    def _qualified_database(self, database: str) -> str:
        catalog = self._catalog()
        if catalog:
            return f"{_quote_identifier(catalog)}.{_quote_identifier(database)}"
        return _quote_identifier(database)

    def _list_tables_for_database(self, database: str) -> list[TableRef]:
        conn = self._connect()
        with conn.cursor() as cursor:
            cursor.execute(f"SHOW TABLES IN {self._qualified_database(database)}")
            rows = cursor.fetchall()
        allowlist = self._table_allowlist()
        limit = self._table_limit()
        tables: list[TableRef] = []
        for row in rows:
            # SHOW TABLES => (namespace, tableName, isTemporary)
            table_name = row[1] if len(row) > 1 and isinstance(row[1], str) else None
            if not table_name:
                continue
            if not self._accept_table(allowlist, database, None, table_name):
                continue
            tables.append(TableRef(database=database, schema=None, table=table_name))
            if limit is not None and len(tables) >= limit:
                break
        return tables

    # ── FQN / columns ────────────────────────────────────────────────────

    def _table_select_fqn(self, table_ref: TableRef) -> str:
        if table_ref.object_type == "PATH":
            return self._path_view(table_ref.table)
        catalog = self._catalog()
        if catalog:
            return (
                f"{_quote_identifier(catalog)}.{_quote_identifier(table_ref.database)}"
                f".{_quote_identifier(table_ref.table)}"
            )
        return f"{_quote_identifier(table_ref.database)}.{_quote_identifier(table_ref.table)}"

    def _path_view(self, path: str) -> str:
        """Register a temp view for a format-by-path table and return its name."""
        view = self._path_views.get(path)
        if view is not None:
            return view
        view = "cls_" + hash_id(self.source_type, path)[:16]
        reader = self._session().read.format(self._path_format())
        reader.load(path).createOrReplaceTempView(view)
        self._path_views[path] = view
        return view

    def _path_format(self) -> str:
        """Spark data-source format keyword for path-mode reads (override)."""
        return self.source_type

    def _spark_field_types(self, table_ref: TableRef) -> list[tuple[str, str]]:
        df = self._session().sql(f"SELECT * FROM {self._table_select_fqn(table_ref)} LIMIT 0")
        return [(field.name, field.dataType.simpleString()) for field in df.schema.fields]

    def _available_columns(self, table_ref: TableRef) -> list[str]:
        return [name for name, _ in self._spark_field_types(table_ref)]

    def _available_column_types(self, table_ref: TableRef) -> dict[str, str]:
        return dict(self._spark_field_types(table_ref))

    # ── Inline sampling query + pagination (Databricks pattern) ──────────

    def _build_sampling_query(
        self, table_ref: TableRef, columns: list[str]
    ) -> tuple[str, list[Any]]:
        sampling = self._sampling()
        if not columns:
            raise ValueError(f"Table {table_ref.display_name} has no readable columns")
        quoted_columns = ", ".join(self._quote_identifier(c) for c in columns)
        query = f"SELECT {quoted_columns} FROM {self._table_select_fqn(table_ref)}"

        strategy = sampling.strategy
        if strategy == SamplingStrategy.LATEST:
            order_column = self._resolve_latest_order_column(columns)
            if order_column:
                query += f" ORDER BY {self._quote_identifier(order_column)} DESC"
            elif sampling.fallback_to_random is not False:
                query += f" ORDER BY {self._random_order_expr()}"
        elif strategy == SamplingStrategy.RANDOM:
            query += f" ORDER BY {self._random_order_expr()}"

        if strategy != SamplingStrategy.ALL:
            query += f" LIMIT {int(sampling.rows_per_page or 100)}"
        return query, []

    def _fetch_one_page(
        self, table_ref: TableRef, base_query: str, page_size: int, offset: int
    ) -> tuple[list[tuple[Any, ...]], list[str]]:
        conn = self._get_cached_connection()
        paginated = f"{base_query} LIMIT {page_size} OFFSET {offset}"
        with conn.cursor() as cursor:
            cursor.execute(paginated)
            rows = list(cursor.fetchall())
            column_names = [desc[0] for desc in cursor.description] if cursor.description else []
        return rows, column_names

    # ── Identity / parsing ───────────────────────────────────────────────

    def _sampling(self) -> SamplingConfig:
        return self.config.sampling

    def _asset_type_value(self) -> str:
        type_value = self.config.type
        return type_value.value if hasattr(type_value, "value") else str(type_value)

    def generate_hash_id(self, asset_id: str) -> str:
        return hash_id(self._asset_type_value(), asset_id)

    def _table_ref_from_parts(self, parts: list[str]) -> TableRef | None:
        if len(parts) >= 2:
            return TableRef(database=parts[-2], schema=None, table=parts[-1])
        return None

    # ── Test connection ──────────────────────────────────────────────────

    def test_connection(self) -> dict[str, Any]:
        logger.info("Testing connection to %s...", self._source_label)
        result: dict[str, Any] = {
            "timestamp": datetime.now(UTC).isoformat(),
            "source_type": self.recipe.get("type"),
        }
        try:
            conn = self._connect()
            with conn.cursor() as cursor:
                cursor.execute("SELECT 1")
                cursor.fetchone()
            result["status"] = "SUCCESS"
            result["message"] = f"Successfully started a Spark session for {self._source_label}."
        except Exception as exc:
            result["status"] = "FAILURE"
            result["message"] = f"Failed to start a Spark session for {self._source_label}: {exc}"
        return result

    # ── Abstract: subclass identity / metadata ───────────────────────────

    @property
    @abstractmethod
    def _source_label(self) -> str: ...

    @abstractmethod
    def _build_external_url(self, table_ref: TableRef) -> str: ...
