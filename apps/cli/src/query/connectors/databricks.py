"""Databricks through the ``unity_catalog`` extension, with the scan's token.

The token is the one the scan authenticates with (a personal access token, or
the OAuth token of its service principal). The extension asks Unity Catalog
for short-lived storage credentials itself, so no storage keys are involved.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import urlparse

from ...utils.duckdb_engine import quote_identifier, sql_literal
from .base import QueryBinding, SourceContext, TableLocation


class DatabricksBinding(QueryBinding):
    tier = "native"

    def __init__(self, source: SourceContext) -> None:
        super().__init__(source)
        self._attached: dict[str, str] = {}

    def label(self) -> str | None:
        workspace = str(self.source.section("required").get("workspace_url") or "").strip()
        netloc = urlparse(workspace).netloc or workspace.removeprefix("https://").strip("/")
        return f"databricks://{netloc}/" if netloc else None

    def relation(self, conn: Any, location: TableLocation) -> str:
        catalog, schema, table = self.require(location, "database", "schema", "table")
        alias = self._attached.get(catalog)
        if alias is None:
            source = self.source.instance()
            endpoint = str(self.source.section("required").get("workspace_url") or "").rstrip("/")
            # Delta files sit in S3 on AWS (httpfs) and in ADLS on Azure (azure).
            storage = "azure" if "azuredatabricks.net" in endpoint else "httpfs"
            for extension in ("unity_catalog", "delta", storage):
                self.load(conn, extension)
            alias = f"{self.source.hidden}_{len(self._attached)}"
            secret = quote_identifier(f"{alias}_secret")
            conn.execute(
                f"CREATE OR REPLACE SECRET {secret} (TYPE unity_catalog, "
                f"TOKEN {sql_literal(source._access_token_value())}, "
                f"ENDPOINT {sql_literal(endpoint)})"
            )
            conn.execute(
                f"ATTACH {sql_literal(catalog)} AS {quote_identifier(alias)} "
                f"(TYPE unity_catalog, SECRET {secret}, READ_ONLY)"
            )
            self._attached[catalog] = alias
        return ".".join(quote_identifier(part) for part in (alias, schema, table))

    def explain(self, exc: Exception) -> str | None:
        if "temporary-table-credentials" in str(exc):
            return (
                "Databricks would not hand out storage credentials for the table. "
                "An admin has to turn on External data access for the metastore, and the "
                "source's principal needs the EXTERNAL USE SCHEMA privilege on the schema."
            )
        return None
