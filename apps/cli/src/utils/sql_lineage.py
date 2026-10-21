"""Column-level lineage read out of a view's own SQL.

Some catalogs hand back column lineage directly (Unity Catalog, and SQL Server
through ``sys.dm_sql_referenced_entities``). Most hand back only the text of the
view, and the columns have to be recovered from it.

What is recovered here: for each output column, which base-table columns feed
it (followed through CTEs, derived tables and UNIONs), the transformations on
the way (``LOWER``, ``SUM → CASE``), and the expression itself. That does not
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
from collections.abc import Iterator
from typing import Any

from ..graph.edges import FieldMapping, FieldTransform

logger = logging.getLogger(__name__)

__all__ = [
    "NO_UPSTREAM",
    "column_mappings_by_table",
    "sqlglot_dialect",
    "table_paths_from_sql",
    "upstream_tables_from_sql",
]

#: Our source_type -> sqlglot's dialect name, where they differ.
_DIALECTS = {
    "postgresql": "postgres",
    "mssql": "tsql",
    "mysql": "mysql",
    "oracle": "oracle",
    "snowflake": "snowflake",
    "databricks": "databricks",
    "dremio": "dremio",
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


#: A key in :func:`column_mappings_by_table` for columns no table feeds — a
#: literal, ``CURRENT_TIMESTAMP``. They still belong to the view, so the caller
#: attaches them to one edge rather than dropping them.
NO_UPSTREAM = ""


def _step_name(node: Any, exp: Any) -> str | None:
    if isinstance(node, exp.Window):
        inner = node.this
        name = _step_name(inner, exp) if inner is not None else None
        return f"{name} OVER" if name else "OVER"
    if isinstance(node, exp.If) and isinstance(node.parent, exp.Case):
        # A `WHEN` branch: part of the CASE, not a step of its own.
        return None
    if isinstance(node, exp.Anonymous):
        return str(node.name).upper() or None
    if isinstance(node, (exp.JSONExtract, exp.JSONExtractScalar, exp.JSONBExtract)):
        return "JSONPATH"
    if isinstance(node, exp.Func):
        return str(node.sql_name()).upper() or None
    if isinstance(node, (exp.Add, exp.Sub, exp.Mul, exp.Div, exp.Mod, exp.DPipe, exp.Neg)):
        return {"Add": "+", "Sub": "-", "Mul": "*", "Div": "/", "Mod": "%", "DPipe": "||"}.get(
            type(node).__name__, "-"
        )
    return None


def _steps(projection: Any, exp: Any) -> list[str]:
    """The transformations a value passes through, outermost first.

    This is the idea behind sqlleaf's function nodes, kept as a flat list: a
    reader wants ``LOWER`` or ``SUM → CASE``, not the expression tree. Predicates
    are skipped — the ``>`` inside ``CASE WHEN x > 0`` decides *which* value,
    it does not change one — and so is everything inside a window's
    ``PARTITION BY``/``ORDER BY``, and anything applied only to a constant
    (Postgres writes ``ELSE NULL::numeric`` into every stored view).
    """
    steps: list[str] = []
    stack = [projection.this if isinstance(projection, exp.Alias) else projection]
    while stack:
        node = stack.pop()
        if node is None or isinstance(node, (exp.Predicate, exp.Connector, exp.Not)):
            continue
        if not isinstance(node, (exp.Column, exp.Window)) and node.find(exp.Column) is None:
            continue
        name = _step_name(node, exp)
        if name:
            steps.append(name)
        if isinstance(node, exp.Window):
            node = node.this
            if isinstance(node, exp.Func):
                # Already named as "<fn> OVER"; only its arguments are left.
                stack.extend(reversed(list(node.iter_expressions())))
            continue
        stack.extend(reversed(list(node.iter_expressions())))
    return steps


class _Trace:
    """What one table contributes to one output column, over every path."""

    def __init__(self) -> None:
        self.columns: set[str] = set()
        self.steps: list[str] = []
        self.aggregated = False
        self.projection: Any = None

    def add(self, projections: list[Any], column: str | None, exp: Any) -> None:
        if column:
            self.columns.add(column)
        if self.projection is None and projections:
            self.projection = projections[0]
        for projection in projections:
            self.aggregated = self.aggregated or _aggregate(projection, exp)
            for step in _steps(projection, exp):
                if step not in self.steps:
                    self.steps.append(step)

    def kind(self) -> FieldTransform:
        if self.aggregated:
            return FieldTransform.AGGREGATED
        if not self.steps and len(self.columns) == 1:
            return FieldTransform.IDENTITY
        return FieldTransform.TRANSFORMED


def _paths(node: Any, trail: tuple[Any, ...] = ()) -> Iterator[tuple[Any, ...]]:
    """Every route from an output column down to a source it reads."""
    trail = (*trail, node)
    if not node.downstream:
        yield trail
        return
    for child in node.downstream:
        yield from _paths(child, trail)


def column_mappings_by_table(
    sql: str,
    *,
    dialect: str | None = None,
) -> dict[str, list[FieldMapping]]:
    """Per-column dependencies of a view, split by the table they come from.

    Keys are lower-cased table names (the last part of the name), so a caller
    holding ``(db, schema, table)`` upstream keys can attach to each edge only
    the columns that table really feeds. :data:`NO_UPSTREAM` holds output
    columns no table feeds.

    Columns are resolved through CTEs, derived tables and set operations, so a
    ``WITH`` chain ends at the real base table. An unqualified column in a join
    cannot be placed without the upstream schemas, which are not fetched here;
    it is left out rather than guessed. An empty result means "dataset-level
    only": unparseable SQL, a star projection, or nothing resolvable.
    """
    text = (sql or "").strip()
    if not text:
        return {}

    sqlglot = _sqlglot()
    if sqlglot is None:
        return {}
    from sqlglot import exp
    from sqlglot.lineage import lineage
    from sqlglot.optimizer.qualify import qualify
    from sqlglot.optimizer.scope import build_scope

    try:
        statement = sqlglot.parse_one(text, read=dialect)
        if isinstance(statement, exp.Create):
            statement = statement.expression
        if not isinstance(statement, exp.Query):
            return {}
        # The expression as the view's author wrote it, before qualifying
        # rewrites every column reference.
        as_written = {
            str(projection.alias_or_name).lower(): projection
            for projection in statement.copy().selects
            if projection.alias_or_name
        }
        statement = qualify(
            statement, dialect=dialect, validate_qualify_columns=False, identify=False
        )
        root = build_scope(statement)
        is_set = isinstance(statement, exp.SetOperation)
    except Exception as exc:
        # A dialect we mis-guessed, or DDL wrapped around the select. Not worth
        # failing a scan over.
        logger.debug("Could not parse view SQL for column lineage: %s", exc)
        return {}
    if root is None:
        return {}

    by_table: dict[str, list[FieldMapping]] = {}
    for name in statement.named_selects:
        if not name or name == "*":
            # `SELECT *` — the output columns are whatever the upstream has,
            # which we deliberately do not resolve. Dataset-level it is.
            continue
        try:
            node = lineage(name, statement, {}, dialect=dialect, scope=root)
        except Exception as exc:
            logger.debug("Could not trace column %s: %s", name, exc)
            continue

        # One path per source column, from the output column down to it: the
        # steps, kind and expression belong to a path, not to the column — the
        # two branches of a UNION can do quite different things.
        per_table: dict[str, _Trace] = {}
        constant: _Trace | None = None
        for path in _paths(node):
            leaf = path[-1]
            if isinstance(leaf.source, exp.Placeholder):
                continue  # an unqualified column in a join; not guessed
            projections = [
                hop.expression
                for hop in path
                if not isinstance(hop.source, (exp.Table, exp.SetOperation))
            ]
            if not isinstance(leaf.source, exp.Table):
                if len(path) == 1 and projections:
                    constant = _Trace()
                    constant.add(projections, None, exp)
                continue
            table = str(leaf.source.name).lower()
            column = leaf.name.rsplit(".", 1)[-1]
            if table and column and column != "*":
                per_table.setdefault(table, _Trace()).add(projections, column, exp)

        if per_table:
            traces = per_table
        elif constant is not None:
            traces = {NO_UPSTREAM: constant}
        else:
            continue

        written = as_written.get(name.lower())
        for table, trace in traces.items():
            kind = trace.kind()
            # The expression as written, so a person reading the mapping can
            # see *how* the column was derived rather than only that it was.
            # A UNION branch other than the first was written elsewhere; its
            # own (qualified) expression is the honest one to show.
            source = written if (written is not None and not is_set) else trace.projection
            transform = (
                None
                if kind is FieldTransform.IDENTITY or source is None
                else (source.this if isinstance(source, exp.Alias) else source).sql(dialect=dialect)
            )
            by_table.setdefault(table, []).append(
                FieldMapping(
                    downstream=name,
                    upstreams=sorted(trace.columns),
                    transform=transform,
                    steps=trace.steps,
                    type=kind,
                )
            )

    if not by_table:
        return {}

    # Columns that shaped which rows came out without feeding any one output
    # column. Recorded once per table against the dataset — fanning them across
    # every output column is what makes indirect dependencies unaffordable to
    # keep, and it is also simply wrong.
    indirect: dict[str, set[str]] = {}
    for scope in root.traverse():
        select = scope.expression
        if not isinstance(select, exp.Select):
            continue
        clauses = [select.args.get(key) for key in ("where", "group", "having", "order")]
        # Postgres stores joins nested inside the FROM: `FROM (a JOIN b ON …)`.
        clauses.extend(join.args.get("on") for join in select.find_all(exp.Join))
        for clause in clauses:
            if clause is None:
                continue
            for column in clause.find_all(exp.Column):
                source = scope.sources.get(column.table)
                if isinstance(source, exp.Table) and column.name and column.name != "*":
                    indirect.setdefault(str(source.name).lower(), set()).add(column.name)

    for table, columns in indirect.items():
        by_table.setdefault(table, []).append(
            FieldMapping(downstream=None, upstreams=sorted(columns), type=FieldTransform.INDIRECT)
        )
    return by_table


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


def table_paths_from_sql(sql: str, *, dialect: str | None = None) -> list[tuple[str, ...]]:
    """Every table a statement reads from, as the name parts it was written with.

    :func:`upstream_tables_from_sql` assumes ``catalog.schema.table`` and fills
    in defaults, which is right for a warehouse and wrong for an engine whose
    names are folder paths of any depth (Dremio's ``source.folder.folder.table``).
    This returns the parts untouched and leaves resolving them — against a
    default context, case-insensitively, whatever the engine does — to the
    caller, who is the only one that knows the rules.

    CTE names are excluded for the same reason as above.
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
        logger.debug("Could not parse SQL for table paths: %s", exc)
        return []
    if statement is None:
        return []

    cte_names = {
        cte.alias_or_name.lower() for cte in statement.find_all(exp.CTE) if cte.alias_or_name
    }

    paths: set[tuple[str, ...]] = set()
    for table in statement.find_all(exp.Table):
        parts = tuple(part.name for part in table.parts if part.name)
        if not parts:
            continue
        if len(parts) == 1 and parts[0].lower() in cte_names:
            continue
        paths.add(parts)
    return sorted(paths)
