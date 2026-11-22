"""PostgreSQL through DuckDB's ``postgres`` scanner, read-only.

Attached from the same recipe fields the connector scans with; the Python
driver is not needed, so a query never installs it. One attachment per
database the query reads (a source can scan several).
"""

from __future__ import annotations

from typing import Any

from ...utils.duckdb_engine import quote_identifier, sql_literal
from .base import QueryBinding, SourceContext, TableLocation, endpoint_label


def conninfo(values: dict[str, Any]) -> str:
    """A libpq-style ``key=value`` string for PostgreSQL's scanner.

    (MySQL's scanner does not read quoted values — see ``mysql.py``, which
    connects through a secret instead.) Numbers and plain hostnames stay
    bare; anything with whitespace, quotes or backslashes is quoted.
    """
    parts = []
    for key, value in values.items():
        if value is None or value == "":
            continue
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            parts.append(f"{key}={value}")
            continue
        text = str(value)
        if key in ("host", "database", "dbname", "user") and not any(
            ch in text for ch in " \t\n'\"\\"
        ):
            parts.append(f"{key}={text}")
            continue
        escaped = text.replace("\\", "\\\\").replace("'", "\\'")
        parts.append(f"{key}='{escaped}'")
    return " ".join(parts)


class PostgresBinding(QueryBinding):
    tier = "native"

    def __init__(self, source: SourceContext) -> None:
        super().__init__(source)
        self._attached: dict[str, str] = {}

    def label(self) -> str | None:
        return endpoint_label(self.source, "postgresql")

    def relation(self, conn: Any, location: TableLocation) -> str:
        database, schema, table = self.require(location, "database", "schema", "table")
        alias = self._attached.get(database)
        if alias is None:
            self.load(conn, "postgres")
            required, masked = self.source.section("required"), self.source.section("masked")
            dsn = conninfo(
                {
                    "host": required.get("host"),
                    "port": required.get("port"),
                    "dbname": database,
                    "user": masked.get("username"),
                    "password": masked.get("password"),
                    "sslmode": self.source.connection_option("ssl_mode") or "prefer",
                    "connect_timeout": 10,
                    "application_name": "classifyre-query",
                }
            )
            alias = f"{self.source.hidden}_{len(self._attached)}"
            conn.execute(
                f"ATTACH {sql_literal(dsn)} AS {quote_identifier(alias)} (TYPE postgres, READ_ONLY)"
            )
            self._attached[database] = alias
        return ".".join(quote_identifier(part) for part in (alias, schema, table))
