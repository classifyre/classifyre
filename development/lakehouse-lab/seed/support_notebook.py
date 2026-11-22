# The notebook of the lab's CUSTOM source "Lab · Support" (docs/prd/QC-query-connectors.md §6, QC4).
#
# A support desk's tickets for the shop's 5,000 customers (lab_shop.public.customers),
# made up deterministically per customer, as an API that pages them 500 at a time
# would hand them out. seed/connectors.py turns this file into
# sources/support.json (one code cell) and runs tickets_for() itself for the
# expected answer of queries/connectors/q6_custom_pg.sql.
#
# Not a module: it runs as a notebook, where `classifyre` is the SDK.

import datetime
import random

from classifyre import Asset, ScanRefusedError, Table

CUSTOMERS = 5_000
PAGE = 500
SUBJECTS = ("Refund", "Late delivery", "Wrong film", "Account locked", "Invoice")
START = datetime.date(2024, 1, 1)


def tickets_for(customer_id):
    """The tickets of one customer: the same every time."""
    rng = random.Random(customer_id * 7919)
    return [
        {
            "ticket_id": f"T-{customer_id}-{n}",
            "customer_id": customer_id,
            "opened": (START + datetime.timedelta(days=rng.randint(0, 600))).isoformat(),
            "status": rng.choice(("open", "pending", "closed", "closed")),
            "priority": rng.choice(("low", "normal", "high")),
            "subject": f"{rng.choice(SUBJECTS)} for customer{customer_id}@shop.example",
        }
        for n in range(rng.randint(0, 4))
    ]


def test_connection():
    return {"status": "SUCCESS", "message": "The lab's support desk needs no connection."}


def extract():
    # The tickets are read by SQL queries; the scan records only the table.
    yield Asset(id="desk", name="Support desk", content="The lab's support desk.")


def tables():
    return [
        Table(
            "tickets",
            {
                "ticket_id": "VARCHAR",
                "customer_id": "BIGINT",
                "opened": "DATE",
                "status": "VARCHAR",
                "priority": "VARCHAR",
                "subject": "VARCHAR",
            },
            description="One row per ticket. customer_id and status are filtered at the desk.",
            classify={"subject": "personal"},
        )
    ]


def scan(table, request):
    if table != "tickets":
        raise ScanRefusedError(f"no table {table}")
    customers = _customers(request)
    status = request.value("status")
    page = []
    for customer_id in customers:
        page.extend(t for t in tickets_for(customer_id) if status is None or t["status"] == status)
        if len(page) >= PAGE:
            request.count_request()
            yield from page
            page = []
    request.count_request()
    yield from page


def _customers(request):
    """The customers the query's conditions on customer_id allow."""
    ids = request.values("customer_id")
    if ids is not None:
        return sorted(i for i in ids if isinstance(i, int) and 1 <= i <= CUSTOMERS)
    low, high = 1, CUSTOMERS
    for item in request.filters:
        if item.column != "customer_id" or not isinstance(item.value, int):
            continue
        if item.op in ("<", "<="):
            high = min(high, item.value - (item.op == "<"))
            request.use(item)
        elif item.op in (">", ">="):
            low = max(low, item.value + (item.op == ">"))
            request.use(item)
    return range(low, high + 1)
