# PRD DQ · Data query: SQL over the tables of a workspace

|                  |                                                                                                                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**       | Phases 0–2 built 2026-11-09, plus export (from phase 3) and the phase-1 hardening (§9 "As built"). Phase 4, SQL connections (PostgreSQL protocol for BI tools and drivers), built 2026-11-13 (§5.7, §9). Rest of phase 3 and phases 5–6 proposed. Owners, business metadata and data quality moved to [GOV](GOV-governed-data-assets.md) (2026-11-12). |
| **Size**         | L (7 phases, each its own PR or set of PRs)                                                                                                                      |
| **Depends on**   | [IAM](IAM-access-management.md) (grants, roles, capabilities), the CLI's DuckDB readers (`apps/cli/src/utils/duckdb_engine.py`, `lakehouse_tables.py`)          |
| **Starts from**  | The payload-access proof of concept `fedsql` (outside this repository: `onedata/poc-payload`, reviewed 2026-11-05)                                               |
| **Not in scope** | writing to sources, row-level policies (phase 3 covers columns), a warehouse of copies, user-defined functions                                                   |

## 1. Summary

Classifyre knows every table of a workspace (assets of kind `table`, and table files in buckets) and what was found in them, but nobody can read the rows. This PRD lets anyone allowed — by a role on the workspace or by a group grant on one source or one table — query those tables with standard SQL, from the asset's page or from a SQL page that shows what they may query, and join tables across sources (a PostgreSQL table with a Delta table in a bucket, for example).

The engine is the one the CLI already has, DuckDB, run the way every other piece of CLI work runs: an **ephemeral job** per query (a Kubernetes Job, or a local process in the all-in-one image). The API decides what a query may read; the job enforces it on the SQL itself.

Later phases add column masking (driven by the PII findings Classifyre already has), access requests, **SQL connections** for BI tools and drivers (phase 4, §5.7), more source types, and **Delta data products**: a multi-table query published as a governed Delta table that can be granted without its base tables.

What makes a table a *governed data asset* — an accountable owner, stewards and a custodian from IAM, a description and column-level business metadata, and ODCS-shaped quality rules with kept results — is its own PRD, [GOV](GOV-governed-data-assets.md). This PRD's phase 3 builds on it: access requests go to the table's owner, and default masks come from GOV's column classification. GOV's whole-table quality rules run on this PRD's engine (job mode `quality`).

## 2. What the proof of concept showed

| Finding                                                                                                                                         | Taken over as                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| One isolated in-memory DuckDB per query, sources attached under hidden names, only policy views exposed                                        | §5.2, unchanged                                                      |
| SQLGlot gate: one SELECT, function allowlist, no table functions, only registered names; its bypass list                                      | `apps/cli/src/query/gate.py`, stricter: an allowlist of **tables**   |
| Bucket-scoped S3 secrets, read-only PostgreSQL attach, `pg_use_ctid_scan = false` (LIMIT over-returned rows, F01)                              | §5.3                                                                 |
| `delta_scan` obeys the Delta log (5 active rows, not the 9 files on disk)                                                                      | Delta and Iceberg read through their scanners, never as file globs   |
| Timeout did not cover source setup (F02); results fully materialised (F03)                                                                     | One deadline around setup and execution; row and byte caps           |
| Roles per source, column allowlists, hides and masks                                                                                           | Grants per source **or table** (§4); masks in phase 3                |
| Hand-written PostgreSQL wire server worked with JDBC/ODBC drivers (text results only; Power BI and Excel never signed off)                    | Phase 4: PGlite as the catalog and protocol back end, binary results (§5.7) |
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

- **SQL page** (`/<ws>/query`, sidebar "SQL"): the editor leads, with Run, Format, Save and Export in one toolbar above it and the result below; the explorer sits beside it with Tables (sources → tables → columns, starred sources first, play mark = can query, lock = cannot, a reason when it cannot be queried (unreadable, or locked for lack of a grant — R4), "Only what I can query", filter), History (your recent runs, reopened as SQL only — rows expire and may be huge) and Saved (your saved queries, per signed-in person by actor reference; visitors of a public workspace save nothing). Everything inserts where the cursor stands in Monaco, never appended to the query's end. Below the result: **Access** (every Data reader grant in the workspace; Give access on the whole workspace) and **Activity** (`resource=data`).
- **Asset → Data tab**: shown for table-shaped assets; the editor starts with `SELECT * FROM <table> LIMIT 100`, "Open in SQL" carries the query over. Below the result, for people with `access.view`: **Access** (grants on the table, its source and wider; Give access gives the Data reader role on this table only — `access.manage`) and **Activity** (`resource=asset:<id>`).
- **Source → Data tab** (`/<ws>/sources/<id>?tab=data`, built 2026-11-11): the same layout, with the source's tables beside the editor (the explorer, tables only, over a catalog narrowed to the source — completions too). Access lists grants on the source, on any of its tables, and wider; Give access gives the Data reader role on the whole source; Activity filters on `resource=source:<id>`.
- **Activity per scope**: `audit_events.resources` (text[], GIN) tags each table read/export with `data`, `asset:<id>`, `source:<id>`, and each grant given or removed with `data` (data-reader) and its `asset:`/`source:` scope (a table grant also its source, from `GrantDto.sourceId`). `GET /audit-events?resource=…` filters on one tag (`identity/audit-resources.ts`). `DELETE …/access/grants/:id` answers with the removed grant, so removals are named and tagged too.
- **Settings → General**: the limits, with who last changed them.
- Libraries: Monaco (already in the app, served from the app's own copy) with its SQL grammar and a completion provider fed by the catalog; `@tanstack/react-table` v8 + `@tanstack/react-virtual` for the grid (sortable, only visible rows in the DOM); `apache-arrow` to decode; `sql-formatter` for Format.

### 5.6 Export and large tables

- `POST query-runs {sql, format: xlsx|csv|parquet}` runs the same job with `exportFormat`: `COPY (SELECT … LIMIT export_max_rows) TO file`, through DuckDB's `excel` extension for `.xlsx` (types Excel has no cell for written as text, text cut to 32,767 characters, at most 1,048,575 rows), zstd Parquet, CSV with a header. One count of `cap + 1` rows says whether the cap cut it. Files over 256 MB are refused, not cut. Needs `data.export` on top of the right to read; audited as `query-runs.export-table.<format>`. `GET query-runs/:id/result` answers with the file's media type and `Content-Disposition`.
- **Large tables.** Nothing is copied before it is read. Every query is wrapped as `LIMIT max_rows + 1`, so `SELECT *` stops early; filters push down into PostgreSQL/MySQL scans and Parquet/Delta/Iceberg row-group pruning. DuckDB is given the pod's budget: the API sets `CLASSIFYRE_QUERY_MEMORY_LIMIT` (70 % of the job's memory limit), `CLASSIFYRE_QUERY_THREADS` (whole cores) and `CLASSIFYRE_QUERY_MAX_SPILL`; sorts, aggregates and joins larger than memory spill to the pod's disk. Measured in a 2 GiB / 1 CPU pod on 60 M rows (2.5 GB Parquet): `SELECT *` 3 s (cut at 10,000), count+sum 6 s, top-20 7 s, 2 M-group aggregate 5 s, full sort (top-N by the wrap) 12 s, 60 M-group aggregate 51 s with spilling — no OOM. Without the settings DuckDB still respected the cgroup memory limit, but ran 10 threads on 1 CPU: 84 s for the last one.
- Helm `api.cliJobs.query` (`memory` 2Gi, `cpu` 1, `priorityClassName` interactive, `maxSpill` 10GiB) and `priorityClasses.interactiveName/Value` (5000, `preemptionPolicy: Never`: ahead of queued scans, never evicting a running one).

### 5.7 SQL connections (phase 4)

BI tools and drivers reach the same tables over the PostgreSQL protocol. Decided with the user on 2026-11-13: connections are made by their person **and** given by admins and owners; a connection is a **channel, not a right** (its person's live rights, narrowed by its scope, minus owners' blocks — IAM's groups-only grants stay); an owner or steward **closes their table or source to one connection**, admins and the person revoke the whole of it; **jobs only**, latency measured.

```mermaid
sequenceDiagram
  participant T as BI tool / driver
  participant G as SQL gateway (SERVICE_ROLE=sql)
  participant L as PGlite (per session, worker thread)
  participant A as Query runs (API code in the gateway)
  participant J as Query job
  T->>G: SSLRequest or direct TLS, startup (database = workspace, user = connection)
  G->>G: SCRAM-SHA-256 against the connection's verifier
  G->>L: catalog DDL: "<source>.<schema>" schemas, empty tables, GOV descriptions as comments
  T->>G: Parse/Bind/Describe/Execute, Query
  G->>L: every message (catalog, prepared statements, portals, transactions, errors)
  G->>L: classifyre.reads(sql): which relations its plan reads
  alt reads the person's tables
    G->>A: createForConnection(sql with parameters as literals, tables, search_path)
    A->>J: job (dialect postgres), audited channel sql, resource connection:<id>
    J-->>A: Arrow
    A-->>G: rows (taken once, then dropped)
    G-->>T: DataRow in the formats PGlite described (text or binary)
  else catalog only
    L-->>T: PostgreSQL's own answer
  end
```

- **Connections** (`data_connections`, `data_connection_blocks`, workspace schema): name, person, user name (`<login>_<name>`, unique in the workspace), SCRAM-SHA-256 verifier (salt, 4096 iterations, StoredKey, ServerKey — never the password), scope (sources/tables; empty = everything the person may query), who gave it, expiry (1–365 days, 90 by default), last use and client address, revocation. Routes under `/<ws>/data-connections` (mine, all, per asset/source, create, issue, password, revoke, blocks, endpoint), rights in the service: its person (`data.connect`, also from a Data reader grant on a table, or owning tables), `data.connection.manage`, or governing the table/source. Every change is audited with `changes` and `connection:<id>`; issued, revoked and blocked connections notify their person (GOVERNANCE).
- **The gateway** (`apps/api/src/sql-gateway/`): Node TCP listener in the API image. TLS always (`SQL_GATEWAY_ALLOW_PLAINTEXT` for development, or behind a TLS-terminating proxy that sends PROXY headers); both negotiations — `SSLRequest` (every client) and direct TLS (libpq 17 `sslnegotiation=direct`, and Traefik `passthrough`, which answers the SSLRequest itself); SCRAM only, an unknown user goes through the same exchange; lockout after 10 failures in 15 minutes per user and per address; PROXY protocol v1/v2; allowed networks; sessions per pod and per connection; idle timeout; CancelRequest cancels the job; a 30-second sweep ends sessions of revoked or expired connections; the person's principal is rebuilt every 5 minutes and before data statements (a leaver's tools stop).
- **PGlite as protocol back end**: one PostgreSQL-in-WebAssembly per session in its own worker thread, started from a per-workspace template (database named after the workspace, Classifyre's helper functions) in about a second, ~150 MB. It holds only the session person's metadata, never rows; whatever a client does there reaches no data. Because every message goes to a real PostgreSQL, clients get real `pg_catalog`/`information_schema`, prepared statements, portals, transactions and error states. `classifyre.reads()` explains a statement (`EXPLAIN (VERBOSE, GENERIC_PLAN)`, in a subtransaction) to see whether it reads the person's tables; mixing them with the catalog is refused. Data errors are raised through `classifyre.fail()`, so the transaction aborts and the extended protocol skips to Sync as PostgreSQL does.
- **Results** are encoded by the gateway from the job's Arrow into the types PGlite described, text or binary (Npgsql/Power BI and pgJDBC ask for binary): integers, floats, numeric (base 10000), text, bytea, uuid, json/jsonb, date, time, timestamp(tz), one-dimensional arrays. A result over the cap (`max_rows`, `export_max_rows` with `data.export`) is refused after the rows up to it (SQLSTATE 54000), never cut silently. Loading results into PGlite instead was measured and dropped (1M rows: 7.7 s, +1.5 GB).
- **The job**: `dialect: postgres` with the workspace as `database` and the client's `searchPath`; the gate resolves `"src.sch".tbl`, `ws."src.sch".tbl` and bare names on the search path, then writes DuckDB SQL. (Unquoted `src.sch.tbl` cannot get that far: PGlite, like PostgreSQL, reads it as a cross-database reference and refuses it.) The gate stays the authority.
- **Exposure** (Helm `sqlGateway`, off by default): Service `ClusterIP`/`NodePort`/`LoadBalancer` (with source ranges) — no proxy needed; Traefik v3 `IngressRouteTCP` (`tls: none` raw TCP on a dedicated entrypoint, `passthrough` SNI routing, `terminate` with PROXY v2); ingress-nginx `tcp-services` (documented). Certificate from `tls.existingSecret`, cert-manager, or a CA and certificate the chart makes once and keeps (`lookup`), the CA downloadable in the app. The all-in-one image listens on 5433 and makes its CA under `/var/lib/classifyre/sql-tls`.
- **Product**: Settings → *SQL connections* (mine; everyone's for managers; reveal once; connection strings for psql, JDBC, ODBC, Npgsql); *Connect a tool* on the SQL page and the Data tabs; the asset and source Governance tabs gain *Access* (connections that read it, name it or are closed on it, reads and last read, give, close, revoke); Activity names the connection (*via SQL connection …*); GOV's Usage counts people, not tokens or connections, split by channel.
- **Fixed on the way**: MCP requests now get grants on single sources and tables (`CLS_RESOURCE_GRANTS` was missing), and owners keep their own tables over MCP (`ownerDataScope` matched `user:x@mcp:t`); runs record `person_ref`, `channel`, `connection_id`, and the per-person cap counts the person across channels; reads were always audited as `rest`.

## 6. Phases

| Phase | What | Status |
| --- | --- | --- |
| 0 | This PRD; POC gate ported with its bypass list; job latency measured | Built 2026-11-09 |
| 1 | CLI engine and bindings, job mode `query`, API runs and catalog, `data.query` / `data-reader`, source and table grants, workspace setting, audit | Built 2026-11-09 |
| 2 | SQL page, asset Data tab, grant panel, settings card; redesigned 2026-11-10 into an IDE-style runner (Monaco-centric toolbar, cursor-aware explorer, per-user history and saved queries in `saved_queries`); source Data tab and per-scope Access/Activity 2026-11-11 | Built; redesign built 2026-11-10; source tab 2026-11-11 |
| 3 | **Access governance** (after [GOV](GOV-governed-data-assets.md) G-1/G-2): column hide/mask per group; **classified columns masked by default** — GOV's column classification (derived from open findings, or a steward's override) — unless `data.unmask`; **access requests routed to the table's owner** (then a steward, then the workspace's owning group), approval ending in an expiring Data reader grant to a group (one the requester names, or a requester group made on approval); MCP tool `query_data`; grants and governance rows cleaned up with the asset purge. Export to Excel/CSV/Parquet (`data.export`) and saved queries built 2026-11-09/10 | Export + saved queries built; rest proposed |
| 4 | **SQL connections** (§5.7): a PostgreSQL endpoint (the SQL gateway, `SERVICE_ROLE=sql`) for BI tools and drivers; per-person connections with SCRAM verifiers, issued by their person or by an admin or owner, revocable, closable per table by owners; every data statement a phase-1 job audited with the connection; TLS always, exposed directly (LoadBalancer/NodePort), through Traefik (`IngressRouteTCP`) or ingress-nginx TCP, or from the all-in-one image; Governance tab *Access* and usage by channel. Jobs only (no warm pool, decided 2026-11-13) | Built 2026-11-13 |
| 5 | More sources: Snowflake, BigQuery, MSSQL, Databricks, Trino, Redshift, Athena, Oracle, Hive through DuckDB extensions where reliable, otherwise a driver binding with projection/filter/LIMIT pushdown and a row cap that refuses rather than silently answers on part of a table; file tables in SharePoint/Drive by materialising them | Proposed |
| 6 | **Delta data products**: a saved multi-table query + a target (a bucket source with a write key and a prefix) + a schedule; job mode `publish` runs it with the owning group's grants (re-checked every refresh) and writes Delta (`deltalake`; on B2 write locally then upload); the product is an asset of its own, grantable without its base tables, with lineage edges from them; Delta versions are its history; masks applied at publish time | Proposed |

## 7. Risks and open questions

- **Job start-up is the latency floor.** A query is as fast as a pod is to start. Mitigations in place: the quick profile, no internal-key/HF token work, the `query` command skips connector imports, optional interactive priority class. Not yet: extensions baked into the CLI image (they come from the uv-cache volume after first use). Measure before phase 5.
- **Grants on single resources are new to IAM.** They are evaluated per request from the principal's grants (no extra lookups) and listed among the workspace's grants. Removing a source or asset leaves its grants behind, harmless but untidy: clean up with the asset purge in phase 3, together with the asset's GOV rows (owners, annotations, quality rules).
- **Masking is display protection, not anonymisation** (as the POC noted): someone who can query a column can infer from it. Phase 3 hides by default what GOV classifies (detectors' findings, or a steward's override).
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
- End to end on the dev stack with sign-in on (2026-11-09, workspace `lakehouse-lab`, a tenant admin): switched on in Settings → General; the SQL page lists 8 sources and their tables with the right marks (Lance, Paimon and Trino tables shown as not queryable, with the reason); `SELECT … FROM lab_s3_tables.tables.delta_orders JOIN lab_polaris_iceberg_rest.crm.orders … (SELECT count(*) FROM lab_ducklake.crm.people)` ran as a Kubernetes Job and came back through the callback: 11 rows, the row the lab deleted from the Delta table absent, 3 tables recorded on the run and in `audit_events`. Refusals came back with their codes (`function_not_allowed`, `table_not_available` for a missing table and for a Lance table, `select_only`, `execution_error` for an unknown column). Asset → Data tab ran `SELECT * FROM shop_lake.shop.orders`; a table grant to a group was given, listed and removed from the panel.
- Latency through a Job on k3d: 10–20 s per query (pod start dominates; setup 1.7–5 s inside, the query itself under 0.4 s); the first query after the image was pulled took 44 s (optional groups installed). Refusals cost a whole job too (7–15 s): a cheap validation in the API before starting a job is worth adding.
- Fixed while testing: the migration had been applied before `callback_token_hash` was added to it, so the column moved to its own migration (`20261109130000_query_run_callback_token`); polling now rides out gateway errors for 90 s (an API restart dropped the port-forward mid-run); dates and timestamps from Arrow are shown as dates, not epoch milliseconds; `?tab=data` opens the Data tab (the tabs remount once it is known).
- Then, the same day: **API pre-check** (`sql-precheck.ts`): one statement, a read-only start, no file/table functions, no full name of a table of a known source that is not granted — refused at once with the job's codes, the job's SQLGlot gate still the authority; **export** (§5.6); **large tables** (§5.6); **Helm** query-job values and the `interactive` priority class; **the CLI image** syncs `file-processing` and `lineage` and ships the DuckDB extensions in `/opt/duckdb-extensions` (`CLASSIFYRE_DUCKDB_BAKED_EXTENSION_DIR`, loaded before the shared cache or INSTALL; +356 MB of extensions); **persona checks** `D` in `scripts/dev/iam-personas.sh` (17 checks; the whole suite 83/83 on a throwaway release, 2026-11-09); **Playwright** steps in `apps/e2e/tests/smoke.spec.ts` with `docker/fixtures/smoke/orders.csv` (7/7 against the dev stack: SQL off → on, a GROUP BY on the SQL page, Excel download, CSV through the API, a refusal; the viewer locked, then given the one table, querying it from the Data tab, refused an export). On the dev stack refusals now answer in 20–100 ms instead of 7–15 s; an Excel export of `shop_lake.shop.orders` opened with 12 rows and real dates.
- Not verified: a full build of the CLI image with the baked groups and extensions (the extension step was run locally and `docker build --check` passes); the image grows by the two groups and 356 MB of extensions.

### Phase 4, SQL connections, 2026-11-13

- **Code**: API `src/sql-connections/` (service, controller, DTOs, `scram.ts`), `src/sql-gateway/` (listener, `pg-protocol.ts`, `pg-session.ts`, `pg-types.ts`, `catalog-ddl.ts`, `pglite-host.ts` + `pglite-worker.ts`, `proxy-protocol.ts`), `src/identity/principal-context.ts`, `src/data-query/connection-scope.ts`; migration `20261113130000_sql_connections`; dependencies `@electric-sql/pglite` 0.5.16 and `apache-arrow` 21 in the API. CLI gate `dialect=postgres`. Web `components/sql-connections/`, `components/governance/access-card.tsx`, Settings tab *SQL connections*, *Connect a tool*. Helm `sqlGateway` (Deployment, Service, generated CA or existing Secret or cert-manager, Traefik `IngressRouteTCP`), Docker entrypoint (port 5433, CA under `/var/lib/classifyre/sql-tls`). Docs page *SQL Connections*; smoke kit `development/sql-gateway-smoke/` (JDBC program, psql and isql lines); `SQL_GATEWAY_TRACE=true` logs a session's message types, statements and errors (never values).
- **Spike**: PGlite in a worker thread starts from a per-workspace template in 0.8–2 s and holds ~150 MB, freed when the thread ends; one instance per session (no sharing: prepared statements, portals and settings are per connection). Loading results into PGlite (1M rows: 7.7 s, +1.5 GB) was dropped for encoding rows in the gateway.
- **Each session runs as a role named after the connection** with USAGE/SELECT on its schemas: `current_user` is the connection, and writes fail with `permission denied` (42501) instead of landing in the empty catalog tables.
- **Found while testing**: unsynced internal messages before a simple Query left PGlite in a transaction (`T`), so psqlODBC wrapped every statement in a SAVEPOINT and failed — internal messages in a simple query now end with their own Sync; a direct-TLS ClientHello put back on the socket was lost while it kept flowing (paused now); cancelling a job raced with the job's exit (now marked cancelled first) and ran outside the workspace context.
- **Verified on the dev stack** (2026-11-13, skaffold, `lakehouse-lab`; gateway port-forwarded to `localhost:25432` because 15432 was taken on the machine): signed in as `admin`, created *DBeaver* in Settings (password shown once, CA downloaded); psql 18 with `verify-full` over TLS 1.3 (ALPN `postgresql`, SCRAM), also with `sslnegotiation=direct`; plaintext and a wrong password refused; `\dn`/`\dt`/`\d+` list the workspace's source schemas and GOV's business names as column descriptions; data from the Azure Delta table, a search-path query on S3 Delta (11 rows), errors with their SQLSTATEs. pgJDBC 42.7.11 (DBeaver's driver): getSchemas/getTables/getColumns with remarks, `SELECT *` (14–15 s per data statement, the job start dominating), a server-prepared parameterised count in binary, fetch-size 2 portals, unknown column 42703, `DELETE` 42501, cancel 57014 after 2.9 s, session usable after. psqlODBC (`isql`): count and filtered rows. Governance tab *Access* on `delta_orders`: the connection with its reads; *Close here* removed the table from the connection's catalog and reads, other tables kept working; lifted again; Usage "Through: SQL connections 15 · the app 4"; Activity reads as `channel sql`, `via sql-connection`, `connection:<id>`, the actor resolving to *via DBeaver*; block/unblock recorded with what changed. As admin, gave `test` a connection for the S3 `delta_orders` only; `test` got the GOVERNANCE notification, revealed the password, saw exactly that one table though a tenant admin, and was refused the Azure one; revoking it ended a live session within 30 s and refused new sign-ins.
- **Not verified**: Npgsql/Power BI, Excel and Tableau themselves (desktop apps, no Npgsql runtime here), Traefik on k3d (no Traefik in the dev cluster), the all-in-one image build with the gateway, a non-admin persona whose rights come from a table grant (unit-tested scope logic; `test` is a tenant admin), and managers' *Everyone's* view beyond rendering.

