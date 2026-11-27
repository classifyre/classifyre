"""Unit tests for Phase 5 column-level PK/nullable & FK extraction."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from src.sources.mssql.source import MSSQLSource
from src.sources.mysql.source import MySQLSource
from src.sources.odbc.source import OdbcSource
from src.sources.oracle.source import OracleSource
from src.sources.postgresql.source import PostgreSQLSource
from src.sources.snowflake.source import SnowflakeSource
from src.sources.tabular_utils import ForeignKeyDetail, TableRef
from src.utils.file_metadata import build_columns


class _FakeCursor:
    def __init__(self, rows: list[Any], *, description: list[tuple[str]] | None = None) -> None:
        self._rows = rows
        self.description = description
        self.executed: list[tuple[str, Any]] = []

    def execute(self, sql: str, params: Any = None) -> None:
        self.executed.append((sql, params))

    def fetchall(self) -> list[Any]:
        return list(self._rows)

    def foreignKeys(self, **_kwargs: Any) -> list[Any]:  # noqa: N802
        return list(self._rows)

    def close(self) -> None:
        pass

    def __enter__(self) -> _FakeCursor:
        return self

    def __exit__(self, *_args: Any) -> None:
        self.close()


class _FakeConn:
    def __init__(self, cursor: _FakeCursor) -> None:
        self._cursor = cursor

    def cursor(self) -> _FakeCursor:
        return self._cursor


class TestBuildColumnsMetadata:
    def test_emits_pk_and_nullability_compactly(self) -> None:
        cols = build_columns(
            ["id", "email", "notes"],
            {"id": "bigint", "email": "varchar", "notes": "text"},
            primary_keys=["ID"],
            nullable={"id": False, "email": False, "notes": True},
        )
        assert cols == [
            {"name": "id", "type": "bigint", "is_primary_key": True, "nullable": False},
            {"name": "email", "type": "varchar", "nullable": False},
            {"name": "notes", "type": "text", "nullable": True},
        ]

    def test_omits_optional_keys_when_absent(self) -> None:
        cols = build_columns(["id"], {"id": "int"})
        assert cols == [{"name": "id", "type": "int"}]


class TestTabularBasePkNullabilityAndMultiFk:
    def _pg_source(self, monkeypatch: pytest.MonkeyPatch) -> PostgreSQLSource:
        monkeypatch.setattr(
            "src.sources.postgresql.source.require_module",
            lambda **_kwargs: object(),
        )
        return PostgreSQLSource(
            {
                "type": "POSTGRESQL",
                "required": {"host": "db.local", "port": 5432},
                "masked": {"username": "u", "password": "p"},
                "optional": {"scope": {"database": "shop"}},
                "sampling": {"strategy": "RANDOM"},
            }
        )

    def test_table_to_asset_persists_primary_keys_and_column_nullability(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        src = self._pg_source(monkeypatch)
        ref = TableRef("shop", "public", "orders")
        src._cached_column_types = lambda _r: {"id": "bigint", "customer_id": "bigint", "note": "text"}  # type: ignore[method-assign]
        src._cached_column_nullability = lambda _r: {"id": False, "customer_id": False, "note": True}  # type: ignore[method-assign]
        src._get_primary_key_columns = lambda _r: ["id"]  # type: ignore[method-assign]
        src._estimate_row_count = lambda _r: 42  # type: ignore[method-assign]

        asset = src._table_to_asset(ref)
        meta = asset.metadata or {}
        assert meta["primary_keys"] == ["id"]
        assert meta["row_count"] == 42
        assert meta["columns"] == [
            {"name": "id", "type": "bigint", "is_primary_key": True, "nullable": False},
            {"name": "customer_id", "type": "bigint", "nullable": False},
            {"name": "note", "type": "text", "nullable": True},
        ]

    def test_emit_relationship_edges_groups_multiple_fks_between_same_tables(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        src = self._pg_source(monkeypatch)
        orders = TableRef("shop", "public", "orders")
        addresses = TableRef("shop", "public", "addresses")
        hashes = {
            orders.table_key: src.generate_hash_id(orders.raw_id),
            addresses.table_key: src.generate_hash_id(addresses.raw_id),
        }
        src._collect_view_lineage = lambda _t: []  # type: ignore[method-assign]
        details = [
            ForeignKeyDetail(
                source_key=orders.table_key,
                target_key=addresses.table_key,
                source_column="billing_address_id",
                target_column="id",
                constraint_name="fk_orders_billing_addr",
            ),
            ForeignKeyDetail(
                source_key=orders.table_key,
                target_key=addresses.table_key,
                source_column="shipping_address_id",
                target_column="id",
                constraint_name="fk_orders_shipping_addr",
            ),
            # Duplicate should be deduplicated cleanly
            ForeignKeyDetail(
                source_key=orders.table_key,
                target_key=addresses.table_key,
                source_column="shipping_address_id",
                target_column="id",
                constraint_name="fk_orders_shipping_addr",
            ),
        ]
        src._emit_relationship_edges([orders, addresses], hashes, {}, fk_details=details)
        edges = src.drain_edges()

        assert len(edges) == 1
        edge = edges[0]
        assert edge.relation_class == "REFERENCE"
        assert edge.relation_type == "FOREIGN_KEY"
        assert edge.from_hash == hashes[orders.table_key]
        assert edge.to_hash == hashes[addresses.table_key]
        assert edge.evidence == {
            "foreign_keys": [
                {
                    "fromColumn": "billing_address_id",
                    "toColumn": "id",
                    "constraintName": "fk_orders_billing_addr",
                },
                {
                    "fromColumn": "shipping_address_id",
                    "toColumn": "id",
                    "constraintName": "fk_orders_shipping_addr",
                },
            ]
        }


class TestSqlConnectorForeignKeyDetails:
    def test_postgresql_collect_foreign_key_details(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            "src.sources.postgresql.source.require_module",
            lambda **_kwargs: object(),
        )
        src = PostgreSQLSource(
            {
                "type": "POSTGRESQL",
                "required": {"host": "db.local", "port": 5432},
                "masked": {"username": "u", "password": "p"},
                "optional": {"scope": {"database": "shop"}},
                "sampling": {"strategy": "RANDOM"},
            }
        )
        orders = TableRef("shop", "public", "orders")
        addresses = TableRef("shop", "public", "addresses")
        cursor = _FakeCursor(
            [
                ("fk_orders_billing", "public", "orders", "billing_address_id", "public", "addresses", "id"),
                ("fk_orders_shipping", "public", "orders", "shipping_address_id", "public", "addresses", "id"),
            ]
        )
        src._get_cached_connection = lambda _db: _FakeConn(cursor)  # type: ignore[method-assign]

        details = src._collect_foreign_key_details([orders, addresses])
        assert details == [
            ForeignKeyDetail(
                orders.table_key, addresses.table_key, "billing_address_id", "id", "fk_orders_billing"
            ),
            ForeignKeyDetail(
                orders.table_key, addresses.table_key, "shipping_address_id", "id", "fk_orders_shipping"
            ),
        ]

    def test_mysql_collect_foreign_key_details(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            "src.sources.mysql.source.require_module",
            lambda **_kwargs: object(),
        )
        src = MySQLSource(
            {
                "type": "MYSQL",
                "required": {"host": "db.local", "port": 3306},
                "masked": {"username": "u", "password": "p"},
                "optional": {"scope": {"database": "shop"}},
                "sampling": {"strategy": "RANDOM"},
            }
        )
        orders = TableRef("shop", None, "orders")
        customers = TableRef("shop", None, "customers")
        cursor = _FakeCursor(
            [("fk_orders_cust", "shop", "orders", "customer_id", "shop", "customers", "id")]
        )
        src._get_cached_connection = lambda _db: _FakeConn(cursor)  # type: ignore[method-assign]

        details = src._collect_foreign_key_details([orders, customers])
        assert details == [
            ForeignKeyDetail(
                orders.table_key, customers.table_key, "customer_id", "id", "fk_orders_cust"
            )
        ]

    def test_mssql_collect_foreign_key_details(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            "src.sources.mssql.source.require_module",
            lambda **_kwargs: object(),
        )
        src = MSSQLSource(
            {
                "type": "MSSQL",
                "required": {"host": "db.local", "port": 1433},
                "masked": {"username": "u", "password": "p"},
                "optional": {"scope": {"database": "shop"}},
                "sampling": {"strategy": "RANDOM"},
            }
        )
        orders = TableRef("shop", "dbo", "orders")
        customers = TableRef("shop", "dbo", "customers")
        cursor = _FakeCursor(
            [("FK_Orders_Customers", "dbo", "orders", "customer_id", "dbo", "customers", "id")]
        )
        src._get_cached_connection = lambda _db: _FakeConn(cursor)  # type: ignore[method-assign]

        details = src._collect_foreign_key_details([orders, customers])
        assert details == [
            ForeignKeyDetail(
                orders.table_key, customers.table_key, "customer_id", "id", "FK_Orders_Customers"
            )
        ]

    def test_oracle_collect_foreign_key_details(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            "src.sources.oracle.source.require_module",
            lambda **_kwargs: object(),
        )
        src = OracleSource(
            {
                "type": "ORACLE",
                "required": {"host": "db.local", "port": 1521, "service_name": "ORCL"},
                "masked": {"username": "u", "password": "p"},
                "optional": {},
                "sampling": {"strategy": "RANDOM"},
            }
        )
        orders = TableRef("ORCL", "CRM", "ORDERS")
        customers = TableRef("ORCL", "CRM", "CUSTOMERS")
        cursor = _FakeCursor(
            [("FK_ORD_CUST", "CRM", "ORDERS", "CUSTOMER_ID", "CRM", "CUSTOMERS", "ID")]
        )
        src._get_cached_connection = lambda _db: _FakeConn(cursor)  # type: ignore[method-assign]

        details = src._collect_foreign_key_details([orders, customers])
        assert details == [
            ForeignKeyDetail(
                orders.table_key, customers.table_key, "CUSTOMER_ID", "ID", "FK_ORD_CUST"
            )
        ]

    def test_odbc_collect_foreign_key_details(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            "src.sources.odbc.source.require_module",
            lambda **_kwargs: SimpleNamespace(drivers=lambda: ["PostgreSQL"]),
        )
        src = OdbcSource(
            {
                "type": "ODBC",
                "required": {"driver": "PostgreSQL", "host": "db.local"},
                "masked": {"username": "u", "password": "p"},
                "optional": {},
                "sampling": {"strategy": "RANDOM"},
            }
        )
        orders = TableRef("shop", "public", "orders")
        customers = TableRef("shop", "public", "customers")
        # ODBC SQLForeignKeys row: (pkcat, pkschem, pktable, pkcol, fkcat, fkschem, fktable, fkcol, key_seq, upd, del, fkname)
        odbc_row = (
            "shop", "public", "customers", "id",
            "shop", "public", "orders", "customer_id",
            1, 0, 0, "fk_orders_customer",
        )
        cursor = _FakeCursor([odbc_row])
        src._get_cached_connection = lambda _db: _FakeConn(cursor)  # type: ignore[method-assign]

        details = src._collect_foreign_key_details([orders, customers])
        assert details == [
            ForeignKeyDetail(
                orders.table_key, customers.table_key, "customer_id", "id", "fk_orders_customer"
            )
        ]

    def test_snowflake_collect_foreign_key_details(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            "src.sources.snowflake.source.require_module",
            lambda **_kwargs: object(),
        )
        src = SnowflakeSource(
            {
                "type": "SNOWFLAKE",
                "required": {
                    "authentication_type": "DEFAULT_AUTHENTICATOR",
                    "account_id": "acme.us-east-1.aws",
                },
                "masked": {"username": "u", "password": "p"},
                "optional": {
                    "connection": {"warehouse": "WH"},
                    "extraction": {"include_table_lineage": True},
                },
                "sampling": {"strategy": "RANDOM"},
            }
        )
        orders = TableRef("PROD", "PUBLIC", "ORDERS")
        customers = TableRef("PROD", "PUBLIC", "CUSTOMERS")
        cursor = _FakeCursor(
            [
                ("PROD", "PUBLIC", "CUSTOMERS", "ID", "PROD", "PUBLIC", "ORDERS", "CUSTOMER_ID", "FK_ORD_CUST")
            ],
            description=[
                ("pk_database_name",),
                ("pk_schema_name",),
                ("pk_table_name",),
                ("pk_column_name",),
                ("fk_database_name",),
                ("fk_schema_name",),
                ("fk_table_name",),
                ("fk_column_name",),
                ("fk_name",),
            ],
        )
        src._get_cached_connection = lambda _db: _FakeConn(cursor)  # type: ignore[method-assign]

        details = src._collect_foreign_key_details([orders, customers])
        assert details == [
            ForeignKeyDetail(
                orders.table_key, customers.table_key, "CUSTOMER_ID", "ID", "FK_ORD_CUST"
            )
        ]
