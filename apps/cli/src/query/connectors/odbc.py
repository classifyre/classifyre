"""Any database with an ODBC driver, through DuckDB's ``odbc_scanner`` extension.

The connection string is the one the ODBC source scans with. It sits in a
DuckDB variable, so a view holds only the variable's name, and every scan of a
view opens a connection of its own. ``odbc_query`` is a plain remote
``SELECT``: nothing is pushed down, so a query reads the whole table unless a
``LIMIT`` ends the read early.
"""

from __future__ import annotations

from typing import Any

from ...utils.duckdb_engine import quote_identifier, sql_literal
from .base import QueryBinding, SourceContext, TableLocation


class OdbcBinding(QueryBinding):
    tier = "extension"

    def __init__(self, source: SourceContext) -> None:
        super().__init__(source)
        self._variable: str | None = None

    def label(self) -> str | None:
        from ...utils.odbc_connection import build_connection_string, endpoint_label

        try:
            return f"odbc://{endpoint_label(build_connection_string(self.source.recipe))}/"
        except ValueError:
            return None

    def relation(self, conn: Any, location: TableLocation) -> str:
        (qualified,) = self.require(location, "qualified_name")
        if self._variable is None:
            from ...utils.odbc_connection import build_connection_string

            self.load(conn, "odbc_scanner")
            variable = f"{self.source.hidden}_odbc"
            # A variable, not a literal in the view: the view's own text (what
            # DuckDB stores and prints) then carries a name, never a password.
            conn.execute(
                f"SET VARIABLE {quote_identifier(variable)} = "
                f"{sql_literal(build_connection_string(self.source.recipe))}"
            )
            self._variable = variable
        remote = sql_literal(f"SELECT * FROM {qualified}")
        # `odbc_connect` inside the call: every scan of a view opens its own
        # connection, which is what a query that reads two tables, or one table
        # twice, needs. (Two scans on one handle fail, and the connection-string
        # form of `odbc_query` frees a connection before its statement, which
        # crashes unixODBC on Linux as soon as a query holds two scans.) The
        # connections live until the query job exits.
        return f"odbc_query(odbc_connect(getvariable({sql_literal(self._variable)})), {remote})"

    def explain(self, exc: Exception) -> str | None:
        if "Can't open lib" in str(exc):
            return (
                "The ODBC driver named in the connection string is not installed where "
                "queries run. Install it there, or use a DSN that exists on that host."
            )
        return None
