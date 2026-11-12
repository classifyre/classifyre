# ODBC smoke fixture

A PostgreSQL with an invented `sales` schema, deployed by `skaffold dev` (the
`odbc-smoke` release of its `dev` profile) next to the rest of the dev stack:

| | |
| --- | --- |
| Address (in the cluster) | `odbc-smoke-postgres.classifyre-dev.svc:5432` |
| Database | `warehouse` |
| User / password | `admin` / `admin` (throwaway, a ClusterIP Service nobody outside the cluster reaches) |
| Tables | `sales.customers` (key), `sales.orders` (key, foreign key to customers), `sales.support_notes` (no key), view `sales.large_orders` |

`source.json` is the ODBC source that reads it, through the PostgreSQL ODBC
driver the CLI image ships; `smoke.py` creates it in the `all-sources-test`
workspace, scans it and runs SQL over it:

```bash
# The published CLI image has no ODBC driver until the next release; this builds
# one that does, imports it into k3d and points the scan and query jobs at it.
./development/odbc-smoke/build-cli-image.sh

API_TOKEN=<access token of a signed-in user> python3 development/odbc-smoke/smoke.py
```

`skaffold dev` resets the job template to `classifyre/cli:latest` on every helm
upgrade; run `build-cli-image.sh` again after one (or drop it when the published
image has ODBC).

The same database is reachable from outside the cluster for a look around:

```bash
kubectl -n classifyre-dev port-forward svc/odbc-smoke-postgres 55432:5432
psql postgresql://admin:admin@127.0.0.1:55432/warehouse
```
