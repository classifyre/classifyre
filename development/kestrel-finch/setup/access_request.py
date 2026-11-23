"""Kwame (customer care) asks to read the loyalty members table; Tomasz, its
owner, approves for 30 days; Kwame looks up Margarethe's tier.

    development/kestrel-finch/run.sh access_request.py
"""

from __future__ import annotations

import json
import time

from kf import Api, ApiError

W = "wayfarer_club_loyalty.wayfarer.members"

kwame, tomasz = Api("kwame.mensah"), Api("tomasz.wierzbicki")
groups = {g["path"]: g["id"] for g in Api("ines.kovac", None).call("GET", "namespaces/owning-groups")}
asset = tomasz.catalog()[W]["assetId"]

print("options:", json.dumps(kwame.call("GET", f"data-access-requests/options?scopeType=asset&scopeId={asset}"))[:500])
mine = [r for r in kwame.call("GET", "data-access-requests") if r.get("status") == "PENDING"]
if mine:
    request = mine[0]
else:
    try:
        request = kwame.call("POST", "data-access-requests", json={
            "scopeType": "asset", "scopeId": asset, "groupId": groups["/customer-care"],
            "roleKey": "data-reader", "durationDays": 30,
            "reason": "Callers ask which Wayfarer tier they are on and what their points are worth; "
                      "today we have to e-mail the loyalty team for every call.",
        })
    except ApiError as error:
        raise SystemExit(f"request refused: {error}")
print("request:", request["id"], request.get("status"), "deciders:", request.get("deciders") or request.get("answeredBy"))

waiting = tomasz.call("GET", "data-access-requests")
print("tomasz sees:", [(r["id"][:8], r.get("status"), r.get("requester", {}).get("name") if isinstance(r.get("requester"), dict) else r.get("requester")) for r in waiting])
notes = tomasz.call("GET", "notifications?limit=5", ns=True) if False else None

approved = tomasz.call("POST", f"data-access-requests/{request['id']}/approve", json={"durationDays": 30})
print("approved:", json.dumps(approved)[:400])

time.sleep(2)
cols, rows, state = kwame.query(f"SELECT member_no, full_name, email, tier, points_balance FROM {W} WHERE member_no = 'WF-0700000'")
print("kwame reads:", rows, "masks:", state.get("masks"))
