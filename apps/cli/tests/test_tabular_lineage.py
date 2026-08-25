"""Lineage as the tabular sources produce it.

Two things are being pinned. First, that a *view* and a *foreign key* come out
as different classes of edge: a view derives its rows from its base tables, so
changing one can break it; a foreign key moves no data at all and must never be
a hop in a lineage path. Second, that an upstream outside the scan is named
rather than dropped — that is the only reason cross-system lineage works at all.
"""

from __future__ import annotations

from typing import Any

import pytest

from src.graph.edges import EdgeClass, FieldTransform, FlowType
from src.sources.postgresql.source import PostgreSQLSource
from src.sources.tabular_utils import TableRef, ViewLineage


def _recipe() -> dict[str, Any]:
    return {
        "type": "POSTGRESQL",
        "required": {"host": "Db.Example.com", "port": 5432},
        "masked": {"username": "postgres", "password": "test"},
        "optional": {"scope": {"database": "shop"}},
        "sampling": {"strategy": "RANDOM"},
    }


@pytest.fixture(autouse=True)
def _patch_optional_dep(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "src.sources.postgresql.source.require_module",
        lambda **_kwargs: object(),
    )


ORDERS = TableRef("shop", "public", "orders")
CUSTOMERS = TableRef("shop", "public", "customers")
TOP_DELIVERIES = TableRef("shop", "public", "top_deliveries", object_type="VIEW")

VIEW_SQL = (
    "SELECT o.id, DATEDIFF(o.placed_on, o.delivered_on) AS delivery_time "
    "FROM orders o ORDER BY o.placed_on"
)


def _source() -> PostgreSQLSource:
    return PostgreSQLSource(_recipe())


def _emit(
    source: PostgreSQLSource,
    tables: list[TableRef],
    *,
    fk: dict[tuple[str, ...], set[tuple[str, ...]]] | None = None,
    views: list[ViewLineage] | None = None,
) -> list[Any]:
    hashes = {t.table_key: source.generate_hash_id(t.raw_id) for t in tables}
    source._collect_view_lineage = lambda _tables: list(views or [])  # type: ignore[method-assign]
    source._emit_relationship_edges(tables, hashes, fk or {})
    return source.drain_edges()


class TestForeignKeysAreNotLineage:
    def test_a_foreign_key_is_emitted_as_a_reference(self) -> None:
        source = _source()
        edges = _emit(
            source,
            [ORDERS, CUSTOMERS],
            fk={ORDERS.table_key: {CUSTOMERS.table_key}},
        )
        assert len(edges) == 1
        assert edges[0].relation_class == "REFERENCE"
        assert edges[0].relation_type == "FOREIGN_KEY"

    def test_a_foreign_key_to_a_table_outside_the_scan_is_skipped(self) -> None:
        # Unlike a view's upstream, an FK target we cannot see says nothing
        # about where data came from, so there is nothing worth parking.
        source = _source()
        edges = _emit(source, [ORDERS], fk={ORDERS.table_key: {CUSTOMERS.table_key}})
        assert edges == []


class TestViewLineage:
    def test_a_view_derives_from_its_base_table(self) -> None:
        source = _source()
        edges = _emit(
            source,
            [ORDERS, TOP_DELIVERIES],
            views=[ViewLineage(TOP_DELIVERIES.table_key, (ORDERS.table_key,), VIEW_SQL)],
        )
        assert len(edges) == 1
        edge = edges[0]
        assert edge.relation_class == "FLOW"
        assert edge.relation_type == str(FlowType.VIEW)

    def test_the_edge_points_the_way_the_data_moves(self) -> None:
        source = _source()
        orders_hash = source.generate_hash_id(ORDERS.raw_id)
        view_hash = source.generate_hash_id(TOP_DELIVERIES.raw_id)
        edges = _emit(
            source,
            [ORDERS, TOP_DELIVERIES],
            views=[ViewLineage(TOP_DELIVERIES.table_key, (ORDERS.table_key,), VIEW_SQL)],
        )
        assert edges[0].from_hash == orders_hash
        assert edges[0].to_hash == view_hash

    def test_column_mappings_are_recovered_from_the_view_sql(self) -> None:
        source = _source()
        edges = _emit(
            source,
            [ORDERS, TOP_DELIVERIES],
            views=[ViewLineage(TOP_DELIVERIES.table_key, (ORDERS.table_key,), VIEW_SQL)],
        )
        mappings = edges[0].field_mappings or []
        derived = [m for m in mappings if m["downstream"] == "delivery_time"]
        assert derived, f"no mapping for delivery_time in {mappings}"
        assert set(derived[0]["upstreams"]) == {"placed_on", "delivered_on"}
        assert edges[0].granularity == "FIELD"

    def test_an_order_by_column_is_recorded_as_indirect(self) -> None:
        # It shaped which rows came out without feeding any output column.
        # Reported as a dependency of the dataset, not of a column.
        source = _source()
        edges = _emit(
            source,
            [ORDERS, TOP_DELIVERIES],
            views=[ViewLineage(TOP_DELIVERIES.table_key, (ORDERS.table_key,), VIEW_SQL)],
        )
        indirect = [m for m in (edges[0].field_mappings or []) if m["downstream"] is None]
        assert indirect
        assert indirect[0]["type"] == str(FieldTransform.INDIRECT)
        assert "placed_on" in indirect[0]["upstreams"]

    def test_a_select_star_view_stays_dataset_level(self) -> None:
        # Resolving `*` would mean guessing the upstream's columns. A confidently
        # wrong column mapping is worse than an absent one.
        source = _source()
        edges = _emit(
            source,
            [ORDERS, TOP_DELIVERIES],
            views=[
                ViewLineage(TOP_DELIVERIES.table_key, (ORDERS.table_key,), "SELECT * FROM orders")
            ],
        )
        assert edges[0].granularity == "DATASET"
        assert edges[0].field_mappings is None


class TestUpstreamsOutsideTheScan:
    def test_an_unscanned_upstream_is_named_by_urn(self) -> None:
        # A view routinely reads from a schema the scan's scope excludes. Before
        # URNs the only options were to drop the edge or invent an asset.
        source = _source()
        edges = _emit(
            source,
            [TOP_DELIVERIES],
            views=[ViewLineage(TOP_DELIVERIES.table_key, (ORDERS.table_key,), VIEW_SQL)],
        )
        assert len(edges) == 1
        assert edges[0].from_hash is None
        assert edges[0].from_urn == "postgres://db.example.com/shop/public/orders"

    def test_the_urn_drops_the_default_port(self) -> None:
        # So it matches the URN a different connector writes for the same table.
        source = _source()
        assert source._urn_authority() == "Db.Example.com:5432"
        edges = _emit(
            source,
            [TOP_DELIVERIES],
            views=[ViewLineage(TOP_DELIVERIES.table_key, (ORDERS.table_key,), None)],
        )
        assert ":5432" not in (edges[0].from_urn or "")


class TestAssetIdentity:
    def test_a_table_asset_carries_its_platform_name(self) -> None:
        source = _source()
        source._cached_column_types = lambda _ref: {}  # type: ignore[method-assign]
        source._cached_columns = lambda _ref: []  # type: ignore[method-assign]
        source._estimate_row_count = lambda _ref: None  # type: ignore[method-assign]
        asset = source._table_to_asset(ORDERS)
        assert asset.urn == "postgres://db.example.com/shop/public/orders"


class TestClassVocabulary:
    def test_lineage_is_exactly_the_flow_class(self) -> None:
        assert EdgeClass.FLOW == "FLOW"
        assert {str(c) for c in EdgeClass} == {
            "FLOW",
            "CONTAINMENT",
            "IDENTITY",
            "REFERENCE",
            "USAGE",
        }


class TestTableauCrossSystem:
    """The showcase: a BI tool naming a warehouse table it will never scan.

    This is the case `links` could not express at all — the upstream has no
    hash here, because this connector never produced it.
    """

    @staticmethod
    def _urn(table: dict[str, object]) -> str | None:
        from src.sources.tableau.source import TableauSource

        return TableauSource._table_urn(TableauSource, table)  # type: ignore[arg-type]

    def test_it_writes_the_urn_the_warehouse_connector_would(self) -> None:
        # The two sides only ever meet if both fold the name identically, and
        # Snowflake upper-cases while Tableau reports whatever was typed.
        assert (
            self._urn(
                {
                    "name": "orders",
                    "schema": "public",
                    "database": {
                        "name": "prod",
                        "connectionType": "snowflake",
                        "hostName": "AcMe",
                    },
                }
            )
            == "snowflake://acme/PROD/PUBLIC/ORDERS"
        )

    def test_it_translates_the_connection_type_to_a_platform(self) -> None:
        # Tableau says "sqlserver"; the MSSQL connector writes "mssql".
        urn = self._urn(
            {
                "name": "Orders",
                "schema": "dbo",
                "database": {
                    "name": "Shop",
                    "connectionType": "sqlserver",
                    "hostName": "db.example.com",
                },
            }
        )
        assert urn is not None and urn.startswith("mssql://db.example.com/")

    def test_a_table_with_no_host_produces_nothing(self) -> None:
        # Without a host there is nothing to scope the name to, and a URN
        # scoped to the wrong host would stitch two unrelated systems together.
        assert (
            self._urn({"name": "orders", "schema": "public", "database": {"name": "prod"}}) is None
        )
