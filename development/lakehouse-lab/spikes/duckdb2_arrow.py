"""QC0 spike: how DuckDB 2.0 reads Python Arrow objects (docs/prd/QC-query-connectors.md §5.3).

Run from apps/cli: ``uv run python ../../development/lakehouse-lab/spikes/duckdb2_arrow.py``.
"""

from __future__ import annotations

import duckdb
import pyarrow as pa
import pyarrow.dataset as ds

print("duckdb", duckdb.__version__, "pyarrow", pa.__version__)
TABLE = pa.table({"id": list(range(1000)), "genre": ["Drama", "Horror"] * 500, "x": [1.5] * 1000})


class Stream:
    """A connector-shaped object: Arrow C stream, records what it was asked."""

    def __init__(self) -> None:
        self.calls: list[object] = []

    def __arrow_c_stream__(self, requested_schema: object = None) -> object:
        self.calls.append(requested_schema)
        return pa.RecordBatchReader.from_batches(TABLE.schema, TABLE.to_batches(100)).__arrow_c_stream__()


def q(conn: duckdb.DuckDBPyConnection, sql: str) -> object:
    try:
        return conn.sql(sql).fetchall()
    except Exception as exc:  # noqa: BLE001
        return f"ERROR {type(exc).__name__}: {str(exc).splitlines()[0]}"


conn = duckdb.connect()

# 1. A registered RecordBatchReader: single use?
reader = pa.RecordBatchReader.from_batches(TABLE.schema, TABLE.to_batches(100))
conn.register("r", reader)
print("1 reader first :", q(conn, "SELECT count(*) FROM r"))
print("1 reader second:", q(conn, "SELECT count(*) FROM r"))
s = Stream()
conn.register("s", s)
print("1 capsule obj  :", q(conn, "SELECT count(*) FROM s"), q(conn, "SELECT count(*) FROM s"),
      "stream opened", len(s.calls), "times")
print("1 self-join    :", q(conn, "SELECT count(*) FROM s a JOIN s b USING (id)"), "opened", len(s.calls))

# 2. Projection / filter pushdown into a registered dataset or the capsule object
dataset = ds.dataset(TABLE)
conn.register("d", dataset)
print("2 dataset plan :", [r[1] for r in conn.sql("EXPLAIN SELECT id FROM d WHERE genre = 'Drama'").fetchall()][0][:400])
s2 = Stream()
conn.register("s2", s2)
q(conn, "SELECT id FROM s2 WHERE genre = 'Drama'")
print("2 capsule requested_schema:", s2.calls)

# 3. A Python table-function API?
print("3 create_table_function:", hasattr(conn, "create_table_function"),
      [n for n in dir(conn) if "table" in n.lower() and "function" in n.lower()])

# 4. register after lock_configuration
conn2 = duckdb.connect()
conn2.register("e", TABLE.slice(0, 0))
conn2.execute("CREATE VIEW v AS SELECT * FROM e WHERE genre = 'Drama'")
conn2.execute("SET lock_configuration = true")
conn2.register("e", TABLE)
print("4 re-register after lock:", q(conn2, "SELECT count(*) FROM v"))
s3 = Stream()
conn2.register("e", s3)
print("4 capsule after lock:", q(conn2, "SELECT count(*) FROM v"))

# 5. Join filters into a stream / dataset: does a semi-join narrow what is read?
small = pa.table({"id": [1, 2, 3]})
conn.register("small", small)
plan = conn.sql("EXPLAIN ANALYZE SELECT count(*) FROM d JOIN small USING (id)").fetchall()[0][1]
print("5 dataset join filter (ARROW_SCAN rows):", [ln.strip() for ln in plan.splitlines() if "rows" in ln.lower() or "Filters" in ln][:12])
