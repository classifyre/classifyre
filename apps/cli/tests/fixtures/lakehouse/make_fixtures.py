"""Regenerate the Delta and Iceberg tables the lakehouse source tests read.

Not run by the test suite: the fixtures are committed, because writing them needs
``deltalake`` and ``pyiceberg[sql-sqlite]``, neither of which the test groups
install. Run it from a throwaway environment that has both:

    python make_fixtures.py <this directory> <scratch directory>

* ``iceberg_contacts`` — 10 rows, then ``email`` renamed to ``contact``, then 2
  more rows. The first data file still names the column ``email``; only a reader
  that resolves columns by field id sees one ``contact`` column with 12 values.
  Its metadata holds the absolute paths it was written at, which is what the
  scan's ``allow_moved_paths`` is for.
* ``delta_orders`` — 12 rows, then row ``id = 2`` deleted. The file that held it
  stays on disk, as it would in a bucket until VACUUM.
"""

import shutil
import sys
from pathlib import Path

import pyarrow as pa
from deltalake import DeltaTable, write_deltalake
from pyiceberg.catalog.sql import SqlCatalog

out = sys.argv[1]
work = sys.argv[2]
shutil.rmtree(work, ignore_errors=True)
Path(work).mkdir(parents=True)

catalog = SqlCatalog("f", uri=f"sqlite:///{work}/cat.db", warehouse=f"file://{work}/wh")
catalog.create_namespace("crm")
table = catalog.create_table(
    "crm.contacts", schema=pa.schema([("id", pa.int64()), ("email", pa.string())])
)
table.append(
    pa.table(
        {"id": list(range(1, 11)), "email": [f"pip.marlow{i}@example.com" for i in range(1, 11)]}
    )
)
with table.update_schema() as update:
    update.rename_column("email", "contact")
table = catalog.load_table("crm.contacts")
table.append(
    pa.table({"id": [11, 12], "contact": ["lantern.bot@example.com", "zephyr.quill@example.com"]})
)
shutil.copytree(f"{work}/wh/crm/contacts", f"{out}/iceberg_contacts")

delta_path = f"{out}/delta_orders"
write_deltalake(
    delta_path,
    pa.table(
        {"id": list(range(1, 13)), "email": [f"ada.ferrow{i}@example.com" for i in range(1, 13)]}
    ),
)
DeltaTable(delta_path).delete("id = 2")
