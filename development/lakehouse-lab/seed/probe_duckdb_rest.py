"""Probe DuckDB's Iceberg REST attach against the lab catalogs."""
import duckdb

def run(label, statements, db):
    c = duckdb.connect()
    for ext in ("httpfs", "iceberg"):
        c.execute(f"INSTALL {ext}; LOAD {ext}")
    try:
        for s in statements:
            c.execute(s)
        tables = c.execute(f"SELECT schema_name, table_name FROM duckdb_tables() WHERE database_name = '{db}' ORDER BY 1, 2").fetchall()
        print(label, "tables:", tables)
        cur = c.execute(f"SELECT * FROM {db}.crm.contacts ORDER BY id")
        print(label, [d[0] for d in cur.description], cur.fetchall())
        print(label, "orders:", c.execute(f"SELECT count(*) FROM {db}.crm.orders").fetchall())
    except Exception as e:
        print(label, "FAIL", str(e)[:400])

S3 = ("CREATE SECRET lab_s3 (TYPE S3, KEY_ID 'lab-access-key', SECRET 'lab-secret-key-0123456789', "
      "REGION 'us-east-1', ENDPOINT '172.19.10.10:9000', URL_STYLE 'path', USE_SSL false)")
run("gravitino", [
    "ATTACH '' AS g (TYPE iceberg, ENDPOINT 'http://172.19.10.20:9001/iceberg', AUTHORIZATION_TYPE 'none')",
], "g")
run("gravitino+s3", [S3,
    "ATTACH '' AS g (TYPE iceberg, ENDPOINT 'http://172.19.10.20:9001/iceberg', AUTHORIZATION_TYPE 'none', ACCESS_DELEGATION_MODE 'none')",
], "g")
run("polaris", [S3,
    "CREATE SECRET pol (TYPE ICEBERG, CLIENT_ID 'root', CLIENT_SECRET 's3cr3t', OAUTH2_SERVER_URI 'http://172.19.10.21:8181/api/catalog/v1/oauth/tokens', OAUTH2_SCOPE 'PRINCIPAL_ROLE:ALL')",
    "ATTACH 'lab_polaris' AS p (TYPE iceberg, ENDPOINT 'http://172.19.10.21:8181/api/catalog', SECRET pol, ACCESS_DELEGATION_MODE 'none')",
], "p")
