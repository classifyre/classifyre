"""Column lineage read out of view SQL: which table each column comes from."""

from __future__ import annotations

from src.graph.edges import FieldMapping, FieldTransform
from src.utils.sql_lineage import (
    NO_UPSTREAM,
    column_mappings_by_table,
    fields_for_table,
    upstream_tables_from_sql,
)


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

    name = _by_downstream(by_table["public.accounts"])["NAME"]
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

    assert _by_downstream(by_table["shop.orders"])[None].upstreams == ("customer_id", "status")
    assert _by_downstream(by_table["shop.customers"])[None].upstreams == ("id",)
    assert _by_downstream(by_table[NO_UPSTREAM])["channel"].steps == ()


def test_each_union_branch_keeps_its_own_kind_and_expression() -> None:
    by_table = column_mappings_by_table(
        "SELECT orders.amount FROM shop.orders "
        "UNION ALL SELECT (- refunds.amount) AS amount FROM shop.refunds",
        dialect="postgres",
    )

    orders = _by_downstream(by_table["shop.orders"])["amount"]
    refunds = _by_downstream(by_table["shop.refunds"])["amount"]
    assert orders.type is FieldTransform.IDENTITY
    assert refunds.steps == ("-",)
    assert refunds.transform == "(-refunds.amount)"


# ── Postgres stored text: what pg_get_viewdef really writes ──────────────
#
# A single-table view is stored with no qualifiers on its columns at all, which
# is the shape sqlglot cannot place without a schema.


def test_single_table_view_keeps_where_group_and_order_columns_as_indirect() -> None:
    by_table = column_mappings_by_table(
        """ SELECT order_date,
    sum(gross_amount) AS revenue
   FROM lab_mart.fct_orders f
  WHERE status <> 'CANCELLED'::text
  GROUP BY order_date
  ORDER BY order_date;""",
        dialect="postgres",
    )

    mappings = _by_downstream(by_table["lab_mart.fct_orders"])
    assert mappings["revenue"].upstreams == ("gross_amount",)
    assert mappings[None].type is FieldTransform.INDIRECT
    assert mappings[None].upstreams == ("order_date", "status")


def test_output_name_that_shadows_a_source_column_can_be_used_again() -> None:
    # `qty::integer AS qty` renames in place, then `qty` is used a second time.
    by_table = column_mappings_by_table(
        """ SELECT order_ref,
    qty::integer AS qty,
    qty::integer::numeric * unit_price::numeric AS line_total
   FROM lab_raw.order_lines_raw l;""",
        dialect="postgres",
    )

    mappings = _by_downstream(by_table["lab_raw.order_lines_raw"])
    assert mappings["qty"].upstreams == ("qty",)
    assert mappings["line_total"].upstreams == ("qty", "unit_price")


def test_order_by_an_output_alias_is_not_mistaken_for_a_column() -> None:
    by_table = column_mappings_by_table(
        "SELECT region, SUM(amount) AS total FROM sales GROUP BY region ORDER BY total DESC",
        dialect="postgres",
    )

    mappings = _by_downstream(by_table["sales"])
    assert mappings["total"].upstreams == ("amount",)
    assert mappings[None].upstreams == ("region",)


def test_quoted_mixed_case_output_names_resolve() -> None:
    by_table = column_mappings_by_table(
        """ SELECT "Order ID" AS "Id",
    lower("Customer Email") AS "Mail",
    "Total (EUR)" * 1.19 AS "Gross"
   FROM lab_edge."Mixed Case Orders" m;""",
        dialect="postgres",
    )

    mappings = _by_downstream(by_table["lab_edge.mixed case orders"])
    assert mappings["Id"].upstreams == ("Order ID",)
    assert mappings["Mail"].steps == ("LOWER",)
    assert mappings["Gross"].upstreams == ("Total (EUR)",)


def test_same_table_name_in_two_schemas_is_kept_apart() -> None:
    by_table = column_mappings_by_table(
        """ SELECT c.email,
    e.loyalty_tier
   FROM lab_core.customers c
     JOIN lab_edge.customers e ON e.customer_id = c.customer_id;""",
        dialect="postgres",
    )

    core = _by_downstream(by_table["lab_core.customers"])
    edge = _by_downstream(by_table["lab_edge.customers"])
    assert set(core) == {"email", None}
    assert set(edge) == {"loyalty_tier", None}


def test_lateral_subquery_is_followed_to_its_own_table() -> None:
    by_table = column_mappings_by_table(
        """ SELECT c.customer_id,
    t.order_id,
    t.total_amount
   FROM lab_core.customers c
     CROSS JOIN LATERAL ( SELECT o.order_id,
            o.total_amount
           FROM lab_core.orders o
          WHERE o.customer_id = c.customer_id
          ORDER BY o.total_amount DESC
         LIMIT 3) t;""",
        dialect="postgres",
    )

    customers = _by_downstream(by_table["lab_core.customers"])
    orders = _by_downstream(by_table["lab_core.orders"])
    assert set(customers) == {"customer_id", None}
    assert orders["order_id"].upstreams == ("order_id",)
    assert orders["total_amount"].upstreams == ("total_amount",)
    # The correlation `o.customer_id = c.customer_id` shapes rows from both.
    assert "customer_id" in orders[None].upstreams
    assert customers[None].upstreams == ("customer_id",)


def test_fields_for_table_prefers_the_schema_it_was_written_with() -> None:
    by_table = column_mappings_by_table(
        "SELECT c.email, e.tier FROM lab_core.customers c "
        "JOIN lab_edge.customers e ON e.customer_id = c.customer_id",
        dialect="postgres",
    )

    core = fields_for_table(by_table, ("db", "lab_core", "customers"))
    edge = fields_for_table(by_table, ("db", "lab_edge", "customers"))
    assert {m.downstream for m in core} == {"email", None}
    assert {m.downstream for m in edge} == {"tier", None}


def test_fields_for_table_matches_a_bare_name_by_table() -> None:
    # On the search path Postgres writes the table without its schema.
    by_table = column_mappings_by_table("SELECT id FROM orders", dialect="postgres")

    assert [m.downstream for m in fields_for_table(by_table, ("db", "public", "orders"))] == ["id"]
    assert fields_for_table(by_table, ("db", "public", "refunds")) == []


_MYSQL_STORED_VIEW = (
    "select `lab_shop`.`o`.`order_id` AS `order_id`,`e`.`full_name` AS `manager` "
    "from (`lab_shop`.`orders` `o` left join `lab_hr`.`employees` `e` "
    "on((`e`.`employee_id` = `o`.`account_manager_id`)))"
)


def test_two_level_names_are_database_and_table_not_a_third_part() -> None:
    # MySQL and Hive name a table ``database.table``; sqlglot files the first
    # part as ``db``, so the default database must not be put in front of it.
    keys = upstream_tables_from_sql(
        _MYSQL_STORED_VIEW, dialect="mysql", default_database="lab_audit", two_level=True
    )

    assert keys == [("lab_hr", "employees"), ("lab_shop", "orders")]


def test_two_level_bare_name_takes_the_views_own_database() -> None:
    keys = upstream_tables_from_sql(
        "select id from orders", dialect="mysql", default_database="shop", two_level=True
    )

    assert keys == [("shop", "orders")]


def test_three_level_names_still_get_catalog_schema_and_table() -> None:
    keys = upstream_tables_from_sql(
        "select a from raw.orders",
        dialect="snowflake",
        default_database="PROD",
        default_schema="MART",
    )

    assert keys == [("PROD", "raw", "orders")]
