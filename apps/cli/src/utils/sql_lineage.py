"""Column-level lineage read out of a view's own SQL.

Some catalogs hand back column lineage directly (Unity Catalog, and SQL Server
through ``sys.dm_sql_referenced_entities``). Most hand back only the text of the
view, and the columns have to be recovered from it.

What is recovered here is deliberately narrow: for each output column, which
input columns its expression mentions, and the expression itself. That does not
need a schema, which is what makes it usable — resolving ``SELECT *`` or an
unqualified column against the real catalog would mean fetching every upstream
table's columns before parsing a single view, and would still be a guess when
two upstreams share a column name.

The consequence is that a ``SELECT *`` view produces no column mappings at all.
That is the honest answer: the edge stays dataset-level, which is exactly what
the ``granularity`` field is for. A confidently wrong column mapping is worse
than an absent one, because the whole point of column lineage is to answer
"what breaks if I drop this column".
"""

from __future__ import annotations

import logging
from typing import Any

from ..graph.edges import FieldMapping, FieldTransform

logger = logging.getLogger(__name__)

__all__ = ["column_mappings_from_sql", "sqlglot_dialect", "upstream_tables_from_sql"]

#: Our source_type -> sqlglot's dialect name, where they differ.
_DIALECTS = {
    "postgresql": "postgres",
    "mssql": "tsql",
    "mysql": "mysql",
    "oracle": "oracle",
    "snowflake": "snowflake",
    "databricks": "databricks",
    "hive": "hive",
    "sqlite": "sqlite",
}


def sqlglot_dialect(source_type: str) -> str | None:
    return _DIALECTS.get((source_type or "").lower())


def _sqlglot() -> Any | None:
    """Import sqlglot, or None when the lineage extra is not installed.

    Absence degrades to dataset-level lineage rather than failing the scan: the
    table-to-table edges are the majority of the value and they do not need a
    parser.
    """
    from ..sources.dependencies import require_module

    try:
        return require_module("sqlglot", "SQL lineage", ["lineage"])
    except Exception as exc:
        logger.debug("Column-level lineage unavailable (no sqlglot): %s", exc)
        return None


def _aggregate(expression: Any, exp: Any) -> bool:
    return bool(list(expression.find_all(exp.AggFunc)))


def column_mappings_from_sql(
    sql: str,
    *,
    dialect: str | None = None,
) -> list[FieldMapping]:
    """Per-column dependencies for a single ``SELECT``.

    Returns an empty list — meaning "dataset-level only" — for anything it
    cannot read confidently: unparseable SQL, a star projection, or a statement
    with no projections at all.
    """
    text = (sql or "").strip()
    if not text:
        return []

    sqlglot = _sqlglot()
    if sqlglot is None:
        return []
    from sqlglot import exp

    try:
        statement = sqlglot.parse_one(text, read=dialect)
    except Exception as exc:
        # A dialect we mis-guessed, or DDL wrapped around the select. Not worth
        # failing a scan over.
        logger.debug("Could not parse view SQL for column lineage: %s", exc)
        return []
    if statement is None:
        return []

    select = statement.find(exp.Select)
    if select is None:
        return []

    mappings: list[FieldMapping] = []
    for projection in select.expressions:
        if isinstance(projection, exp.Star):
            # `SELECT *` — the output columns are whatever the upstream has,
            # which we deliberately do not resolve. Dataset-level it is.
            continue
        name = projection.alias_or_name
        if not name or name == "*":
            continue

        upstreams = sorted(
            {
                column.name
                for column in projection.find_all(exp.Column)
                if column.name and column.name != "*"
            }
        )
        if not upstreams:
            # A literal or a constant: nothing upstream feeds it, so there is
            # no dependency to record.
            continue

        if _aggregate(projection, exp):
            kind = FieldTransform.AGGREGATED
        elif (
            isinstance(projection, exp.Column)
            or (isinstance(projection, exp.Alias) and isinstance(projection.this, exp.Column))
        ) and len(upstreams) == 1:
            kind = FieldTransform.IDENTITY
        else:
            kind = FieldTransform.TRANSFORMED

        mappings.append(
            FieldMapping(
                downstream=name,
                upstreams=upstreams,
                # The expression as written, so a person reading the mapping can
                # see *how* the column was derived rather than only that it was.
                transform=None
                if kind is FieldTransform.IDENTITY
                else projection.sql(dialect=dialect),
                type=kind,
            )
        )

    if not mappings:
        return []

    # Columns that shaped which rows came out without feeding any one output
    # column. Recorded once against the dataset — fanning them across every
    # output column is what makes indirect dependencies unaffordable to keep,
    # and it is also simply wrong.
    indirect: set[str] = set()
    for clause in (select.args.get("where"), select.args.get("group"), select.args.get("order")):
        if clause is None:
            continue
        for column in clause.find_all(exp.Column):
            if column.name and column.name != "*":
                indirect.add(column.name)
    for join in select.args.get("joins") or []:
        for column in join.find_all(exp.Column):
            if column.name and column.name != "*":
                indirect.add(column.name)

    if indirect:
        mappings.append(
            FieldMapping(
                downstream=None,
                upstreams=sorted(indirect),
                type=FieldTransform.INDIRECT,
            )
        )
    return mappings


def upstream_tables_from_sql(
    sql: str,
    *,
    dialect: str | None = None,
    default_database: str | None = None,
    default_schema: str | None = None,
) -> list[tuple[str, ...]]:
    """Table keys a statement reads from, for catalogs with no dependency view.

    MySQL before 8, Hive and Snowflake without ACCOUNT_USAGE access can all show
    a view's text but not what it depends on. Recovering the table names from
    the text is a weaker answer than the catalog's own — a name resolved against
    the wrong default schema points at nothing — so callers should prefer the
    catalog wherever it exists and treat these edges as SQL_PARSED.

    CTE names are excluded: a ``WITH`` alias is not a table, and emitting it
    would create lineage to an object that does not exist.
    """
    text = (sql or "").strip()
    if not text:
        return []
    sqlglot = _sqlglot()
    if sqlglot is None:
        return []
    from sqlglot import exp

    try:
        statement = sqlglot.parse_one(text, read=dialect)
    except Exception as exc:
        logger.debug("Could not parse SQL for upstream tables: %s", exc)
        return []
    if statement is None:
        return []

    cte_names = {
        cte.alias_or_name.lower() for cte in statement.find_all(exp.CTE) if cte.alias_or_name
    }

    keys: set[tuple[str, ...]] = set()
    for table in statement.find_all(exp.Table):
        name = table.name
        if not name or name.lower() in cte_names:
            continue
        schema = table.text("db") or default_schema
        database = table.text("catalog") or default_database
        if database and schema:
            keys.add((database, schema, name))
        elif database:
            keys.add((database, name))
        elif schema:
            keys.add((schema, name))
        else:
            # Nothing to qualify it with; an unqualified name alone cannot be
            # matched against a table key, so it is dropped rather than guessed.
            continue
    return sorted(keys)
