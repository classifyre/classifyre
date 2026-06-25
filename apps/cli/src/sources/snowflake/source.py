from __future__ import annotations

import logging
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from ...models.generated_input import (
    SamplingConfig,
    SamplingStrategy,
    SnowflakeInput,
    SnowflakeMaskedDefaultAuthenticator,
    SnowflakeMaskedExternalBrowserAuthenticator,
    SnowflakeMaskedKeyPairAuthenticator,
    SnowflakeMaskedOauthAuthenticatorToken,
    SnowflakeOptionalConnection,
    SnowflakeOptionalExtraction,
    SnowflakeOptionalScope,
    SnowflakeRequiredDefaultAuthenticator,
    SnowflakeRequiredExternalBrowserAuthenticator,
    SnowflakeRequiredKeyPairAuthenticator,
    SnowflakeRequiredOauthAuthenticatorToken,
)
from ..dependencies import require_module
from ..tabular_base import BaseTabularSource
from ..tabular_utils import TableRef

logger = logging.getLogger(__name__)

_DEFAULT_EXCLUDED_DATABASES = {"SNOWFLAKE", "SNOWFLAKE_SAMPLE_DATA"}
_DEFAULT_EXCLUDED_SCHEMAS = {"INFORMATION_SCHEMA"}


def _quote_identifier(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


class SnowflakeSource(BaseTabularSource):
    source_type = "snowflake"

    def __init__(
        self,
        recipe: dict[str, Any],
        source_id: str | None = None,
        runner_id: str | None = None,
    ) -> None:
        super().__init__(recipe, source_id, runner_id)
        self.config = SnowflakeInput.model_validate(recipe)
        self.runner_id = runner_id or "local-run"
        self._snowflake = require_module(
            module_name="snowflake.connector",
            source_name="Snowflake",
            uv_groups=["snowflake"],
            detail="The Snowflake connector is optional.",
        )
        self._validate_auth_configuration()

    # ── Auth validation ──────────────────────────────────────────────────

    def _validate_auth_configuration(self) -> None:
        required = self.config.required
        masked = self.config.masked

        if isinstance(required, SnowflakeRequiredDefaultAuthenticator):
            if not isinstance(masked, SnowflakeMaskedDefaultAuthenticator):
                raise ValueError(
                    "SNOWFLAKE DEFAULT_AUTHENTICATOR requires masked.username and masked.password"
                )
            return
        if isinstance(required, SnowflakeRequiredExternalBrowserAuthenticator):
            if not isinstance(masked, SnowflakeMaskedExternalBrowserAuthenticator):
                raise ValueError(
                    "SNOWFLAKE EXTERNAL_BROWSER_AUTHENTICATOR requires masked.username"
                )
            return
        if isinstance(required, SnowflakeRequiredKeyPairAuthenticator):
            if not isinstance(masked, SnowflakeMaskedKeyPairAuthenticator):
                raise ValueError(
                    "SNOWFLAKE KEY_PAIR_AUTHENTICATOR requires masked.username and masked.private_key"
                )
            return
        if isinstance(required, SnowflakeRequiredOauthAuthenticatorToken):
            if not isinstance(masked, SnowflakeMaskedOauthAuthenticatorToken):
                raise ValueError(
                    "SNOWFLAKE OAUTH_AUTHENTICATOR_TOKEN requires masked.username and masked.token"
                )
            return
        raise ValueError("Unsupported SNOWFLAKE auth configuration")

    # ── Identity ─────────────────────────────────────────────────────────

    @property
    def _source_label(self) -> str:
        return "Snowflake"

    def _asset_type_value(self) -> str:
        type_value = self.config.type
        return type_value.value if hasattr(type_value, "value") else str(type_value)

    def _sampling(self) -> SamplingConfig:
        return self.config.sampling

    # ── Connection ───────────────────────────────────────────────────────

    def _connection_options(self) -> SnowflakeOptionalConnection:
        if self.config.optional and self.config.optional.connection:
            return self.config.optional.connection
        return SnowflakeOptionalConnection()

    def _scope_options(self) -> SnowflakeOptionalScope:
        if self.config.optional and self.config.optional.scope:
            return self.config.optional.scope
        return SnowflakeOptionalScope()

    def _extraction_options(self) -> SnowflakeOptionalExtraction:
        if self.config.optional and self.config.optional.extraction:
            return self.config.optional.extraction
        return SnowflakeOptionalExtraction()

    def _account_id(self) -> str:
        return self.config.required.account_id

    def _snowflake_domain(self) -> str:
        domain = self._connection_options().snowflake_domain
        return str(domain or "snowflakecomputing.com")

    def _account_locator(self) -> str:
        account_id = self._account_id().strip().removeprefix("https://").removeprefix("http://")
        account_id = account_id.rstrip("/")
        suffix = f".{self._snowflake_domain()}"
        if account_id.endswith(suffix):
            return account_id[: -len(suffix)]
        return account_id

    def _build_private_key_bytes(self, private_key: str, password: str | None) -> bytes:
        from cryptography.hazmat.backends import default_backend
        from cryptography.hazmat.primitives import serialization

        pkey_bytes = private_key.replace("\\n", "\n").encode()
        private_key_obj = serialization.load_pem_private_key(
            pkey_bytes,
            password=password.encode() if password else None,
            backend=default_backend(),
        )
        return private_key_obj.private_bytes(
            encoding=serialization.Encoding.DER,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )

    def _connect(self, database: str | None = None) -> Any:
        required = self.config.required
        masked = self.config.masked
        connection_options = self._connection_options()

        connect_kwargs: dict[str, Any] = {
            "account": self._account_locator(),
            "user": masked.username,
            "login_timeout": int(connection_options.connect_timeout_seconds or 30),
            "session_parameters": {
                "QUERY_TAG": "classifyre-snowflake-source",
            },
        }
        if connection_options.warehouse:
            connect_kwargs["warehouse"] = connection_options.warehouse
        if connection_options.role:
            connect_kwargs["role"] = connection_options.role

        auth_type = required.authentication_type
        if isinstance(required, SnowflakeRequiredDefaultAuthenticator):
            assert isinstance(masked, SnowflakeMaskedDefaultAuthenticator)
            connect_kwargs["password"] = masked.password
        elif isinstance(required, SnowflakeRequiredExternalBrowserAuthenticator):
            connect_kwargs["authenticator"] = "externalbrowser"
        elif isinstance(required, SnowflakeRequiredKeyPairAuthenticator):
            assert isinstance(masked, SnowflakeMaskedKeyPairAuthenticator)
            connect_kwargs["private_key"] = self._build_private_key_bytes(
                masked.private_key,
                masked.private_key_password,
            )
            connect_kwargs["authenticator"] = "snowflake_jwt"
        elif isinstance(required, SnowflakeRequiredOauthAuthenticatorToken):
            assert isinstance(masked, SnowflakeMaskedOauthAuthenticatorToken)
            connect_kwargs["token"] = masked.token
            connect_kwargs["authenticator"] = "oauth"
        else:
            raise ValueError(f"Unsupported SNOWFLAKE authentication type: {auth_type}")

        connect_args = connection_options.connect_args or {}
        if isinstance(connect_args, dict):
            connect_kwargs.update(connect_args)

        return self._snowflake.connect(**connect_kwargs)

    def _is_connection_alive(self, conn: Any) -> bool:
        try:
            return not conn.is_closed()
        except Exception:
            return False

    # ── Dict row normalization (Snowflake may return dicts) ──────────────

    def _fetch_dict_rows(self, cursor: Any) -> list[dict[str, Any]]:
        rows = cursor.fetchall()
        description = getattr(cursor, "description", None) or []
        columns = [str(col[0]).upper() for col in description if isinstance(col, tuple) and col]

        result: list[dict[str, Any]] = []
        for row in rows:
            if isinstance(row, dict):
                result.append({str(key).upper(): value for key, value in row.items()})
                continue
            if isinstance(row, tuple):
                mapped: dict[str, Any] = {}
                for index, value in enumerate(row):
                    key = columns[index] if index < len(columns) else f"COL_{index}"
                    mapped[key] = value
                result.append(mapped)
        return result

    def _normalize_rows(self, rows: list[Any], column_names: list[str]) -> list[tuple[Any, ...]]:
        normalized: list[tuple[Any, ...]] = []
        for row in rows:
            if isinstance(row, tuple):
                normalized.append(row)
            elif isinstance(row, dict):
                normalized.append(tuple(row.get(column) for column in column_names))
        return normalized

    # ── Dialect hooks ────────────────────────────────────────────────────

    def _quote_identifier(self, identifier: str) -> str:
        return _quote_identifier(identifier)

    def _random_order_expr(self) -> str:
        return "RANDOM()"

    # ── Snowflake uses db.schema.table in FROM ───────────────────────────

    def _table_select_fqn(self, table_ref: TableRef) -> str:
        return (
            f"{self._quote_identifier(table_ref.database)}"
            f".{self._quote_identifier(table_ref.schema or '')}"
            f".{self._quote_identifier(table_ref.table)}"
        )

    # ── Snowflake uses inline LIMIT (no params) ─────────────────────────

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

        query = f"SELECT {quoted_columns} FROM {from_expr}"
        if strategy == SamplingStrategy.LATEST:
            order_column = self._resolve_latest_order_column(columns)
            if order_column:
                query += f" ORDER BY {self._quote_identifier(order_column)} DESC"
            elif sampling.fallback_to_random is not False:
                query += f" ORDER BY {self._random_order_expr()}"
        elif strategy == SamplingStrategy.RANDOM:
            query += f" ORDER BY {self._random_order_expr()}"

        query += f" LIMIT {int(sampling.rows_per_page or 100)}"
        return query, []

    # ── Case-insensitive column resolution ───────────────────────────────

    def _resolve_latest_order_column(self, columns: list[str]) -> str | None:
        sampling = self._sampling()
        configured = sampling.order_by_column
        if configured:
            for column in columns:
                if column == configured or column.lower() == configured.lower():
                    return column

        from ..tabular_base import _LATEST_COLUMN_CANDIDATES

        lower_lookup = {column.lower(): column for column in columns}
        for candidate in _LATEST_COLUMN_CANDIDATES:
            if candidate in lower_lookup:
                return lower_lookup[candidate]
        return None

    # ── Decimal/date handling in cell serialization ──────────────────────

    def _serialize_cell(self, value: Any) -> str:
        if value is None:
            return "null"
        if isinstance(value, memoryview):
            value = value.tobytes()
        if isinstance(value, (bytes, bytearray)):
            return f"<{len(value)} bytes>"
        if isinstance(value, (datetime, date)):
            return value.isoformat()
        if isinstance(value, Decimal):
            return str(value)
        return str(value)

    # ── Snowflake-specific pagination (inline LIMIT/OFFSET) ──────────────

    def _fetch_one_page(
        self, table_ref: TableRef, base_query: str, page_size: int, offset: int
    ) -> tuple[list[tuple[Any, ...]], list[str]]:
        conn = self._get_cached_connection(table_ref.database)
        paginated_query = f"{base_query} LIMIT {page_size} OFFSET {offset}"
        with conn.cursor() as cursor:
            cursor.execute(paginated_query, [])
            raw_batch = list(cursor.fetchall())
            description = getattr(cursor, "description", None) or []
            column_names = [str(col[0]) for col in description if isinstance(col, tuple) and col]
        return self._normalize_rows(raw_batch, column_names), column_names

    @staticmethod
    def _cursor_execute(cursor: Any, query: str) -> list[str]:
        cursor.execute(query, [])
        description = getattr(cursor, "description", None) or []
        return [str(col[0]) for col in description if isinstance(col, tuple) and col]

    @staticmethod
    def _cursor_fetchmany(cursor: Any, size: int) -> list[tuple[Any, ...]]:
        return list(cursor.fetchmany(size))

    # ── Override _fetch_sample_rows for dict normalization ────────────────

    def _automatic_supports_keyset(self) -> bool:
        # Snowflake builds inline (parameter-less) queries and normalises rows via
        # _fetch_one_page; route AUTOMATIC through OFFSET paging instead of keyset.
        return False

    def _fetch_sample_rows(
        self, table_ref: TableRef
    ) -> tuple[list[tuple[Any, ...]], list[str]] | None:
        sampling = self._sampling()
        if sampling.strategy == SamplingStrategy.AUTOMATIC:
            return self._automatic_fetch(table_ref)

        columns = self._available_columns(table_ref)
        query, params = self._build_sampling_query(table_ref, columns)

        if sampling.strategy == SamplingStrategy.ALL:
            rows_per_page = int(sampling.rows_per_page or 100)
            rows, column_names = self._fetch_one_page(table_ref, query, rows_per_page, 0)
        else:
            conn = self._get_cached_connection(table_ref.database)
            with conn.cursor() as cursor:
                cursor.execute(query, params)
                raw_rows = cursor.fetchall()
                description = getattr(cursor, "description", None) or []
                column_names = [
                    str(col[0]) for col in description if isinstance(col, tuple) and col
                ]
            rows = self._normalize_rows(raw_rows, column_names)

        if not column_names:
            return None
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
                "SNOWFLAKE source requires optional.scope.database when include_all_databases "
                "is false. Set optional.scope.database (e.g. 'ANALYTICS') or enable "
                "include_all_databases."
            )

        excluded = self._excluded_databases()
        databases: list[str] = []
        conn = self._get_cached_connection()
        with conn.cursor() as cursor:
            cursor.execute("SHOW DATABASES")
            for row in self._fetch_dict_rows(cursor):
                database_name = row.get("NAME")
                if not isinstance(database_name, str) or not database_name:
                    continue
                if database_name.upper() in excluded:
                    continue
                databases.append(database_name)

        if configured_database and configured_database not in databases:
            databases.insert(0, configured_database)
        return databases

    def _excluded_databases(self) -> set[str]:
        configured = self._scope_options().exclude_databases or []
        excluded = {name.strip().upper() for name in configured if name.strip()}
        return excluded if excluded else set(_DEFAULT_EXCLUDED_DATABASES)

    def _default_excluded_schemas(self) -> set[str]:
        return set(_DEFAULT_EXCLUDED_SCHEMAS)

    def _schema_allowlist(self) -> set[str] | None:
        configured = self._scope_options().include_schemas
        if not configured:
            return None
        return {schema.strip().upper() for schema in configured if schema.strip()}

    def _schema_denylist(self) -> set[str]:
        configured = self._scope_options().exclude_schemas or []
        denylist = {schema.strip().upper() for schema in configured if schema.strip()}
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

    # ── Snowflake uses db-qualified INFORMATION_SCHEMA ────────────────────

    def _list_tables_for_database(self, database: str) -> list[TableRef]:
        include_tables = self._include_tables_enabled()
        include_views = self._include_views_enabled()
        if not include_tables and not include_views:
            return []

        schema_allowlist = self._schema_allowlist()
        schema_denylist = self._schema_denylist()
        object_allowlist = self._object_allowlist()
        limit = self._table_limit()

        query = f"""
            SELECT TABLE_CATALOG, TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE
            FROM {_quote_identifier(database)}.INFORMATION_SCHEMA.TABLES
            ORDER BY TABLE_SCHEMA, TABLE_NAME
        """
        tables: list[TableRef] = []
        conn = self._get_cached_connection(database)
        with conn.cursor() as cursor:
            cursor.execute(query)
            for row in self._fetch_dict_rows(cursor):
                schema_name = row.get("TABLE_SCHEMA")
                table_name = row.get("TABLE_NAME")
                table_type = row.get("TABLE_TYPE")
                if not isinstance(schema_name, str) or not isinstance(table_name, str):
                    continue

                schema_upper = schema_name.upper()
                if schema_upper in schema_denylist:
                    continue
                if schema_allowlist and schema_upper not in schema_allowlist:
                    continue

                normalized_type = str(table_type).upper()
                is_view = "VIEW" in normalized_type
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

    # ── Snowflake uses db-qualified INFORMATION_SCHEMA for columns ────────

    def _available_columns(self, table_ref: TableRef) -> list[str]:
        query = f"""
            SELECT COLUMN_NAME
            FROM {self._quote_identifier(table_ref.database)}.INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = %s
              AND TABLE_NAME = %s
            ORDER BY ORDINAL_POSITION
        """
        conn = self._get_cached_connection(table_ref.database)
        with conn.cursor() as cursor:
            cursor.execute(query, [table_ref.schema, table_ref.table])
            return [
                row.get("COLUMN_NAME")
                for row in self._fetch_dict_rows(cursor)
                if isinstance(row.get("COLUMN_NAME"), str)
            ]

    # ── Lineage via OBJECT_DEPENDENCIES ──────────────────────────────────

    def _collect_foreign_key_links(
        self,
        tables: list[TableRef],
    ) -> dict[tuple[str, ...], set[tuple[str, ...]]]:
        if not self._include_table_lineage_enabled() and not self._include_view_lineage_enabled():
            return {}

        known_keys = {t.table_key for t in tables}
        view_keys = {t.table_key for t in tables if t.object_type == "VIEW"}
        table_keys = {t.table_key for t in tables if t.object_type == "TABLE"}
        if not known_keys:
            return {}

        query = """
            SELECT
              REFERENCING_DATABASE,
              REFERENCING_SCHEMA,
              REFERENCING_OBJECT_NAME,
              REFERENCING_OBJECT_DOMAIN,
              REFERENCED_DATABASE,
              REFERENCED_SCHEMA,
              REFERENCED_OBJECT_NAME,
              REFERENCED_OBJECT_DOMAIN
            FROM SNOWFLAKE.ACCOUNT_USAGE.OBJECT_DEPENDENCIES
            WHERE REFERENCING_OBJECT_DOMAIN IN ('TABLE', 'VIEW')
              AND REFERENCED_OBJECT_DOMAIN IN ('TABLE', 'VIEW')
        """

        links: dict[tuple[str, ...], set[tuple[str, ...]]] = {}
        try:
            conn = self._get_cached_connection()
            with conn.cursor() as cursor:
                cursor.execute(query)
                for row in self._fetch_dict_rows(cursor):
                    source_db = row.get("REFERENCING_DATABASE")
                    source_schema = row.get("REFERENCING_SCHEMA")
                    source_table = row.get("REFERENCING_OBJECT_NAME")
                    source_domain = row.get("REFERENCING_OBJECT_DOMAIN")
                    target_db = row.get("REFERENCED_DATABASE")
                    target_schema = row.get("REFERENCED_SCHEMA")
                    target_table = row.get("REFERENCED_OBJECT_NAME")
                    if not all(
                        isinstance(v, str)
                        for v in (
                            source_db,
                            source_schema,
                            source_table,
                            source_domain,
                            target_db,
                            target_schema,
                            target_table,
                        )
                    ):
                        continue

                    source_key = (source_db, source_schema, source_table)
                    target_key = (target_db, target_schema, target_table)
                    if source_key not in known_keys or target_key not in known_keys:
                        continue

                    source_is_view = source_key in view_keys
                    source_is_table = source_key in table_keys
                    if source_is_view and not self._include_view_lineage_enabled():
                        continue
                    if source_is_table and not self._include_table_lineage_enabled():
                        continue

                    links.setdefault(source_key, set()).add(target_key)
        except Exception as exc:
            logger.warning("Could not resolve Snowflake lineage links: %s", exc)

        return links

    # ── External URL ─────────────────────────────────────────────────────

    def _build_external_url(self, table_ref: TableRef) -> str:
        return (
            f"snowflake://{self._account_locator()}/"
            f"{table_ref.database}/{table_ref.schema}.{table_ref.table}"
        )

    def _extra_asset_metadata(self, table_ref: TableRef) -> dict[str, Any]:
        extraction = self._extraction_options()
        return {
            "account_id": self._account_id(),
            "object_type": table_ref.object_type,
            "lineage": {
                "start_time": (
                    extraction.start_time.isoformat() if extraction.start_time else None
                ),
                "include_table_lineage": bool(extraction.include_table_lineage),
                "include_view_lineage": bool(extraction.include_view_lineage),
            },
        }

    def _finding_base_path(self, table_ref: TableRef) -> str:
        return f"{table_ref.database}.{table_ref.schema}.{table_ref.table}"

    # ── Parse table ref from asset ID ────────────────────────────────────

    def _table_ref_from_parts(self, parts: list[str]) -> TableRef | None:
        if parts and parts[0].upper() == "SNOWFLAKE":
            parts = parts[1:]
        if len(parts) >= 3:
            return TableRef(
                database=parts[-3], schema=parts[-2], table=parts[-1], object_type="TABLE"
            )
        return None
