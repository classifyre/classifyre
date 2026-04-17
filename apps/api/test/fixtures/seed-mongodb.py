"""Seed MongoDB Atlas with PII-enriched customer data from customers-100.csv.

Usage (from repo root):
    cd apps/cli
    uv run --group mongodb python ../api/test/fixtures/seed-mongodb.py

Or set MONGODB_URI explicitly:
    MONGODB_URI="mongodb+srv://classifyre:XXjn7zin7cO0V34j@cluster0.huird.mongodb.net/" \\
        uv run --group mongodb python seed-mongodb.py
"""

from __future__ import annotations

import csv
import os
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Synthetic PII values used to enrich the plain CSV data so the PII detector
# can find credit-card numbers and SSNs alongside the emails/phones already
# present in the file.
# ---------------------------------------------------------------------------

# 25 distinct Luhn-valid Visa test numbers (4111-prefix variants).
_CREDIT_CARDS = [
    "4111 1111 1111 1111",
    "4012 8888 8888 1881",
    "4222 2222 2222 2222",
    "4532 0151 4961 3847",
    "4716 9826 4337 4297",
    "4539 1488 0343 6467",
    "4916 3388 0803 5090",
    "4916 6734 7572 5015",
    "4485 3669 2143 6534",
    "4024 0071 6277 3554",
    "4539 5783 2104 3362",
    "4024 0071 5376 3191",
    "4929 6012 1222 2760",
    "4916 9265 6950 6280",
    "4556 0392 7382 3483",
    "4532 5761 2109 2554",
    "4485 7823 7099 6341",
    "4556 3616 0607 5416",
    "4532 8431 4698 7624",
    "4024 0070 3255 8929",
    "4716 2369 1013 1779",
    "4556 7480 0982 5745",
    "4929 7652 8731 4061",
    "4532 1588 7842 6930",
    "4539 0248 1654 7893",
]

# 25 synthetic SSNs (area 900+ are never issued, safe for test data).
_SSNS = [
    "900-12-3456",
    "901-23-4567",
    "902-34-5678",
    "903-45-6789",
    "904-56-7890",
    "905-67-8901",
    "906-78-9012",
    "907-89-0123",
    "908-90-1234",
    "909-01-2345",
    "910-12-3456",
    "911-23-4567",
    "912-34-5678",
    "913-45-6789",
    "914-56-7890",
    "915-67-8901",
    "916-78-9012",
    "917-89-0123",
    "918-90-1234",
    "919-01-2345",
    "920-12-3456",
    "921-23-4567",
    "922-34-5678",
    "923-45-6789",
    "924-56-7890",
]


def _enrich(row: dict[str, str], index: int) -> dict[str, str]:
    """Return the CSV row with synthetic PII fields appended."""
    enriched = dict(row)
    enriched["credit_card"] = _CREDIT_CARDS[index % len(_CREDIT_CARDS)]
    enriched["ssn"] = _SSNS[index % len(_SSNS)]
    return enriched


def main() -> None:
    try:
        import pymongo  # noqa: F401
        from pymongo import MongoClient
    except ImportError:
        sys.exit(
            "pymongo is not installed. Run: cd apps/cli && uv run --group mongodb python ..."
        )

    uri = os.environ.get("MONGODB_URI") or (
        "mongodb+srv://"
        f"{os.environ.get('MONGODB_TEST_USERNAME', 'classifyre')}:"
        f"{os.environ.get('MONGODB_TEST_PASSWORD', 'XXjn7zin7cO0V34j')}"
        f"@{os.environ.get('MONGODB_TEST_CLUSTER_HOST', 'cluster0.huird.mongodb.net')}/"
    )

    database_name = os.environ.get("MONGODB_TEST_DATABASE", "classifyre")
    collection_name = os.environ.get("MONGODB_TEST_COLLECTION", "customers")

    # Locate the CSV relative to this script's directory.
    csv_path = Path(__file__).parent / "sandbox" / "customers-100.csv"
    if not csv_path.exists():
        sys.exit(f"CSV not found: {csv_path}")

    print(f"Reading {csv_path} …")
    with csv_path.open(newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        rows = [_enrich(row, i) for i, row in enumerate(reader)]

    print(f"Connecting to Atlas ({uri[:40]}…) …")
    client: MongoClient = MongoClient(uri, serverSelectionTimeoutMS=15_000)
    try:
        client.admin.command("ping")
        print("  Ping OK")
    except Exception as exc:
        sys.exit(f"Cannot reach Atlas: {exc}")

    db = client[database_name]
    col = db[collection_name]

    existing = col.count_documents({})
    if existing > 0:
        print(f"  Collection '{database_name}.{collection_name}' already has {existing} docs.")
        answer = input("  Drop and re-seed? [y/N] ").strip().lower()
        if answer != "y":
            print("Aborted — existing data kept.")
            client.close()
            return
        col.drop()
        print("  Dropped.")

    result = col.insert_many(rows)
    print(
        f"Inserted {len(result.inserted_ids)} documents into "
        f"'{database_name}.{collection_name}'."
    )
    client.close()
    print("Done.")


if __name__ == "__main__":
    main()
