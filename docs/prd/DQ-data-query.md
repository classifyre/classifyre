# PRD DQ · Data query: SQL over the tables of a workspace

|                  |                                                                                                                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**       | Phases 0–2 built 2026-11-09, plus export (from phase 3) and the phase-1 hardening (§9 "As built"). Rest of phase 3 and phases 4–6 proposed.                     |
| **Size**         | L (7 phases, each its own PR or set of PRs)                                                                                                                      |
| **Depends on**   | [IAM](IAM-access-management.md) (grants, roles, capabilities), the CLI's DuckDB readers (`apps/cli/src/utils/duckdb_engine.py`, `lakehouse_tables.py`)          |
| **Starts from**  | The payload-access proof of concept `fedsql` (outside this repository: `onedata/poc-payload`, reviewed 2026-11-05)                                               |
| **Not in scope** | writing to sources, row-level policies (phase 3 covers columns), a warehouse of copies, user-defined functions                                                   |

## 1. Summary

Classifyre knows every table of a workspace (assets of kind `table`, and table files in buckets) and what was found in them, but nobody can read the rows. This PRD lets anyone allowed — by a role on the workspace or by a group grant on one source or one table — query those tables with standard SQL, from the asset's page or from a SQL page that shows what they may query, and join tables across sources (a PostgreSQL table with a Delta table in a bucket, for example).

The engine is the one the CLI already has, DuckDB, run the way every other piece of CLI work runs: an **ephemeral job** per query (a Kubernetes Job, or a local process in the all-in-one image). The API decides what a query may read; the job enforces it on the SQL itself.

Later phases add column masking (driven by the PII findings Classifyre already has), access requests, more source types, JDBC/BI access, and **Delta data products**: a multi-table query published as a governed Delta table that can be granted without its base tables.

## 2. What the proof of concept showed

| Finding                                                                                                                                         | Taken over as                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| One isolated in-memory DuckDB per query, sources attached under hidden names, only policy views exposed                                        | §5.2, unchanged                                                      |
| SQLGlot gate: one SELECT, function allowlist, no table functions, only registered names; its bypass list                                      | `apps/cli/src/query/gate.py`, stricter: an allowlist of **tables**   |
| Bucket-scoped S3 secrets, read-only PostgreSQL attach, `pg_use_ctid_scan = false` (LIMIT over-returned rows, F01)                              | §5.3                                                                 |
| `delta_scan` obeys the Delta log (5 active rows, not the 9 files on disk)                                                                      | Delta and Iceberg read through their scanners, never as file globs   |
| Timeout did not cover source setup (F02); results fully materialised (F03)                                                                     | One deadline around setup and execution; row and byte caps           |
| Roles per source, column allowlists, hides and masks                                                                                           | Grants per source **or table** (§4); masks in phase 3                |
| Hand-written PostgreSQL wire server worked with JDBC/ODBC drivers                                                                              | Phase 5                                                              |
| "Delta" in the POC meant Delta Lake; a joined result becomes a Delta table only if something publishes it                                     | Phase 6, data products                                               |

## 3. Requirements

| #   | Requirement                                                                                                                                         |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | A person can query a table only when a role on the workspace gives `data.query`, or a data-reader grant names the table or its source.             |
| R2  | A query can read nothing but those tables: no files, no table functions, no system catalogs, no other source's credentials.                        |
| R3  | Only SELECT. No writes, no settings, no attachments, one statement.                                                                                 |
| R4  | People see what they can query, and what exists that they cannot (when they can see assets at all), and why.                                       |
| R5  | One query can join tables of several sources.                                                                                                       |
| R6  | Every query is attributed and the tables it read are recorded (audit).                                                                              |
| R7  | Results are bounded (rows, bytes, time) and the bound is visible; nothing is silently cut.                                                         |
| R8  | *(Changed 2026-11-09.)* No per-workspace switch: sign-in is always on, so grants (`data.query`, Data reader on a workspace, source or table) are the only gate. Workspace admins query straight away. |
| R9  | Reuses the CLI's connection code and the job machinery; no second engine, no long-lived worker to run in phase 1.                                  |

## 4. Who may query what

**Capability.** `data.query` — "Query the rows of tables with SQL". It is a workspace capability like every other, so Workspace admin, Workspace manager and Tenant admin have it on their scopes.

**Role.** `data-reader` (Data reader) holds only `data.query`. It is an add-on, like Code author: combined with a role that opens the workspace (Viewer or more).

**Scopes.** A data-reader grant can be on the tenant, a group's workspaces, a workspace — or on **one source** or **one table** of a workspace. The last two are the first grants on single resources (`iam_grants.scope_type` `source` / `asset`, `scope_id = <namespace id>/<source or asset id>`). They never give anything workspace-wide (`grantApplies` is false for them); the namespace hook works out, per request, which sources and tables they open (`resourceGrantsInWorkspace`) and `IamAccessPolicy.check(actor, capability, resource)` honours them. Grants go to groups only, as since IAM step 8f: a one-person need is a small group.

**Sign-in off.** *(Gone 2026-11-09: sign-in is always on.)*

**The settings.** `data_query_settings` (per workspace): `max_rows` (10,000), `timeout_seconds` (120) and `export_max_rows`. Changed with `workspace.settings`. *(The `enabled` switch was dropped 2026-11-09, migration `20261110090200_data_query_always_on`.)*

**What a person sees.** The catalog lists every table-shaped asset. A table is `canQuery` when DuckDB can read it and a role or grant covers it (R8: no switch). Tables someone cannot query are listed (locked) only if they hold `asset.view`.

## 5. Design

### 5.1 Flow

```mermaid
sequenceDiagram
  participant W as Web (SQL page / asset Data tab)
  participant A as API
  participant J as Query job (CLI image)
  W->>A: POST /<ws>/query-runs {sql}
  A->>A: setting on? catalog for this person → allowed tables
  A->>A: sources the SQL names (sqlName prefix) → their recipes, decrypted
  A->>A: QueryRun PENDING (token hash); per-table audit on success, for the tables the job read (R6)
  A-->>W: run (PENDING)
  A->>J: K8s Job or local process, request gzipped in env
  J->>J: SQLGlot gate against the allowed tables
  J->>J: attach sources as __src_<n>, views <source>.<schema>.<table>
  J->>J: lock configuration, run with LIMIT max_rows+1 under one deadline
  J->>A: POST /<ws>/query-runs/:id/result (Arrow IPC, X-Query-Run-Token)
  W->>A: GET /<ws>/query-runs/:id (poll)
  W->>A: GET /<ws>/query-runs/:id/result → Arrow → grid
```

### 5.2 Names

A table is `<source>.<schema>.<table>`, every part a plain lower-case identifier (`apps/api/src/data-query/sql-names.ts`):

| Source                         | schema                                         | table                         |
| ------------------------------ | ---------------------------------------------- | ----------------------------- |
| PostgreSQL                     | `schema` (prefixed with the database when a source scans several) | `table_name`      |
| MySQL                          | the database                                   | `table_name`                  |
| Iceberg REST, DuckLake         | namespace / schema                             | `table_name`                  |
| Bucket tables (Delta, Iceberg) | the folders of the table root, joined with `_` | the last folder               |
| Bucket files (Parquet, CSV, TSV, JSON lines, Avro) | the folders                | the file name without extension |

`Source.sqlName` is given from the source's name the first time it is needed and **kept** when the source is renamed, so saved SQL keeps working. Colliding table names get `_2`, `_3` by asset id.

### 5.3 The job (`apps/cli/src/query/`)

- `gate.py` — the SQLGlot gate. Refuses: non-SELECT roots, any DDL/DML/INTO/COMMAND/LOCK node (write CTEs included), functions outside `SAFE_FUNCTIONS`, qualified functions, anything in FROM that is not a plain name (files, `read_*`, `query()`, `postgres_query()`), names not in full (`source.schema.table`), and every name not in the request. Rewrites names quoted and lower-cased.
- `bindings.py` — one adapter per source type:
  - PostgreSQL / MySQL: DuckDB's scanners, `READ_ONLY`, from the recipe fields the connectors read; no Python driver needed.
  - Iceberg REST / DuckLake: the scan's own `DuckDBAttachedSource._attach`, under the query's alias (`_attach_alias`, secrets prefixed with it).
  - Buckets: the source's `TableStorage` (the scan's secret body, now with a `SCOPE` per bucket); `delta_scan`, `iceberg_scan(…, allow_moved_paths)` with `unsafe_enable_version_guessing` (a query reads the table as it is now, not the version the last scan recorded, which is gone once the table moves on), `read_parquet`, `read_csv`, `read_json`, `read_avro`.
- `session.py` — attaches only the sources the SQL reads, creates the views, sets `lock_configuration`, turns extension auto-loading off, runs under one deadline (`conn.interrupt()`), cuts to `max_rows` and `max_result_bytes`, converts columns the browser's Arrow reader cannot decode to text.
- `runner.py` — posts Arrow IPC (or a JSON error) with the run's token, and prints one `__CLASSIFYRE_QUERY_RESULT__` line so the API can still say what happened when the callback never came. Errors pass the recipe redactor.
- `python -m src.main query <file>` skips importing every connector: a person is waiting.

### 5.4 The API (`apps/api/src/data-query/`)

- `QueryCatalogService` — the table list of a workspace (cached 30 s), then per request who may query what.
- `QueryRunService` — creates the run, picks the sources the SQL names in code (only allowed ones), decrypts their recipes, starts the job, receives the result. At most 8 sources per query and 3 running queries per person. Results expire after 24 h.
- Routes: `GET data-query/catalog`, `GET|PUT data-query/settings`, `POST query-runs`, `GET query-runs`, `GET query-runs/:id`, `GET query-runs/:id/result`, `POST query-runs/:id/cancel`, and the job's `POST query-runs/:id/result`.
- The callback route is the one public workspace route: the namespace hook lets `POST /query-runs/<uuid>/result` with an `X-Query-Run-Token` through, and the route compares the token's sha256 with the run's (constant time), then clears it. The job holds no `CLASSIFYRE_INTERNAL_KEY`, like a notebook job.
- Job mode `query` in `kubernetes-cli-job.service.ts`: the quick resource profile, `activeDeadlineSeconds = timeout + 60`, `backoffLimit 0`, optional `K8S_CLI_QUERY_JOB_PRIORITY_CLASS` and `K8S_CLI_QUERY_JOB_MEMORY`.

### 5.5 The web app

- **SQL page** (`/<ws>/query`, sidebar "SQL"): the catalog on the left (sources → tables → columns, play mark = can query, lock = cannot, a reason when it cannot be queried (unreadable, or locked for lack of a grant — R4), "Only what I can query", filter), the editor and its result on the right.
- **Asset → Data tab**: shown for table-shaped assets; the editor starts with `SELECT * FROM <table> LIMIT 100`, "Open in SQL" carries the query over. People with `access.manage` (sign-in on) see **Who can query this table** and give a group the Data reader role on the table or its source.
- **Settings → Export & Import**: the limits, with who last changed them.
- Libraries: Monaco (already in the app, served from the app's own copy) with its SQL grammar and a completion provider fed by the catalog; `@tanstack/react-table` v8 + `@tanstack/react-virtual` for the grid (sortable, only visible rows in the DOM); `apache-arrow` to decode; `sql-formatter` for Format.

### 5.6 Export and large tables

- `POST query-runs {sql, format: xlsx|csv|parquet}` runs the same job with `exportFormat`: `COPY (SELECT … LIMIT export_max_rows) TO file`, through DuckDB's `excel` extension for `.xlsx` (types Excel has no cell for written as text, text cut to 32,767 characters, at most 1,048,575 rows), zstd Parquet, CSV with a header. One count of `cap + 1` rows says whether the cap cut it. Files over 256 MB are refused, not cut. Needs `data.export` on top of the right to read; audited as `query-runs.export-table.<format>`. `GET query-runs/:id/result` answers with the file's media type and `Content-Disposition`.
- **Large tables.** Nothing is copied before it is read. Every query is wrapped as `LIMIT max_rows + 1`, so `SELECT *` stops early; filters push down into PostgreSQL/MySQL scans and Parquet/Delta/Iceberg row-group pruning. DuckDB is given the pod's budget: the API sets `CLASSIFYRE_QUERY_MEMORY_LIMIT` (70 % of the job's memory limit), `CLASSIFYRE_QUERY_THREADS` (whole cores) and `CLASSIFYRE_QUERY_MAX_SPILL`; sorts, aggregates and joins larger than memory spill to the pod's disk. Measured in a 2 GiB / 1 CPU pod on 60 M rows (2.5 GB Parquet): `SELECT *` 3 s (cut at 10,000), count+sum 6 s, top-20 7 s, 2 M-group aggregate 5 s, full sort (top-N by the wrap) 12 s, 60 M-group aggregate 51 s with spilling — no OOM. Without the settings DuckDB still respected the cgroup memory limit, but ran 10 threads on 1 CPU: 84 s for the last one.
- Helm `api.cliJobs.query` (`memory` 2Gi, `cpu` 1, `priorityClassName` interactive, `maxSpill` 10GiB) and `priorityClasses.interactiveName/Value` (5000, `preemptionPolicy: Never`: ahead of queued scans, never evicting a running one).

## 6. Phases

| Phase | What | Status |
| --- | --- | --- |
| 0 | This PRD; POC gate ported with its bypass list; job latency measured | Built 2026-11-09 |
| 1 | CLI engine and bindings, job mode `query`, API runs and catalog, `data.query` / `data-reader`, source and table grants, workspace setting, audit | Built 2026-11-09 |
| 2 | SQL page, asset Data tab, grant panel, settings card | Built 2026-11-09 |
| 3 | Governance: column hide/mask per group; **PII columns masked by default** from open findings unless `data.unmask`; access requests that end in an expiring group grant; saved queries; MCP tool `query_data`. Export to Excel/CSV/Parquet (`data.export`) built 2026-11-09 | Export built; rest proposed |
| 4 | More sources: Snowflake, BigQuery, MSSQL, Databricks, Trino, Redshift, Athena, Oracle, Hive through DuckDB extensions where reliable, otherwise a driver binding with projection/filter/LIMIT pushdown and a row cap that refuses rather than silently answers on part of a table; file tables in SharePoint/Drive by materialising them | Proposed |
| 5 | JDBC/ODBC: a PostgreSQL wire endpoint (from the POC's `pgwire.py`: TLS, SCRAM, an isolated metadata catalog answered from the API catalog), personal data access tokens like MCP tokens, each query a phase-1 job. The one place a long-lived listener is unavoidable: decide jobs-only vs a warm pool with the phase-1 latency numbers | Proposed |
| 6 | **Delta data products**: a saved multi-table query + a target (a bucket source with a write key and a prefix) + a schedule; job mode `publish` runs it with the owning group's grants (re-checked every refresh) and writes Delta (`deltalake`; on B2 write locally then upload); the product is an asset of its own, grantable without its base tables, with lineage edges from them; Delta versions are its history; masks applied at publish time | Proposed |

## 7. Risks and open questions

- **Job start-up is the latency floor.** A query is as fast as a pod is to start. Mitigations in place: the quick profile, no internal-key/HF token work, the `query` command skips connector imports, optional interactive priority class. Not yet: extensions baked into the CLI image (they come from the uv-cache volume after first use). Measure before phase 5.
- **Grants on single resources are new to IAM.** They are evaluated per request from the principal's grants (no extra lookups) and listed among the workspace's grants. Removing a source or asset leaves its grants behind, harmless but untidy: clean up with the asset purge in phase 3.
- **Masking is display protection, not anonymisation** (as the POC noted): someone who can query a column can infer from it. Phase 3 hides by default what detectors flagged.
- **Two S3 sources on the same bucket with different keys** in one query: secrets are scoped by bucket, so the longest scope wins. Rare; documented.
- **Delta writes to B2** fail through delta-rs (no `If-None-Match`): phase 6 writes locally and uploads.

## 8. Testing and acceptance

| Level | What |
| --- | --- |
| CLI unit (`tests/test_query.py`) | The POC's bypass list and more (34 statements refused), analytics SQL accepted, joins across files, exact row cap, byte cap, timeout, refused table before attaching, engine errors reach the person, one marker line |
| API unit | Names and locations per source type, collisions, mentioned sources, resource grants; route-access completeness (the callback is the one public workspace route) |
| Dev stack | `lakehouse-lab`: Delta + Iceberg + Parquet/CSV in buckets, PostgreSQL joined with Delta, timeout, cancel, refusal, audit rows, latency |
| Personas (next) | `scripts/dev/iam-personas.sh`: no grant (table absent from the catalog, query refused), table grant, source grant |

## 9. As built

### Phases 0–2, 2026-11-09

- Code: `apps/cli/src/query/` (gate, bindings, session, runner), `apps/api/src/data-query/`, `apps/web/components/data-query/`, `apps/web/app/[locale]/[namespaceSlug]/(dashboard)/query/`. Migration `20261109120000_data_query` (`sources.sql_name`, `query_runs`, `data_query_settings`); `iam_grants_scope_type_check` widened in `identity/tenancy.sql.ts`.
- DuckDB 2.0 (the CLI's local venv) dropped `pg_experimental_filter_pushdown`; the scanner settings are best effort per statement. Its DB-API results no longer have `.arrow()`: the session uses `conn.sql(…).to_arrow_table()`.
- The Iceberg and DuckLake sources attach under `_attach_alias` and prefix their secret names with it when it is not the default, so scans are unchanged and several catalogs fit in one query.
- The CLI image keeps DuckDB/pyarrow (`file-processing`) and SQLGlot (`lineage`) in optional groups; `runner.ensure_dependencies()` installs them on first use into the shared uv cache. Baking them (and the DuckDB extensions) into the image is the next latency step.
- Local (macOS, DuckDB 2.0): Parquet + CSV join, Delta and Iceberg from the lab folder, PostgreSQL (`lineage_smoke` on the dev Postgres) joined with Delta, timeout, refusals — all through `python -m src.main query`.
- In the cluster (a pod on the scan job's template, `classifyre/cli:latest`, host-mounted `src`), against the lakehouse lab: S3 Delta, S3 Iceberg, S3 CSV, Polaris (Iceberg REST), DuckLake, Azure Delta, local-folder Delta, a four-source query and an S3 Delta ⋈ Polaris join — each 1–2 s including DuckDB extension loading, setup 0.3–0.8 s, the queries themselves under 0.1 s.
- End to end on the dev stack with sign-in on (2026-11-09, workspace `lakehouse-lab`, a tenant admin): switched on in Settings → Export & Import; the SQL page lists 8 sources and their tables with the right marks (Lance, Paimon and Trino tables shown as not queryable, with the reason); `SELECT … FROM lab_s3_tables.tables.delta_orders JOIN lab_polaris_iceberg_rest.crm.orders … (SELECT count(*) FROM lab_ducklake.crm.people)` ran as a Kubernetes Job and came back through the callback: 11 rows, the row the lab deleted from the Delta table absent, 3 tables recorded on the run and in `audit_events`. Refusals came back with their codes (`function_not_allowed`, `table_not_available` for a missing table and for a Lance table, `select_only`, `execution_error` for an unknown column). Asset → Data tab ran `SELECT * FROM shop_lake.shop.orders`; a table grant to a group was given, listed and removed from the panel.
- Latency through a Job on k3d: 10–20 s per query (pod start dominates; setup 1.7–5 s inside, the query itself under 0.4 s); the first query after the image was pulled took 44 s (optional groups installed). Refusals cost a whole job too (7–15 s): a cheap validation in the API before starting a job is worth adding.
- Fixed while testing: the migration had been applied before `callback_token_hash` was added to it, so the column moved to its own migration (`20261109130000_query_run_callback_token`); polling now rides out gateway errors for 90 s (an API restart dropped the port-forward mid-run); dates and timestamps from Arrow are shown as dates, not epoch milliseconds; `?tab=data` opens the Data tab (the tabs remount once it is known).
- Then, the same day: **API pre-check** (`sql-precheck.ts`): one statement, a read-only start, no file/table functions, no full name of a table of a known source that is not granted — refused at once with the job's codes, the job's SQLGlot gate still the authority; **export** (§5.6); **large tables** (§5.6); **Helm** query-job values and the `interactive` priority class; **the CLI image** syncs `file-processing` and `lineage` and ships the DuckDB extensions in `/opt/duckdb-extensions` (`CLASSIFYRE_DUCKDB_BAKED_EXTENSION_DIR`, loaded before the shared cache or INSTALL; +356 MB of extensions); **persona checks** `D` in `scripts/dev/iam-personas.sh` (17 checks; the whole suite 83/83 on a throwaway release, 2026-11-09); **Playwright** steps in `apps/e2e/tests/smoke.spec.ts` with `docker/fixtures/smoke/orders.csv` (7/7 against the dev stack: SQL off → on, a GROUP BY on the SQL page, Excel download, CSV through the API, a refusal; the viewer locked, then given the one table, querying it from the Data tab, refused an export). On the dev stack refusals now answer in 20–100 ms instead of 7–15 s; an Excel export of `shop_lake.shop.orders` opened with 12 rows and real dates.
- Not verified: a full build of the CLI image with the baked groups and extensions (the extension step was run locally and `docker build --check` passes); the image grows by the two groups and 356 MB of extensions.
