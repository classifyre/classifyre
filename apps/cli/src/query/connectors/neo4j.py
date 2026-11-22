"""Neo4j labels and relationship types, read live (docs/prd/QC-query-connectors.md §5.6).

* ``<source>.nodes.<label>``: one row per node with the label; its recorded
  properties and ``element_id``.
* ``<source>.relationships.<type>``: one row per relationship of the type;
  ``source_element_id`` and ``target_element_id`` (and ``source_id`` /
  ``target_id``, the endpoints' ``id`` property, when the scan saw one on
  every endpoint), the relationship's properties, ``source_label`` and
  ``target_label``. The ids join a relationship table with node tables and
  with other sources' tables.

One Cypher statement per scan (:func:`build_cypher`), streamed in batches
of :data:`BATCH_SIZE` rows: only the columns the query reads, the pushed
conditions as a ``WHERE`` with every value a parameter, the label or type
backtick-escaped. The driver, credentials and TLS are the scan's own
(:class:`~src.sources.neo4j.source.Neo4jSource`).
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

from ...utils.document_columns import native
from .arrow import ArrowConnector, ConnectorError, Predicate, ScanRequest
from .base import TableLocation

BATCH_SIZE = 10_000
#: Transaction timeout when the query has more time than this.
DEFAULT_TIMEOUT_SECONDS = 300.0

NODES = "nodes"
RELATIONSHIPS = "relationships"

_OPERATORS = {"=": "=", "!=": "<>", "<": "<", "<=": "<=", ">": ">", ">=": ">="}


def escape(name: str) -> str:
    """A label, type or property name as a backtick-quoted Cypher identifier."""
    return "`" + name.replace("`", "``") + "`"


#: The columns Neo4j computes for a node table and a relationship table,
#: and their Cypher. One list: the scan records them
#: (``Neo4jSource._label_columns``, ``_relationship_to_asset``), the
#: connector reads and filters them.
ELEMENT_ID = "element_id"
SOURCE_ELEMENT_ID, TARGET_ELEMENT_ID = "source_element_id", "target_element_id"
SOURCE_ID, TARGET_ID = "source_id", "target_id"
SOURCE_LABEL, TARGET_LABEL = "source_label", "target_label"
NODE_COLUMNS = {ELEMENT_ID: "elementId(n)"}
RELATIONSHIP_COLUMNS = {
    SOURCE_ELEMENT_ID: "elementId(a)",
    TARGET_ELEMENT_ID: "elementId(b)",
    SOURCE_ID: "a.`id`",
    TARGET_ID: "b.`id`",
    SOURCE_LABEL: "head(labels(a))",
    TARGET_LABEL: "head(labels(b))",
}


def _column_expression(kind: str, column: str) -> str:
    if kind == NODES:
        return NODE_COLUMNS.get(column) or f"n.{escape(column)}"
    return RELATIONSHIP_COLUMNS.get(column) or f"r.{escape(column)}"


#: Computed columns that are text whatever the graph stores (ids, labels);
#: the endpoints' ``id`` properties are typed like any property.
_COMPUTED = {
    name
    for name, cypher in {**NODE_COLUMNS, **RELATIONSHIP_COLUMNS}.items()
    if not cypher.endswith("`id`")
}
#: Recorded types a property is compared as in Cypher exactly as SQL reads
#: it: numbers (Cypher compares 5 and 5.0 as equal, as SQL does once read)
#: and booleans. Not dates and times: a node holding a datetime where the
#: sample saw dates is not equal to date(...) in Cypher, while it is a
#: value of another type to SQL (an error, ``to_batch``), so the two would
#: disagree on whether the query fails (QC re-review, c4).
_COMPARABLE = {"BIGINT", "DOUBLE", "BOOLEAN"}


def pushable(column: str, types: dict[str, str]) -> bool:
    """Whether a condition on ``column`` may go to Neo4j.

    A property recorded as text (or JSON) reads any stored value as its
    text (``5`` as ``'5'``), while Cypher compares the stored value itself:
    ``p = '5'`` would miss the node holding the integer 5. Only properties
    recorded as numbers or booleans are sent, and the ids and labels Neo4j
    computes. A value is never read as something else (``to_batch`` refuses
    it), but a node whose property is of another type than the sample saw is
    one Cypher's condition may not match: the answer then leaves that node
    out where reading every node would have stopped with an error. Known and
    accepted (QC re-review 2, 2026-11-22); a new scan records the type.
    """
    return column in _COMPUTED or types.get(column, "").upper() in _COMPARABLE


def build_cypher(
    kind: str,
    name: str,
    columns: tuple[str, ...],
    predicates: tuple[Predicate, ...],
) -> tuple[str, dict[str, Any]]:
    """The statement that reads one table, and its parameters.

    ``columns`` are the recorded columns the query reads; predicates on
    any other column are not sent.
    """
    if kind == NODES:
        pattern = f"MATCH (n:{escape(name)})"
    elif kind == RELATIONSHIPS:
        pattern = f"MATCH (a)-[r:{escape(name)}]->(b)"
    else:
        raise ConnectorError(f"Neo4j has no {kind} tables.")
    params: dict[str, Any] = {}
    conditions: list[str] = []
    known = set(columns)
    for predicate in predicates:
        if predicate.column not in known:
            continue
        key = f"p{len(params)}"
        expression = _column_expression(kind, predicate.column)
        if predicate.op == "in":
            params[key] = list(predicate.value)
            conditions.append(f"{expression} IN ${key}")
        else:
            params[key] = predicate.value
            conditions.append(f"{expression} {_OPERATORS[predicate.op]} ${key}")
    projection = ", ".join(f"{escape(c)}: {_column_expression(kind, c)}" for c in columns)
    where = f" WHERE {' AND '.join(conditions)}" if conditions else ""
    return f"{pattern}{where} RETURN {{{projection}}} AS row", params


class Neo4jConnector(ArrowConnector):
    dependency_groups = ("neo4j",)
    product = "Neo4j"
    url_field = "uri"

    def scan(self, location: TableLocation, request: ScanRequest) -> Iterator[Any]:
        kind, name = self.require(location, "schema", "table")
        recorded = [column for column, _ in location.columns]
        columns = (
            tuple(c for c in request.columns if c in recorded)
            if request.columns is not None
            else tuple(recorded)
        )
        types = dict(location.columns)
        sent = tuple(
            p for p in request.predicates if p.column in columns and pushable(p.column, types)
        )
        cypher, params = build_cypher(kind, name, columns, sent)
        request.sent(sent)
        client = self.source.instance()
        neo4j = client._neo4j
        errors = getattr(neo4j, "exceptions", None)
        try:
            query_class = getattr(neo4j, "Query", None)
            timeout = request.timeout(DEFAULT_TIMEOUT_SECONDS)
            query = query_class(cypher, timeout=timeout) if query_class else cypher
            database = location.database or client._database()
            # Read-only: a query never writes to the graph, whatever its
            # statement (QC §5.6); the server refuses a write in this mode.
            with client._driver().session(
                database=database,
                fetch_size=BATCH_SIZE,
                default_access_mode=getattr(neo4j, "READ_ACCESS", "READ"),
            ) as session:
                result = session.run(query, params)
                request.stats.requests += 1
                batch: list[dict[str, Any]] = []
                for record in result:
                    row = record["row"]
                    batch.append({key: native(value) for key, value in dict(row).items()})
                    if len(batch) >= BATCH_SIZE:
                        yield batch
                        batch = []
                if batch:
                    yield batch
        except ConnectorError:
            raise
        except Exception as exc:
            raise self._error(exc, errors) from None

    def _error(self, exc: Exception, errors: Any) -> ConnectorError:
        """What went wrong, without the statement's values or the server's text."""

        def is_a(name: str) -> bool:
            cls = getattr(errors, name, None) if errors is not None else None
            return isinstance(cls, type) and isinstance(exc, cls)

        if is_a("AuthError"):
            return ConnectorError(f"{self.where()} refused the source's credentials.")
        if is_a("ServiceUnavailable") or is_a("SessionExpired"):
            return ConnectorError(f"{self.where()} is unreachable.")
        code = getattr(exc, "code", None)
        if isinstance(code, str) and code.startswith("Neo."):
            return ConnectorError(f"{self.where()} refused the query ({code}).")
        return ConnectorError(f"{self.where()} failed: {type(exc).__name__}.")
