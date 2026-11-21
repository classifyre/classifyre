# /// script
# requires-python = ">=3.12"
# dependencies = ["requests", "psycopg[binary]", "neo4j>=5,<7", "pyarrow", "boto3", "duckdb"]
# ///
"""Seed the search-and-graph lab (docs/prd/QC-query-connectors.md §6).

    uv run seed/connectors.py             # load everything, write the expected answers
    uv run seed/connectors.py --expected  # only the expected answers

Fixed random seed 7, so every run makes the same data:

* Meilisearch: 20,000 films in ``movies`` (filterable ``genre``, ``year``,
  ``id``; a nested ``studio``, a list of ``tags``);
* PostgreSQL ``shop``: 5,000 customers in ``public.customers`` (invented
  names and addresses at shop.example);
* S3: 200,000 orders as Parquet, ``s3://lake/tables/connectors/orders.parquet``
  (the lab's S3 source reads ``tables/``);
* Neo4j: 5,000 ``Person {id}`` (the customers), 20,000 ``Movie {id, title}``
  and 50,000 ``RATED {stars}`` from a person to a film.

``queries/connectors/expected.json``: each ``queries/connectors/*.sql`` run by
a plain DuckDB over the same generated rows, under the same table names: the
answer Classifyre must give, worked out without its connectors.
"""

from __future__ import annotations

import argparse
import datetime
import io
import json
import random
import sys
import time
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent.parent
QUERIES = HERE / "queries" / "connectors"

MEILI = "http://localhost:17700"
MEILI_KEY = "lab-meili-master-key-0123456789"
NEO4J = "bolt://localhost:17687"
NEO4J_AUTH = ("neo4j", "lab-neo4j-pass")
SHOP_PG = "host=localhost port=15433 dbname=shop user=lab password=lab-shop-pass"
S3 = "http://localhost:19000"
S3_KEYS = ("lab-access-key", "lab-secret-key-0123456789")
ORDERS_KEY = "tables/connectors/orders.parquet"

GENRES = ["Drama", "Comedy", "Sci-Fi", "Horror", "Action", "Documentary", "Romance", "Thriller"]
COUNTRIES = ["AT", "DE", "FR", "CH", "IT", "NL", "PL", "ES"]
STUDIOS = ["Aurora", "Basalt", "Cobalt", "Dune", "Ember", "Fjord"]
TAGS = ["award", "classic", "cult", "debut", "festival", "indie", "remake", "series", "silent", "sequel"]
WORDS = ["Night", "River", "Glass", "Iron", "Summer", "Signal", "Harbor", "Orbit", "Paper", "Echo"]


def generate() -> dict[str, list[dict[str, Any]]]:
    rng = random.Random(7)
    movies = [
        {
            "id": i,
            "title": f"{rng.choice(WORDS)} {rng.choice(WORDS)} {i}",
            "genre": rng.choice(GENRES),
            "year": rng.randint(1980, 2024),
            "rating": round(rng.uniform(1, 10), 1),
            "studio": {"name": rng.choice(STUDIOS), "country": rng.choice(COUNTRIES)},
            "tags": sorted(rng.sample(TAGS, rng.randint(1, 3))),
        }
        for i in range(1, 20_001)
    ]
    customers = [
        {
            "id": i,
            "name": f"Customer {i}",
            "email": f"customer{i}@shop.example",
            "country": rng.choice(COUNTRIES),
        }
        for i in range(1, 5_001)
    ]
    start = datetime.date(2024, 1, 1)
    orders = [
        {
            "order_id": i,
            "customer_id": rng.randint(1, 5_000),
            "movie_id": rng.randint(1, 20_000),
            "amount": round(rng.uniform(2, 40), 2),
            "ordered_at": start + datetime.timedelta(days=rng.randint(0, 600)),
        }
        for i in range(1, 200_001)
    ]
    pairs: set[tuple[int, int]] = set()
    while len(pairs) < 50_000:
        pairs.add((rng.randint(1, 5_000), rng.randint(1, 20_000)))
    rated = [{"person": p, "movie": m, "stars": rng.randint(1, 5)} for p, m in sorted(pairs)]
    return {"movies": movies, "customers": customers, "orders": orders, "rated": rated}


# ── load ───────────────────────────────────────────────────────────────


def load_meilisearch(movies: list[dict[str, Any]]) -> None:
    import requests

    session = requests.Session()
    session.headers["Authorization"] = f"Bearer {MEILI_KEY}"

    def wait(task: dict[str, Any]) -> None:
        uid = task["taskUid"]
        while True:
            status = session.get(f"{MEILI}/tasks/{uid}", timeout=30).json()
            if status["status"] in ("succeeded", "failed", "canceled"):
                if status["status"] != "succeeded" and "index_already_exists" not in str(status):
                    raise RuntimeError(f"Meilisearch task {uid}: {status.get('error')}")
                return
            time.sleep(0.2)

    session.delete(f"{MEILI}/indexes/movies", timeout=30)
    time.sleep(0.5)
    wait(session.post(f"{MEILI}/indexes", json={"uid": "movies", "primaryKey": "id"}, timeout=30).json())
    wait(
        session.put(
            f"{MEILI}/indexes/movies/settings/filterable-attributes",
            json=["genre", "year", "id"],
            timeout=30,
        ).json()
    )
    for offset in range(0, len(movies), 5_000):
        task = session.post(
            f"{MEILI}/indexes/movies/documents", json=movies[offset : offset + 5_000], timeout=120
        ).json()
        wait(task)
    print(f"meilisearch: {len(movies)} movies")


def load_postgres(customers: list[dict[str, Any]]) -> None:
    import psycopg

    with psycopg.connect(SHOP_PG, autocommit=True) as conn:
        conn.execute("DROP TABLE IF EXISTS public.customers")
        conn.execute(
            "CREATE TABLE public.customers "
            "(id integer PRIMARY KEY, name text NOT NULL, email text NOT NULL, country text NOT NULL)"
        )
        with conn.cursor().copy("COPY public.customers (id, name, email, country) FROM STDIN") as copy:
            for c in customers:
                copy.write_row((c["id"], c["name"], c["email"], c["country"]))
    print(f"postgres: {len(customers)} customers")


def load_s3(orders: list[dict[str, Any]]) -> None:
    import boto3
    import pyarrow as pa
    import pyarrow.parquet as pq

    table = pa.Table.from_pylist(orders)
    buffer = io.BytesIO()
    pq.write_table(table, buffer, compression="zstd")
    s3 = boto3.client(
        "s3",
        endpoint_url=S3,
        aws_access_key_id=S3_KEYS[0],
        aws_secret_access_key=S3_KEYS[1],
        region_name="us-east-1",
    )
    s3.put_object(Bucket="lake", Key=ORDERS_KEY, Body=buffer.getvalue())
    print(f"s3: {len(orders)} orders → s3://lake/{ORDERS_KEY}")


def load_neo4j(data: dict[str, list[dict[str, Any]]]) -> None:
    from neo4j import GraphDatabase

    with GraphDatabase.driver(NEO4J, auth=NEO4J_AUTH) as driver, driver.session() as session:
        session.run("MATCH (n) CALL (n) { DETACH DELETE n } IN TRANSACTIONS OF 10000 ROWS").consume()
        session.run("CREATE CONSTRAINT person_id IF NOT EXISTS FOR (p:Person) REQUIRE p.id IS UNIQUE")
        session.run("CREATE CONSTRAINT movie_id IF NOT EXISTS FOR (m:Movie) REQUIRE m.id IS UNIQUE")
        people = [{"id": c["id"]} for c in data["customers"]]
        films = [{"id": m["id"], "title": m["title"]} for m in data["movies"]]
        for rows, cypher in (
            (people, "UNWIND $rows AS row CREATE (:Person {id: row.id})"),
            (films, "UNWIND $rows AS row CREATE (:Movie {id: row.id, title: row.title})"),
            (
                data["rated"],
                "UNWIND $rows AS row MATCH (p:Person {id: row.person}), (m:Movie {id: row.movie}) "
                "CREATE (p)-[:RATED {stars: row.stars}]->(m)",
            ),
        ):
            for offset in range(0, len(rows), 10_000):
                session.run(cypher, rows=rows[offset : offset + 10_000]).consume()
    print(f"neo4j: {len(people)} people, {len(films)} movies, {len(data['rated'])} ratings")


# ── the expected answers ───────────────────────────────────────────────


def expected(data: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    """Every query over the generated rows in a plain DuckDB, same names."""
    import duckdb
    import pyarrow as pa

    conn = duckdb.connect()
    movies = [{**m, "studio": json.dumps(m["studio"])} for m in data["movies"]]
    rated = [
        {"source_id": r["person"], "target_id": r["movie"], "stars": r["stars"]}
        for r in data["rated"]
    ]
    tables = {
        ("lab_s3_tables", "tables_connectors", "orders"): data["orders"],
        ("lab_meilisearch", "indexes", "movies"): movies,
        ("lab_shop", "public", "customers"): data["customers"],
        ("lab_neo4j", "relationships", "rated"): rated,
    }
    for (catalog, schema, table), rows in tables.items():
        conn.execute(f"ATTACH IF NOT EXISTS ':memory:' AS {catalog}")
        conn.execute(f"CREATE SCHEMA IF NOT EXISTS {catalog}.{schema}")
        arrow = pa.Table.from_pylist(rows)
        conn.register("__rows", arrow)
        conn.execute(f"CREATE TABLE {catalog}.{schema}.{table} AS SELECT * FROM __rows")
        conn.unregister("__rows")
    answers: dict[str, Any] = {}
    for path in sorted(QUERIES.glob("*.sql")):
        cursor = conn.execute(path.read_text(encoding="utf-8"))
        names = [d[0] for d in cursor.description]
        answers[path.stem] = [dict(zip(names, _plain(row), strict=True)) for row in cursor.fetchall()]
    drama_recent = sum(1 for m in data["movies"] if m["genre"] == "Drama" and m["year"] >= 2015)
    return {
        "queries": answers,
        # Documents Q1 should read from Meilisearch with its filter sent, and without.
        "q1_documents": {"pushed": drama_recent, "all": len(data["movies"])},
    }


def _plain(row: tuple[Any, ...]) -> list[Any]:
    out = []
    for value in row:
        if isinstance(value, float):
            value = round(value, 6)
        elif isinstance(value, (datetime.date, datetime.datetime)):
            value = value.isoformat()
        elif not isinstance(value, (int, str, list, type(None))):
            value = str(value)
        out.append(value)
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--expected", action="store_true", help="only write expected.json")
    args = parser.parse_args()
    data = generate()
    if not args.expected:
        load_meilisearch(data["movies"])
        load_postgres(data["customers"])
        load_s3(data["orders"])
        load_neo4j(data)
    out = QUERIES / "expected.json"
    out.write_text(json.dumps(expected(data), indent=2) + "\n", encoding="utf-8")
    print(f"wrote {out.relative_to(HERE)}")


if __name__ == "__main__":
    sys.exit(main())
