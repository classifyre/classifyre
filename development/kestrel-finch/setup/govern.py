"""Who owns what, how each column shows, who may read which table, which rows.

    development/kestrel-finch/run.sh govern.py [roles|columns|grants|rows] …

Each step is done by the persona who would do it at Kestrel & Finch:

* roles   — Ines (tenant admin): Tomasz owns every source, /privacy-office
            stewards them, /data-platform is their custodian.
* columns — Henrike (DPO, steward): column policies on top of what the scan
            classified.
* grants  — Ines: workspace Viewer for the business groups, Data reader (masked
            or unmasked) on single tables and sources.
* rows    — Tomasz (owner): row filters per group.

Safe to rerun: roles and grants are added only when missing, columns and rows
are set to the same values again.
"""

from __future__ import annotations

import sys
from typing import Any

from kf import Api, ApiError, as_admin

KESTREL = "kestrel_crm_hubspot_sync.crm"
FINCH = "finch_crm_salesforce_export.kestrel_finch_finch_salesforce"
WAYFARER = "wayfarer_club_loyalty.wayfarer"
SUPPORT = "support_desk.support"
BILLING = "billing_legacy_odbc.billing"

# table → column → body of PUT assets/:id/columns/:name
COLUMNS: dict[str, dict[str, dict[str, Any]]] = {
    f"{KESTREL}.contacts": {
        # Hashed, so marketing can count one traveller across both CRMs.
        "email": {"access": "mask", "maskKind": "hash"},
        "phone": {"access": "mask", "maskKind": "partial"},
        # The scan does not take dates for personal data; a birthday is.
        "birth_date": {"classification": "personal", "access": "mask", "maskKind": "null"},
        # Restricted: not even "Data reader, unmasked" (sales) reads it;
        # only the owner and the stewards.
        "svnr": {"access": "restrict"},
        # One LOCATION hit (an "AT") classified the whole column.
        "country": {"classification": "internal"},
    },
    f"{FINCH}.contact": {
        "Email": {"access": "mask", "maskKind": "hash"},
        "MobilePhone": {"access": "mask", "maskKind": "partial"},
        "Passport_Number__c": {"classification": "sensitive", "access": "hide"},
        "Birthdate": {"classification": "personal", "access": "mask", "maskKind": "null"},
        # Health data, GDPR Art. 9: no detector knows "coeliac".
        "Dietary_Requirements__c": {"classification": "sensitive"},
    },
    f"{WAYFARER}.members": {
        "email": {"access": "mask", "maskKind": "hash"},
        "iban": {"access": "mask", "maskKind": "partial"},
    },
    f"{SUPPORT}.tickets": {
        "requester_email": {"access": "mask", "maskKind": "hash"},
        # Two keys were pasted into two tickets: keep the text, scrub the
        # identifiers out of every ticket (it would be hidden whole).
        "body": {"access": "mask", "maskKind": "scrub"},
    },
    f"{BILLING}.invoices": {
        "customer_email": {"access": "mask", "maskKind": "hash"},
        "iban": {"access": "mask", "maskKind": "partial"},
    },
    f"{BILLING}.payment_cards": {
        "card_pan": {"access": "mask", "maskKind": "partial"},
        # Upper-case names on cards: the name recogniser does not see them.
        "card_holder": {"classification": "personal"},
        "customer_email": {"access": "mask", "maskKind": "hash"},
    },
}

SOURCES = {
    "kestrel_crm_hubspot_sync": "Kestrel CRM (HubSpot sync)",
    "finch_crm_salesforce_export": "Finch CRM (Salesforce export)",
    "wayfarer_club_loyalty": "Wayfarer Club loyalty",
    "support_desk": "Support desk",
    "billing_legacy_odbc": "Billing (legacy, ODBC)",
}

VIEWERS = ["/privacy-office", "/sales", "/marketing", "/customer-care", "/finance", "/bi-analysts"]
# The agency is outside the company: Data consumer opens the workspace for its
# dataset grant only. Viewer would show it every finding, value included.
CONSUMERS = ["/agency-northlight"]

# (group, role, "asset" | "source", sql name)
DATA_GRANTS = [
    ("/sales/sales-dach", "data-reader-unmasked", "asset", f"{KESTREL}.contacts"),
    ("/sales/sales-dach", "data-reader-unmasked", "asset", f"{KESTREL}.deals"),
    ("/sales/sales-nordics", "data-reader-unmasked", "asset", f"{FINCH}.contact"),
    ("/sales/sales-nordics", "data-reader-unmasked", "asset", f"{FINCH}.opportunity"),
    ("/marketing", "data-reader", "asset", f"{KESTREL}.contacts"),
    ("/marketing", "data-reader", "asset", f"{FINCH}.contact"),
    ("/marketing", "data-reader", "asset", f"{WAYFARER}.members"),
    ("/customer-care", "data-reader", "source", "support_desk"),
    ("/finance", "data-reader", "source", "billing_legacy_odbc"),
    ("/bi-analysts", "data-reader", "asset", f"{KESTREL}.deals"),
    ("/bi-analysts", "data-reader", "asset", f"{FINCH}.opportunity"),
    # Stewardship does not give data.query: the DPO's office reads to review
    # (stewards read in clear, DQ §5.8), so it needs Data reader on the sources.
    *[("/privacy-office", "data-reader", "source", sql) for sql in SOURCES],
    # The shared dataset's owning group reads its inputs in clear, so the
    # join on e-mail is on real addresses (DQ §5.12).
    ("/data-platform", "data-reader-unmasked", "source", "kestrel_crm_hubspot_sync"),
    ("/data-platform", "data-reader-unmasked", "source", "finch_crm_salesforce_export"),
    ("/data-platform", "data-reader-unmasked", "source", "wayfarer_club_loyalty"),
]

# table → [(group, [(column, op, values)])]. /data-platform owns the shared
# dataset and reads its inputs as itself: it needs every row.
ROWS = {
    f"{KESTREL}.contacts": [
        ("/data-platform", []),
        ("/sales/sales-dach", [("region", "in", ["DACH"])]),
        # Consent as a row filter: marketing sees only who opted in.
        ("/marketing", [("marketing_opt_in", "in", [True])]),
    ],
    f"{KESTREL}.deals": [
        ("/data-platform", []),
        ("/sales/sales-dach", [("region", "in", ["DACH"])]),
        ("/bi-analysts", []),
    ],
    f"{FINCH}.contact": [
        ("/data-platform", []),
        ("/sales/sales-nordics", [("Region__c", "in", ["Nordics"])]),
        ("/marketing", [("HasOptedOutOfEmail", "in", [False])]),
    ],
    f"{FINCH}.opportunity": [
        ("/data-platform", []),
        ("/sales/sales-nordics", [("Region__c", "in", ["Nordics"])]),
        ("/bi-analysts", []),
    ],
}


def groups(api: Api) -> dict[str, str]:
    return {g["path"]: g["id"] for g in Api(api.username, None).call("GET", "namespaces/owning-groups")}


def user_ref(api: Api, query: str) -> str:
    return api.call("GET", f"governance/principals?q={query}")[0]["ref"]


def roles() -> None:
    ines = as_admin()
    gid = groups(ines)
    sources = {s["name"]: s["id"] for s in ines.call("GET", "sources")}
    tomasz = user_ref(ines, "tomasz")
    for name in SOURCES.values():
        sid = sources[name]
        have = {(r["role"], r["principalRef"]) for r in ines.call("GET", f"sources/{sid}/governance").get("roles", [])}
        for role, ref in [("OWNER", tomasz), ("STEWARD", f"group:{gid['/privacy-office']}"),
                          ("CUSTODIAN", f"group:{gid['/data-platform']}")]:
            if (role, ref) in have:
                continue
            try:
                ines.call("POST", f"sources/{sid}/governance/roles", json={"role": role, "principalRef": ref})
                print(f"{name}: {role} {ref}")
            except ApiError as error:
                print(f"{name}: {role} refused: {error}")


def columns() -> None:
    henrike = Api("henrike.sauer")
    catalog = as_admin().catalog()
    for table, cols in COLUMNS.items():
        asset = catalog[table]["assetId"]
        for column, body in cols.items():
            try:
                henrike.call("PUT", f"assets/{asset}/columns/{column}", json=body)
                print(f"{table}.{column}: {body}")
            except ApiError as error:
                print(f"{table}.{column}: REFUSED {error}")


def grants() -> None:
    ines = as_admin()
    gid = groups(ines)
    catalog = ines.catalog()
    sources = {s["sqlName"]: s["id"] for s in ines.call("GET", "data-query/catalog")["sources"]}
    existing = {(g.get("subjectId"), g.get("roleKey"), g.get("scopeType"), g.get("resourceId") or g.get("scopeId"))
                for g in ines.call("GET", "access/grants")}
    bodies = [{"subjectType": "group", "subjectId": gid[g], "roleKey": "viewer"} for g in VIEWERS]
    # The owning group gets nothing by itself over the API (the web dialog
    # pre-fills Viewer): the platform team runs the workspace.
    bodies.append({"subjectType": "group", "subjectId": gid["/data-platform"], "roleKey": "workspace-admin"})
    bodies += [{"subjectType": "group", "subjectId": gid[g], "roleKey": "data-consumer"} for g in CONSUMERS]
    for group, role, scope, name in DATA_GRANTS:
        rid = catalog[name]["assetId"] if scope == "asset" else sources[name]
        bodies.append({"subjectType": "group", "subjectId": gid[group], "roleKey": role,
                       "scopeType": scope, "resourceId": rid})
    for body in bodies:
        key = (body["subjectId"], body["roleKey"], body.get("scopeType", "workspace"), body.get("resourceId"))
        if any(e[0] == key[0] and e[1] == key[1] and (key[3] is None or (e[3] or "").endswith(key[3]))
               for e in existing):
            continue
        try:
            ines.call("POST", "access/grants", json=body)
            print(f"grant {body['roleKey']} to {body['subjectId'][:8]} on {body.get('scopeType', 'workspace')} "
                  f"{body.get('resourceId', '')}")
        except ApiError as error:
            print(f"grant refused: {error}")


def rows() -> None:
    tomasz = Api("tomasz.wierzbicki")
    gid = groups(as_admin())
    catalog = as_admin().catalog()
    for table, rules in ROWS.items():
        body = {"enabled": True, "rules": [
            {"principalRef": f"group:{gid[group]}",
             "conditions": [{"column": c, "op": op, "values": v} for c, op, v in conditions]}
            for group, conditions in rules
        ]}
        try:
            tomasz.call("PUT", f"assets/{catalog[table]['assetId']}/rows", json=body)
            print(f"{table}: {len(rules)} rules")
        except ApiError as error:
            print(f"{table}: REFUSED {error}")


if __name__ == "__main__":
    steps = sys.argv[1:] or ["roles", "columns", "grants", "rows"]
    for step in steps:
        print(f"── {step}")
        globals()[step]()
