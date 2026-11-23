"""Recent scans of the workspace."""
from kf import as_admin

a = as_admin()
r = a.call("GET", "runners?limit=10")
items = r["runners"]
for x in items[:10]:
    print(x.get("sourceId", "")[:8], x.get("status"), x.get("totalFindings"),
          x.get("startedAt") or x.get("createdAt"), (x.get("errorMessage") or "")[:300])
