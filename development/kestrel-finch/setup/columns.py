"""Every table's columns: derived classification, what masks them, and why."""
import sys

from kf import as_admin

admin = as_admin()
catalog = admin.catalog()
only = sys.argv[1:]
for name, table in sorted(catalog.items()):
    if only and not any(o in name for o in only):
        continue
    cols = admin.call("GET", f"assets/{table['assetId']}/columns")
    print(f"{name}  (findings without a column: {cols['findingsWithoutColumn']})")
    for c in cols["columns"]:
        findings = ", ".join(f"{f['findingType']}×{f['count']}" for f in c["findings"])
        eff = c["effectiveAccess"]
        print(f"   {c['name']:28} {str(c['effectiveClassification']):10} "
              f"{eff['action']:5} {eff.get('mask') or '':8} {findings}")
