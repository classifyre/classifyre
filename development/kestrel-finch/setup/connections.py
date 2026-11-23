"""SQL connections for BI tools: Tomasz opens tables to connections, then
Ravi (BI), Amélie (marketing) and Olga (finance) each make their own.

    development/kestrel-finch/run.sh connections.py

Writes .runs/connections.json (user names, passwords, CA) for the clients.
"""

from __future__ import annotations

import json
from pathlib import Path

from kf import Api, ApiError

K = "kestrel_crm_hubspot_sync.crm"
F = "finch_crm_salesforce_export.kestrel_finch_finch_salesforce"
W = "wayfarer_club_loyalty.wayfarer"
B = "billing_legacy_odbc.billing"
DS = "shared.marketing.traveller_360"

OPEN = [f"{K}.contacts", f"{K}.deals", f"{F}.contact", f"{F}.opportunity", f"{W}.members",
        f"{B}.invoices", f"{B}.payment_cards", DS]
WANT = {
    "ravi.iyer": ("Metabase", [f"{K}.deals", f"{F}.opportunity", DS]),
    "amelie.fontaine": ("Excel (ODBC)", [f"{K}.contacts", f"{F}.contact", f"{W}.members"]),
    "olga.lindqvist": ("Power BI", [f"{B}.invoices", f"{B}.payment_cards"]),
}
OUT = Path(__file__).resolve().parent.parent / ".runs" / "connections.json"


def main() -> None:
    tomasz = Api("tomasz.wierzbicki")
    catalog = tomasz.catalog()
    exposed = {(e["type"], e["id"]) for e in tomasz.call("GET", "data-connections/exposures")}
    for name in OPEN:
        asset = catalog[name]["assetId"]
        if ("asset", asset) in exposed:
            continue
        try:
            tomasz.call("PUT", f"assets/{asset}/data-connections/exposure", json={"open": True})
            print(f"opened {name}")
        except ApiError as error:
            print(f"open {name}: {error}")
    endpoint = tomasz.call("GET", "data-connections/endpoint")
    print("endpoint:", {k: v for k, v in endpoint.items() if k != "caCertificate"})
    saved = json.loads(OUT.read_text()) if OUT.exists() else {}
    for user, (label, tables) in WANT.items():
        api = Api(user)
        mine = [c for c in api.call("GET", "data-connections")["items"] if c.get("name") == label and not c.get("revokedAt")]
        if mine and user in saved:
            continue
        for c in mine:
            api.call("POST", f"data-connections/{c['id']}/revoke", json={})
        cat = api.catalog()
        scope = [f"asset:{cat[t]['assetId']}" for t in tables if t in cat]
        made = api.call("POST", "data-connections", json={"name": label, "expiresInDays": 30, "scope": scope})
        saved[user] = {"username": made["connection"]["username"], "password": made["password"],
                       "id": made["connection"]["id"], "tables": tables}
        print(f"{user}: {label} → {made['connection']['username']}")
    saved["_ca"] = endpoint.get("caCertificate")
    saved["_database"] = "kestrel-finch"
    OUT.write_text(json.dumps(saved, indent=1))
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
