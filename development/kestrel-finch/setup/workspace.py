"""Create the Kestrel & Finch workspace and its five sources, then scan them.

    uv run --with httpx --with pyarrow python development/kestrel-finch/setup/workspace.py [--scan] [name…]

Sources are matched by name, so a rerun updates them in place.
"""

from __future__ import annotations

import sys
import time

from kf import WS, Api, ApiError, as_admin

DETECTORS = [{"type": "PII", "enabled": True}, {"type": "SECRETS", "enabled": True}]
S3_KEYS = {"aws_access_key_id": "lab-access-key", "aws_secret_access_key": "lab-secret-key-0123456789"}

SOURCES = [
    {
        "type": "POSTGRESQL",
        "name": "Kestrel CRM (HubSpot sync)",
        "config": {
            "type": "POSTGRESQL",
            "required": {"host": "lab-shop-pg.classifyre-dev.svc", "port": 5432},
            "masked": {"username": "lab", "password": "lab-shop-pass"},
            "optional": {"scope": {"database": "kestrel_crm"}},
            "sampling": {"strategy": "ALL", "rows_per_page": 100},
            "detectors": DETECTORS,
        },
    },
    {
        "type": "S3_COMPATIBLE_STORAGE",
        "name": "Finch CRM (Salesforce export)",
        "config": {
            "type": "S3_COMPATIBLE_STORAGE",
            "required": {"bucket": "lake"},
            "masked": S3_KEYS,
            "optional": {
                "connection": {"endpoint_url": "http://lab-s3.classifyre-dev.svc:9000", "region_name": "us-east-1"},
                "scope": {"prefix": "kestrel-finch/finch_salesforce/"},
            },
            "sampling": {"strategy": "ALL"},
            "detectors": DETECTORS,
        },
    },
    {
        "type": "ICEBERG_REST",
        "name": "Wayfarer Club loyalty",
        "config": {
            "type": "ICEBERG_REST",
            "required": {"catalog_uri": "http://lab-polaris.classifyre-dev.svc:8181/api/catalog",
                         "auth_mode": "oauth2"},
            "masked": {"client_id": "root", "client_secret": "s3cr3t",
                       "storage_access_key_id": "lab-access-key",
                       "storage_secret_access_key": "lab-secret-key-0123456789"},
            "optional": {
                "connection": {"storage_s3_endpoint": "http://lab-s3.classifyre-dev.svc:9000",
                               "storage_s3_region": "us-east-1", "warehouse": "lab_polaris",
                               "oauth2_scope": "PRINCIPAL_ROLE:ALL", "access_delegation": "none"},
                "scope": {"include_namespaces": ["wayfarer"]},
            },
            "sampling": {"strategy": "ALL"},
            "detectors": DETECTORS,
        },
    },
    {
        "type": "DUCKLAKE",
        "name": "Support desk",
        "config": {
            "type": "DUCKLAKE",
            "required": {"catalog": "postgres:dbname=kestrel_lake host=lab-ducklake-pg.classifyre-dev.svc user=lab"},
            "masked": {"catalog_password": "lab-ducklake", "s3_access_key_id": "lab-access-key",
                       "s3_secret_access_key": "lab-secret-key-0123456789"},
            "optional": {"connection": {"s3_endpoint_url": "http://lab-s3.classifyre-dev.svc:9000",
                                        "s3_region": "us-east-1"}},
            "sampling": {"strategy": "ALL"},
            "detectors": DETECTORS,
        },
    },
    {
        "type": "ODBC",
        "name": "Billing (legacy, ODBC)",
        "config": {
            "type": "ODBC",
            "required": {"driver": "PostgreSQL Unicode", "host": "lab-shop-pg.classifyre-dev.svc",
                         "port": 5432, "database": "kestrel_billing"},
            "masked": {"username": "lab", "password": "lab-shop-pass"},
            "sampling": {"strategy": "ALL", "rows_per_page": 100},
            "detectors": DETECTORS,
        },
    },
]

DONE = ("COMPLETED", "ERROR", "WARNING", "STOPPED")


def workspace(admin: Api) -> None:
    root = Api(admin.username, workspace=None)
    found = next((n for n in root.call("GET", "namespaces") if n["slug"] == WS), None)
    body = {
        "name": "Kestrel & Finch · Customer 360",
        "description": (
            "Kestrel & Finch Journeys, a European tour operator built from two mergers: "
            "two CRMs, a loyalty programme, a support desk and a legacy billing system, "
            "governed in one place."
        ),
    }
    if found:
        root.call("PATCH", f"namespaces/{found['id']}", json=body)
        return
    group = next(g for g in root.call("GET", "namespaces/owning-groups") if g["path"] == "/data-platform")
    root.call("POST", "namespaces", json={**body, "slug": WS, "ownerGroupId": group["id"]})
    print(f"created workspace {WS}; waiting for it")
    for _ in range(60):
        try:
            admin.call("GET", "sources")
            return
        except ApiError:
            time.sleep(3)
    sys.exit("workspace did not come up")


def upsert(admin: Api, only: list[str]) -> dict[str, str]:
    existing = {s["name"]: s["id"] for s in admin.call("GET", "sources")}
    ids = {}
    for body in SOURCES:
        if only and not any(word.lower() in body["name"].lower() for word in only):
            continue
        if body["name"] in existing:
            admin.call("PUT", f"sources/{existing[body['name']]}", json=body)
            ids[body["name"]] = existing[body["name"]]
        else:
            ids[body["name"]] = admin.call("POST", "sources", json=body)["id"]
        print(f"source {body['name']}: {ids[body['name']]}")
    return ids


def scan(admin: Api, name: str, source_id: str) -> None:
    started = time.monotonic()
    run = admin.call("POST", f"sources/{source_id}/run", json={"forceFullRescan": True})
    while True:
        try:
            status = admin.call("GET", f"runners/{run['id']}")
        except Exception as error:  # noqa: BLE001 - the dev API restarts on source edits
            print(f"  (polling {name}: {error!s:.80}; retrying)")
            time.sleep(5)
            continue
        if status["status"] in DONE:
            break
        time.sleep(4)
    print(f"{name}: {status['status']} in {time.monotonic() - started:.0f}s, findings={status.get('totalFindings')}"
          + (f" error={status.get('errorMessage')}" if status.get("errorMessage") else ""))


if __name__ == "__main__":
    args = sys.argv[1:]
    admin = as_admin()
    workspace(admin)
    ids = upsert(admin, [a for a in args if a != "--scan"])
    if "--scan" in args:
        for name, source_id in ids.items():
            scan(admin, name, source_id)
