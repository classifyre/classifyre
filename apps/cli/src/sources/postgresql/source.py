from __future__ import annotations

import logging
from typing import Any

from ...models.generated_input import (
    PostgreSQLInput,
    PostgreSQLOptionalConnection,
    PostgreSQLOptionalScope,
    SamplingConfig,
)
from ..dependencies import require_module
from ..tabular_base import BaseTabularSource
from ..tabular_utils import TableRef, ViewLineage

logger = logging.getLogger(__name__)

_DEFAULT_EXCLUDED_SCHEMAS = {"information_schema", "pg_catalog", "pg_toast"}


def _quote_identifier(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


class PostgreSQLSource(BaseTabularSource):
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

    # ── Identity ─────────────────────────────────────────────────────────

    @property
    def _source_label(self) -> str:
        return "PostgreSQL"

    def _asset_type_value(self) -> str:
        type_value = self.config.type
        return type_value.value if hasattr(type_value, "value") else str(type_value)

    def _sampling(self) -> SamplingConfig:
        return self.config.sampling

    # ── Connection ───────────────────────────────────────────────────────

    def _connection_options(self) -> PostgreSQLOptionalConnection:
        if self.config.optional and self.config.optional.connection:
            return self.config.optional.connection
        return PostgreSQLOptionalConnection()

    def _scope_options(self) -> PostgreSQLOptionalScope:
        if self.config.optional and self.config.optional.scope:
            return self.config.optional.scope
        return PostgreSQLOptionalScope()

    def _connect(self, database: str | None = None) -> Any:
        connection_options = self._connection_options()
        connect_kwargs: dict[str, Any] = {
            "host": self.config.required.host,
            "port": int(self.config.required.port),
            "user": self.config.masked.username,
            "password": self.config.masked.password,
            "dbname": database or "postgres",
            "connect_timeout": int(connection_options.connect_timeout_seconds or 30),
            "sslmode": str(connection_options.ssl_mode or "prefer"),
        }
        connection = self._psycopg2.connect(**connect_kwargs)
        connection.autocommit = True
        return connection

    def _is_connection_alive(self, conn: Any) -> bool:
        try:
            return conn.closed == 0  # type: ignore[no-any-return]
        except Exception:
            return False

    # ── Dialect hooks ────────────────────────────────────────────────────

    def _quote_identifier(self, identifier: str) -> str:
        return _quote_identifier(identifier)

    def _random_order_expr(self) -> str:
        return "RANDOM()"

    def _supports_nulls_last(self) -> bool:
        return True

    # ── Database / table discovery ───────────────────────────────────────

    def _default_excluded_schemas(self) -> set[str]:
        return set(_DEFAULT_EXCLUDED_SCHEMAS)

    def _schema_allowlist(self) -> set[str] | None:
        include_schemas = self._scope_options().include_schemas
        if not include_schemas:
            return None
        return {s.strip() for s in include_schemas if s.strip()}

    def _schema_denylist(self) -> set[str]:
        configured = self._scope_options().exclude_schemas or []
        denylist = {s.strip() for s in configured if s.strip()}
        return denylist if denylist else set(_DEFAULT_EXCLUDED_SCHEMAS)

    def _table_allowlist(self) -> set[str]:
        include_tables = self._scope_options().include_tables or []
        return {item.strip().lower() for item in include_tables if item.strip()}

    def _table_limit(self) -> int | None:
        limit = self._scope_options().table_limit
        return int(limit) if limit else None

    def _resolve_databases(self) -> list[str]:
        scope = self._scope_options()
        include_all = bool(scope.include_all_databases)
        configured_database = scope.database

        if not include_all:
            return [configured_database or "postgres"]

        maintenance_database = scope.maintenance_database or "postgres"
        databases: list[str] = []
        conn = self._get_cached_connection(maintenance_database)
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
        return databases if databases else [maintenance_database]

    # ── Foreign key links (PostgreSQL uses pg_constraint) ────────────────

    # ── Cross-system identity ────────────────────────────────────────────

    def _urn_authority(self) -> str:
        return f"{self.config.required.host}:{self.config.required.port}"

    def _collect_foreign_key_links(
        self,
        tables: list[TableRef],
    ) -> dict[tuple[str, ...], set[tuple[str, ...]]]:
        by_database: dict[str, set[tuple[str, ...]]] = {}
        for t in tables:
            by_database.setdefault(t.database, set()).add(t.table_key)

        links: dict[tuple[str, ...], set[tuple[str, ...]]] = {}
        for database, scoped_keys in by_database.items():
            try:
                conn = self._get_cached_connection(database)
                with conn.cursor() as cursor:
                    cursor.execute(
                        """
                        SELECT
                            source_ns.nspname  AS source_schema,
                            source_tbl.relname AS source_table,
                            target_ns.nspname  AS target_schema,
                            target_tbl.relname AS target_table
                        FROM pg_constraint AS fk
                        JOIN pg_class     AS source_tbl ON source_tbl.oid = fk.conrelid
                        JOIN pg_namespace AS source_ns  ON source_ns.oid  = source_tbl.relnamespace
                        JOIN pg_class     AS target_tbl ON target_tbl.oid = fk.confrelid
                        JOIN pg_namespace AS target_ns  ON target_ns.oid  = target_tbl.relnamespace
                        WHERE fk.contype = 'f'
                        """
                    )
                    for src_schema, src_table, tgt_schema, tgt_table in cursor.fetchall():
                        source_key = (database, src_schema, src_table)
                        target_key = (database, tgt_schema, tgt_table)
                        if source_key in scoped_keys and target_key in scoped_keys:
                            links.setdefault(source_key, set()).add(target_key)
            except Exception as exc:
                logger.warning(
                    "Could not resolve foreign key links for database %s: %s",
                    database,
                    exc,
                )
        return links

    # ── View lineage (pg_depend / pg_rewrite) ────────────────────────────

    def _collect_view_lineage(self, tables: list[TableRef]) -> list[ViewLineage]:
        """What each view in this database selects from.

        `pg_depend` records the dependency the planner already tracks, so this
        is the catalog's own answer rather than a guess parsed out of SQL. The
        view definition comes along for the ride because column-level mappings
        are not in the catalog and have to be recovered from it.
        """
        by_database: dict[str, set[tuple[str, ...]]] = {}
        for t in tables:
            by_database.setdefault(t.database, set()).add(t.table_key)

        results: list[ViewLineage] = []
        for database, scoped_keys in by_database.items():
            try:
                conn = self._get_cached_connection(database)
                with conn.cursor() as cursor:
                    cursor.execute(
                        """
                        SELECT DISTINCT
                            view_ns.nspname     AS view_schema,
                            view_cls.relname    AS view_name,
                            source_ns.nspname   AS source_schema,
                            source_cls.relname  AS source_table,
                            pg_get_viewdef(view_cls.oid, true) AS view_sql
                        FROM pg_depend      AS dep
                        JOIN pg_rewrite     AS rw         ON rw.oid = dep.objid
                        JOIN pg_class       AS view_cls   ON view_cls.oid = rw.ev_class
                        JOIN pg_class       AS source_cls ON source_cls.oid = dep.refobjid
                        JOIN pg_namespace   AS view_ns    ON view_ns.oid = view_cls.relnamespace
                        JOIN pg_namespace   AS source_ns  ON source_ns.oid = source_cls.relnamespace
                        WHERE dep.classid = 'pg_rewrite'::regclass
                          AND dep.refclassid = 'pg_class'::regclass
                          AND dep.deptype = 'n'
                          -- A view depends on itself through its own rewrite
                          -- rule; that is not lineage.
                          AND view_cls.oid <> source_cls.oid
                          AND view_cls.relkind IN ('v', 'm')
                          AND source_ns.nspname NOT IN ('pg_catalog', 'information_schema')
                        """
                    )
                    rows = cursor.fetchall()
            except Exception as exc:
                logger.warning("Could not resolve view lineage for database %s: %s", database, exc)
                continue

            upstreams: dict[tuple[str, ...], set[tuple[str, ...]]] = {}
            definitions: dict[tuple[str, ...], str | None] = {}
            for view_schema, view_name, src_schema, src_table, view_sql in rows:
                view_key = (database, view_schema, view_name)
                if view_key not in scoped_keys:
                    continue
                upstreams.setdefault(view_key, set()).add((database, src_schema, src_table))
                definitions.setdefault(view_key, view_sql)

            results.extend(
                ViewLineage(
                    view=view_key,
                    upstreams=tuple(sorted(sources)),
                    sql=definitions.get(view_key),
                )
                for view_key, sources in upstreams.items()
            )
        return results

    # ── External URL ─────────────────────────────────────────────────────

    def _build_external_url(self, table_ref: TableRef) -> str:
        return (
            f"postgresql://{self.config.required.host}:{self.config.required.port}/"
            f"{table_ref.database}/{table_ref.schema}.{table_ref.table}"
        )

    def _estimate_row_count(self, table_ref: TableRef) -> int | None:
        """Planner row estimate from ``pg_class.reltuples`` (no full COUNT(*)).

        ``reltuples`` is -1 for tables that have never been analyzed/vacuumed;
        those are reported as unknown (``None``).
        """
        try:
            conn = self._get_cached_connection(table_ref.database)
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT c.reltuples::bigint
                    FROM pg_class c
                    JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE n.nspname = %s AND c.relname = %s
                    """,
                    (table_ref.schema, table_ref.table),
                )
                row = cursor.fetchone()
        except Exception as exc:
            logger.debug("Row estimate failed for %s: %s", table_ref.display_name, exc)
            return None
        if not row or row[0] is None:
            return None
        estimate = int(row[0])
        return estimate if estimate >= 0 else None

    # ── Parse table ref from asset ID ────────────────────────────────────

    def _table_ref_from_parts(self, parts: list[str]) -> TableRef | None:
        # Handles: ["POSTGRESQL", db, schema, table] or [db, schema, table]
        if len(parts) >= 4 and parts[0].upper() == "POSTGRESQL":
            return TableRef(database=parts[-3], schema=parts[-2], table=parts[-1])
        if len(parts) >= 3:
            return TableRef(database=parts[-3], schema=parts[-2], table=parts[-1])
        return None
