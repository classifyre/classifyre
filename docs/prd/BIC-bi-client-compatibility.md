# PRD BIC · BI clients over SQL connections: Metabase, pgJDBC, psqlODBC

|                  |                                                                                                                                                                                                                                         |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**       | BIC0 built and run 2026-11-21, plus the BIC2 fixes it forced (sign-in under pools, portal paging, cursors, qualified columns, memory guard) and a first client corpus (BIC1). Npgsql, M6, M10, M11 and the skaffold profile still open (§9). |
| **Size**         | M (4 phases, BIC0–BIC3)                                                                                                                                                                                                                 |
| **Depends on**   | [DQ](DQ-data-query.md) §5.7 (SQL connections, the gateway in `apps/api/src/sql-gateway/`), the warm query worker (DQ §5.3)                                                                                                             |
| **Used by**      | [QC](QC-query-connectors.md) (connector tables over SQL connections are checked here)                                                                                                                                                   |
| **Starts from**  | The payload proof of concept `fedsql` (outside this repository: `poc-payload`), commits `eb5e750` (psqlODBC 18 / Excel), `bc493ab` (Metabase / pgJDBC), `0e9fe8f` (BI findings, test plan, trace tools), reviewed 2026-11-21 |
| **Not in scope** | Windows desktop apps themselves (Power BI Desktop, Excel for Windows, Tableau Desktop): their drivers are tested instead (Npgsql, psqlODBC, pgJDBC). Writing through SQL connections. Metabase as a product feature of Classifyre. |

## 1. Summary

SQL connections (DQ phase 4) were verified by hand on 2026-11-13: psql, pgJDBC 42.7.11 through `JdbcSmoke.java`, and psqlODBC with `isql`. They were never verified with a real BI tool, and nothing guards them against the next driver version. The kit `development/sql-gateway-smoke/` is a README of manual steps.

In the proof of concept, the first real BI tool (Metabase v0.65.6.2 over pgJDBC) and psqlODBC 18 found ten bugs. Metabase connected and ran native SQL, but its schema sync found **0 tables**, so its query builder was unusable. Most of those bugs were in the POC's emulated catalog, which Classifyre does not have: the Classifyre gateway answers every catalog question with **PGlite**, a real PostgreSQL. The bugs on the *data* path, however, reach Classifyre's path too: types, qualified names, functions, time zones, cursors and concurrency.

This PRD gives Classifyre:
1. An **automated smoke run** on the skaffold dev stack. It drives the same open-source BI tool, Metabase, plus the real drivers (psqlODBC 18, pgJDBC, Npgsql, psql) against the `lakehouse-lab` workspace, checks every answer against Classifyre's own REST query, and writes evidence.
2. A **client statement corpus** with CI tests that replay what each client sends, without a cluster. The next driver version that breaks something becomes a failing spec, not a support ticket.

## 2. What the proof of concept found, and what it means here

The POC's gateway was a hand-written PostgreSQL server, `pgwire.py`. It emulated `pg_catalog` and `information_schema` in a second DuckDB and ran every other statement in DuckDB through sqlglot. Classifyre's gateway is built differently (DQ §5.7):
- every message goes to a per-session PGlite that holds the person's catalog as empty tables;
- `classifyre.reads()` explains a statement to see whether it reads data;
- a data statement goes to a query run (gate with `dialect: postgres` → DuckDB → Arrow);
- the gateway encodes the Arrow result in the types **PGlite described**.

So:

| POC ID | What broke in the POC | In Classifyre | Becomes |
| --- | --- | --- | --- |
| F1 (P1) | psqlODBC 18 `SQLColumns` uses `a.attnum OPERATOR(pg_catalog.>) 0`; sqlglot kept it, DuckDB failed | PGlite parses it natively | Regression case D2, corpus |
| F2 (P1) | DOUBLE columns (`avg()`, `round()`) sent as text (OID 25); DECIMAL announced as text | **Applies, in a different form**: PGlite describes the result type from PostgreSQL's rules, DuckDB computes it by its own. `avg(integer)` is `numeric` in PostgreSQL and `DOUBLE` in DuckDB; `round(double precision, integer)` does not exist in PostgreSQL (PGlite refuses it at Parse); `sum(integer)` is `bigint` in PostgreSQL and `HUGEINT`/`INT128` in DuckDB; DuckDB `DECIMAL(38,s)` against `numeric` | **Type-agreement tests** (§6.3); fixes in `pg-types.ts` |
| F3 (P1) | `BEGIN READ ONLY` failed to parse, which broke the transaction and every later statement | PGlite handles transactions | Regression J5, corpus |
| F4 (P2) | `SET SESSION CHARACTERISTICS AS TRANSACTION ISOLATION LEVEL READ UNCOMMITTED` refused | PGlite accepts it | Regression M1, corpus |
| F5 (P1) | Metabase's table-permission CTE (`has_table_privilege`, `has_any_column_privilege`, `pg_matviews`, reserved-word aliases `as select`) | PGlite answers it. The session role has USAGE/SELECT on its schemas (DQ §9, phase 4), so every open table should report `select = true` | Regression M1: Metabase must see **every open table**, which needs the privilege answer to be true |
| F6 (P2) | `pg_stat_user_tables`, `pg_enum`, `table_constraints`, `key_column_usage` | Real in PGlite (empty or truthful) | Corpus |
| F7 (P2) | `format('%s', …)`, `CAST(… AS oid)`, `x = ANY(array)` | Real in PGlite | Corpus |
| F8 (P2) | pgJDBC `getPrimaryKeys` via `information_schema._pg_expandarray` | Real in PGlite | Regression J1 |
| F9 (P2) | `information_schema.columns.udt_name` reported DuckDB names | PGlite reports the types of `catalog-ddl.ts`'s empty tables | Check that `catalog-ddl.ts` types match what the job returns (§6.3) |
| F10 (P1) | `SELECT "shop.public"."customers"."id" FROM "shop.public"."customers"`: only the table qualifier was mapped | **Applies**: PGlite accepts it, but the gate (`gate.py`, `dialect='postgres'`) must resolve **column qualifiers** of the form `"src.sch"."tbl"."col"`, not only table names | Gate test (§6.2), M2 |
| O1 (P2) | List columns announced as `text`; Metabase's fingerprint `SUBSTRING(tags, 1, 1234)` fails and the whole table is not fingerprinted | **Applies**: `catalog-ddl.ts` types list columns as arrays, so check whether Metabase still issues `SUBSTRING` on them and whether DuckDB accepts what it sends instead | M9 |
| O2 (P2) | `PERCENTILE_CONT` / `PERCENTILE_DISC` not allowlisted: median and percentiles fail | **Applies**: not in `SAFE_FUNCTIONS` (`gate.py`). PostgreSQL's `percentile_cont(0.5) WITHIN GROUP (ORDER BY x)` must map to DuckDB's `quantile_cont(x, 0.5)` | M8, fix in BIC2 |
| O4 (P2) | `SET TIME ZONE` accepted, ignored; DuckDB in UTC | **Applies**: PGlite keeps the client's `TimeZone`; the job does not get it | M7: pass the session `TimeZone` in the run request, set it in DuckDB (`SET TimeZone`), or refuse non-UTC zones clearly; decide in BIC2 |
| O5 (P2) | One BI connection = one role; Metabase stores field values; no `SET ROLE` impersonation | **Applies as governance**: one Metabase database = one SQL connection = one Classifyre person. Every Metabase user reads with that person's rights; Metabase caches the (masked) field values it scans | Docs (§5.4), M5 |
| O6 (P2) | Text results only; Npgsql binary a risk | Classifyre encodes binary (DQ §5.7) | N2 |
| O7–O8 (P3) | No PK/FK, no row estimates | Same: empty constraints, `reltuples` 0 | Known, documented |
| O9 (P1) | Catalog emulation is a whitelist; any driver version can break it | Mostly gone (PGlite). The **data path** still has a whitelist: the gate's grammar and `SAFE_FUNCTIONS` | The corpus (§6) is the guard |
| F03, F05 (review) | BI results fully materialised; Describe executes the query | Results are capped and refused over the cap (SQLSTATE 54000). Describe should be answered by PGlite from empty tables without a job | Check in the corpus spec: Describe of a data statement starts **no** run |

New risks the POC could not see, because Classifyre adds things it did not have:

| Risk | Why | Check |
| --- | --- | --- |
| **Session cap vs connection pools** | `sqlGateway.maxSessionsPerConnection` is 4 (`helm/classifyre/values.yaml`). Metabase's pool for a data warehouse defaults to 15 (`MB_JDBC_DATA_WAREHOUSE_MAX_CONNECTION_POOL_SIZE`). Each session is a PGlite of about 150 MB | M12: a six-card dashboard with Metabase's defaults; the docs give the pool setting |
| **Per-person query cap** | `QUERY_MAX_ACTIVE_PER_PERSON` (default 3, across channels; `query-run.service.ts`). A dashboard or a sync running more queries in parallel gets `TOO_MANY_QUERIES` | M12. Decide in BIC2: queue SQL-connection statements for a short time (for example up to 10 s) instead of refusing them |
| **psqlODBC cursors** | With `UseDeclareFetch=1` psqlODBC sends `DECLARE "SQL_CUR…" CURSOR WITH HOLD FOR SELECT …` then `FETCH 100 IN …`. `classifyre.reads()` must see the inner SELECT, and the gateway must serve FETCH from the run's result | D5 |
| **Mixed catalog + data** | Refused by design (DQ §5.7). Metabase or Tableau may join a data table with `pg_catalog` | Corpus; documented if it happens |
| **Warm worker cancel** | CancelRequest → `cancelConnectionRun` → `QueryWorkerClient.cancel` (drops the HTTP request; the worker kills the process) | M11, J8 |
| **Masks in BI caches** | Metabase stores field values and fingerprints; Power BI imports | M5: only masked values ever appear in Metabase's own database |

## 3. Requirements

| # | Requirement |
| --- | --- |
| R1 | One command runs the whole BI smoke against the skaffold dev stack and the `lakehouse-lab` workspace and exits non-zero on any failed check: `scripts/dev/bi-smoke.sh`. |
| R2 | Metabase, pinned to the version the POC used, connects over TLS (`verify-full`) with a real SQL connection, syncs every table open to that connection, and passes the §5 checks with **zero sync errors** in its log. |
| R3 | psqlODBC 18, pgJDBC 42.7.x, Npgsql and psql 18 pass their §5 checks from inside the cluster. |
| R4 | Every data answer is compared with the same query run through Classifyre's REST API as the same person: same rows, same values, compatible types. |
| R5 | No unmasked value of a masked column appears anywhere: results, Metabase's stored field values, downloads, logs. |
| R6 | Every statement each client sends is captured (`SQL_GATEWAY_TRACE`, statements only, never bound values) into a versioned **client corpus**, and CI replays it without a cluster. |
| R7 | A bug found by the smoke is fixed with a failing corpus or unit test first. |
| R8 | Latency is measured: Metabase card p95 under 3 s for native sources and under 5 s for connector sources ([QC](QC-query-connectors.md)), through the warm worker. |

## 4. The smoke harness

### 4.1 Layout

```
development/bi-smoke/                      (new)
  README.md                                how to run, what each check means, how to add a client
  Chart.yaml, values.yaml, templates/      Helm chart, like development/odbc-smoke/
    metabase.yaml                          Deployment + Service (ClusterIP 3000)
    drivers-job.yaml                       Job running the drivers image (rendered on demand)
  drivers/
    Dockerfile                             psqlODBC 18 + unixODBC + pyodbc, JDK 21 + pgJDBC 42.7.x, .NET 8 + Npgsql, psql 18
    odbc_checks.py                         D1–D8
    JdbcChecks.java                        J1–J8 (grows from development/sql-gateway-smoke/JdbcSmoke.java)
    npgsql/                                N1–N4 (a small console app)
    psql_checks.sh                         P1–P3
  bi_smoke.py                              orchestrator (uv script; httpx, psycopg)
  checks/metabase.py                       M1–M13 via Metabase's REST API
  expected/                                reference queries (SQL against Classifyre names) per check
scripts/dev/bi-smoke.sh                    (new) wrapper: build drivers image into k3d, helm upgrade, run bi_smoke.py
```

Skaffold gets an optional profile **`bi-smoke`**. It is never active by default; `skaffold dev -p dev,bi-smoke` adds the `development/bi-smoke` release to namespace `classifyre-dev` and port-forwards Metabase to `localhost:3030`, so a person can look at what the run did.

### 4.2 Metabase

- Image `metabase/metabase:v0.65.6.2`, the version that found F3–F10. Bump it deliberately, with a corpus capture (§6.4).
- Environment:
  - `MB_ANON_TRACKING_ENABLED=false`, `MB_CHECK_FOR_UPDATES=false`
  - `MB_DB_TYPE=h2` on an emptyDir (throwaway)
  - `JAVA_OPTS=-Xmx1g`
  - `MB_JDBC_DATA_WAREHOUSE_MAX_CONNECTION_POOL_SIZE` left at the default for M12, then set to 4 for the rest
- Reaches the gateway in-cluster at `classifyre-sql-gateway.classifyre-dev.svc:5432`. The chart's generated certificate already names the Service (`helm/classifyre/templates/secret-sql-gateway-tls.yaml`), so `verify-full` works. The CA comes from `GET /api/<ws>/data-connections/endpoint` (`caCertificate`) and is mounted from a ConfigMap that `bi_smoke.py` creates.
- Added as a database through `POST /api/database` with:

  ```json
  { "engine": "postgres",
    "details": { "host": "classifyre-sql-gateway.classifyre-dev.svc", "port": 5432,
                 "dbname": "lakehouse-lab", "user": "<connection user>", "password": "<revealed>",
                 "ssl": true, "ssl-mode": "verify-full", "ssl-root-cert-options": "local",
                 "ssl-root-cert-path": "/ca/ca.crt" },
    "is_full_sync": true, "is_on_demand": false }
  ```

  No `binaryTransfer=false`: Classifyre encodes binary, unlike the POC.
- Recommended settings, which the docs repeat (§5.4): scan field values *Only when adding a new filter widget*, and refingerprinting off.

### 4.3 The orchestrator `bi_smoke.py`

1. **Preflight**: API at `localhost:8811`, the gateway Service, the `lakehouse-lab` workspace (create it with `development/lakehouse-lab/workspace.py` if missing), Metabase ready.
2. **Arrange through the API** (`API_TOKEN`, as `workspace.py` uses):
   - Open the test tables to SQL connections (`data_connection_exposures`): S3 Delta `delta_orders`, Azure Delta, Polaris Iceberg, DuckLake, a CSV file table, `iceberg_contacts` (masked `contact`), and the QC tables when present (`lab_meilisearch.indexes.movies`, `lab_neo4j.relationships.rated`).
   - Create connections: `bi_admin` for the admin, and `bi_viewer` for the smoke persona (Viewer + Data reader on two tables, a row filter on one, a masked column; the same persona as `scripts/dev/iam-personas.sh`). Reveal each password once.
   - Save the CA.
3. **Metabase**: `/api/setup` (first run) or `/api/session`, add both databases, `POST /api/database/:id/sync_schema`, poll `/api/database/:id/metadata` until the tables appear (timeout 5 min), then run M1–M13 (§5.1).
4. **Drivers**: render and run the `drivers` Job with the connection details as a Secret; collect its JSON report from the pod log (one `__BI_SMOKE__ {json}` line per check).
5. **Reference**: for every check with data, run the same SQL through `POST /<ws>/query-runs` as the same person (the REST channel) and compare. Rows are compared order-insensitively unless the query orders; numbers within 1e-9 relative; timestamps as UTC instants.
6. **Logs**:
   - `kubectl logs deploy/bi-smoke-metabase` since the run started: grep `ERROR` and `sync` failures (M1 fails on any).
   - The gateway's log for refusals.
   - Check that no masked value appears (R5): the reference rows give the raw values the admin sees, and none of them may appear in the viewer's outputs or in Metabase's H2 field values (`GET /api/field/:id/values`).
7. **Capture** (`--capture`):
   - Before the run, `kubectl set env deploy/classifyre-sql-gateway SQL_GATEWAY_TRACE=true`.
   - After the run, extract each session's statements from the gateway log, keyed by the client's `application_name` (Metabase sends `Metabase v0.65.6.2 [<uuid>]`; the drivers set their own).
   - Write them to the corpus (§6.1) as new or changed files for review.
   - Turn the trace off.
8. **Evidence**: `development/bi-smoke/.evidence/<date>-<git sha>.json` (gitignored) with every check, its timing, its pass/fail and the versions. A summary table goes to stdout in the shape of §5, ready to paste into §9 *As built*.
9. **Clean up**: revoke both connections, close the exposures it opened, remove the persona's temporary grants (`--keep` keeps them for a look in Metabase).

## 5. The checks

Each check has an ID that the evidence, the corpus and §9 use. *Ref* means compared with the REST reference (R4).

### 5.1 Metabase (pgJDBC inside)

| ID | Check | Expected |
| --- | --- | --- |
| M1 | Add database, full sync | Every table open to the connection appears (count = exposures ∩ scope), schemas named `"<source>.<schema>"`, base types right (BigInteger, Float, Decimal, Text, Date, DateTime, DateTimeWithTZ, Boolean, Array, JSON). Zero `ERROR` lines for the sync. GOV descriptions appear as field descriptions |
| M2 | Table preview in the query builder (raw data, first 2,000 rows) | Works for every table; the SQL Metabase sends uses `"src.sch"."tbl"."col"` (F10). *Ref* |
| M3 | Query builder: count grouped by a text column; filter (`=`, `IN`, `between` dates) + sum; a join of two tables of **different sources** | *Ref* each |
| M4 | Native SQL: S3 Delta ⋈ Polaris Iceberg; with QC, Q1 and Q3 of QC §6 | *Ref*; time recorded |
| M5 | As `bi_viewer`: preview of `iceberg_contacts` | `contact` is `****`; `WHERE contact LIKE '%@%'` returns 0; `GET /api/field/:id/values` for `contact` holds only masked values (R5) |
| M6 | As `bi_viewer`: the row-filtered table | Only the rows the filter selects (*Ref* as the same person); the hidden column is absent from the synced schema |
| M7 | Types and time zone: `date`, `timestamp`, `timestamptz`, `decimal(p,s)`, `double`, `boolean`, `list`, `json`, `avg(int)`, `sum(int)`, `count(*)`; report time zone set to `Europe/Vienna` | Values equal *Ref*; no numeric column comes back as text (F2); `timestamptz` shown as the same instant (O4) |
| M8 | Median and percentile in the query builder | Works after BIC2 (O2); before, the refusal is `function_not_allowed` with a clear message |
| M9 | Field fingerprinting and binning on a numeric and a list column | No fingerprint error (O1); binning produces bins |
| M10 | Errors: a table closed to the connection mid-session; the connection revoked | The closed table's queries fail with a clear SQLSTATE; after revocation Metabase's next query fails at sign-in and a sync shows *authentication failed* |
| M11 | Cancel: a deliberately slow native query (a self-join of the lab's largest table on a non-key column, ordered; `generate_series` and other table functions are refused by the gate), cancelled from Metabase | The run ends `cancelled` within 5 s; the worker frees its slot (`/metrics` `classifyre_query_worker_active`) |
| M12 | A dashboard with six cards (native sources), loaded cold, with Metabase's default pool size and then with pool 4 | Records sessions opened, `TOO_MANY_QUERIES` refusals and card latencies. **Pass after BIC2**: all cards load, p95 < 3 s (R8) |
| M13 | Download a card's results as CSV over `max_rows` (10,000) | Refused with SQLSTATE 54000 and the cap in the message (DQ: never silently cut); with `data.export` the larger `export_max_rows` applies |

### 5.2 psqlODBC 18 (Excel's and Power BI's ODBC driver) with unixODBC and pyodbc

| ID | Check | Expected |
| --- | --- | --- |
| D1 | `SQLTables` | Every open table; `"<source>.<schema>"` as schema |
| D2 | `SQLColumns` on every table (psqlODBC 18 sends `OPERATOR(pg_catalog.>)`, F1) | Columns, ODBC type codes right (`SQL_DOUBLE`, `SQL_NUMERIC`, `SQL_TYPE_TIMESTAMP`, `SQL_WVARCHAR`), remarks = GOV descriptions |
| D3 | `SQLPrimaryKeys`, `SQLStatistics` | Empty result, no error |
| D4 | `SELECT` with and without a parameter, `UseServerSidePrepare=0` and `=1` | *Ref* |
| D5 | `UseDeclareFetch=1`, `Fetch=100` on a 500-row table | All 500 rows, in pages; *Ref* |
| D6 | Numeric results: `avg(int)`, `round(double, 2)` (DuckDB) and `round(numeric, 2)` (PostgreSQL), `sum(bigint)` | Returned as numbers, never text (F2) |
| D7 | Unicode text (umlauts, emoji) and `BoolsAsChar=0/1` | Round-trips |
| D8 | TLS `SSLMode=verify-full` with `pqopt={sslrootcert=…}`; wrong password | Connects; wrong password refused with 28P01 |

### 5.3 pgJDBC 42.7.x (DBeaver's, Tableau's and Metabase's driver)

| ID | Check | Expected |
| --- | --- | --- |
| J1 | `DatabaseMetaData`: `getSchemas`, `getTables`, `getColumns` (remarks), `getPrimaryKeys` (`_pg_expandarray`, F8), `getImportedKeys`, `getTypeInfo` | No errors; shapes as PostgreSQL |
| J2 | Server-prepared parameterised statement, binary transfer on (default) | *Ref*; types decode in binary |
| J3 | `setFetchSize(2)` in a transaction (portals) | All rows |
| J4 | `prepareThreshold=0` (simple protocol) | *Ref* |
| J5 | `setReadOnly(true)` → `BEGIN READ ONLY` (F3); `SET SESSION CHARACTERISTICS …` (F4) | Accepted; later statements work |
| J6 | Unknown column; `DELETE` | 42703; 42501; session usable after |
| J7 | `timestamptz` with `TimeZone=Europe/Vienna` in the startup options | Same instant as *Ref* (O4) |
| J8 | `setQueryTimeout(2)` on a slow query | 57014 within about 3 s; session usable after |

### 5.4 Npgsql (Power BI's driver) and psql

| ID | Check | Expected |
| --- | --- | --- |
| N1 | `GetSchema("Tables")`, `GetSchema("Columns")` | No errors |
| N2 | Binary reads of every type of M7 | Decodes; *Ref* |
| N3 | `SELECT version()`, `SHOW server_version`, and the statements Power BI's connector sends at connect (captured once in BIC3 from a Windows machine, or from the Power Query SDK, and added to the corpus) | No error |
| N4 | `timestamp` vs `timestamptz` with Npgsql 6+ semantics (`Kind=Utc`) | Correct kinds |
| P1 | psql 18 `verify-full`, and `sslnegotiation=direct` | Connects (TLS 1.3, SCRAM) |
| P2 | `\dn`, `\dt *.*`, `\d+ "<src>.<sch>".<tbl>` | Lists; masked columns say *Masked (kind)* |
| P3 | A data query, `\copy (…) to stdout` | *Ref*; COPY is refused or works, and either way the result is documented |

### 5.5 Docs that come out of the run

`apps/docs/app/sql-connections/page.mdx` gets a section *BI tools*:
- Metabase settings: pool size at or below `maxSessionsPerConnection`, field-value scans, the CA.
- One SQL connection is one person (O5): give a BI tool a connection of a person or group whose rights every user of that tool may have.
- psqlODBC options (`UseDeclareFetch`, `UseServerSidePrepare`).
- JDBC and Npgsql connection strings.
- What is known not to work (O7, O8, and any check still failing after BIC2).

## 6. Regression tests for the future (CI, no cluster)

### 6.1 The client corpus

```
apps/api/src/sql-gateway/fixtures/client-corpus/       (new)
  README.md                     format, how to capture, how to add a client
  metabase-0.65.6.2.sql
  pgjdbc-42.7.11.sql
  psqlodbc-18.00.0006.sql
  npgsql-<version>.sql
  psql-18.sql
```

Each file is a list of statements exactly as the client sent them, separated by a line `-- @@ <kind> <label>`, where `<kind>` is `catalog`, `data`, `session` (SET/BEGIN/SHOW) or `refused`. Statements are captured, not written, and they never contain values a person typed: the trace never logs bound parameters, and literals in data statements of the capture are replaced by the fixture workspace's names (§6.2).

The first version is seeded from the POC's captured statements:
- psqlODBC 18's `SQLColumns` query with `OPERATOR(pg_catalog.=)` and `OPERATOR(pg_catalog.>)`
- Metabase's table-permission CTE with `has_table_privilege`, `has_any_column_privilege`, `has_schema_privilege`, `pg_matviews` and `t.schemaname !~ '^pg_'`
- `SET SESSION CHARACTERISTICS AS TRANSACTION ISOLATION LEVEL READ UNCOMMITTED`
- `BEGIN READ ONLY` / `COMMIT`
- `information_schema._pg_expandarray(con.conkey)` (getPrimaryKeys)
- `format('%s', udt_name)`
- `a.attnum = ANY(c.conkey)`
- the fully qualified preview `SELECT "src.sch"."tbl"."col" FROM "src.sch"."tbl" LIMIT 2000`

The rest comes from the first `--capture` run (BIC0).

### 6.2 Specs

| Spec | What |
| --- | --- |
| `apps/api/src/sql-gateway/pg-session.client-corpus.integration.spec.ts` (*new*) | Builds a fixture workspace catalog with `catalog-ddl.ts` (three sources, five tables, a masked column, a GOV description) in a real PGlite (as `pg-session.integration.spec.ts` does). For every corpus statement: `catalog` and `session` statements run with no error and, where labelled, give the expected shape (for example the permission CTE returns `select = true` for every table, M1); `data` statements are classified as data by `classifyre.reads()` and handed to a fake `DataRunner` with the expected tables; `refused` ones get their SQLSTATE. A Describe of every `data` statement starts **no** run (F05) |
| `apps/cli/tests/test_query_bi_dialect.py` (*new*) | Loads the corpus's `data` statements (the same files, read from the repository) and passes each through `gate.validate(sql, tables, dialect="postgres", database=…, search_path=…)` with the fixture names: accepted ones run in DuckDB over local fixture files with the same tables (Parquet/CSV), and their Arrow types are recorded; refused ones must carry the code the corpus says. Covers F10 qualifiers, `percentile_cont … WITHIN GROUP`, `date_trunc`, `CAST(x AS date)`, `EXTRACT`, Metabase's `CASE`/`COALESCE` patterns |
| `apps/api/src/sql-gateway/pg-types.agreement.spec.ts` (*new*) | The **type-agreement table**: for each expression of a fixed list (`avg(int)`, `sum(int)`, `sum(bigint)`, `count(*)`, `round(numeric,2)`, `x / y` on integers, `decimal(38,10)`, `date_trunc('month', ts)`, `ts AT TIME ZONE …`, `array_agg`, `json` fields), the OID PGlite describes and the Arrow type DuckDB returns (recorded by `test_query_bi_dialect.py` into `fixtures/client-corpus/arrow-types.json`), and that `pg-types.ts` encodes the second into the first in text **and** binary without error and without losing value (for example DuckDB `DOUBLE` into PostgreSQL `numeric`, `HUGEINT` into `numeric`, `DECIMAL(38,s)` into `numeric`). Where they cannot agree, the expected behaviour is a clear refusal, never a wrong value |
| `apps/e2e/tests/smoke.spec.ts` (extended) | A small step *SQL connection*: create a connection through the API, open `orders.csv`'s table, connect with the npm `pg` client over TLS (CA from the endpoint), run one catalog query (`information_schema.tables`) and one data query, compare with the SQL page's result. Runs for both `SMOKE_TARGET=k8s` and `docker`, so the all-in-one image's gateway (port 5433) is covered too |

`test_query_bi_dialect.py` writes `arrow-types.json` and the TypeScript spec reads it, so the two languages agree on one recorded truth. A CI step runs the Python test first (the API job already depends on the CLI job), or the file is committed and regenerated by `bun --filter api corpus:types` (*new* script) when the corpus changes.

### 6.3 Where the fixes for type disagreements go

- `apps/api/src/sql-gateway/pg-types.ts`: the encoders accept a wider Arrow type for the described OID (`DOUBLE` → `numeric` text and base-10000 binary; `Int128`/`Decimal128` → `numeric`; `Int64` → `int4` refused over range).
- Where PostgreSQL and DuckDB disagree on *existence*: for example `round(double precision, integer)` is a DuckDB function that PGlite refuses at Parse. That is not fixable without changing what PGlite plans. It is documented, and Metabase does not send it: it sends `round(CAST(x AS numeric), 2)`. The corpus records which variant each client sends.

### 6.4 The workflow when a client breaks

Written into `development/bi-smoke/README.md` and the corpus README:

1. Reproduce: `scripts/dev/bi-smoke.sh --capture --only <check>` (or connect the client by hand with `SQL_GATEWAY_TRACE=true`).
2. Find the statement in the capture diff, and add it to the corpus file of that client and version (a new file for a new version).
3. Run the specs: the statement fails in `pg-session.client-corpus` or `test_query_bi_dialect`. Fix the gateway, the gate or `pg-types.ts` until it passes.
4. Run the smoke again, then record the result in §9.

A Metabase or driver version bump is the same process: bump the image or jar version, capture, review the corpus diff, and fix what fails.

## 7. Phases

| Phase | What | Done when |
| --- | --- | --- |
| BIC0 | **Harness**: `development/bi-smoke/` (chart, Metabase, drivers image, orchestrator, checks), skaffold profile `bi-smoke`, `scripts/dev/bi-smoke.sh`, capture. First full run on skaffold `lakehouse-lab` | The run completes end to end and writes evidence; every check has a result (pass or fail with its error); the first capture is in the corpus |
| BIC1 | **Corpus and specs**: corpus seeded from the POC and the capture; `pg-session.client-corpus.integration.spec.ts`, `test_query_bi_dialect.py`, `pg-types.agreement.spec.ts`, the e2e step | Specs in CI; they fail exactly where BIC0's checks failed (each failure has a spec) |
| BIC2 | **Fixes** for what BIC0 found. Expected, to be confirmed by the run: gate column qualifiers (F10); type agreement (F2); `percentile_cont/disc … WITHIN GROUP` → `quantile_cont/disc` (O2); the session `TimeZone` passed to the job (O4); `DECLARE … CURSOR` / `FETCH` (D5); SQL-connection statements **wait** (bounded) for a free per-person slot instead of `TOO_MANY_QUERIES` (M12); docs (§5.5) | All M, D, J, P checks pass on skaffold, or are listed in §9 as known with the reason and a follow-up; R8 latencies met |
| BIC3 | **Npgsql and Power BI**: the N checks; the Power BI connector's connect statements captured once (Windows or the Power Query SDK) into the corpus; optionally a nightly CI job that runs `bi-smoke.sh` on a k3d runner | N checks pass; the Power BI statements replay in the corpus spec |

## 8. Risks and open questions

- **Metabase changes what it sends** with every release. The pin and the capture-on-bump workflow (§6.4) are the answer; the corpus keeps old versions' files, so a fix for a new version does not break an old one.
- **PGlite's PostgreSQL is not the client's expectation of a server version.** Some clients branch on `server_version`. Record what the gateway reports, and keep it stable.
- **Queueing instead of refusing** (BIC2, M12) changes DQ's per-person cap semantics for one channel. The proposal: a SQL-connection statement waits up to `SQL_GATEWAY_QUEUE_SECONDS` (10) for a slot, then fails with 53300 *too many queries*. Decide before building.
- **One connection serves many Metabase users** (O5). That is a governance property, not a bug. Per-user impersonation (Metabase's *connection impersonation*, which uses `SET ROLE`) would need a role per person in PGlite and a way to bind it to Classifyre's rights. Out of scope; noted for later.
- **Session memory**: each session is a PGlite of about 150 MB; a pool of 15 is about 2.2 GB on the gateway pod (`sqlGateway.resources` in dev: 3Gi limit). M12 measures it.
- **Desktop apps remain untested**: Excel and Power BI Desktop themselves. Their drivers are covered; the statements their connectors add are captured once (BIC3).

## 9. As built

### BIC0–BIC2, 2026-11-21

- **Code.** Harness `development/bi-smoke/` (chart with Metabase v0.65.6.2 and the drivers Job, `drivers/` image with psqlODBC 18.00.0006, pgJDBC 42.7.11, psql 18, `bi_smoke.py`, README), `scripts/dev/bi-smoke.sh`. Gateway: `sign-in.ts` (sign-ins wait their turn), `sql-gateway.service.ts` (the guard covers only the password check; memory admission), `memory-guard.ts`, `pg-session.ts` (portals keep their statement; data cursors), `sql-text.ts` (`parseCursorStatement`). CLI gate `gate.py` (`_qualify_columns`). Corpus `apps/api/src/sql-gateway/fixtures/client-corpus/` (psqlODBC 18, Metabase 0.65.6.2) replayed in `pg-session.integration.spec.ts`. Docs: *Metabase* tab and *Tools that pool connections* on the SQL connections page. Fragments `changelog.d/sql-connections-*.fixed.md`.
- **Fixtures changed.** The `shop_lake` bucket's tables are broken in the lab (Delta "No files in log segment", Iceberg metadata gone), so the run reads the S3, Azure, Polaris and DuckLake lab tables; date, double, numeric, boolean and timestamptz come from expressions over `id` (which is what F2 is about anyway).

**Found and fixed** (each with a test that failed first, except the memory guard, written with its test):

| Check | Finding | Fix |
| --- | --- | --- |
| M0 | Metabase could not connect at all: its pool signs in several connections at once, and the one-sign-in-at-a-time guard (2026-11-16) refused the second with `53300 Another sign-in from here is under way`; the whole c3p0 pool failed | `SignInLockout.begin` waits (≤ 10 s) instead of refusing, and the guard is released once the password is checked, not after the session's PGlite started (`sign-in.spec.ts`) |
| M2, M3 (POC F10) | Query builder: `"src.sch"."tbl"."col"` → DuckDB `Referenced table "src.sch.tbl" not found`; fingerprinting failed with it (M1 errors, M9) | The gate rewrites column qualifiers with their table (`_qualify_columns`, 4-part DuckDB names; a qualifier of a table not read is refused) (`test_query.py`) |
| J3, M13 | **Silent truncation**: pgJDBC pages a portal of the *unnamed* statement and re-parses that statement for column metadata between pages; the gateway looked the portal's statement up by name, found the metadata query, forwarded the Execute to PGlite and answered "complete" after the first page (2 of 11 rows; Metabase downloads cut at 500 rows as complete-looking files) | A portal keeps the statement (and parameter types) it was bound from (`pg-session.integration.spec.ts`, *page by page*) |
| D5 | psqlODBC `UseDeclareFetch=1`: `DECLARE … CURSOR WITH HOLD FOR <select>` went to PGlite's empty tables: 0 rows | Data cursors: the query runs once as a job when declared, `FETCH n/ALL/NEXT` reads forward, `CLOSE`; non-hold cursors end with their transaction; over the cap refused at the FETCH that reaches it (`sql-text.spec.ts`, *data cursor*) |
| M5 | **Gateway OOM-killed** (exit 137, twice) with two Metabase pools: about 400 MB per busy session, not the ~150 MB measured idle; `maxSessions` 8 on 3 GiB cannot hold | Memory admission: a session is refused as busy (`53300`) when resident memory plus 450 MB per starting session would pass `SQL_GATEWAY_MAX_RSS_BYTES` (default `UNDER_PRESSURE_MAX_RSS_BYTES`) (`memory-guard.spec.ts`); no restart since |
| M12 | Metabase's default pool (15) against `maxSessionsPerConnection` 4: `This SQL connection has 4 sessions open already`, the pool fails | Documented: pool ≤ 4 (`MB_JDBC_DATA_WAREHOUSE_MAX_CONNECTION_POOL_SIZE=4`); the harness sets it |

**Found, not fixed yet**: the gate refuses `bool_and` (`function_not_allowed: LOGICAL_AND`); the JDBC startup option `-c TimeZone=Europe/Vienna` is ignored (`SHOW TimeZone` says UTC; values still agree, Metabase converts itself); psql's `SHOW ssl` says `off` on a TLS session (PGlite's view); the trace cuts statements at 300 characters and does not log `application_name`, so captures need a window per client; a Metabase download over the cap is a broken file (the refusal arrives after the header) — refused, not cut, but give BI users `data.export` for bigger downloads.

**Last run** (`.evidence/20261121-1246-7281bbcc.json`, warm worker, pool 4): **30 pass, 0 fail, 3 not run**.

| Check | Result | ms |
| --- | --- | --- |
| D1–D8 | pass (D5: 11 rows via DECLARE/FETCH; D6 numbers typed) | 22–5,000 |
| J1–J8 | pass (J3: 11 rows through a 2-row portal; J8 cancel 57014 in 2.9 s) | 1,700–4,000 |
| P1–P3 | pass | ~2,600 |
| M1 | pass: 5 tables, right base types, 0 Metabase errors | 99 |
| M2 | pass: previews of all 5 tables, rows equal REST | 6,611 |
| M3 | pass: group-by, filter + sum, join through the query builder | 8,221 |
| M4 | pass: S3 Delta ⋈ Polaris Iceberg native, 1.4 s | 3,114 |
| M5 | pass: persona sees 2 tables, `contact` never in clear (preview, stored field values, `LIKE '%@%'` = 0) | 9,565 |
| M7 | pass: Decimal/Float/Boolean/Date, no number as text; timestamptz instants agree under report time zone Europe/Vienna | 4,783 |
| M8, M9 | pass: median; fingerprint and 6 bins | ~1,000 |
| M12 | pass: 6 cards in parallel, p95 2.3 s (3.0–3.7 s in other runs: at the edge of the 3 s target) | 2,280 |
| M13 | pass: over the cap the download is aborted (refused), never a short complete file | 2,323 |
| M6, M10, M11 | not run: row-filter persona, closing/revoking mid-session, cancel from Metabase (J8 covers cancel) | — |

- **Not verified**: Npgsql/Power BI (BIC3), the `bi-smoke` skaffold profile (not added; `scripts/dev/bi-smoke.sh` installs the chart itself), the all-in-one image's gateway with these fixes, a corpus from a fresh capture (the two files are seeded from the POC and adapted to the spec's fixture catalog).

## 10. Work breakdown for the developer agent

Work test-first where there is code (the `tdd` skill); the harness itself is tested by running it. One PR per phase, each with a `changelog.d` fragment, or the skip label for dev-only tooling (`release-notes` skill).

1. **Drivers image** (`development/bi-smoke/drivers/Dockerfile`). Pin psqlODBC `18.00.0006` (Debian/Ubuntu `odbc-postgresql` or built from source if the distribution lags), unixODBC, `pyodbc`, Temurin 21 + `postgresql-42.7.11.jar` (the version DQ verified) with a `PGJDBC_VERSION` build argument, .NET 8 SDK + Npgsql, and `postgresql-client-18`. Write `odbc_checks.py`, `JdbcChecks.java` (start from `development/sql-gateway-smoke/JdbcSmoke.java`), the Npgsql app and `psql_checks.sh`. Each prints one `__BI_SMOKE__ {"id", "ok", "ms", "detail", "rows"}` line per check.
2. **Chart** (`development/bi-smoke/`), modelled on `development/odbc-smoke/`: Metabase Deployment + Service, the drivers Job (behind a value), the CA ConfigMap and a connection Secret supplied by the orchestrator. Add the `bi-smoke` profile to `skaffold.yaml` (port-forward Metabase 3000 → 3030).
3. **Orchestrator** `bi_smoke.py` with the steps of §4.3, one module per check family (`checks/metabase.py`, …), the REST reference and the comparisons, the masked-value scan (R5), evidence, `--capture`, `--only`, `--keep`. Then `scripts/dev/bi-smoke.sh`: build the drivers image and `k3d image import` it, `helm upgrade --install`, run the orchestrator.
4. **First run (BIC0)** on skaffold with the lakehouse lab (`development/lakehouse-lab/README.md` steps, then `scripts/dev/start.sh`). Commit the capture as the first corpus files, and write the result table into §9.
5. **Corpus and specs (BIC1)** as in §6. Seed the POC statements by hand from §6.1's list; label each statement's kind; make the specs fail where BIC0 failed.
6. **Fixes (BIC2)**, one commit each with its spec red first:
   - `gate.py` column qualifiers;
   - `pg-types.ts` agreement;
   - `SAFE_FUNCTIONS` plus a rewrite of the ordered-set aggregates;
   - `TimeZone` in the run request (`query-run.service.ts` `createForConnection` → the request → `session.py` `SET TimeZone`);
   - cursors in `pg-session.ts`;
   - the bounded queue for the connection channel (decide first, §8).

   Run the smoke again after each.
7. **Docs** (§5.5) and `development/sql-gateway-smoke/README.md`: point to the new harness, and keep the manual steps for laptops without k3d.
8. **BIC3**: the Npgsql checks; capture Power BI's statements once; the optional nightly job.
9. **Update this PRD's §9**, its status row, and `README.md`.
