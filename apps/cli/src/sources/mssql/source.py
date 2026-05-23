from __future__ import annotations

import logging
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
from ..dependencies import require_module
from ..tabular_base import BaseTabularSource
from ..tabular_utils import TableRef

logger = logging.getLogger(__name__)

_DEFAULT_EXCLUDED_DATABASES = {"master", "tempdb", "model"}
_DEFAULT_EXCLUDED_SCHEMAS = {"INFORMATION_SCHEMA", "sys"}


def _quote_identifier(identifier: str) -> str:
    return f"[{identifier.replace(']', ']]')}]"


class MSSQLSource(BaseTabularSource):
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
        self._unsupported_feature_warning_logged = False

    # ── Identity ─────────────────────────────────────────────────────────

    @property
    def _source_label(self) -> str:
        return "MSSQL"

    def _asset_type_value(self) -> str:
        type_value = self.config.type
        return type_value.value if hasattr(type_value, "value") else str(type_value)

    def _sampling(self) -> SamplingConfig:
        return self.config.sampling

    # ── Connection ───────────────────────────────────────────────────────

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

    def _connect(self, database: str | None = None) -> Any:
        connection_options = self._connection_options()
        connect_kwargs: dict[str, Any] = {
            "server": self._host,
            "port": int(self._port),
            "user": self._username(),
            "password": self._password(),
            "login_timeout": int(connection_options.connect_timeout_seconds or 30),
            "timeout": int(connection_options.connect_timeout_seconds or 30),
        }
        if database:
            connect_kwargs["database"] = database

        connection = self._pymssql.connect(**connect_kwargs)
        try:
            connection.autocommit(True)
        except Exception:
            pass
        return connection

    # ── Dialect hooks ────────────────────────────────────────────────────

    def _quote_identifier(self, identifier: str) -> str:
        return _quote_identifier(identifier)

    def _random_order_expr(self) -> str:
        return "NEWID()"

    def _limit_clause(self, placeholder: str) -> str:
        # MSSQL uses TOP N for non-ALL sampling, but for keyset/offset pagination
        # it uses OFFSET/FETCH. The base class calls _limit_clause for keyset pages.
        return f"OFFSET 0 ROWS FETCH NEXT {placeholder} ROWS ONLY"

    def _offset_clause(self, limit_ph: str, offset_ph: str) -> str:
        return f"OFFSET {offset_ph} ROWS FETCH NEXT {limit_ph} ROWS ONLY"

    def _output_asset_type(self, table_ref: TableRef) -> OutputAssetType:
        return OutputAssetType.TABLE

    # ── MSSQL uses SELECT TOP N for sampling ─────────────────────────────

    def _build_sampling_query(
        self, table_ref: TableRef, columns: list[str]
    ) -> tuple[str, list[Any]]:
        sampling = self._sampling()
        if not columns:
            raise ValueError(f"Table {table_ref.display_name} has no readable columns")

        quoted_columns = ", ".join(self._quote_identifier(c) for c in columns)
        from_expr = self._table_select_fqn(table_ref)

        strategy = sampling.strategy
        if strategy == SamplingStrategy.ALL:
            return f"SELECT {quoted_columns} FROM {from_expr}", []

        rows_per_page = int(sampling.rows_per_page or 100)
        query = f"SELECT TOP {rows_per_page} {quoted_columns} FROM {from_expr}"

        if strategy == SamplingStrategy.LATEST:
            order_column = self._resolve_latest_order_column(columns)
            if order_column:
                query += f" ORDER BY {self._quote_identifier(order_column)} DESC"
            elif sampling.fallback_to_random is not False:
                query += f" ORDER BY {self._random_order_expr()}"
        elif strategy == SamplingStrategy.RANDOM:
            query += f" ORDER BY {self._random_order_expr()}"

        return query, []

    # ── MSSQL OFFSET/FETCH pagination ────────────────────────────────────

    def _fetch_one_page(
        self, table_ref: TableRef, base_query: str, page_size: int, offset: int
    ) -> tuple[list[tuple[Any, ...]], list[str]]:
        conn = self._get_cached_connection(table_ref.database)
        paginated_query = (
            f"{base_query} ORDER BY (SELECT NULL) "
            f"OFFSET {offset} ROWS FETCH NEXT {page_size} ROWS ONLY"
        )
        with conn.cursor() as cursor:
            cursor.execute(paginated_query)
            rows = list(cursor.fetchall())
            column_names = [desc[0] for desc in cursor.description] if cursor.description else []
        return rows, column_names

    # ── MSSQL expanded-OR keyset pagination ──────────────────────────────

    def _fetch_page_keyset(
        self,
        conn: Any,
        base_query: str,
        page_size: int,
        pk_columns: list[str],
        pk_order: str,
        last_pk_values: list[Any] | None,
    ) -> tuple[list[tuple[Any, ...]], list[str]]:
        if last_pk_values is None:
            paginated_query = (
                f"{base_query} ORDER BY {pk_order} OFFSET 0 ROWS FETCH NEXT {page_size} ROWS ONLY"
            )
            params: list[Any] = []
        elif len(pk_columns) == 1:
            where = f"WHERE {self._quote_identifier(pk_columns[0])} > %s"
            paginated_query = (
                f"{base_query} {where} ORDER BY {pk_order} "
                f"OFFSET 0 ROWS FETCH NEXT {page_size} ROWS ONLY"
            )
            params = [last_pk_values[0]]
        else:
            # Composite PK: expanded OR form for broad MSSQL compatibility
            conditions = []
            params = []
            for i in range(len(pk_columns)):
                eq_parts = " AND ".join(
                    f"{self._quote_identifier(pk_columns[j])} = %s" for j in range(i)
                )
                gt_part = f"{self._quote_identifier(pk_columns[i])} > %s"
                if eq_parts:
                    conditions.append(f"({eq_parts} AND {gt_part})")
                    params.extend(last_pk_values[:i])
                    params.append(last_pk_values[i])
                else:
                    conditions.append(f"({gt_part})")
                    params.append(last_pk_values[i])
            where = "WHERE " + " OR ".join(conditions)
            paginated_query = (
                f"{base_query} {where} ORDER BY {pk_order} "
                f"OFFSET 0 ROWS FETCH NEXT {page_size} ROWS ONLY"
            )

        with conn.cursor() as cursor:
            cursor.execute(paginated_query, params if params else None)
            rows = list(cursor.fetchall())
            column_names = [desc[0] for desc in cursor.description] if cursor.description else []
        return rows, column_names

    # ── Database / table discovery ───────────────────────────────────────

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
        conn = self._get_cached_connection()
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

    def _excluded_databases(self) -> set[str]:
        configured = self._scope_options().exclude_databases or []
        excluded = {name.strip() for name in configured if name.strip()}
        return excluded if excluded else set(_DEFAULT_EXCLUDED_DATABASES)

    def _default_excluded_schemas(self) -> set[str]:
        return set(_DEFAULT_EXCLUDED_SCHEMAS)

    def _schema_allowlist(self) -> set[str] | None:
        configured = self._scope_options().include_schemas
        if not configured:
            return None
        return {schema.strip() for schema in configured if schema.strip()}

    def _schema_denylist(self) -> set[str]:
        configured = self._scope_options().exclude_schemas or []
        denylist = {schema.strip() for schema in configured if schema.strip()}
        return denylist if denylist else set(_DEFAULT_EXCLUDED_SCHEMAS)

    def _include_tables_enabled(self) -> bool:
        return self._scope_options().include_tables is not False

    def _include_views_enabled(self) -> bool:
        return self._scope_options().include_views is not False

    def _include_table_lineage_enabled(self) -> bool:
        return self._extraction_options().include_table_lineage is not False

    def _include_view_lineage_enabled(self) -> bool:
        return self._extraction_options().include_view_lineage is not False

    def _object_allowlist(self) -> set[str]:
        include_objects = self._scope_options().include_objects or []
        return {entry.strip().lower() for entry in include_objects if entry.strip()}

    def _table_limit(self) -> int | None:
        table_limit = self._scope_options().table_limit
        return int(table_limit) if table_limit else None

    def _list_tables_for_database(self, database: str) -> list[TableRef]:
        include_tables = self._include_tables_enabled()
        include_views = self._include_views_enabled()
        if not include_tables and not include_views:
            return []

        schema_allowlist = self._schema_allowlist()
        schema_denylist = self._schema_denylist()
        object_allowlist = self._object_allowlist()
        limit = self._table_limit()

        tables: list[TableRef] = []
        conn = self._get_cached_connection(database)
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

    # ── Primary keys (MSSQL-specific: TABLE_CATALOG) ─────────────────────

    def _query_primary_key_columns(self, table_ref: TableRef) -> list[str]:
        if table_ref.object_type == "VIEW":
            return []
        conn = self._get_cached_connection(table_ref.database)
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
            return [
                row[0]
                for row in cursor.fetchall()
                if isinstance(row, tuple) and row and isinstance(row[0], str)
            ]

    # ── Column metadata (MSSQL uses TABLE_CATALOG) ───────────────────────

    def _available_columns(self, table_ref: TableRef) -> list[str]:
        conn = self._get_cached_connection(table_ref.database)
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

    # ── Foreign key + view dependency links (merged) ─────────────────────

    def _collect_foreign_key_links(
        self,
        tables: list[TableRef],
    ) -> dict[tuple[str, ...], set[tuple[str, ...]]]:
        links: dict[tuple[str, ...], set[tuple[str, ...]]] = {}

        if self._include_table_lineage_enabled():
            fk_links = self._collect_fk_links(tables)
            for source, targets in fk_links.items():
                links.setdefault(source, set()).update(targets)

        if self._include_view_lineage_enabled():
            view_links = self._collect_view_dependency_links(tables)
            for source, targets in view_links.items():
                links.setdefault(source, set()).update(targets)

        return links

    def _collect_fk_links(
        self,
        tables: list[TableRef],
    ) -> dict[tuple[str, ...], set[tuple[str, ...]]]:
        table_keys = {t.table_key for t in tables if t.object_type == "TABLE"}
        by_database: dict[str, set[tuple[str, ...]]] = {}
        for t in tables:
            if t.object_type != "TABLE":
                continue
            by_database.setdefault(t.database, set()).add(t.table_key)

        links: dict[tuple[str, ...], set[tuple[str, ...]]] = {}
        for database, scoped_keys in by_database.items():
            try:
                conn = self._get_cached_connection(database)
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
                    "Could not resolve foreign key links for database %s: %s", database, exc
                )
        return links

    def _collect_view_dependency_links(
        self,
        tables: list[TableRef],
    ) -> dict[tuple[str, ...], set[tuple[str, ...]]]:
        table_keys = {t.table_key for t in tables}
        view_keys = {t.table_key for t in tables if t.object_type == "VIEW"}
        by_database: dict[str, set[tuple[str, ...]]] = {}
        for t in tables:
            if t.object_type != "VIEW":
                continue
            by_database.setdefault(t.database, set()).add(t.table_key)

        links: dict[tuple[str, ...], set[tuple[str, ...]]] = {}
        for database, scoped_views in by_database.items():
            try:
                conn = self._get_cached_connection(database)
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
                        if source_key not in scoped_views or source_key not in view_keys:
                            continue
                        if target_key not in table_keys:
                            continue
                        links.setdefault(source_key, set()).add(target_key)
            except Exception as exc:
                logger.warning(
                    "Could not resolve view lineage links for database %s: %s", database, exc
                )
        return links

    # ── Unsupported extraction feature warnings ──────────────────────────

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

    # ── External URL ─────────────────────────────────────────────────────

    def _build_external_url(self, table_ref: TableRef) -> str:
        return (
            f"mssql://{self._host}:{self._port}/"
            f"{table_ref.database}/{table_ref.schema}.{table_ref.table}"
        )

    def _extra_asset_metadata(self, table_ref: TableRef) -> dict[str, Any]:
        return {
            "object_type": table_ref.object_type,
            "is_aws_rds": self._is_aws_rds(),
        }

    def _finding_base_path(self, table_ref: TableRef) -> str:
        return f"{table_ref.database}.{table_ref.schema}.{table_ref.table}"

    # ── Override extract_raw to log unsupported features ──────────────────

    async def extract_raw(self, *args: Any, **kwargs: Any) -> Any:
        self._log_unsupported_extraction_features()
        async for batch in super().extract_raw():
            yield batch

    # ── Parse table ref from asset ID ────────────────────────────────────

    def _table_ref_from_parts(self, parts: list[str]) -> TableRef | None:
        if len(parts) >= 4 and parts[0].upper() == "MSSQL":
            return TableRef(
                database=parts[-3], schema=parts[-2], table=parts[-1], object_type="TABLE"
            )
        if len(parts) >= 3:
            return TableRef(
                database=parts[-3], schema=parts[-2], table=parts[-1], object_type="TABLE"
            )
        return None
