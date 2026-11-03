"""Write the lakehouse cases only an engine can write, through the lab's Trino.

    python trino_tables.py http://172.19.10.30:8080

* ``delta.crm.customers`` (s3://lake/tables/trino_delta/customers) — deletion
  vectors on and column mapping by name: 5 people, row 2 deleted (a deletion
  vector, the file stays), ``email`` renamed to ``contact``, a 6th person.
  A reader must show 5 rows and one ``contact`` column.
* ``iceberg.trino_crm.people`` (Gravitino's warehouse) — format v2: 5 people,
  row 3 deleted with a positional delete file (merge-on-read). 4 rows.
* ``iceberg_polaris.trino_crm.people`` — the same, in Polaris (s3://lake/polaris/),
  whose metadata is in the bucket so a bucket scan reads it by path too.
* ``hive.lab.plain_people`` — a plain Hive Parquet table (in the file metastore's
  own directory, s3://lake/trino-metastore/hive), 3 rows.

Every value is invented; e-mails are ``<table><n>@lab.example.com``.
"""

import os
import sys
from urllib.parse import urlsplit

import boto3
import trino

url = urlsplit(sys.argv[1])
conn = trino.dbapi.connect(host=url.hostname, port=url.port, user="lab", http_scheme=url.scheme)
cursor = conn.cursor()


def run(sql: str) -> None:
    cursor.execute(sql)
    cursor.fetchall()


people = ["Pip Marlow", "Zephyr Quill", "Lark Brook", "Ada Ferrow", "Juniper Vale", "Wren Holloway"]

run("CREATE SCHEMA IF NOT EXISTS delta.crm WITH (location = 's3://lake/tables/trino_delta/')")
run("DROP TABLE IF EXISTS delta.crm.customers")
# Dropping an external Delta table keeps its files, and Trino refuses to create a
# table over existing content: clear the location so the seed can rerun.
s3 = boto3.client("s3", endpoint_url=os.environ["LAB_S3_ENDPOINT"])


def purge(prefix: str) -> None:
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket="lake", Prefix=prefix):
        for item in page.get("Contents", []):
            s3.delete_object(Bucket="lake", Key=item["Key"])


def purge_if_forgotten(catalog: str, prefix: str) -> None:
    """Clear a table's old files when the catalog no longer knows the table.

    Both lab catalogs keep their state in memory but their files in the bucket,
    so a restarted catalog leaves files behind at the location it assigns again,
    and Trino will not create a table over them.
    """
    cursor.execute(f"SHOW TABLES FROM {catalog}.trino_crm LIKE 'people'")
    if not cursor.fetchall():
        purge(prefix)


purge("tables/trino_delta/customers/")
run(
    "CREATE TABLE delta.crm.customers (id BIGINT, name VARCHAR, email VARCHAR) "
    "WITH (location = 's3://lake/tables/trino_delta/customers', "
    "deletion_vectors_enabled = true, column_mapping_mode = 'name')"
)
values = ", ".join(f"({i}, '{people[i - 1]}', 'customers{i}@lab.example.com')" for i in range(1, 6))
run(f"INSERT INTO delta.crm.customers VALUES {values}")
run("DELETE FROM delta.crm.customers WHERE id = 2")
run("ALTER TABLE delta.crm.customers RENAME COLUMN email TO contact")
run(f"INSERT INTO delta.crm.customers VALUES (6, '{people[5]}', 'customers6@lab.example.com')")

run("CREATE SCHEMA IF NOT EXISTS iceberg.trino_crm")
purge_if_forgotten("iceberg", "gravitino/trino_crm/people")
run(
    "CREATE TABLE IF NOT EXISTS iceberg.trino_crm.people (id BIGINT, name VARCHAR, email VARCHAR) "
    "WITH (format_version = 2)"
)
# Gravitino refuses to drop it on a rerun; emptying it is a delete as well.
run("DELETE FROM iceberg.trino_crm.people")
values_people = ", ".join(f"({i}, '{people[i - 1]}', 'people{i}@lab.example.com')" for i in range(1, 6))
run(f"INSERT INTO iceberg.trino_crm.people VALUES {values_people}")
run("DELETE FROM iceberg.trino_crm.people WHERE id = 3")

run("DROP SCHEMA IF EXISTS hive.lab CASCADE")
run("CREATE SCHEMA hive.lab")
run("DROP TABLE IF EXISTS hive.lab.plain_people")
run("CREATE TABLE hive.lab.plain_people (id BIGINT, name VARCHAR, email VARCHAR) WITH (format = 'PARQUET')")
values = ", ".join(f"({i}, '{people[i - 1]}', 'plain{i}@lab.example.com')" for i in range(1, 4))
run(f"INSERT INTO hive.lab.plain_people VALUES {values}")

# The same merge-on-read table in Polaris, which keeps its metadata in the bucket,
# so a bucket scan can read it by path as well.
run("CREATE SCHEMA IF NOT EXISTS iceberg_polaris.trino_crm")
purge_if_forgotten("iceberg_polaris", "polaris/trino_crm/people")
run(
    "CREATE TABLE IF NOT EXISTS iceberg_polaris.trino_crm.people (id BIGINT, name VARCHAR, email VARCHAR) "
    "WITH (format_version = 2)"
)
run("DELETE FROM iceberg_polaris.trino_crm.people")
run(f"INSERT INTO iceberg_polaris.trino_crm.people VALUES {values_people}")
run("DELETE FROM iceberg_polaris.trino_crm.people WHERE id = 3")

for table in (
    "delta.crm.customers",
    "iceberg.trino_crm.people",
    "iceberg_polaris.trino_crm.people",
    "hive.lab.plain_people",
):
    cursor.execute(f"SELECT count(*) FROM {table}")
    print(table, cursor.fetchall()[0][0], "rows")
