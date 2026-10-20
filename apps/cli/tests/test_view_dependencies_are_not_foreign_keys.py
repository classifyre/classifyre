"""A view's dependencies are lineage, never a foreign key.

MSSQL, Oracle and Snowflake can all tell which tables a view reads from, and
each used to merge that into the foreign-key links. Those links are written as
REFERENCE/FOREIGN_KEY edges, so every view got a second, wrong edge pointing
view -> table next to its FLOW edge. Each catalog below answers both the
constraint query and the dependency query; only the constraint may come back
as a foreign key.
"""

from __future__ import annotations

from typing import Any

import pytest

from src.sources.mssql.source import MSSQLSource
from src.sources.oracle.source import OracleSource
from src.sources.snowflake.source import SnowflakeSource
from src.sources.tabular_base import BaseTabularSource
from src.sources.tabular_utils import TableRef, ViewLineage


class _Cursor:
    """Answers a query with the first rows whose marker appears in its SQL."""

    def __init__(self, answers: list[tuple[str, list[str], list[tuple[Any, ...]]]]) -> None:
        self._answers = answers
        self._rows: list[tuple[Any, ...]] = []
        self.description: list[tuple[str, ...]] = []

    def execute(self, query: str, _params: Any = None) -> None:
        for marker, columns, rows in self._answers:
            if marker in query:
                self._rows = rows
                self.description = [(name,) for name in columns]
                return
        self._rows = []
        self.description = []

    def fetchall(self) -> list[tuple[Any, ...]]:
        return list(self._rows)

    def close(self) -> None:
        return None

    def __enter__(self) -> _Cursor:
        return self

    def __exit__(self, *_exc: object) -> None:
        return None


class _Connection:
    def __init__(self, answers: list[tuple[str, list[str], list[tuple[Any, ...]]]]) -> None:
        self._answers = answers

    def cursor(self) -> _Cursor:
        return _Cursor(self._answers)


def _edges(
    source: BaseTabularSource,
    tables: list[TableRef],
    answers: list[tuple[str, list[str], list[tuple[Any, ...]]]],
    view: TableRef,
    base: TableRef,
) -> tuple[dict[tuple[str, ...], set[tuple[str, ...]]], list[Any]]:
    connection = _Connection(answers)
    source._get_cached_connection = lambda *_a, **_k: connection  # type: ignore[method-assign]
    source._collect_view_lineage = lambda _tables: [  # type: ignore[method-assign]
        ViewLineage(view.table_key, (base.table_key,), None)
    ]
    links = source._collect_foreign_key_links(tables)
    hashes = {t.table_key: source.generate_hash_id(t.raw_id) for t in tables}
    source._emit_relationship_edges(tables, hashes, links)
    return links, source.drain_edges()


def _assert_only_the_constraint_is_a_foreign_key(
    source: BaseTabularSource,
    links: dict[tuple[str, ...], set[tuple[str, ...]]],
    edges: list[Any],
    *,
    child: TableRef,
    parent: TableRef,
    view: TableRef,
) -> None:
    assert links == {child.table_key: {parent.table_key}}

    view_hash = source.generate_hash_id(view.raw_id)
    parent_hash = source.generate_hash_id(parent.raw_id)
    fk_edges = [e for e in edges if e.relation_type == "FOREIGN_KEY"]
    assert [(e.from_hash, e.to_hash) for e in fk_edges] == [
        (source.generate_hash_id(child.raw_id), parent_hash)
    ]
    assert all(view_hash not in (e.from_hash, e.to_hash) for e in fk_edges)

    view_edges = [e for e in edges if view_hash in (e.from_hash, e.to_hash)]
    assert [(e.relation_class, e.from_hash, e.to_hash) for e in view_edges] == [
        ("FLOW", parent_hash, view_hash)
    ]


@pytest.fixture(autouse=True)
def _no_drivers(monkeypatch: pytest.MonkeyPatch) -> None:
    for module in ("mssql", "oracle", "snowflake"):
        monkeypatch.setattr(
            f"src.sources.{module}.source.require_module", lambda **_kwargs: object()
        )


def test_mssql_view_dependencies_are_not_foreign_keys() -> None:
    source = MSSQLSource(
        {
            "type": "MSSQL",
            "required": {"host": "localhost", "port": 1433},
            "masked": {"username": "reader", "password": "example"},
            "optional": {"scope": {"database": "shop"}},
            "sampling": {"strategy": "RANDOM"},
        }
    )
    orders = TableRef("shop", "dbo", "orders")
    items = TableRef("shop", "dbo", "order_items")
    view = TableRef("shop", "dbo", "v_orders", object_type="VIEW")
    answers = [
        ("sys.foreign_keys", [], [("dbo", "order_items", "dbo", "orders")]),
        ("sys.sql_expression_dependencies", [], [("dbo", "v_orders", "dbo", "orders")]),
    ]

    links, edges = _edges(source, [orders, items, view], answers, view, orders)

    _assert_only_the_constraint_is_a_foreign_key(
        source, links, edges, child=items, parent=orders, view=view
    )


def test_oracle_view_dependencies_are_not_foreign_keys() -> None:
    source = OracleSource(
        {
            "type": "ORACLE",
            "required": {"host": "localhost", "port": 1521, "service_name": "shop"},
            "masked": {"username": "reader", "password": "example"},
            "optional": {"scope": {"include_views": True, "include_view_lineage": True}},
            "sampling": {"strategy": "RANDOM"},
        }
    )
    orders = TableRef("shop", "SALES", "ORDERS")
    items = TableRef("shop", "SALES", "ORDER_ITEMS")
    view = TableRef("shop", "SALES", "V_ORDERS", object_type="VIEW")
    answers = [
        ("all_constraints", [], [("SALES", "ORDER_ITEMS", "SALES", "ORDERS")]),
        ("all_dependencies", [], [("SALES", "V_ORDERS", "SALES", "ORDERS", "TABLE")]),
    ]

    links, edges = _edges(source, [orders, items, view], answers, view, orders)

    _assert_only_the_constraint_is_a_foreign_key(
        source, links, edges, child=items, parent=orders, view=view
    )


def test_snowflake_view_dependencies_are_not_foreign_keys() -> None:
    source = SnowflakeSource(
        {
            "type": "SNOWFLAKE",
            "required": {
                "authentication_type": "DEFAULT_AUTHENTICATOR",
                "account_id": "xy123410.us-east-2.aws",
            },
            "masked": {"username": "reader", "password": "example"},
            "optional": {
                "scope": {"database": "SHOP", "include_views": True},
                "extraction": {"include_table_lineage": True, "include_view_lineage": True},
            },
            "sampling": {"strategy": "RANDOM"},
        }
    )
    orders = TableRef("SHOP", "PUBLIC", "ORDERS")
    items = TableRef("SHOP", "PUBLIC", "ORDER_ITEMS")
    view = TableRef("SHOP", "PUBLIC", "V_ORDERS", object_type="VIEW")
    answers = [
        (
            "REFERENTIAL_CONSTRAINTS",
            ["SOURCE_SCHEMA", "SOURCE_TABLE", "TARGET_SCHEMA", "TARGET_TABLE"],
            [("PUBLIC", "ORDER_ITEMS", "PUBLIC", "ORDERS")],
        ),
        (
            "OBJECT_DEPENDENCIES",
            [
                "REFERENCING_DATABASE",
                "REFERENCING_SCHEMA",
                "REFERENCING_OBJECT_NAME",
                "REFERENCING_OBJECT_DOMAIN",
                "REFERENCED_DATABASE",
                "REFERENCED_SCHEMA",
                "REFERENCED_OBJECT_NAME",
                "REFERENCED_OBJECT_DOMAIN",
            ],
            [("SHOP", "PUBLIC", "V_ORDERS", "VIEW", "SHOP", "PUBLIC", "ORDERS", "TABLE")],
        ),
    ]

    links, edges = _edges(source, [orders, items, view], answers, view, orders)

    _assert_only_the_constraint_is_a_foreign_key(
        source, links, edges, child=items, parent=orders, view=view
    )


def test_snowflake_foreign_keys_follow_the_table_lineage_toggle() -> None:
    source = SnowflakeSource(
        {
            "type": "SNOWFLAKE",
            "required": {
                "authentication_type": "DEFAULT_AUTHENTICATOR",
                "account_id": "xy123410.us-east-2.aws",
            },
            "masked": {"username": "reader", "password": "example"},
            "optional": {
                "scope": {"database": "SHOP"},
                "extraction": {"include_table_lineage": False},
            },
            "sampling": {"strategy": "RANDOM"},
        }
    )
    source._get_cached_connection = lambda *_a, **_k: pytest.fail(  # type: ignore[method-assign]
        "no catalog query when table lineage is off"
    )

    assert source._collect_foreign_key_links([TableRef("SHOP", "PUBLIC", "ORDERS")]) == {}
