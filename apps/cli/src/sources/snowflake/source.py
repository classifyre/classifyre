from __future__ import annotations

import logging
from collections.abc import AsyncGenerator
from contextlib import closing
from dataclasses import dataclass
from datetime import UTC, date, datetime
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

_DEFAULT_EXCLUDED_DATABASES = {"SNOWFLAKE", "SNOWFLAKE_SAMPLE_DATA"}
_DEFAULT_EXCLUDED_SCHEMAS = {"INFORMATION_SCHEMA"}


@dataclass(frozen=True)
class TableRef:
    database: str
    schema: str
    table: str
    object_type: str


def _quote_identifier(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


class SnowflakeSource(BaseSource):
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

        self._table_lookup: dict[str, TableRef] = {}
        self._content_cache: dict[str, tuple[str, str]] = {}

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

    def _asset_type_value(self) -> str:
        type_value = self.config.type
        return type_value.value if hasattr(type_value, "value") else str(type_value)

    def _sampling(self) -> SamplingConfig:
        return self.config.sampling

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
        required = self.config.required
        return required.account_id

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

    def _username(self) -> str:
        masked = self.config.masked
        return masked.username

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

    def _connect(self):
        required = self.config.required
        masked = self.config.masked
        connection_options = self._connection_options()

        connect_kwargs: dict[str, Any] = {
            "account": self._account_locator(),
            "user": self._username(),
            "login_timeout": int(connection_options.connect_timeout_seconds or 15),
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
        else:  # pragma: no cover - guarded in _validate_auth_configuration
            raise ValueError(f"Unsupported SNOWFLAKE authentication type: {auth_type}")

        connect_args = connection_options.connect_args or {}
        if isinstance(connect_args, dict):
            connect_kwargs.update(connect_args)

        return self._snowflake.connect(**connect_kwargs)

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

    def _excluded_databases(self) -> set[str]:
        configured = self._scope_options().exclude_databases or []
        excluded = {name.strip().upper() for name in configured if name.strip()}
        if not excluded:
            excluded = set(_DEFAULT_EXCLUDED_DATABASES)
        return excluded

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

    def _include_table_lineage_enabled(self) -> bool:
        return self._extraction_options().include_table_lineage is not False

    def _include_view_lineage_enabled(self) -> bool:
        return self._extraction_options().include_view_lineage is not False

    def _resolve_databases(self) -> list[str]:
        scope_options = self._scope_options()
        include_all = bool(scope_options.include_all_databases)
        configured_database = scope_options.database

        if not include_all:
            if configured_database:
                return [configured_database]
            raise ValueError(
                "SNOWFLAKE source requires optional.scope.database when include_all_databases is false. "
                "Set optional.scope.database (e.g. 'ANALYTICS') or enable include_all_databases."
            )

        excluded = self._excluded_databases()
        databases: list[str] = []
        with closing(self._connect()) as conn:
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

        query = f"""
            SELECT TABLE_CATALOG, TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE
            FROM {_quote_identifier(database)}.INFORMATION_SCHEMA.TABLES
            ORDER BY TABLE_SCHEMA, TABLE_NAME
        """
        tables: list[TableRef] = []
        with closing(self._connect()) as conn:
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
        logger.info("Testing connection to SNOWFLAKE...")
        result = {
            "timestamp": datetime.now(UTC).isoformat(),
            "source_type": self.recipe.get("type"),
        }

        try:
            databases = self._resolve_databases()
            if not databases:
                raise ValueError("No databases available for scanning")

            with closing(self._connect()) as conn:
                with conn.cursor() as cursor:
                    cursor.execute("SELECT 1")
                    cursor.fetchone()

            result["status"] = "SUCCESS"
            result["message"] = (
                f"Successfully connected to SNOWFLAKE. Reachable databases: {len(databases)}."
            )
        except Exception as exc:
            result["status"] = "FAILURE"
            result["message"] = f"Failed to connect to SNOWFLAKE: {exc}"

        return result

    def _table_key(self, table_ref: TableRef) -> tuple[str, str, str]:
        return (table_ref.database, table_ref.schema, table_ref.table)

    def _table_raw_id(self, table_ref: TableRef) -> str:
        return f"{table_ref.database}_#_{table_ref.schema}_#_{table_ref.table}"

    def _collect_dependency_links(
        self,
        tables: list[TableRef],
    ) -> dict[tuple[str, str, str], set[tuple[str, str, str]]]:
        if not self._include_table_lineage_enabled() and not self._include_view_lineage_enabled():
            return {}

        known_keys = {self._table_key(table_ref) for table_ref in tables}
        view_keys = {
            self._table_key(table_ref) for table_ref in tables if table_ref.object_type == "VIEW"
        }
        table_keys = {
            self._table_key(table_ref) for table_ref in tables if table_ref.object_type == "TABLE"
        }
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

        links: dict[tuple[str, str, str], set[tuple[str, str, str]]] = {}
        try:
            with closing(self._connect()) as conn:
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
                            isinstance(value, str)
                            for value in (
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
            f"snowflake://{self._account_locator()}/"
            f"{table_ref.database}/{table_ref.schema}.{table_ref.table}"
        )

        extraction_options = self._extraction_options()
        metadata = {
            "account_id": self._account_id(),
            "database": table_ref.database,
            "schema": table_ref.schema,
            "table": table_ref.table,
            "object_type": table_ref.object_type,
            "lineage": {
                "start_time": (
                    extraction_options.start_time.isoformat()
                    if extraction_options.start_time
                    else None
                ),
                "include_table_lineage": bool(extraction_options.include_table_lineage),
                "include_view_lineage": bool(extraction_options.include_view_lineage),
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

        tables = self._iter_tables()
        table_hash_by_key: dict[tuple[str, str, str], str] = {
            self._table_key(table_ref): self.generate_hash_id(self._table_raw_id(table_ref))
            for table_ref in tables
        }
        dependency_links = self._collect_dependency_links(tables)

        batch: list[SingleAssetScanResults] = []
        for table_ref in tables:
            if self._aborted:
                return

            key = self._table_key(table_ref)
            linked_hashes = [
                table_hash_by_key[target]
                for target in sorted(dependency_links.get(key, set()))
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

        if decoded.startswith("SNOWFLAKE_#_"):
            decoded = decoded[len("SNOWFLAKE_#_") :]

        parts = decoded.split("_#_")
        if len(parts) >= 3:
            return TableRef(
                database=parts[-3],
                schema=parts[-2],
                table=parts[-1],
                object_type="TABLE",
            )
        return None

    def _available_columns(self, table_ref: TableRef) -> list[str]:
        query = f"""
            SELECT COLUMN_NAME
            FROM {_quote_identifier(table_ref.database)}.INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = %s
              AND TABLE_NAME = %s
            ORDER BY ORDINAL_POSITION
        """
        with closing(self._connect()) as conn:
            with conn.cursor() as cursor:
                cursor.execute(query, [table_ref.schema, table_ref.table])
                return [
                    row.get("COLUMN_NAME")
                    for row in self._fetch_dict_rows(cursor)
                    if isinstance(row.get("COLUMN_NAME"), str)
                ]

    def _resolve_latest_order_column(self, columns: list[str]) -> str | None:
        sampling = self._sampling()
        configured = sampling.order_by_column
        if configured:
            for column in columns:
                if column == configured or column.lower() == configured.lower():
                    return column

        priority_candidates = (
            "updated_at",
            "modified_at",
            "created_at",
            "inserted_at",
            "timestamp",
            "ts",
            "date",
        )
        lower_lookup = {column.lower(): column for column in columns}
        for candidate in priority_candidates:
            if candidate in lower_lookup:
                return lower_lookup[candidate]
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
            f"{_quote_identifier(table_ref.database)}.{_quote_identifier(table_ref.schema)}."
            f"{_quote_identifier(table_ref.table)}"
        )

        strategy = sampling.strategy
        if strategy == SamplingStrategy.ALL:
            return query, []

        if strategy == SamplingStrategy.LATEST:
            order_column = self._resolve_latest_order_column(columns)
            if order_column:
                query += f" ORDER BY {_quote_identifier(order_column)} DESC"
            elif sampling.fallback_to_random is not False:
                query += " ORDER BY RANDOM()"
        elif strategy == SamplingStrategy.RANDOM:
            query += " ORDER BY RANDOM()"

        query += f" LIMIT {int(sampling.rows_per_page or 100)}"
        return query, []

    def _count_table_rows(self, table_ref: TableRef) -> int | None:
        try:
            with closing(self._connect()) as conn:
                with conn.cursor() as cursor:
                    cursor.execute(
                        f"SELECT COUNT(*) FROM {_quote_identifier(table_ref.database)}.{_quote_identifier(table_ref.schema)}.{_quote_identifier(table_ref.table)}"
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
        if isinstance(value, (datetime, date)):
            return value.isoformat()
        if isinstance(value, Decimal):
            return str(value)
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

    def _normalize_rows(self, rows: list[Any], column_names: list[str]) -> list[tuple[Any, ...]]:
        normalized: list[tuple[Any, ...]] = []
        for row in rows:
            if isinstance(row, tuple):
                normalized.append(row)
            elif isinstance(row, dict):
                normalized.append(tuple(row.get(column) for column in column_names))
        return normalized

    def _fetch_one_page(
        self, table_ref: TableRef, base_query: str, page_size: int, offset: int
    ) -> tuple[list[tuple[Any, ...]], list[str]]:
        with closing(self._connect()) as conn:
            paginated_query = f"{base_query} LIMIT {page_size} OFFSET {offset}"
            with conn.cursor() as cursor:
                cursor.execute(paginated_query, [])
                raw_batch = list(cursor.fetchall())
                description = getattr(cursor, "description", None) or []
                column_names = [
                    str(col[0]) for col in description if isinstance(col, tuple) and col
                ]
        rows = self._normalize_rows(raw_batch, column_names)
        return rows, column_names

    def _sample_table_rows(self, table_ref: TableRef) -> tuple[str, str] | None:
        columns = self._available_columns(table_ref)
        sampling = self._sampling()
        query, params = self._build_sampling_query(table_ref, columns)

        if sampling.strategy == SamplingStrategy.ALL:
            rows_per_page = int(sampling.rows_per_page or 100)
            rows, column_names = self._fetch_one_page(table_ref, query, rows_per_page, 0)
        else:
            with closing(self._connect()) as conn:
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
            row_index=metadata.get("tabular_row_index"),
            column_name=metadata.get("tabular_column_name"),
        )

    def abort(self) -> None:
        logger.info("Aborting SNOWFLAKE extraction...")
        super().abort()
