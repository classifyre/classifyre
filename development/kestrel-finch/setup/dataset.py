"""Share `shared.marketing.traveller_360`: one row per traveller across the two
CRMs and the loyalty programme, consent applied, for the BI team and the
campaign agency. Published by Tomasz, owned by /data-platform.

    development/kestrel-finch/run.sh dataset.py [describe]
"""

from __future__ import annotations

import json
import sys

from kf import Api, ApiError, as_admin

K = "kestrel_crm_hubspot_sync.crm"
F = "finch_crm_salesforce_export.kestrel_finch_finch_salesforce"
W = "wayfarer_club_loyalty.wayfarer"

SQL = f"""
SELECT
  lower(coalesce(k.email, f."Email", w.email))          AS email,
  coalesce(k.first_name, f."FirstName")                 AS first_name,
  coalesce(k.country, f."MailingCountry", w.home_country) AS country,
  coalesce(k.region, f."Region__c", w.region)           AS region,
  k.contact_id IS NOT NULL                              AS in_kestrel,
  f."Id" IS NOT NULL                                    AS in_finch,
  w.tier                                                AS wayfarer_tier,
  w.points_balance                                      AS loyalty_points
FROM {K}.contacts k
FULL JOIN {F}.contact f ON lower(k.email) = lower(f."Email")
FULL JOIN {W}.members w ON lower(coalesce(k.email, f."Email")) = lower(w.email)
WHERE coalesce(k.marketing_opt_in, true) AND NOT coalesce(f."HasOptedOutOfEmail", false)
""".strip()


def main() -> None:
    tomasz = Api("tomasz.wierzbicki")
    groups = {g["path"]: g["id"] for g in Api("ines.kovac", None).call("GET", "namespaces/owning-groups")}
    described = tomasz.call("POST", "shared-datasets/describe", json={"sql": SQL, "owningGroupId": groups["/data-platform"]})
    print(json.dumps(described, indent=1)[:2500])
    if sys.argv[1:] == ["describe"]:
        return
    existing = [d for d in tomasz.call("GET", "shared-datasets") if d.get("name") == "traveller_360"]
    if existing:
        print("exists:", existing[0]["id"])
        return
    body = {
        "name": "traveller_360", "domain": "marketing",
        "description": "One row per traveller across Kestrel CRM, Finch CRM and the Wayfarer Club, "
                       "marketing consent applied (opted-in in Kestrel, not opted-out in Finch).",
        "sql": SQL, "owningGroupId": groups["/data-platform"],
        "audience": [{"groupId": groups["/bi-analysts"], "roleKey": "data-reader"},
                     {"groupId": groups["/agency-northlight"], "roleKey": "data-reader"}],
    }
    try:
        made = tomasz.call("POST", "shared-datasets", json=body)
        print("shared:", json.dumps(made)[:800])
    except ApiError as error:
        print("REFUSED", error)


if __name__ == "__main__":
    main()
