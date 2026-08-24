"""Normalization is the whole contract: two connectors must produce one string.

Every case here is a pair that *must* collapse to the same URN, or a pair that
must stay apart. A regression in this file is a lineage edge that silently never
stitches, which shows up as a missing arrow rather than as an error.

``apps/api/src/graph/urn.spec.ts`` pins the same table on the TypeScript side.
"""

from __future__ import annotations

import pytest

from src.utils.urn import Urn, UrnError, normalize_urn


class TestCaseFolding:
    def test_snowflake_folds_identifiers_up(self) -> None:
        # Snowflake upper-cases unquoted identifiers, so a connector reading
        # lowercase config and one reading the catalog must still agree.
        assert str(Urn.snowflake("acme", "prod", "public", "orders")) == str(
            Urn.snowflake("ACME", "PROD", "PUBLIC", "ORDERS")
        )
        assert str(Urn.snowflake("AcMe", "prod", "public", "orders")) == (
            "snowflake://acme/PROD/PUBLIC/ORDERS"
        )

    def test_postgres_folds_identifiers_down(self) -> None:
        assert str(Urn.postgres("DB.example.com", 5432, "App", "Public", "Orders")) == (
            "postgres://db.example.com/app/public/orders"
        )

    def test_object_store_key_keeps_its_case(self) -> None:
        # An S3 bucket is case-insensitive; the key after it is byte-exact, and
        # folding it would merge two genuinely different objects.
        assert str(Urn.s3("MyBucket", "raw/2024/Orders.csv")) == (
            "s3://mybucket/raw/2024/Orders.csv"
        )


class TestAuthorityNormalization:
    def test_default_port_is_dropped(self) -> None:
        # One connector reads the port from config, another takes the driver
        # default and writes nothing. Without this they never stitch.
        assert str(Urn.postgres("db", 5432, "app", "public", "orders")) == str(
            Urn.postgres("db", None, "app", "public", "orders")
        )

    def test_non_default_port_is_kept(self) -> None:
        assert "5433" in str(Urn.postgres("db", 5433, "app", "public", "orders"))

    def test_platform_aliases_converge(self) -> None:
        assert normalize_urn("s3a://bucket/key.csv") == normalize_urn("s3://bucket/key.csv")
        assert normalize_urn("S3N://bucket/key.csv") == "s3://bucket/key.csv"
        assert normalize_urn("postgresql://db/app/public/t") == "postgres://db/app/public/t"


class TestParsing:
    def test_parse_round_trips_through_normalization(self) -> None:
        built = Urn.snowflake("acme", "prod", "public", "orders")
        assert Urn.parse(str(built)) == built

    def test_parse_normalizes_a_hand_written_urn(self) -> None:
        # A URN typed into a notebook gets held to the same rules as one built
        # by a connector, so authored lineage stitches too.
        assert Urn.parse("SNOWFLAKE://Acme/prod/public/orders") == Urn.snowflake(
            "acme", "prod", "public", "orders"
        )

    def test_segment_containing_a_separator_survives(self) -> None:
        urn = Urn.of("custom", "host", "weird/name")
        assert Urn.parse(str(urn)).path == ("weird/name",)

    def test_empty_segments_are_dropped_not_rejected(self) -> None:
        # Callers assemble these from optional catalog/schema parts; a missing
        # middle should shorten the name rather than abort a scan.
        assert str(Urn.of("hive", "host", "db", "", "table")) == "hive://host/db/table"

    @pytest.mark.parametrize("bad", ["", "no-scheme", "://authority"])
    def test_unparseable_input_raises(self, bad: str) -> None:
        with pytest.raises(UrnError):
            Urn.parse(bad)


class TestDistinctThingsStayDistinct:
    def test_different_databases_do_not_collide(self) -> None:
        assert str(Urn.snowflake("a", "prod", "public", "orders")) != str(
            Urn.snowflake("a", "dev", "public", "orders")
        )

    def test_unknown_platform_is_conservative(self) -> None:
        # Unregistered platforms lowercase the authority and leave the path
        # alone: never merges two objects that are actually different.
        assert str(Urn.of("weirddb", "HOST", "Schema", "Table")) == "weirddb://host/Schema/Table"
