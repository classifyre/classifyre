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
from urllib.parse import urlsplit

from ...utils.document_columns import native
from .arrow import ArrowConnector, ConnectorError, Predicate, ScanRequest
from .base import SourceContext, TableLocation

BATCH_SIZE = 10_000
#: Transaction timeout when the query has more time than this.
DEFAULT_TIMEOUT_SECONDS = 300.0

NODES = "nodes"
RELATIONSHIPS = "relationships"

_OPERATORS = {"=": "=", "!=": "<>", "<": "<", "<=": "<=", ">": ">", ">=": ">="}


def escape(name: str) -> str:
    """A label, type or property name as a backtick-quoted Cypher identifier."""
    return "`" + name.replace("`", "``") + "`"


def _column_expression(kind: str, column: str) -> str:
    if kind == NODES:
        if column == "element_id":
            return "elementId(n)"
        return f"n.{escape(column)}"
    special = {
        "source_element_id": "elementId(a)",
        "target_element_id": "elementId(b)",
        "source_id": "a.`id`",
        "target_id": "b.`id`",
        "source_label": "head(labels(a))",
        "target_label": "head(labels(b))",
    }
    return special.get(column) or f"r.{escape(column)}"


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
    def __init__(self, source: SourceContext) -> None:
        super().__init__(source)

    def label(self) -> str | None:
        parts = urlsplit(str(self.source.section("required").get("uri") or ""))
        if not parts.hostname:
            return None
        port = f":{parts.port}" if parts.port else ""
        return f"{parts.scheme}://{parts.hostname}{port}/"

    def _where(self) -> str:
        return f"Neo4j at {self.label() or self.source.alias}"

    def scan(self, location: TableLocation, request: ScanRequest) -> Iterator[Any]:
        kind, name = self.require(location, "schema", "table")
        recorded = [column for column, _ in location.columns]
        columns = (
            tuple(c for c in request.columns if c in recorded)
            if request.columns is not None
            else tuple(recorded)
        )
        cypher, params = build_cypher(kind, name, columns, request.predicates)
        client = self.source.instance()
        neo4j = client._neo4j
        errors = getattr(neo4j, "exceptions", None)
        try:
            query_class = getattr(neo4j, "Query", None)
            timeout = request.timeout(DEFAULT_TIMEOUT_SECONDS)
            query = query_class(cypher, timeout=timeout) if query_class else cypher
            database = location.database or client._database()
            with client._driver().session(database=database, fetch_size=BATCH_SIZE) as session:
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
            return ConnectorError(f"{self._where()} refused the source's credentials.")
        if is_a("ServiceUnavailable") or is_a("SessionExpired"):
            return ConnectorError(f"{self._where()} is unreachable.")
        code = getattr(exc, "code", None)
        if isinstance(code, str) and code.startswith("Neo."):
            return ConnectorError(f"{self._where()} refused the query ({code}).")
        return ConnectorError(f"{self._where()} failed: {type(exc).__name__}.")
