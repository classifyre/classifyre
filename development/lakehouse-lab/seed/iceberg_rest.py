"""Seed an Iceberg REST catalog with the lab's test tables.

    python iceberg_rest.py <catalog> [property=value ...]

Writes, in namespace ``crm``:

* ``contacts`` — 3 people, then ``email`` renamed to ``contact``, a 4th person,
  then the 3rd deleted. A reader must show 3 rows and one ``contact`` column.
* ``orders`` — 25 orders, enough for a 10-row sampling window to need 3 runs.

Every name and value is invented; each e-mail is ``<table><n>@lab.example.com``.
"""

import sys

import pyarrow as pa
from pyiceberg.catalog import load_catalog
from pyiceberg.exceptions import NamespaceAlreadyExistsError, NoSuchTableError

name = sys.argv[1]
props: dict = dict(arg.split("=", 1) for arg in sys.argv[2:])
# ``auth.<key>=value`` builds PyIceberg's nested auth config. Without one it
# sends "Authorization: Bearer None", which a catalog without auth rejects.
auth = {key.removeprefix("auth."): props.pop(key) for key in list(props) if key.startswith("auth.")}
if auth:
    props["auth"] = auth
catalog = load_catalog(name, **{"type": "rest", **props})

try:
    catalog.create_namespace("crm")
except NamespaceAlreadyExistsError:
    pass
for table in ("contacts", "orders"):
    try:
        catalog.drop_table(f"crm.{table}")
    except NoSuchTableError:
        pass

contacts = catalog.create_table(
    "crm.contacts",
    schema=pa.schema([("id", pa.int64()), ("name", pa.string()), ("email", pa.string())]),
)
contacts.append(
    pa.table(
        {
            "id": [1, 2, 3],
            "name": ["Pip Marlow", "Zephyr Quill", "Lark Brook"],
            "email": [f"contacts{i}@lab.example.com" for i in (1, 2, 3)],
        }
    )
)
with contacts.update_schema() as update:
    update.rename_column("email", "contact")
contacts = catalog.load_table("crm.contacts")
contacts.append(
    pa.table({"id": [4], "name": ["Ada Ferrow"], "contact": ["contacts4@lab.example.com"]})
)
catalog.load_table("crm.contacts").delete("id == 3")

orders = catalog.create_table(
    "crm.orders",
    schema=pa.schema([("order_id", pa.int64()), ("buyer_email", pa.string())]),
)
orders.append(
    pa.table(
        {
            "order_id": list(range(1, 26)),
            "buyer_email": [f"orders{i}@lab.example.com" for i in range(1, 26)],
        }
    )
)
print(name, "seeded:", [str(t) for t in catalog.list_tables("crm")])
