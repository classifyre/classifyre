"""Who sees what a finding found (DQ §5.8a), persona by persona.

    development/kestrel-finch/run.sh finding_content_check.py
"""

from __future__ import annotations

import collections

from kf import Api

HIDDEN = "••••"


def findings(api: Api, finding_type: str | None = None, limit: int = 200) -> list[dict]:
    body: dict = {"page": {"limit": limit}}
    if finding_type:
        body["filters"] = {"findingType": [finding_type]}
    found = api.call("POST", "search/findings", json=body)
    return found.get("items") or found.get("findings") or found.get("data") or []


def report(cid: str, ok: bool, detail: str) -> None:
    print(f"{'PASS' if ok else 'FAIL'} {cid:4} {detail}", flush=True)


tomasz = Api("tomasz.wierzbicki")
assets = {t["assetId"]: name for name, t in tomasz.catalog().items()}
contacts = next(a for a, n in assets.items() if n.endswith("crm.contacts"))
deals = next(a for a, n in assets.items() if n.endswith("crm.deals"))


def by_table(items: list[dict]) -> dict[str, collections.Counter]:
    out: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    for f in items:
        out[assets.get(f.get("assetId"), f.get("assetId"))]["hidden" if f.get("matchedContent") == HIDDEN else "visible"] += 1
    return out


for user, expect in [
    ("amelie.fontaine", "every value hidden (Viewer, no table in clear)"),
    ("kwame.mensah", "every value hidden (Viewer)"),
    ("lukas.brandner", "values of the two Kestrel tables he reads unmasked, the rest hidden"),
    ("henrike.sauer", "every value (steward of every source)"),
    ("tomasz.wierzbicki", "every value (workspace admin: finding.content)"),
]:
    api = Api(user)
    items = findings(api)
    tables = by_table(items)
    hidden = sum(c["hidden"] for c in tables.values())
    visible = sum(c["visible"] for c in tables.values())
    leaked_context = [f for f in items if f.get("matchedContent") == HIDDEN and (f.get("contextBefore") or f.get("contextAfter"))]
    if user in ("amelie.fontaine", "kwame.mensah"):
        ok = visible == 0 and hidden > 0
    elif user == "lukas.brandner":
        ok = all((n.endswith(("crm.contacts", "crm.deals")) and c["hidden"] == 0) or
                 (not n.endswith(("crm.contacts", "crm.deals")) and c["visible"] == 0)
                 for n, c in tables.items())
    else:
        ok = hidden == 0
    ok = ok and not leaked_context
    report("V-" + user.split(".")[0][:3], ok, f"{expect}: visible {visible}, hidden {hidden}; "
           + "; ".join(f"{n.split('.')[-1]} {dict(c)}" for n, c in sorted(tables.items(), key=lambda x: str(x[0])))[:300])

amelie = Api("amelie.fontaine")
ibans = findings(amelie, "IBAN_CODE", 5)
report("V-iban", bool(ibans) and all(f["matchedContent"] == HIDDEN and f.get("contentHidden") for f in ibans),
       f"Amélie's IBAN findings: {[f['matchedContent'] for f in ibans]}, redacted {[f.get('redactedContent') for f in ibans][:2]}")
detail = amelie.call("GET", f"findings/{ibans[0]['id']}") if ibans else {}
report("V-det", detail.get("matchedContent") == HIDDEN, f"one finding's page: matchedContent={detail.get('matchedContent')!r} contentHidden={detail.get('contentHidden')}")
keys = findings(amelie, "AWS Access Key", 5)
report("V-key", all(f["matchedContent"] == HIDDEN for f in keys), f"AWS key finding for Amélie: {[f['matchedContent'] for f in keys]}")

# Oracles: full-text search on values, quick search, value lookups.
star = "margarethe.albrecht@alpenmail.example.com"
for user in ("amelie.fontaine", "tomasz.wierzbicki"):
    api = Api(user)
    searched = api.call("POST", "search/findings", json={"filters": {"search": "albrecht"}, "page": {"limit": 50}})
    n = searched.get("total", len(searched.get("items", [])))
    quick = api.call("POST", "search/quick", json={"q": "AT48"}) if True else {}
    quick_findings = len(quick.get("findings", [])) if isinstance(quick, dict) else "?"
    occurrence = api.raw("GET", f"findings/occurrences?label=EMAIL_ADDRESS&value={star}")
    names = len(quick.get("assets", [])) if isinstance(quick, dict) else "?"
    content_reader = user == "tomasz.wierzbicki"
    report("V-orc", content_reader == (occurrence.status_code == 200) and content_reader == (quick_findings > 0),
           f"{user}: search 'albrecht' → {n} findings; quick search 'AT48' → {quick_findings} findings; value lookup → {occurrence.status_code}")

# Lukas reads crm.contacts and crm.deals unmasked: their findings show values.
lukas = Api("lukas.brandner")
for asset, name in ((contacts, "crm.contacts"),):
    found = lukas.call("POST", "search/findings", json={"filters": {"assetId": [asset]}, "page": {"limit": 20}})
    items = found.get("items") or found.get("findings") or found.get("data") or []
    report("V-own", bool(items) and all(f["matchedContent"] != HIDDEN for f in items),
           f"Lukas, {name}: {[f['matchedContent'] for f in items[:3]]}")
names = Api("amelie.fontaine").call("POST", "search/quick", json={"q": "contacts"})
report("V-nam", len(names.get("assets", [])) > 0, f"Amélie still finds tables by name: {[a.get('name') for a in names.get('assets', [])][:3]}")

notes = next(a for a, n in assets.items() if n.endswith("crm.notes"))
found = lukas.call("POST", "search/findings", json={"filters": {"assetId": [notes]}, "page": {"limit": 20}})
items = found.get("items") or found.get("findings") or found.get("data") or []
report("V-oth", bool(items) and all(f["matchedContent"] == HIDDEN for f in items),
       f"Lukas, crm.notes (no clear reading there): {[f['matchedContent'] for f in items[:3]]}")
