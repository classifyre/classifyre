"""Column lineage of a shared dataset's SQL (docs/prd/DQ-data-query.md §5.12).

Sharing a query as a dataset records which input columns each output column
comes from: the API carries the inputs' classification through it (the
dataset's *floor*) and draws it as column lineage. The inputs' columns are
known here (each input is a view the session just made), so a ``SELECT *``
is expanded and an unqualified column in a join is placed, which plain view
lineage (:func:`~src.utils.sql_lineage.column_mappings_by_table`) cannot do.
"""

from __future__ import annotations

import logging
from typing import Any

from .gate import TableName

logger = logging.getLogger(__name__)


def column_lineage(sql: str, schemas: dict[TableName, list[str]]) -> list[dict[str, Any]]:
    """Per input, the field mappings of the output columns it feeds.

    ``sql`` is the checked SQL (full names, quoted); ``schemas`` the inputs'
    columns. Each input is renamed to a bare ``t<j>`` first, so two inputs
    named alike in different sources never share an entry. Returns
    ``[{"table": "source.schema.table", "fields": [mapping…]}]``, plus one
    entry with ``table: ""`` for columns no table feeds (literals, ``count(*)``);
    an empty list when the SQL cannot be traced (the API then fails closed).
    """
    try:
        import sqlglot
        from sqlglot import exp
        from sqlglot.optimizer.qualify import qualify

        from ..utils.sql_lineage import NO_UPSTREAM, column_mappings_by_table, fields_for_table
    except ImportError:  # pragma: no cover - lineage group missing
        return []

    aliases = {name: f"t{j}" for j, name in enumerate(sorted(schemas, key=str))}
    try:
        tree = sqlglot.parse_one(sql, read="duckdb")
        for table in list(tree.find_all(exp.Table)):
            if not (table.catalog and table.db):
                continue
            name = TableName.of(str(table.catalog), str(table.db), str(table.name))
            alias = aliases.get(name)
            if alias is None:
                continue
            table.set("catalog", None)
            table.set("db", None)
            table.set("this", exp.to_identifier(alias))
        schema: dict[str, object] = {
            aliases[name]: dict.fromkeys(columns, "VARCHAR") for name, columns in schemas.items()
        }
        qualified = qualify(
            tree,
            schema=schema,
            dialect="duckdb",
            validate_qualify_columns=False,
            identify=False,
        )
        by_table = column_mappings_by_table(qualified.sql(dialect="duckdb"), dialect="duckdb")
    except Exception as exc:
        logger.debug("Could not trace the dataset's columns: %s", exc)
        return []
    out: list[dict[str, Any]] = []
    for name, alias in sorted(aliases.items(), key=lambda item: str(item[0])):
        fields = fields_for_table(by_table, (alias,))
        if fields:
            out.append({"table": str(name), "fields": [f.to_payload() for f in fields]})
    # Columns no table feeds (a literal, count(*)): traced, and inherit nothing.
    constants = by_table.get(NO_UPSTREAM) or []
    if constants:
        out.append({"table": "", "fields": [f.to_payload() for f in constants]})
    return out
