# BI smoke (dev stack)

Real BI tools and drivers against the SQL gateway of the skaffold dev stack,
reading the `lakehouse-lab` workspace (docs/prd/BIC-bi-client-compatibility.md).
Every answer is compared with the same query run through Classifyre's REST
API as the same person.

| Client | Version | Checks |
| --- | --- | --- |
| Metabase (pgJDBC inside) | v0.65.6.2 | M1–M13 |
| psqlODBC (Excel's and Power BI's ODBC driver), unixODBC, pyodbc | 18.00.0006 | D1–D8 |
| pgJDBC (DBeaver, Tableau, Metabase) | 42.7.11 | J1–J8 |
| psql | 18 | P1–P3 |

## Run it

Needs the dev stack (`scripts/dev/start.sh`) and the lakehouse lab
(`development/lakehouse-lab/README.md`: compose up, `k8s-services.yaml`,
`seed.sh`, `workspace.py`).

```bash
scripts/dev/bi-smoke.sh                       # build drivers image, install Metabase, run everything
SKIP_BUILD=1 scripts/dev/bi-smoke.sh --only M2,J3
SKIP_BUILD=1 scripts/dev/bi-smoke.sh --skip-drivers   # Metabase only
SKIP_BUILD=1 scripts/dev/bi-smoke.sh --keep           # leave the persona, grants and connections
```

It prints a table in the shape of BIC §5 and writes evidence to
`.evidence/<date>-<sha>.json` (gitignored); it exits 1 when a check fails.
Metabase stays up afterwards (`kubectl -n classifyre-dev port-forward
svc/bi-smoke-metabase 3030:3000`, sign in as `bi-smoke@example.test` with
the password in the `bi-smoke-metabase-admin` Secret).

What one run does (`bi_smoke.py`):

1. Signs in as `BI_SMOKE_USER` / `BI_SMOKE_PASSWORD` (a workspace admin; Keycloak password grant on the dev realm's `lab-cli`). The throwaway Metabase's admin password is made on the first run and kept in the `bi-smoke-metabase-admin` Secret (or set `BI_SMOKE_METABASE_PASSWORD`).
2. Opens the fixture tables to SQL connections (only those not open yet), makes
   an admin connection, and a persona `bi-smoke-viewer` in group
   `bi-smoke-viewers` with Viewer plus Data reader on two tables (whose
   `contact` column is masked for it) and its own connection.
3. Runs the drivers Job (`drivers/`, image `classifyre/bi-smoke-drivers:dev`),
   reads its `__BI_SMOKE__` lines and compares rows with the REST reference.
4. Drives Metabase through its REST API: setup, report time zone
   `Europe/Vienna`, a database per connection, sync, the M checks. M5 removes
   the admin database first, so the persona's pool has the gateway's memory.
5. Removes everything it made (connections revoked, grants and persona
   deleted, exposures closed again).

## Fixtures

The lab's working tables (the `shop_lake` bucket's tables are broken in the
lab as of 2026-11-21: "No files in log segment"):
`lab_s3_tables.tables.delta_orders` (id, email), `…iceberg_contacts` (id,
contact), `lab_polaris_iceberg_rest.crm.orders`, `lab_azure_tables.tables.delta_orders`,
`lab_ducklake.crm.people`. Types the tables lack (date, double, numeric,
boolean, timestamptz) come from expressions over `id`, which tests what
PostgreSQL (PGlite describes) and DuckDB (computes) must agree on.

## Settings that matter

- `values.yaml` `metabase.dataWarehousePoolSize: "4"`. Metabase's default pool
  (15) is larger than a SQL connection's 4 sessions and fails as a whole; set
  it empty to reproduce that.
- Metabase skips fingerprinting and binning of columns it takes for keys
  (`id`), so M9 bins Polaris' `order_id`.

## When a client breaks

1. Turn the gateway's trace on:
   `kubectl -n classifyre-dev set env deploy/classifyre-sql-gateway SQL_GATEWAY_TRACE=true`
   (statements cut at 300 characters, never bound values), run the check,
   read `kubectl logs deploy/classifyre-sql-gateway`, then turn it off again
   (`SQL_GATEWAY_TRACE-`).
2. Add the statements to the client corpus
   (`apps/api/src/sql-gateway/fixtures/client-corpus/`, its README) and run
   `bun --filter api test -- src/sql-gateway`: they fail there first.
3. Fix, then run the smoke again.

The manual kit in `development/sql-gateway-smoke/` (psql, `JdbcSmoke.java`,
`isql` from a laptop) still works for a quick look without k3d.
