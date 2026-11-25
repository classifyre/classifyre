# Product requirements: closing the open-source gaps

These PRDs turn the findings of [palantir-use-case-gap-analysis.md](../../palantir-use-case-gap-analysis.md) into buildable work for the open-source core. The target is traction with enterprises and government in Europe. Sign-in, tenants and roles are planned in [IAM](IAM-access-management.md). They are optional and come with the Helm chart only. [S1](S1-enterprise-extension-seams.md) adds the seams they plug into.

**Start with [00 · How the PRDs fit together](00-integration-architecture.md).** It defines:
- the shared foundations (F1–F7) and contracts (C1–C7) the PRDs use;
- the build order and milestones;
- three end-to-end scenarios that prove the pieces work together;
- the engineering rules and the definition of done.

## The PRDs

| PRD | Why (one line) | Size | Milestone | Provides |
|---|---|---|---|---|
| [G0 · Safe defaults](G0-safe-defaults.md) | An instance without a login exposes every secret it found and runs notebook code for anyone | XS–S | M0 | — |
| [S1 · Enterprise extension seams](S1-enterprise-extension-seams.md) | Makes the enterprise edition a module, not a fork of a fast-moving repository | S–M | M0 | F6 |
| [IAM · Identity and access management](IAM-access-management.md) | Anyone who reaches an instance can do everything, and tenants and groups cannot be kept apart | L | after M0 | builds on F6 |
| [TEN · Tenant isolation, operators and the cloud playground](TEN-tenant-isolation-and-cloud.md) | Turning sign-in off shows every tenant's workspaces, and nobody manages the tenants themselves | L | after IAM | — |
| [DQ · Data query: SQL over the tables of a workspace](DQ-data-query.md) | Classifyre knows every table and what was found in it, but nobody can read the rows, join them, or be given access to one table | L | after IAM | grants on one source or table |
| [DR · Data requests: cases that ask a data team for a dataset](DR-data-requests.md) | Business users need a governed way to ask a data team for a joined dataset without getting raw-table access | L | after DQ | data-request cases, visual join canvas |
| [QC · Query connectors](QC-query-connectors.md) | Only sources DuckDB reads itself can be queried; search, graph, SaaS and custom sources cannot, and the list of queryable types is kept in two places by hand | L | after DQ 0–4 | one read interface per source type (replaces DQ phase 5) |
| [BIC · BI clients over SQL connections](BIC-bi-client-compatibility.md) | SQL connections were never tested with a real BI tool, and nothing stops the next driver version from breaking them | M | after DQ 4 | Metabase/driver smoke on the dev stack, client statement corpus in CI |
| [SG · Native Postgres catalog sidecar and query-path efficiency](SG-sql-gateway-native-catalog.md) | Per-session PGlite WASM costs 150–450 MB per BI connection and the query path leaves gateway heap and worker CoW/CPU on the table | M–L | after BIC | PGlite removed; stateless native Postgres catalog sidecar (`c_<hash>` DBs), direct Arrow wire encoding, `gc.freeze()` & sticky worker reuse |
| [GOV · Governed data assets](GOV-governed-data-assets.md) | Nobody owns an asset, its meaning is hidden in a drawer, and quality is only failures from a sample: no owner, steward, column metadata, thresholds or results | L | after DQ 0–2 | owners for access requests, column classification for masks |
| [G1 · PYTHON detector](G1-python-detector.md) | Rules and quality checks live in connector notebooks as TAG workarounds (67 of 68 GENESIS detectors) | M | M1 | C1, C2 |
| [G3 · Domain events, webhooks, push, case export](G3-outbound-webhooks-notifications-export.md) | Nothing leaves the app: no webhook, no push, no case export | S–M | M1 | F1 |
| [G2 · European detection coverage and bundles](G2-eu-detection-coverage.md) | National IDs for only 6 of 27 member states, no GDPR Art. 9 detection, no way to share detectors | S–M | M2 | F5 |
| [G4 · Extracted values and watch conditions](G4-extracted-values-and-watch-conditions.md) | Extracted fields can't be searched or used in rules; watches can't express real rules | M | M3 | F2, F3 |
| [G5 · Entities](G5-entities.md) | The flow pivots on strings, never on the things they refer to | L | M4 | F4 |
| [G6 · Triage queue](G6-triage-queue.md) | There is no queue before a case exists | S–M | M5 | — |
| [G7 · Outcome metrics](G7-outcome-metrics.md) | Nothing measures precision, time to decision or the effect of a change | S | M5 | decision log |

## Reading order by role

- **Engineering lead:** 00, then S1, then the PRDs in milestone order.
- **Backend:** 00 §3 (foundations), §5 (contracts), §8 (rules), then your PRD's *Design* section.
- **Frontend:** each PRD's *Web* subsection, plus 00 §8 rules 7 and 15 (namespace links, i18n and status tones).
- **Product and docs:** each PRD's *Why*, *Goals* and *Testing and acceptance*, and 00 §6 (scenarios).

## Status

| PRD | Status |
|---|---|
| [G5 · Entities](G5-entities.md) | Shipped on this branch, 2026-10-03 ([as built](G5-entities.md#13-as-built)) |
| [DQ · Data query](DQ-data-query.md) | Phases 0–4 built 2026-11-09/14, phase 6 being built, query worker 2026-11-21 ([as built](DQ-data-query.md#9-as-built)); phase 5 moved to QC |
| [GOV · Governed data assets](GOV-governed-data-assets.md) | Proposed, 2026-11-12 |
| [QC · Query connectors](QC-query-connectors.md) | QC0–QC3 built 2026-11-21 (interface, connector runtime, Meilisearch, Neo4j, lab joins on skaffold); QC4 built 2026-11-22 (custom sources: `tables()`/`scan()`, tried on the live Firmenbuch); QC5 proposed |
| [BIC · BI clients over SQL connections](BIC-bi-client-compatibility.md) | BIC0–BIC2 built and run 2026-11-21 (30/30 checks); BIC3 open |
| [SG · Native Postgres catalog sidecar and query-path efficiency](SG-sql-gateway-native-catalog.md) | Implemented (SG0–SG4 code & local tests), 2026-11-25; live k3d `bi-smoke.sh` & §8.3 benchmarks pending |
| [DR · Data requests](DR-data-requests.md) | In progress, 2026-11-24 |
| All others | Proposed, 2026-09-30 |

Update this table as PRDs move to *Accepted*, *In progress* and *Shipped*.
