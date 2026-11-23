---
name: classifyre-dev-stack
description: Use when working against the local skaffold/k3d dev stack of Classifyre — signing in as a user from a script, creating tenants, groups or people in Keycloak, calling the workspace REST API, finding a workspace's database schema, running queries or SQL connections (psql, ODBC, Metabase), seeding the lakehouse lab, verifying a change live, or when a call returns "Unknown namespace", 401/404 surprises, a stale query worker, a sign-in redirect to mac.local, or the machine slows to a crawl.
---

# Working the Classifyre dev stack

The dev stack is the production Helm chart on k3d (`scripts/dev/start.sh` runs
`skaffold dev --profile dev`). API, worker and SQL gateway run from your
checkout with `bun --watch`; the web app runs on your machine. Nearly every
"it doesn't work" here is one of the facts below, not a product bug.

## Addresses

| What | Where |
| --- | --- |
| API (port-forward) | `http://127.0.0.1:8811` — routes are `/<workspace-slug>/...`; registry routes (`/namespaces`, `/namespaces/owning-groups`) have no slug |
| Keycloak | `http://localhost:8280/iam`, realm `classifyre`; master admin password: Secret `classifyre-iam`, key `admin-password` |
| Web | `http://localhost:3000`; in LAN mode (`bun run web:dev:lan`) sign-in returns to `http://mac.local:3000` — use that host in browser scripts |
| SQL gateway | `localhost:25432` (port-forward), TLS always; CA from `GET /<ws>/data-connections/endpoint` → `caCertificate` |
| Postgres | `kubectl -n classifyre-dev exec deploy/classifyre-postgres -- sh -c 'psql -U "$POSTGRES_USER" -d <db>'` |
| Lakehouse lab | `development/lakehouse-lab/README.md` (S3, Polaris, DuckLake, Trino, shop Postgres on the `k3d-classifyre` network, `172.18.10.x`) |

## Identity: tenants, groups, people

- A **Keycloak organization is a tenant**. Classifyre creates the tenant the first time a member signs in, and gives the organization's **top-level `admins` group** Tenant admin. There is no "create tenant" API.
- People must be **members of the organization**, and groups must be **organization groups** (`organizations/<id>/groups`), not realm groups — else "not in a tenant yet".
- Script it with `kcadm.sh` inside the IAM pod: see `development/kestrel-finch/setup/iam.sh` (org, nested groups, users, passwords; rerunnable).
- Tokens for scripts: password grant on client `lab-cli`, scope `openid organization:<org-alias>`:

```bash
curl -s -d client_id=lab-cli -d username=ines.kovac -d password=… -d grant_type=password \
  -d "scope=openid organization:kestrel-finch" \
  http://localhost:8280/iam/realms/classifyre/protocol/openid-connect/token
```

- A ready Python client (token cache, `call`, `catalog`, `query` → Arrow rows): `development/kestrel-finch/setup/kf.py`.
- Browser sign-in is two steps (username, then password; `#username`, `#kc-login`, `#password`). Example: `development/kestrel-finch/clients/ui_tour.py`.

## Access model in one table

| Need | Grant (always to a group) |
| --- | --- |
| Open the workspace, see everything incl. findings (values only on tables read in clear) | `viewer` |
| Open it for granted tables/datasets only — no findings, assets, sources | `data-consumer` |
| Query rows (masked) of a table / source / workspace | `data-reader` with `scopeType` `asset` / `source` / none |
| Read masked columns in clear | `data-reader-unmasked` (Workspace admin does **not** have it; tenant admin does) |
| Read every finding's matched value | `finding.content`: investigator, curator, source-manager, workspace-admin, tenant-admin |
| Run the workspace | `workspace-admin` |

- `POST /namespaces` gives the **owning group nothing** (the web dialog pre-fills Viewer). Grant it a role yourself.
- Owners and stewards (`POST sources/:id/governance/roles`, `principalRef` `user:<sub>` or `group:<id>`) read in clear and see every row, but **stewards cannot query** without a Data reader grant.
- Row filters fail closed **for admins too**: a tenant admin with no rule sees an empty table. `GET assets/:id/rows` → `readersWithoutRows` names who would.

## Where the data is

- Registry: database `classifyre_control`, table `namespaces` (`slug`, `schema_name`, `tenant_id`).
- A workspace's tables: database `classifyre_t_<tenant_id without dashes>`, schema `ns_<…>` from the registry. `development/kestrel-finch/setup/psql.sh` resolves both.

## API shapes that trip scripts

| Call | Shape |
| --- | --- |
| `GET runners` | `{ "runners": [...] }` |
| `POST search/findings` `{filters, page:{limit}}` | `{ "findings": [...], "total": n }` |
| `GET data-connections` | `{ "items": [...] }` |
| `POST instance-settings/mcp/tokens` | secret in `plainTextToken` |
| `GET data-query/catalog` | `sources[].tables[]` with `sqlName`, `assetId`, `canQuery`, `columns[].access/mask` |
| `POST query-runs {sql}` → poll `GET query-runs/:id` → `GET query-runs/:id/result` | Arrow IPC stream |
| Anonymous or no-access request to a workspace | **404 "Unknown namespace"**, not 401 |

Table names: REST `source.schema.table`; over a SQL connection `"source.schema".table`.

## Changing code while the stack runs

| You edited | Takes effect |
| --- | --- |
| `apps/api/src/**` | API, worker and gateway restart themselves (bun --watch). In-flight HTTP calls and port-forwards drop: poll with retries. |
| `apps/cli/src/**`, used by scans and query **Jobs** | next scan/Job (source is mounted) |
| `apps/cli/src/query/**`, used by the **query worker** | only after `kubectl -n classifyre-dev rollout restart deploy/classifyre-query-worker` — its fork server pre-imports the code |
| A DTO | `bun run --cwd apps/api openapi:generate`, then `bun run --cwd packages/api-client codegen` |
| Anything user-facing | a fragment in `changelog.d/` (release-notes skill) |

Detector changes only apply to findings of a **new scan** (`POST sources/:id/run {"forceFullRescan": true}`).

## Clients for live checks

- psql, psqlODBC (Excel/Power BI's driver), pyodbc, pgJDBC: the local image `classifyre/bi-smoke-drivers:dev`, e.g. `docker run --rm --entrypoint psql classifyre/bi-smoke-drivers:dev "host=host.docker.internal port=25432 … sslmode=verify-ca sslrootcert=…"`; ODBC checks: `development/kestrel-finch/clients/odbc_checks.py`.
- Metabase: `development/kestrel-finch/clients/metabase.yaml` + `metabase_setup.py` (H2 on emptyDir: a pod restart wipes it; rerun setup). One SQL connection allows 4 sessions and Metabase's pool takes all four: give every tool its own connection.
- A whole realistic scenario (tenant, 10 personas, 5 sources, masks, row filters, dataset, 39 checks): `development/kestrel-finch/README.md`.

## Common mistakes

| Symptom | Cause |
| --- | --- |
| Scan finds no e-mails in test data | the recogniser checks the TLD: `.example`/`.test` are rejected; use `example.com` |
| Mask kind change ignored, column shows `****` | stale query worker (restart it) — or the CLI doesn't know the kind yet |
| Query timings 5–10× slower, `kubectl` hangs | the host is out of memory (`uptime`); don't run the full `apps/cli` pytest beside the stack — run the test files you changed |
| `until pgrep -f foo` never ends | `pgrep -f` matches the waiting shell's own command line; match on `python.*foo` or wait on a file |
| Staged files lost their staging | `git stash` + `pop` restores the work tree, not the index: use `git stash pop --index` |
| Gateway "busy" (53300) | its memory guard: each session ~240 MB idle, more when busy; one BI pool can hold ~1 GB for 30 min |
| ODBC-source queries 5–13 s | they always run as a Job (never the shared worker) |
