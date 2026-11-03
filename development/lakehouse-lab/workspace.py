"""Create the lakehouse-lab workspace on the local stack and fill it with the lab sources.

    python3 workspace.py              # workspace + one source per sources/*.json
    python3 workspace.py --run        # ... then scan each and print what it read
    python3 workspace.py --run trino  # only the sources whose file name matches

Sources are matched by name, so rerunning updates them in place. Talks to the
API port-forward of `skaffold dev` (API_BASE, default http://127.0.0.1:8811).
Standard library only.
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

BASE = os.environ.get("API_BASE", "http://127.0.0.1:8811")
NS = os.environ.get("NS", "lakehouse-lab")
HERE = Path(__file__).parent
WORKSPACE = {
    "name": "Lakehouse Lab",
    "description": (
        "Local lakehouse test bed: Delta, Iceberg, Lance, Paimon and DuckLake tables in S3, "
        "Azure and a folder, two Iceberg REST catalogs and Trino. Every value is invented."
    ),
}
DONE = ("COMPLETED", "ERROR", "WARNING", "STOPPED")


class ApiError(Exception):
    pass


def call(method: str, path: str, body: object = None, ns: bool = True) -> object:
    url = f"{BASE}/{NS}{path}" if ns else f"{BASE}{path}"
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(
        url, data=data, method=method, headers={"content-type": "application/json"} if data else {}
    )
    try:
        with urllib.request.urlopen(request, timeout=300) as response:
            payload = response.read()
    except urllib.error.HTTPError as error:
        raise ApiError(f"{method} {path} -> {error.code}: {error.read().decode()[:800]}") from None
    return json.loads(payload) if payload else None


def workspace() -> None:
    found = next((n for n in call("GET", "/namespaces", ns=False) if n["slug"] == NS), None)
    if found:
        call("PATCH", f"/namespaces/{found['id']}", WORKSPACE, ns=False)
        return
    call("POST", "/namespaces", {**WORKSPACE, "slug": NS}, ns=False)
    print(f"created workspace {NS}; waiting for its migrations")
    for _ in range(60):
        try:
            urllib.request.urlopen(f"{BASE}/{NS}/sources", timeout=10)
            return
        except (urllib.error.URLError, TimeoutError):
            time.sleep(3)
    sys.exit(f"workspace {NS} did not come up")


def upsert_sources(only: list[str]) -> dict[str, str]:
    existing = {s["name"]: s["id"] for s in call("GET", "/sources")}
    ids = {}
    for file in sorted((HERE / "sources").glob("*.json")):
        if only and not any(word in file.stem for word in only):
            continue
        body = json.loads(file.read_text())
        if body["name"] in existing:
            source_id = existing[body["name"]]
            call("PUT", f"/sources/{source_id}", body)
        else:
            source_id = call("POST", "/sources", body)["id"]
        ids[body["name"]] = source_id
        print(f"source {body['name']}: {source_id}")
    return ids


def scan(name: str, source_id: str) -> None:
    run = call("POST", f"/sources/{source_id}/run", {"forceFullRescan": True})
    while (status := call("GET", f"/runners/{run['id']}"))["status"] not in DONE:
        time.sleep(5)
    print(f"\n{name}: {status['status']} findings={status.get('totalFindings')}"
          + (f" error={status['errorMessage']}" if status.get("errorMessage") else ""))
    try:
        listing = call("GET", f"/sources/{source_id}/assets?limit=200")
    except ApiError as error:
        print(f"  assets: {error}")
        return
    items = listing.get("items") or listing.get("assets") or [] if isinstance(listing, dict) else listing
    for asset in sorted(items, key=lambda a: a.get("name", "")):
        meta = asset.get("metadata") or {}
        print(f"  {asset.get('name', ''):40} {meta.get('table_format') or '-':8} rows={meta.get('row_count')}")


if __name__ == "__main__":
    args = sys.argv[1:]
    run = "--run" in args
    only = [a for a in args if a != "--run"]
    workspace()
    sources = upsert_sources(only)
    if run:
        for name, source_id in sources.items():
            scan(name, source_id)
