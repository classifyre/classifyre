"""Write the path-readable lakehouse tables and upload them to the lab's storage.

    python bucket_tables.py

Creates bucket ``lake`` on S3 (SeaweedFS) and container ``lake`` on Azurite,
clears what an earlier run left under ``tables/``, and puts under ``tables/`` in
both, and in ``/out`` (the repo's ``dump_files/
lakehouse-lab``, which scan pods see as ``/mnt/corpora/dumps/lakehouse-lab``):

* ``delta_orders/`` — Delta, 12 rows, row 2 deleted: 11 rows.
* ``iceberg_contacts/`` — Iceberg v2 written without a catalog: 10 rows,
  ``email`` renamed to ``contact``, 2 more, row 1 deleted: 11 rows, one
  ``contact`` column.
* ``lance_people.lance/`` — Lance, 6 rows, row 2 deleted: 5 rows.
* ``paimon_wh/crm.db/people/`` — Paimon append table from ``fixtures/`` (pypaimon
  pins a pyarrow too old to share this image).
* ``plain.csv`` — an ordinary file beside the tables, still scanned as a file.

Every value is invented; e-mails are ``<table><n>@lab.example.com``.
"""

import os
import shutil
from pathlib import Path

import boto3
import lance
import pyarrow as pa
from azure.storage.blob import BlobServiceClient
from botocore.config import Config
from deltalake import DeltaTable, write_deltalake
from pyiceberg.catalog.sql import SqlCatalog

WORK = Path("/tmp/lakehouse-tables")
OUT = Path("/out")
AZURITE = (
    "DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;"
    "AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;"
    "BlobEndpoint=http://172.19.10.11:10000/devstoreaccount1;"
)

shutil.rmtree(WORK, ignore_errors=True)
tables = WORK / "tables"
tables.mkdir(parents=True)


def emails(table: str, ids: range) -> list[str]:
    return [f"{table}{i}@lab.example.com" for i in ids]


delta = tables / "delta_orders"
write_deltalake(str(delta), pa.table({"id": list(range(1, 13)), "email": emails("orders", range(1, 13))}))
DeltaTable(str(delta)).delete("id = 2")

catalog = SqlCatalog("lab", uri=f"sqlite:///{WORK}/catalog.db", warehouse=f"file://{WORK}/warehouse")
catalog.create_namespace("crm")
contacts = catalog.create_table(
    "crm.contacts", schema=pa.schema([("id", pa.int64()), ("email", pa.string())])
)
contacts.append(pa.table({"id": list(range(1, 11)), "email": emails("contacts", range(1, 11))}))
with contacts.update_schema() as update:
    update.rename_column("email", "contact")
contacts = catalog.load_table("crm.contacts")
contacts.append(pa.table({"id": [11, 12], "contact": emails("contacts", range(11, 13))}))
catalog.load_table("crm.contacts").delete("id == 1")
shutil.copytree(WORK / "warehouse" / "crm" / "contacts", tables / "iceberg_contacts")

people = tables / "lance_people.lance"
lance.write_dataset(
    pa.table({"id": list(range(1, 7)), "email": emails("lance", range(1, 7))}), str(people)
)
lance.dataset(str(people)).delete("id = 2")

shutil.copytree(Path(__file__).parent / "fixtures" / "paimon_wh", tables / "paimon_wh")
(tables / "plain.csv").write_text(
    "id,email\n" + "".join(f"{i},plain{i}@lab.example.com\n" for i in range(1, 4))
)

s3 = boto3.client(
    "s3",
    endpoint_url=os.environ["LAB_S3_ENDPOINT"],
    config=Config(s3={"addressing_style": "path"}),
)
try:
    s3.create_bucket(Bucket="lake")
except s3.exceptions.BucketAlreadyOwnedByYou:
    pass
azure = BlobServiceClient.from_connection_string(AZURITE).get_container_client("lake")
if not azure.exists():
    azure.create_container()

# Clear what an earlier run (or a hand upload) left under tables/, except the
# Delta table trino_tables.py writes there.
KEEP = "tables/trino_delta/"
for page in s3.get_paginator("list_objects_v2").paginate(Bucket="lake", Prefix="tables/"):
    for item in page.get("Contents", []):
        if not item["Key"].startswith(KEEP):
            s3.delete_object(Bucket="lake", Key=item["Key"])
for blob in azure.list_blobs(name_starts_with="tables/"):
    if not blob.name.startswith(KEEP):
        azure.delete_blob(blob.name)

files = [f for f in tables.rglob("*") if f.is_file()]
for f in files:
    key = f.relative_to(WORK).as_posix()
    s3.upload_file(str(f), "lake", key)
    azure.upload_blob(key, f.read_bytes(), overwrite=True)
if OUT.is_dir():
    shutil.rmtree(OUT / "tables", ignore_errors=True)
    shutil.copytree(tables, OUT / "tables")
print(f"bucket tables: {len(files)} files to s3://lake/tables, az://lake/tables"
      + (", /out/tables" if OUT.is_dir() else ""))
