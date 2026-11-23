"""Write Kestrel & Finch Journeys into the lakehouse lab's services.

Runs in the lab's tools container (it has psycopg2, deltalake, pyiceberg and
DuckDB, and sits on the k3d network):

    development/lakehouse-lab: docker compose --profile tools run --rm -T \
        -v "$PWD/../kestrel-finch/seed:/kf" tools python /kf/load.py

Safe to rerun: every table is dropped and written again.

| System                     | Where                                                        |
| -------------------------- | ------------------------------------------------------------ |
| Kestrel CRM (HubSpot-ish)  | PostgreSQL ``kestrel_crm`` on lab-shop-pg, schema ``crm``     |
| Finch CRM (Salesforce)     | Delta in ``s3://lake/kestrel-finch/finch_salesforce/``       |
| Wayfarer Club loyalty      | Iceberg in Polaris, warehouse ``lab_polaris``, ns ``wayfarer``|
| Support desk               | DuckLake ``kestrel_lake`` on lab-ducklake-pg, schema ``support`` |
| Billing (legacy)           | PostgreSQL ``kestrel_billing`` on lab-shop-pg, schema ``billing``; read over ODBC |
"""

from __future__ import annotations

import datetime as dt
import decimal
import sys

import duckdb
import psycopg2
import psycopg2.extras
import pyarrow as pa
from deltalake import DeltaTable, write_deltalake

sys.path.insert(0, "/kf")
import company  # noqa: E402

S3 = {"endpoint": "172.18.10.10:9000", "key": "lab-access-key", "secret": "lab-secret-key-0123456789"}
SHOP_PG = {"host": "172.18.10.52", "user": "lab", "password": "lab-shop-pass"}
LAKE_PG = {"host": "172.18.10.40", "user": "lab", "password": "lab-ducklake"}
POLARIS = "http://172.18.10.21:8181/api/catalog"

DATA = company.everything()


# ── PostgreSQL ──────────────────────────────────────────────────────────────


def pg_type(value: object) -> str:
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "bigint"
    if isinstance(value, float):
        return "numeric(12,2)"
    if isinstance(value, dt.datetime):
        return "timestamptz"
    if isinstance(value, dt.date):
        return "date"
    return "text"


def ensure_db(conn_args: dict, name: str) -> None:
    conn = psycopg2.connect(dbname="postgres", **conn_args)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (name,))
        if not cur.fetchone():
            cur.execute(f'CREATE DATABASE "{name}"')
    conn.close()


def load_pg(database: str, schema: str, tables: dict[str, list[dict]], keys: dict[str, str],
            comments: dict[str, str]) -> None:
    ensure_db(SHOP_PG, database)
    conn = psycopg2.connect(dbname=database, **SHOP_PG)
    with conn, conn.cursor() as cur:
        cur.execute(f"DROP SCHEMA IF EXISTS {schema} CASCADE; CREATE SCHEMA {schema}")
        for table, rows in tables.items():
            columns = list(rows[0])
            types = {}
            for column in columns:
                sample = next((r[column] for r in rows if r[column] is not None), "")
                types[column] = pg_type(sample)
            ddl = ", ".join(
                f'"{c}" {types[c]}' + (" PRIMARY KEY" if keys.get(table) == c else "") for c in columns
            )
            cur.execute(f"CREATE TABLE {schema}.{table} ({ddl})")
            if table in comments:
                cur.execute(f"COMMENT ON TABLE {schema}.{table} IS %s", (comments[table],))
            psycopg2.extras.execute_values(
                cur,
                f"INSERT INTO {schema}.{table} ({', '.join(chr(34) + c + chr(34) for c in columns)}) VALUES %s",
                [tuple(r[c] for c in columns) for r in rows],
            )
            print(f"pg {database}.{schema}.{table}: {len(rows)}")
        if schema == "crm":
            cur.execute(
                "ALTER TABLE crm.deals ADD FOREIGN KEY (contact_id) REFERENCES crm.contacts(contact_id);"
                "ALTER TABLE crm.notes ADD FOREIGN KEY (contact_id) REFERENCES crm.contacts(contact_id);"
            )
    conn.close()


# ── Arrow helpers ───────────────────────────────────────────────────────────


def arrow(rows: list[dict]) -> pa.Table:
    columns = list(rows[0])
    arrays = {}
    for column in columns:
        values = [r[column] for r in rows]
        sample = next((v for v in values if v is not None), None)
        if isinstance(sample, bool):
            typ = pa.bool_()
        elif isinstance(sample, int):
            typ = pa.int64()
        elif isinstance(sample, float):
            typ = pa.float64()
        elif isinstance(sample, dt.datetime):
            typ = pa.timestamp("us", tz="UTC")
        elif isinstance(sample, dt.date):
            typ = pa.date32()
        elif isinstance(sample, decimal.Decimal):
            typ = pa.decimal128(12, 2)
        else:
            typ = pa.string()
        arrays[column] = pa.array(values, type=typ)
    return pa.table(arrays)


# ── Finch: Delta in S3 ──────────────────────────────────────────────────────


def load_finch() -> None:
    options = {
        "AWS_ENDPOINT_URL": f"http://{S3['endpoint']}", "AWS_ACCESS_KEY_ID": S3["key"],
        "AWS_SECRET_ACCESS_KEY": S3["secret"], "AWS_REGION": "us-east-1",
        "AWS_ALLOW_HTTP": "true", "AWS_S3_ALLOW_UNSAFE_RENAME": "true",
    }
    root = "s3://lake/kestrel-finch/finch_salesforce"
    for table, rows in DATA["finch"].items():
        write_deltalake(f"{root}/{table}", arrow(rows), mode="overwrite",
                        schema_mode="overwrite", storage_options=options)
        print(f"delta finch_salesforce/{table}: {len(rows)}")
    # A GDPR erasure (Art. 17) the Salesforce sync carried over: the row is
    # deleted in a later Delta version, its data file stays on disk.
    erased = next(r for r in DATA["finch"]["contact"] if r["LastName"] == "Pemberton")
    DeltaTable(f"{root}/contact", storage_options=options).delete(f"Id = '{erased['Id']}'")
    print(f"delta: erased {erased['FirstName']} {erased['LastName']} <{erased['Email']}>")
    with open("/kf/erased.txt", "w") as handle:
        handle.write(erased["Email"] + "\n")


# ── Wayfarer: Iceberg in Polaris ────────────────────────────────────────────


def load_wayfarer() -> None:
    from pyiceberg.catalog import load_catalog
    from pyiceberg.exceptions import NamespaceAlreadyExistsError, NoSuchTableError

    catalog = load_catalog(
        "polaris", type="rest", uri=POLARIS, warehouse="lab_polaris", credential="root:s3cr3t",
        scope="PRINCIPAL_ROLE:ALL", **{"header.X-Iceberg-Access-Delegation": "",
                                       "s3.endpoint": f"http://{S3['endpoint']}",
                                       "s3.access-key-id": S3["key"], "s3.secret-access-key": S3["secret"],
                                       "s3.path-style-access": "true", "s3.region": "us-east-1"},
    )
    try:
        catalog.create_namespace("wayfarer")
    except NamespaceAlreadyExistsError:
        pass
    for table, rows in DATA["wayfarer"].items():
        try:
            catalog.drop_table(f"wayfarer.{table}")
        except NoSuchTableError:
            pass
        data = arrow(rows)
        created = catalog.create_table(f"wayfarer.{table}", schema=data.schema)
        created.append(data)
        print(f"iceberg wayfarer.{table}: {len(rows)}")


# ── Support: DuckLake ───────────────────────────────────────────────────────


def load_support() -> None:
    import psycopg2 as pg

    conn = pg.connect(dbname="postgres", **LAKE_PG)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute("SELECT 1 FROM pg_database WHERE datname = 'kestrel_lake'")
        if not cur.fetchone():
            cur.execute("CREATE DATABASE kestrel_lake")
    conn.close()
    db = duckdb.connect()
    for extension in ("ducklake", "postgres", "httpfs"):
        db.execute(f"INSTALL {extension}; LOAD {extension}")
    db.execute(
        f"CREATE SECRET kf_s3 (TYPE S3, KEY_ID '{S3['key']}', SECRET '{S3['secret']}', REGION 'us-east-1', "
        f"ENDPOINT '{S3['endpoint']}', URL_STYLE 'path', USE_SSL false)"
    )
    db.execute(
        f"ATTACH 'ducklake:postgres:dbname=kestrel_lake host={LAKE_PG['host']} user=lab "
        f"password={LAKE_PG['password']}' AS kf (DATA_PATH 's3://lake/kestrel-finch/ducklake/')"
    )
    db.execute("CREATE SCHEMA IF NOT EXISTS kf.support")
    db.execute("DROP TABLE IF EXISTS kf.support.tickets")
    tickets = arrow(DATA["support"]["tickets"])  # noqa: F841 - read by DuckDB below
    db.execute("CREATE TABLE kf.support.tickets AS SELECT * FROM tickets")
    print("ducklake support.tickets:", db.execute("SELECT count(*) FROM kf.support.tickets").fetchone()[0])


if __name__ == "__main__":
    only = set(sys.argv[1:])
    if not only or "kestrel" in only:
        load_pg("kestrel_crm", "crm", DATA["kestrel"],
                keys={"contacts": "contact_id", "deals": "deal_id", "notes": "note_id"},
                comments={"contacts": "Kestrel Reisen CRM contacts (HubSpot sync)",
                          "notes": "Free-text notes sales reps leave on a contact"})
    if not only or "billing" in only:
        load_pg("kestrel_billing", "billing", DATA["billing"],
                keys={"invoices": "invoice_no", "payment_cards": "pm_id"},
                comments={"payment_cards": "Legacy card vault (pre-tokenisation, scheduled for removal)"})
    if not only or "finch" in only:
        load_finch()
    if not only or "wayfarer" in only:
        load_wayfarer()
    if not only or "support" in only:
        load_support()
