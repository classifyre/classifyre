"""Column lineage read out of view SQL: which table each column comes from."""

from __future__ import annotations

from src.graph.edges import FieldMapping, FieldTransform
from src.utils.sql_lineage import NO_UPSTREAM, column_mappings_by_table


def _by_downstream(mappings: list[FieldMapping]) -> dict[str | None, FieldMapping]:
    return {mapping.downstream: mapping for mapping in mappings}


def test_join_view_attributes_each_column_to_its_own_table() -> None:
    by_table = column_mappings_by_table(
        """
        CREATE VIEW order_summary AS
        SELECT o.id, LOWER(c.name) AS customer, CONCAT(o.code, c.region) AS tag
        FROM orders o JOIN customers c ON c.id = o.customer_id
        WHERE o.status = 'open'
        """,
        dialect="postgres",
    )

    orders = _by_downstream(by_table["orders"])
    customers = _by_downstream(by_table["customers"])

    assert orders["id"].upstreams == ("id",)
    assert orders["id"].type is FieldTransform.IDENTITY
    assert "customer" not in orders
    assert customers["customer"].upstreams == ("name",)
    assert customers["customer"].steps == ("LOWER",)
    # A column fed by both tables appears on both, each with its own columns.
    assert orders["tag"].upstreams == ("code",)
    assert customers["tag"].upstreams == ("region",)
    # Join keys and filters are indirect, per table.
    assert orders[None].upstreams == ("customer_id", "status")
    assert customers[None].upstreams == ("id",)


def test_with_chain_ends_at_the_base_table_and_keeps_every_step() -> None:
    by_table = column_mappings_by_table(
        """
        WITH cleaned AS (SELECT id, UPPER(name) AS name FROM raw_users)
        SELECT id, CAST(name AS TEXT) AS display_name FROM cleaned
        """,
        dialect="postgres",
    )

    assert set(by_table) == {"raw_users"}
    mapping = _by_downstream(by_table["raw_users"])["display_name"]
    assert mapping.upstreams == ("name",)
    assert mapping.steps == ("CAST", "UPPER")


def test_union_reads_each_branch_by_position() -> None:
    by_table = column_mappings_by_table(
        "SELECT id, name FROM staff UNION ALL SELECT id, title FROM contractors",
        dialect="postgres",
    )

    assert _by_downstream(by_table["staff"])["name"].upstreams == ("name",)
    assert _by_downstream(by_table["contractors"])["name"].upstreams == ("title",)


def test_aggregate_over_case_is_aggregated_with_both_steps() -> None:
    by_table = column_mappings_by_table(
        "SELECT region, SUM(CASE WHEN amount > 0 THEN amount END) AS income "
        "FROM sales GROUP BY region",
        dialect="postgres",
    )

    income = _by_downstream(by_table["sales"])["income"]
    assert income.type is FieldTransform.AGGREGATED
    # The `>` only picks the branch; it is not a step the value goes through.
    assert income.steps == ("SUM", "CASE")
    assert income.transform == "SUM(CASE WHEN amount > 0 THEN amount END)"


def test_window_function_is_one_step() -> None:
    by_table = column_mappings_by_table(
        "SELECT id, ROW_NUMBER() OVER (PARTITION BY team ORDER BY joined) AS rank FROM members",
        dialect="postgres",
    )

    rank = _by_downstream(by_table["members"])["rank"]
    assert rank.steps == ("ROW_NUMBER OVER",)
    assert rank.upstreams == ("joined", "team")


def test_constant_column_is_kept_without_an_upstream() -> None:
    by_table = column_mappings_by_table(
        "SELECT id, 'web' AS channel FROM visits", dialect="postgres"
    )

    channel = _by_downstream(by_table[NO_UPSTREAM])["channel"]
    assert channel.upstreams == ()
    assert channel.transform == "'web'"


def test_upper_case_snowflake_names_resolve() -> None:
    by_table = column_mappings_by_table(
        "SELECT ID, TRIM(NAME) AS NAME FROM ANALYTICS.PUBLIC.ACCOUNTS", dialect="snowflake"
    )

    name = _by_downstream(by_table["accounts"])["NAME"]
    assert name.upstreams == ("NAME",)
    assert name.steps == ("TRIM",)


def test_unqualified_column_in_a_join_is_left_out_not_guessed() -> None:
    by_table = column_mappings_by_table(
        "SELECT amount, o.id FROM orders o JOIN refunds r ON r.order_id = o.id",
        dialect="postgres",
    )

    assert "amount" not in {m.downstream for group in by_table.values() for m in group}
    assert _by_downstream(by_table["orders"])["id"].upstreams == ("id",)


def test_star_and_garbage_are_dataset_level() -> None:
    assert column_mappings_by_table("SELECT * FROM t", dialect="postgres") == {}
    assert column_mappings_by_table("not sql at all (", dialect="postgres") == {}


def test_postgres_stored_view_text() -> None:
    # pg_get_viewdef nests joins in the FROM and casts every constant.
    by_table = column_mappings_by_table(
        """ SELECT o.id,
    lower(c.name) AS customer,
    'web'::text AS channel
   FROM (shop.orders o
     JOIN shop.customers c ON ((c.id = o.customer_id)))
  WHERE (o.status = 'open'::text);""",
        dialect="postgres",
    )

    assert _by_downstream(by_table["orders"])[None].upstreams == ("customer_id", "status")
    assert _by_downstream(by_table["customers"])[None].upstreams == ("id",)
    assert _by_downstream(by_table[NO_UPSTREAM])["channel"].steps == ()


def test_each_union_branch_keeps_its_own_kind_and_expression() -> None:
    by_table = column_mappings_by_table(
        "SELECT orders.amount FROM shop.orders "
        "UNION ALL SELECT (- refunds.amount) AS amount FROM shop.refunds",
        dialect="postgres",
    )

    orders = _by_downstream(by_table["orders"])["amount"]
    refunds = _by_downstream(by_table["refunds"])["amount"]
    assert orders.type is FieldTransform.IDENTITY
    assert refunds.steps == ("-",)
    assert refunds.transform == "(-refunds.amount)"
