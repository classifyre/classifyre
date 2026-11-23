# Battle test: governed SQL access, masking and BI — Kestrel & Finch (2026-11-23)

A realistic scenario run end to end on the skaffold dev stack, against the
access, masking and SQL query features (DQ phases 1–6, BIC, QC). Everything the
scenario needed was built from scratch: an organization, groups and people, a
workspace, five sources of five kinds, scans, governance, grants, row filters,
an access request, a shared dataset, SQL connections, ODBC and psql clients
and a Metabase dashboard. Every bug that blocked the scenario was fixed in
place and the scenario re-run.

The scenario kit is `development/kestrel-finch/` (README there), the raw
evidence `development/kestrel-finch/.runs/` (battle JSON, screenshots, notes).

## Verdict

| Area | Ready? | Why |
| --- | --- | --- |
| SQL gate and engine isolation | **Yes** | 12 bypass attempts refused (file/table functions, hidden aliases, secrets, getenv, multi-statement, write CTEs, catalog snooping); filters cannot recover masked values; hidden columns cannot be named |
| Masks (redact, partial, hash, null, hide) | **Yes**, once columns are classified | Correct on REST, the SQL page, ODBC, psql, Metabase, MCP-equivalent paths; hashing is joinable across sources |
| Column classification from scans | **Now yes** (was **no**) | Bug 1: on any realistic table nothing was classified, so nothing was masked by default |
| Row filters | **Yes**, with a foot-gun | Region and consent filters held on every channel; fail-closed also hides rows from the tenant admin and from a dataset's owning group (bug 4) |
| Grants, groups, nested groups | **Yes** | Table and source grants, a parent group's Viewer reaching child groups, unmasked vs masked readers |
| Access requests | **Yes** | Routed to the owner, approved, effective within 2 s, audited |
| Shared datasets | **Now yes** (was **silently wrong**) | Bug 4: a dataset quietly lost two of its three inputs |
| SQL connections (gateway) | **Now yes** for dashboards (was **no**) | Bug 6: Metabase dashboards failed 4 of 5 cards on "gateway is busy" |
| ODBC sources | **Now yes** (was **broken**) | Bug 3: every query over an ODBC source failed |
| ODBC/psql/JDBC clients | **Yes** | psqlODBC (Excel/Power BI's driver), psql 18, Metabase (pgJDBC): 11 + 9 checks |
| Audit | **Yes** | Every read with person, channel, connection and the dataset it came through, also on the input table's activity |
| Findings vs masks | **Now yes** (was **no — blocker**) | Finding values follow the column rule (`finding.content` or reading the table in clear), on every surface; value searches closed (follow-up below) |
| Sharing with outsiders | **Now possible** (was **no**) | New role Data consumer; before, the only way in was Viewer, i.e. blocker 5 |

**Overall:** the query engine, gate, masks, row filters, grants, access
requests, gateway protocol and audit are solid and behaved exactly as the PRDs
say under adversarial use. The feature was **not production-ready on the day**
because of what feeds and surrounds it: classification silently failed on real
tables (masks then protect nothing by default), ODBC sources were unqueryable,
datasets could silently drop inputs, dashboards broke on the gateway's memory
admission, and findings expose the masked values. Six of these were fixed and
verified here; blocker 5 needs a product decision before a release that sells
masking.

## The scenario

*Kestrel & Finch Journeys*, a European tour operator: Kestrel Reisen (DACH,
HubSpot-style CRM, **PostgreSQL**) merged with Finch Tours (UK and Nordics,
**Salesforce export as Delta in S3**, with a GDPR erasure applied as a Delta
delete), plus the Wayfarer Club loyalty programme (**Iceberg via Apache
Polaris**), a support desk (**DuckLake**, two tickets with an AWS key and a
live Stripe key pasted in) and a legacy billing system (**PostgreSQL through
the ODBC source**, with a pre-tokenisation card vault). ~1,900 rows, ten tables,
deterministic (`seed/company.py`). One traveller, Margarethe Albrecht, is in
all five systems, with her e-mail capitalised differently in Finch and upper
case in Wayfarer, and opted out of marketing in Kestrel.

New Keycloak organization `kestrel-finch` (a new tenant, made on first sign-in),
11 groups (with `/sales/sales-dach` and `/sales/sales-nordics` nested), 10 people:
tenant admin, data engineer (owner of every source), DPO (steward), two
regional sales reps (unmasked, row-filtered by region), a marketing manager
(masked, consent-filtered), customer care, finance, a BI analyst and an outside
agency.

## Results

| Suite | Result |
| --- | --- |
| Persona checks (`setup/battle.py`): owners, stewards, admin, sales, marketing, care, finance, BI, agency, 12 bypasses | **39/39** after fixes (30/35 on the first run) |
| ODBC client checks (`clients/odbc_checks.py`, psqlODBC 18 + pyodbc) | **11/11**; on a rerun with Metabase's pool open, D11 was refused "busy" (gateway memory full, gap 11) |
| Metabase checks (`clients/metabase_setup.py`, v0.65.6.2) | **9/9**; dashboard in a browser **0/5 cards failing** (was 4/5) |
| psql 18 `\dn`, `\d+` | masks shown as column descriptions (`Masked (hash)`) |
| Unit tests, changed areas | CLI detectors 368, CLI query 147 + worker/manifest/ODBC 54; API 3,576; web 575 |

Some passing checks pin a **gap**, not a good behaviour: S2, A1, M3/M4b, C1, C3
(see "Gaps").

## Bugs found and fixed

### 1. Critical — PII findings lost their column on any realistic table, so nothing was masked by default

- **Symptom.** Kestrel `crm.contacts`: 1,016 PII findings, **all** without a column; every one of 13 columns `clear`. A Data reader read phone numbers and Austrian social insurance numbers in clear.
- **Cause** (`apps/cli/src/detectors/pii/detector.py`). Three ways a tabular page lost its columns: (a) past 200 cells the detector fell back to full-text analysis with no column tags — the default sampling page is 100 rows, so any table with more than two columns; (b) a page had to contain `row_1:`, so the second page of a sweep (`row_101:`) was never tabular (the secrets detector had this fixed on 2026-11-16, PII had not); (c) pages under 200 cells were analysed cell by cell without context, so phone numbers (0.4 base score) never reached the 0.7 threshold. The lakehouse-lab fixtures that verified masking have two columns (`id`, `email`).
- **Fix.** Analyse one column at a time as `<column>: <value>` blocks (one Presidio call per column, the column name as context) and map each result back to its cell; any `row_<n>:` header makes a page tabular.
- **Evidence after.** 0 findings without a column on all five sources; e-mail 189/189, phone 165, svnr 42; the DATE_TIME / IT_VAT_CODE / UK_NHS noise on structured columns gone. Tests: 4 new, 2 stub tests rewritten (they pinned one call per cell).
- **Note.** Existing workspaces need a re-scan.

### 2. Salesforce/HubSpot camelCase columns got no hints

`FirstName`, `MobilePhone` were read as one word: no PERSON in name columns, and every recogniser on phone numbers, so PESEL, VAT and card "findings" made `MobilePhone` *sensitive*. Column names are now split on case (`_normalize_column_name`). Finch findings 1,138 → 327, all on the right columns. Test added.

### 3. Every query over an ODBC source failed

`ODBC connections cannot be opened when external access is disabled` — the 2026-11-21 lockdown (`383fd5c4`) sets `enable_external_access = false` in every query session, and DuckDB's `odbc_scanner` refuses every connection then, even through a handle opened before (tried). Only mocked tests covered ODBC. **Fix:** bindings declare `needs_external_access` (ODBC); the session leaves it on for such a query and keeps the rest locked (no extension autoload, `lock_configuration`); a process of the shared query worker refuses such a source outright (`CLASSIFYRE_QUERY_SHARED_HOST`, set by `_harden`), on top of the worker's existing `job_only`. **Trade-off, stated plainly:** inside an ODBC query Job the SQL gate is the file wall (DuckDB's own is off; `INSTALL … FROM core` gets past repository tricks, so none was added). The Job is a pod of its own. Live: billing queries pass, 5–7 s (a Job), 8–13 s through the gateway.

### 4. A shared dataset silently dropped two of its three inputs

`shared.marketing.traveller_360` (both CRMs and the loyalty programme) shared without complaint and returned only the 186 loyalty members — `in_kestrel`, `in_finch` false on every row. Its owning group `/data-platform` had no row rule on the two row-filtered CRM tables, so it read 0 rows of them (fail closed, by design) and nobody was told. **Fix:** describe reports `groupRows` (`all` / `filtered` / `none`) per input, and `none` is a share problem, like an input the group cannot query (`shared-datasets/dataset-input-rows.ts`, DTO, OpenAPI, api-client). After adding a rule: 197 consented travellers, 22 in both CRMs. **Still open:** a dataset already shared whose group later loses its rows to a new filter keeps answering without them (the read-time check covers grants only).

### 5. (Partly fixed) Outsiders could only be given data by also giving them every finding

Data reader opens no workspace (404); the only role that did was Viewer, which shows every finding *with its matched content*. The agency, which could query nothing, read 2,577 findings: **511 IBANs, 12 card numbers, 42 social insurance numbers, the AWS key and the live Stripe key** — values masked or hidden in SQL. **Fix (narrow):** a built-in role **Data consumer** (`workspace.view`, `notification.view`): with a Data reader grant on a dataset the agency sees exactly that one table; findings, sources and activity answer 403. The web hides sidebar entries a person cannot open and sends people without `asset.view` from the dashboard to the SQL page. **Not fixed — see blocker below.**

### 6. Metabase dashboards failed: "The SQL gateway is busy"

A browser loads a dashboard's cards in parallel; Metabase opens its pool's four sessions at once. The gateway's memory guard reserves 450 MB for every session still starting, so with ~1.6 GB resident it refused the third and fourth (53300), which pgJDBC under a pool does not retry: **4 of 5 cards failed**, reproduced on a healthy stack. A started session settles near 240 MB (measured: 4 idle sessions = 1.38 GB, 0.43 GB without). **Fix:** `admitSession` — a sign-in kept out only by sessions still starting waits (up to 10 s, inside the 20 s sign-in deadline) and is re-checked against real memory; the session limit and a pod truly out of memory still refuse at once. After: 0/5 failing, twice, including a cold pool after a gateway restart.

### 7. EU national IDs derived *personal*, not *sensitive*

GOV §5 says national ids → sensitive; the list had only US/UK ones. Added AT_SVNR, CH_AHV, DE_TAX_ID, PL_PESEL, FI, ES, IT ids, EU_NATIONAL_ID and the other person identifiers the detector knows. Spec added.

## Follow-up (same day): finding values and the four gaps

**Finding values now follow column masks.** New capability `finding.content`
(Investigator, Curator, Source manager, Workspace admin/manager, Tenant admin,
and visitors of a *published* workspace — publishing is the decision to show
what it found). Everyone else sees a finding's value only on tables they read
in clear (`data.unmask` there, owner, steward); elsewhere `••••`, the context
dropped, `contentHidden: true`. Enforced in one place for every REST response
(`finding-content/`: a global interceptor that redacts any finding-shaped
object — findings, search, quick search, cases, inquiries, graph, extractions),
in MCP tool results (also when a result is cut short and no longer JSON: every
value field blanked), and in CSV exports (value columns left out). Value
searches would be oracles, so the findings search box (whole-word), quick
search (prefix — a character-by-character oracle) and "where else does this
value appear" need `finding.content`. Verified live: Amélie and Kwame (Viewer)
0 of 200 values; Lukas sees values on the two tables he reads unmasked and
`••••` elsewhere; Henrike (steward, Viewer only) and Tomasz see all; quick
search for `AT48` and value lookup refused for Amélie; MCP returns hidden
values. 13/13 checks (`setup/finding_content_check.py`, `setup/mcp_check.py`).
Remaining: entity values (G5) are a separate surface, not covered.

**The four gaps, fixed and verified live:**

- **`scrub` mask ("identifiers removed")** for free text: e-mails, IBANs, card
  and phone numbers, ID and document numbers, keys, tokens, private keys and
  `password is …` replaced in every row. All 181 ticket bodies readable, no key
  or number left (C1).
- **`restrict` column access**: hidden even from *Data reader, unmasked*, only
  owners and stewards see it. Lukas reads contacts in clear without `svnr`;
  Tomasz sees it (S2).
- **`hash` ignores case and surrounding spaces**: marketing's cross-CRM join
  finds 22 of 22 (was 18), Finch ⋈ Wayfarer 66 of 66 (was 57) (M3, M4b). Hashes
  shown before change once (release note).
- **Readers without rows**: `GET assets/:id/rows` → `readersWithoutRows`, shown
  in the Rows step ("These groups may query this table but no rule gives them
  a row: /admins"); the run note tells a reader without a rule to ask the
  owner or a steward (R1).

Persona checks now 39/39. Note for the dev stack: the query worker pre-imports
the CLI's query code, so CLI mask changes need `rollout restart
deploy/classifyre-query-worker`.

## Gaps and frustrations (by impact)

1. ~~**Secrets in free text hide the whole column.**~~ Fixed: `scrub` mask (follow-up above).
2. ~~**Unmasked is per table, not per column.**~~ Fixed: `restrict` column access (follow-up above).
3. **One mask per column for everyone.** Marketing needs `email` hashed (to deduplicate), support would want it partial: impossible on the same column.
4. ~~**Hashing is exact.**~~ Fixed: hashes ignore case and surrounding spaces (follow-up above).
5. **Masked columns cannot be searched.** Customer care cannot look a caller up by e-mail (filters see masked values); they need the member number.
6. **Tenant admin sees zero rows** of every row-filtered table (fail closed, by design) — now named in the Rows step (`readersWithoutRows`) and explained to the reader (follow-up above).
7. **Stewards cannot query.** The DPO could set masks but not look at the data until her group got Data reader.
8. **Owners who cannot open the workspace.** Over the API, a workspace's owning group gets no role (the web dialog pre-fills Viewer); Ines named Tomasz owner of five sources he could not open, without a warning.
9. **Detection misses** that need a steward every time: dates of birth (dates in structured columns are never personal), non-US passport numbers, upper-case card-holder names, health data (dietary needs, GDPR Art. 9). And one `LOCATION` hit ("AT") classified a whole `country` column; there is no minimum share of rows.
10. **Test-data trap:** the e-mail recogniser rejects `.example`/`.test` top-level domains; the first seed found zero e-mails.
11. **Gateway capacity is per session (~240 MB idle, ~450 MB busy), and small.** One BI tool's idle pool of four holds ~1 GB of the gateway for 30 min (idle timeout). With Metabase's pool open plus two analysts' ODBC sessions (six live), a seventh sign-in was refused "busy" on the dev pod (3 GiB) — correctly, it was out of memory, but the chart's default 4 GiB pod is documented as "about 6 busy sessions": **one Metabase and two Excel users fill a production gateway pod.** Sizing guidance per BI tool belongs in the SQL-connections docs, and a cheaper idle session (shared catalog per connection, or a shorter idle timeout for pooled clients) is the real fix. Also: one connection allows four sessions, so psql was refused while Metabase held the pool — one connection per tool.
12. **psqlODBC shows no mask notes.** psql shows `Masked (hash)` as the column description; `SQLColumns` remarks are empty, so Excel and Power BI users never see that a column is masked.
13. **ODBC sources are slow to query**: every query is a Kubernetes Job (5–7 s REST, 8–13 s over the gateway) against ~1–2 s for other sources.
14. Smaller: `GET /sources` lists the built-in *Shared datasets* source; S3 table names repeat the scope prefix (`finch_crm_salesforce_export.kestrel_finch_finch_salesforce.contact`); an anonymous visitor to a private workspace URL sees a "PUBLIC · READ-ONLY" badge and an error instead of a sign-in prompt; a "Harness AI" entry still shows for Data consumers.

## Numbers (dev stack, k3d on one machine, after the environment recovered)

| What | Time |
| --- | --- |
| Scans (full, PII + secrets) | Postgres 201 s, S3 Delta 57–114 s, Polaris 90–127 s, DuckLake 65–90 s, ODBC 163 s |
| REST query, one table | 0.7 s (setup 0.4 s) |
| REST query, the three-input shared dataset | 1.7 s |
| SQL page (browser), masked contacts | 1.5 s |
| psqlODBC, masked rows / hashed join | 0.9 s / 1.6 s |
| ODBC source over the gateway | 8–13 s (Job) |
| Metabase dashboard, 5 cards, browser | 8–12 s |

Between about 19:00 and 19:25 UTC the host ran out of memory (load 487) while
the full CLI test suite ran beside the stack; measurements from that window
were discarded and repeated.

## What changed in the code

| Area | Files |
| --- | --- |
| PII column attribution, camelCase | `apps/cli/src/detectors/pii/detector.py`, `apps/cli/tests/detectors/pii/test_pii_detector.py` |
| ODBC queries | `apps/cli/src/query/{session,worker,bindings}.py`, `connectors/{base,odbc}.py`, `apps/cli/tests/test_query.py` |
| EU ids sensitive | `apps/api/src/governance/governance-rules{,.spec}.ts` |
| Dataset input rows | `apps/api/src/shared-datasets/{dataset-input-rows,dataset-input-rows.spec,shared-datasets.service,shared-datasets.dto}.ts`, `openapi.json`, `apps/api/openapi.json`, `packages/api-client` |
| Data consumer role | `apps/api/src/identity/{roles,data-consumer-role.spec}.ts`, `apps/web/lib/nav-access{,.spec}.ts`, `apps/web/components/app-sidebar.tsx`, the dashboard page |
| Gateway admission | `apps/api/src/sql-gateway/{memory-guard,memory-guard.spec,sql-gateway.service}.ts` |
| Release notes | seven fragments in `changelog.d/` |

## Next

1. ~~Finding-content visibility~~, ~~a scrub mask~~, ~~restricted columns~~ — done (follow-up above). Entity values (G5) still follow `entity.view` only.
2. Read-time check that a dataset's owning group still reads rows of each input.
5. Real-table fixtures for the lakehouse lab (more than two columns, more than one sampling page) so bug 1 cannot come back unnoticed; a live ODBC query in CI.
6. Run the full CLI suite in CI rather than beside the dev stack (not completed here, see above; the changed areas' suites pass).
