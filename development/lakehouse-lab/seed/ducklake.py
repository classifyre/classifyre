"""Seed the lab DuckLake: catalog in Postgres, data in the lab bucket.

* ``crm.people`` — 12 people, row 2 deleted, ``email`` renamed to ``contact``.
"""

import duckdb

conn = duckdb.connect()
for extension in ("ducklake", "postgres", "httpfs"):
    conn.execute(f"INSTALL {extension}; LOAD {extension}")
conn.execute(
    "CREATE SECRET lab_s3 (TYPE S3, KEY_ID 'lab-access-key', SECRET 'lab-secret-key-0123456789', "
    "REGION 'us-east-1', ENDPOINT '172.19.10.10:9000', URL_STYLE 'path', USE_SSL false)"
)
conn.execute(
    "ATTACH 'ducklake:postgres:dbname=lake host=172.19.10.40 user=lab password=lab-ducklake' "
    "AS lake (DATA_PATH 's3://lake/ducklake/')"
)
conn.execute("CREATE SCHEMA IF NOT EXISTS lake.crm")
conn.execute("DROP TABLE IF EXISTS lake.crm.people")
conn.execute(
    "CREATE TABLE lake.crm.people AS SELECT r AS id, 'ducklake' || r || '@lab.example.com' AS email "
    "FROM range(1, 13) t(r)"
)
conn.execute("DELETE FROM lake.crm.people WHERE id = 2")
conn.execute("ALTER TABLE lake.crm.people RENAME COLUMN email TO contact")
print("ducklake seeded:", conn.execute("SELECT count(*) FROM lake.crm.people").fetchall()[0][0], "rows")
