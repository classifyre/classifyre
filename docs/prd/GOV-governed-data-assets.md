# PRD GOV · Governed data assets: owners, business metadata, quality

|                  |                                                                                                                                                     |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**       | G-1 to G-5 built 2026-11-12, §9                                                                                                                     |
| **Size**         | L (5 phases, each its own PR)                                                                                                                       |
| **Depends on**   | [IAM](IAM-access-management.md) (people, groups, capabilities, audit), [SL1–SL3](SL0-semantic-layer-architecture.md) (glossary, `asset_terms`), [DQ](DQ-data-query.md) phases 0–2 (the query engine and job) |
| **Used by**      | [DQ](DQ-data-query.md) phase 3: access requests go to the table's owner, and default masks come from GOV's column classification             |
| **Standard**     | [Open Data Contract Standard](https://github.com/bitol-io/open-data-contract-standard) (ODCS) v3.2: team, schema properties, quality, SLA, status |
| **Not in scope** | Multi-table contracts (they come with DQ phase 6 data products), lineage-propagated ownership, an external catalog sync (Collibra, DataHub)       |

## 1. Summary

Classifyre already knows a lot about each asset:

- **What it is:** identity and technical metadata.
- **What it means:** glossary terms.
- **What is in it:** findings.
- **Who reads it:** audit.

Three things are missing before it can be called a **governed data asset**:

1. **Ownership.** Nobody is accountable for an asset.
   - An **owner** is accountable. It is one person, usually from the business.
   - A **steward** maintains the definitions and the quality. It can be a person or a group.
   - A **custodian** runs the system it lives in. It is a technical team.
   - All three come from IAM: the Keycloak people and groups of the tenant.
2. **Business metadata on the asset itself.** Today it has no description, no column-level meaning, and no page that puts meaning, classification and usage in one place. The terms an asset has are hidden in the Connections tab.
3. **Data quality.** Findings record failures from a ~100-row sample, but nothing records:
   - a measurement over a whole table;
   - a threshold;
   - a pass;
   - a history.

**An asset becomes governed the moment someone assigns it an owner.** That creates its governance record. A checklist then shows what is still missing (steward, description, terms, classification, quality rules), and the owner or steward moves it from `draft` to `active`. That move is the certification.

Quality follows the shape of ODCS:

- **Rules** live on the asset or one of its columns: dimension, metric, operator, threshold.
- **Results** are kept every time a rule is evaluated.
- **A failing rule keeps one open finding** of category QUALITY, so triage, watches, notifications and finding statistics work as they do today.

Existing findings become quality inputs. "Open PII findings in column `notes` must be 0" is a conformity rule.

## 2. Where we start

| Pillar | Today | Gap |
| --- | --- | --- |
| Identity | `Asset.urn`, `hash`, `Source.sqlName` | — |
| Technical metadata | `Asset.metadata.columns [{name, type}]` (JSON, per connector; `tabular_base.py`, `file_metadata.py`), `row_count` where cheap; column lineage in `Edge.fieldMappings` | No column entity: nothing can bind to a column |
| Business metadata | Glossary, bindings, `asset_terms` (SL1–SL3, built); `AssetMeaningPanel` (`components/glossary/meaning-card.tsx`) shows terms, but only in the Explore drawer of the Connections tab | No asset description (only `Source.description`); no column terms; the asset page has no Overview; `AssetTerm` is asset-level only |
| Classification | Findings by detector and `category`; PII findings carry `metadata.tabular_column_name` | No roll-up per column, nothing says "this column is personal data" |
| Status | `AssetStatus` NEW / UPDATED / UNCHANGED / DELETED: the last scan's result, overwritten each run | No lifecycle (draft, active, deprecated, retired); no legal basis |
| Usage | `audit_events` `query-runs.read-table` tagged `asset:<id>` / `source:<id>` (DQ R6); the Activity list on the Data tab | Not summarised: no "who uses this, how often" |
| Ownership | `namespaces.owner_group_id` (the workspace's owning group); `GlossaryTerm.steward` and `Case.assignee` are free text | Everything for assets and sources |
| Quality | `category = QUALITY` findings from CODE_DETECTOR and BROKEN_LINKS; resolved when no longer yielded | Failures only; no measured value, threshold or pass; detectors see the scan sample, not the table; no per-rule schedule; outcomes kept 14 days (`RunnerAsset.detectorOutcomes`) |

**Are findings already quality results?** Half of it.

- A finding is the right record for an **open failure**: severity, review, auto-resolve, notifications, watches and daily statistics already exist for it.
- A quality result is **a measurement against a threshold, kept every time it is evaluated, passing or not**. A finding cannot hold that. `matchedContent` is overwritten on re-detection, `history` keeps no value, and a pass leaves no row.

So GOV adds rules and results, and bridges them into findings both ways:

- **Findings as inputs to rules:** the `detector` rule type.
- **Failing rules as findings:** the QUALITY finding.

## 3. Requirements

| #   | Requirement |
| --- | --- |
| R1  | Anyone with `asset.govern` can assign an owner to an asset; the asset is then governed (`draft`). An owner is one person; a steward is a person or a group; a custodian is a group. |
| R2  | Roles set on a source apply to its assets unless the asset sets its own; the UI says when a role is inherited. |
| R3  | The owner and the stewards of an asset (or of its source) can edit its governance without a workspace role that gives `asset.govern`. *(Changed 2026-11-12.)* The owner may also query the tables they own (every table of an owned source), not export them; stewards and custodians get no data access from their role, and a custodian is a contact only. Owners decide access requests (DQ phase 3). *(Changed 2026-11-12.)* Naming or ending owners, stewards and custodians needs `asset.govern` itself: only an admin or a role that holds it gives these rights, never the owner or steward. |
| R4  | Every governance change is audited and tagged `asset:<id>`, `source:<id>`, `governance`; role changes keep their history (date in, date out, replaced by). |
| R5  | The asset page shows, in one place: description, ownership, terms, classification per column, usage, quality, and what is missing to be fully governed. |
| R6  | Columns of a table can be given a business name, description, term and critical-data-element flag; their classification is derived from open findings, and can be overridden by a steward. |
| R7  | Quality rules follow ODCS: dimension, metric or SQL, operator, threshold, unit, severity. Every evaluation is kept with its measured value. |
| R8  | Rules over table contents measure the whole table, not the scan sample, through the DQ query engine, and stay within its limits (time, memory, the tables it may read). |
| R9  | A failing rule has exactly one open QUALITY finding; it resolves when the rule passes. |
| R10 | An asset's governance, columns, team and rules export as an ODCS v3.2 contract and import from one. |
| R11 | Nothing here is a legacy surface: free-text stewards on glossary terms are migrated to people or groups. |

## 4. What "governed" means

**Governed = has an owner.** Assigning the first owner creates the asset's `asset_governance` row in `draft`. Removing the last owner does not delete the row: the asset shows as *ownerless*, so its description and rules are kept.

**Lifecycle** (ODCS `status`, independent of the scan's `AssetStatus`):

| Status | Meaning | Set by |
| --- | --- | --- |
| *(none)* | Ungoverned: no record | — |
| `draft` | Has an owner; being described | Automatic on first owner |
| `active` | Certified: fit for use as described | Owner or steward; stamps `certifiedAt` / `certifiedBy` |
| `deprecated` | Still there, should not be used for new work | Owner or steward |
| `retired` | Gone from use | Owner or steward; also shown (not set) when the scan retires the asset (`AssetStatus.DELETED`) |

**Governance checklist.** It is computed on read and never stored. It drives a completeness bar on the asset and the coverage numbers on sources and the workspace:

| Item | Done when |
| --- | --- |
| Owner | An active OWNER (own or inherited) |
| Steward | An active STEWARD (own or inherited) |
| Description | `asset_governance.description` not empty |
| Meaning | ≥ 1 approved term on the asset (`asset_terms`) |
| Classification reviewed | Every column with an open classifying finding has a confirmed or overridden classification (tables only) |
| Quality | ≥ 1 enabled rule, latest result passing |
| Certified | Status `active` |
| Legal basis | Set, if the asset holds personal data (optional, configurable per workspace) |

## 5. Design

### 5.1 Data model

Prisma models and one migration per phase.

**`asset_governance`**: one row per governed asset.

| Column | Type | Notes |
| --- | --- | --- |
| `asset_id` | uuid PK, FK assets (cascade) | |
| `status` | enum `DRAFT, ACTIVE, DEPRECATED, RETIRED` | |
| `description` | text | Markdown; ODCS `description.purpose` is the first paragraph on export |
| `usage`, `limitations` | text? | ODCS `description.usage` / `.limitations` |
| `legal_basis` | enum? | GDPR Art. 6(1) a–f |
| `retention` | text? | Free, e.g. `10 y`; exported as an SLA `retention` property |
| `certified_at`, `certified_by` | timestamptz?, actor ref? | Set on → `active` |
| `updated_at`, `updated_by` | | |

**`governance_roles`**: owners, stewards and custodians of a source or an asset, with their history.

| Column | Notes |
| --- | --- |
| `id` | uuid |
| `scope_type`, `scope_id` | `source` / `asset`, the id |
| `role` | `OWNER`, `STEWARD`, `CUSTODIAN` |
| `principal_ref` | `user:<sub>` or `group:<id>` |
| `date_in`, `date_out` | `date_out` null = active (ODCS `team.members[].dateIn/dateOut`) |
| `replaced_by_ref` | ODCS `replacedByUsername` |
| `assigned_by` | actor ref |

Constraints:

- OWNER is `user:` only.
- CUSTODIAN is `group:` only.
- At most one active OWNER per scope: a partial unique index on `(scope_type, scope_id) WHERE role = 'OWNER' AND date_out IS NULL`.
- Replacing an owner closes the old row and opens a new one in one transaction.

**Inheritance:** an asset's effective role = its own active rows, else its source's. The DTO marks inherited rows (`inheritedFrom: 'source'`).

**`asset_column_annotations`**: keyed `(asset_id, column_name)`, because columns stay in `metadata.columns`.

| Column | Notes |
| --- | --- |
| `business_name`, `description` | ODCS `businessName`, `description` |
| `term_id` | FK glossary_terms, nullable. A column's term; separate from `asset_terms`, which stays asset-level (SL-2) |
| `critical_data_element` | bool (ODCS `criticalDataElement`) |
| `classification` | text? A steward's override; null = derived |
| `classification_confirmed_at/by` | For the checklist |

**Derived column classification:**

- Built from open findings on the asset, grouped by `metadata.tabular_column_name`.
- The detector and finding type give the label: PII types → `personal`, special categories → `sensitive`, SECRETS → `secret`.
- It is computed on read, with one grouped query per asset.

**Principals** (`apps/api/src/identity/actor-ref.ts`):

- A new kind, `group:<keycloak group id>`.
- `ActorDirectoryService.resolve` names groups from `MembershipService.groups(orgId)`.
- `ActorChip` (`apps/web/components/actor-chip.tsx`) shows a group icon for them.

**Migration of glossary stewards (R11):**

- `GlossaryTerm.steward` free text becomes `steward_ref`.
- A name or e-mail that matches exactly one tenant member or group is converted.
- Anything else is appended to `notes` as "Steward (before 2026-11): …" and the field is left empty.
- The term editor (`components/glossary/term-editor-dialog.tsx`) uses the same principal picker.

### 5.2 People, groups and rights

**Principal search:**

- Route: `GET /<ws>/access/principals?q=&kinds=user,group`. It needs `access.view` or `asset.govern`.
- People come from the tenant's Keycloak organization members, using `MembershipService` with a search parameter on the members call, cached 60 s.
- Groups come from `groups(orgId)`.
- It returns `{ref, kind, name, email?, path?}`, at most 20.
- Today `members()` is used only by the operator Platform page. If it becomes too slow on a large organization, it falls back to `iam_principals` (people who have signed in).

**Capability** `asset.govern`, "Govern assets: owners, descriptions, columns, quality rules":

- Added to `curator`, `workspace-admin`, `workspace-manager` and `tenant-admin` (`identity/capabilities.ts`, `identity/roles.ts`).
- `asset.tag` keeps its meaning (tags, manual connections, explore views).

**Owner and steward rights (R3):**

- `IamAccessPolicy.check('asset.govern', {type: 'asset', id})` also passes when the actor is an effective OWNER or STEWARD of the asset, or a member of a STEWARD group.
- The same holds for `{type: 'source'}` and the source's roles.
- The namespace hook loads the person's active `governance_roles` once per request, matching their `user:` ref and `group:` refs from `CLS_PERSON.groupIds`. It turns them into `{sourceIds, assetIds}` for `asset.govern`, the same way `resourceGrantsInWorkspace` does for grants (`identity/grant-evaluation.ts`).
- The check is resource-scoped, so it never opens anything workspace-wide.
- Ownership gives no `data.query`. The owner decides who may read (DQ phase 3, access requests) but needs a grant to read like anyone else.

**Audit (R4):**

- Every governance write goes through the audit interceptor with `capability = asset.govern`.
- Resources are `governance`, `asset:<id>` and `source:<id>`, from a new `governanceResources()` in `identity/audit-resources.ts`.
- `fields` lists the changed keys, never their values (as today).
- The asset's Activity list (`AuditEventList` with `resource=asset:<id>`) therefore shows owner changes next to table reads.

**Notifications (phase G-5):**

- A type `GOVERNANCE`, with events: you were made owner or steward; a rule on your asset started failing; an access request is waiting for you.
- Today notifications go to groups only (`Notification.audienceGroupIds`). G-5 adds `audience_person_refs text[]`.
- `NotificationState` is already per actor, and the gateway already has a personal room.

### 5.3 Usage

The **Usage** card on the asset reads `audit_events` where `resources @> {asset:<id>}` and `operation LIKE 'query-runs.%-table%'` over 30 days:

- reads per day (sparkline);
- distinct readers;
- the top 5 readers (`ActorChip`);
- exports by format.

It is a read-only aggregate, so no new storage is needed. SQL connections (DQ phase 4, §5.7, built 2026-11-13) write the same events with `channel = sql` and `connection:<id>`, so BI tools show here too: readers are counted as people however they read, and reads are split by channel. The asset and source Governance tabs gain *Access*: the connections that read the table, name it or are closed on it, where owners and stewards give a connection or close the table to one. On the workspace Governance page, *ungoverned tables by reads* uses the same query grouped by asset.

### 5.4 Data quality

**`quality_rules`** (ODCS `quality[]`, one row per rule):

| Column | ODCS | Notes |
| --- | --- | --- |
| `id`, `asset_id`, `column_name?` | — | `column_name` null = object-level rule |
| `key` | `id` | Unique per asset |
| `name`, `description` | same | |
| `dimension` | `dimension` | `accuracy`, `completeness`, `conformity`, `consistency`, `coverage`, `timeliness`, `uniqueness` |
| `type` | `type` | `library`, `sql`, plus two of ours, exported as `custom` with `engine: classifyre`: `detector`, `metadata` |
| `metric` | `metric` | library: `nullValues`, `missingValues`, `invalidValues`, `duplicateValues`, `rowCount`; metadata: `rowCount`, `freshness`; detector: `openFindings` |
| `arguments` | `arguments` | `missingValues`, `validValues`, `pattern`, `properties`; detector: `{detectorType?, customDetectorKey?, findingType?, category?}` |
| `operator`, `threshold` | `mustBe` … `mustNotBeBetween` | One operator per rule; `threshold` is a number or `[lo, hi]` |
| `unit` | `unit` | `rows` (default) or `percent` |
| `query` | `query` | sql only; `{object}` and `{property}` substituted with the table's SQL name and the column |
| `severity`, `business_impact` | same | Severity uses our `Severity` enum |
| `schedule` | `schedule` / `scheduler: cron` | Null = after each scan |
| `enabled`, `created_by`, `updated_at` | — | |

**`quality_evaluations`**: one per run.

- `id`, `trigger` (`scan`, `schedule`, `manual`), `asset_ids`, `runner_id?`, `query_run_id?`, `status`, `started_at`, `finished_at`.

**`quality_results`**: one per rule per evaluation, kept 400 days.

- `rule_id`, `evaluation_id`, `evaluated_at`, `measured_value` (numeric), `rows_checked?`, `passed` (bool), `error?`.
- Indexed `(rule_id, evaluated_at desc)`.

**Evaluation by type:**

| Type | Measures | Runs | Engine |
| --- | --- | --- | --- |
| `detector` | Count of **open** findings on the asset matching `arguments`, optionally restricted to `column_name` via `tabular_column_name` | At the end of every scan of the asset, in `AssetService.finalizeIngestRun` (`apps/api/src/asset.service.ts`), after findings are reconciled | API, one grouped query |
| `metadata` | `rowCount` from `metadata.row_count`; `freshness` = hours since the newest of `lastScannedAt` and the lakehouse snapshot time | Same | API |
| `library` | The ODCS metric over the **whole table** | On `schedule` (pg-boss, the scheduler in `scheduler/scheduler.service.ts`) or *Run now* | CLI job mode `quality` |
| `sql` | The single number the query returns | Same | CLI job mode `quality` |

**Which findings become quality results.** With the `detector` type, existing results become quality measurements without re-running anything:

| Example rule | Dimension |
| --- | --- |
| "open PII findings in `comment` must be 0" | conformity: personal data where none is allowed |
| "open findings of the custom detector `row-integrity` must be 0" | accuracy (a CODE_DETECTOR check) |
| "open BROKEN_LINKS findings must be less than 5" | accuracy, for pages |
| "open `category = QUALITY` findings must be 0" | catch-all |

Detector rules also work on non-table assets (pages, documents). Library and SQL rules need a table the DQ catalog can read.

**Job mode `quality`** reuses `apps/cli/src/query/`: the gate, the bindings and the session.

- One job per asset evaluates all of its due library and SQL rules.
- Library rules compile in the API into **one aggregate SELECT per table**, for example:
  ```sql
  SELECT count(*)                                         AS row_count,
         count(*) FILTER (WHERE "email" IS NULL)          AS email_null_values,
         count(*) - count(DISTINCT "order_id")            AS order_id_duplicate_values,
         count(*) FILTER (WHERE "status" NOT IN ('open','paid','void')) AS status_invalid_values
  FROM shop_lake.shop.orders
  ```
- `percent` divides by `row_count`. SQL rules run as their own statements under the same gate, scoped to the one table, and must return one numeric cell.
- The API compares results with thresholds. The job only measures.
- The run is a system run, `actorRef = system:quality`. It is authorised by the rule, whose author held `asset.govern`, not by a person's `data.query`.
- `QueryRunService` gains a system path: no per-person cap, a per-workspace cap of 2 concurrent quality jobs, and the workspace's DQ timeout and memory settings. Its reads are audited as `quality.read-table`, with `system:quality` as actor and the table's resources.
- The rows themselves are never returned or stored, only numbers.

**Bridge to findings (R9).** When a rule's result is `passed = false`, the API upserts one finding:

| Field | Value |
| --- | --- |
| `detectorType` | New enum value `QUALITY` |
| `category` | `QUALITY` |
| `findingType` | `quality:<rule key>` |
| `detectionIdentity` | Derived from the rule id |
| `severity` | The rule's severity |
| `matchedContent` | `"email: 37 null rows (must be 0)"` |
| `location` | The column, when `column_name` is set |
| `metadata` | `{ruleId, dimension, measuredValue, threshold, operator}` |

- A later passing result resolves the finding ("Rule passes again").
- An evaluation error leaves the finding as it is and records the error on the result.
- Findings search, triage, watches, notifications, `FindingStat*` and the asset's Findings tab handle these without changes.

**Score.** Per asset: the weighted share of enabled rules whose latest result passed. The weights by severity are CRITICAL 8, HIGH 4, MEDIUM 2, LOW 1, INFO 0. The same score is computed per dimension. Assets without rules have no score, which is not the same as a score of 100.

### 5.5 ODCS contract import and export (R10)

`GET /<ws>/assets/:id/contract?format=yaml|json` builds a v3.2 contract from:

| ODCS | From |
| --- | --- |
| `apiVersion`, `kind`, `id`, `version` | `v3.2.0`, `DataContract`, the asset's URN (else `asset:<id>`), `1.<n>` bumped on every governance change |
| `name`, `status`, `domain` | Asset name, governance status, the workspace's name |
| `description.purpose/usage/limitations` | `asset_governance` |
| `team.members[]` | `governance_roles` (current and past): `username` = e-mail or group path, `role`, `dateIn`, `dateOut`, `replacedByUsername` |
| `schema[0]` | The table: `name` = SQL name, `physicalName`, `quality` (object-level rules) |
| `schema[0].properties[]` | `metadata.columns` + annotations: `name`, `physicalType`, `logicalType` (mapped from the type), `businessName`, `description`, `classification`, `criticalDataElement`, `authoritativeDefinitions` (term URN `term://glossary/<key>`), `quality` (column rules) |
| `slaProperties[]` | `freshness` rules → `frequency` / `latency`; `retention` |
| `support[]`, `customProperties` | Workspace link; everything else (legal basis, score) |

`PUT /<ws>/assets/:id/contract` imports a contract:

- It sets the description, annotations and rules, matching columns by name.
- `team.members` resolve by e-mail or group path through the principal search.
- The response lists what did not match: unknown columns, people, metrics.
- Rules with `type: custom` and another engine are refused, with their keys listed.

### 5.6 API

Routes are under `/<ws>`. Writes need `asset.govern` on the asset or source; reads need `asset.view`.

- `GET /assets/:id/governance`: record, effective roles (inherited marked), checklist, score.
- `PUT /assets/:id/governance`: description, usage, limitations, legal basis, retention, status.
- `POST /assets/:id/roles` with `{role, principalRef}` closes any active OWNER first. `DELETE /assets/:id/roles/:roleId` sets `date_out`. The same two routes exist for `/sources/:id/roles`.
- `GET /assets/:id/columns`: columns with annotations and derived classification. `PUT /assets/:id/columns/:name`.
- `GET /assets/:id/usage?days=30`.
- `GET|POST /assets/:id/quality-rules`, `PUT|DELETE /quality-rules/:id`, `POST /assets/:id/quality-runs` (Run now), `GET /quality-rules/:id/results?limit=`.
- `GET|PUT /assets/:id/contract`.
- `GET /governance/summary`: coverage per source, ungoverned tables by reads, failing rules, *mine*.
- `GET /access/principals`.
- `POST /search/assets` gains filters: `governance` (`ungoverned|draft|active|deprecated|retired`), `ownerRef`, `stewardRef`, `qualityFailing`. Owner and status are added to `AssetListItemDto`.
- MCP tools: `get_asset_governance`, `set_asset_owner`, `list_quality_failures`.

### 5.7 Web

**Asset page** (`apps/web/app/[locale]/[namespaceSlug]/(dashboard)/assets/[id]/page.tsx`):

- **Header**, after the kind badges:
  - a governance badge: *Ungoverned* (muted), *Draft*, *Active* (with a check), *Deprecated*, *Retired*;
  - the owner `ActorChip`;
  - the strongest classification chip, e.g. *Personal data*;
  - a quality chip (score, red when a CRITICAL rule fails).
- **Overview** becomes the first and default tab:
  - **Ungoverned:** one card, "Nobody owns this asset yet", with *Assign owner*. It shows who reads it, which is why governing it matters.
  - **Description:** markdown, edited in place. Purpose, usage and limitations sit under "More".
  - **Ownership:** owner, stewards, custodian. Each has an `ActorChip`, an *inherited from source* marker, *Change*, and *History* (closed rows).
  - **The picker:** a searchable combobox over `/access/principals`. People and groups appear in separate sections; the owner role offers people only. It is a new shared component, `components/governance/principal-picker.tsx`, also used by the glossary term editor.
  - **Meaning:** `AssetMeaningPanel` moves here from the Explore drawer. The drawer keeps a link.
  - **Classification:** per column, derived or overridden, with the finding count behind each, e.g. "email · Personal data · 3 open PII findings".
  - **Usage:** §5.3.
  - **Checklist:** §4, each missing item linked to where it is fixed.
  - **Technical details:** today's `AssetMetadataCard`, collapsed.
- **Schema:** `ColumnSchema` in `components/asset-metadata-card.tsx` becomes an editable grid for people with `asset.govern`, read-only otherwise. Its columns:
  - column, type, business name, description, term (term picker), CDE;
  - classification (derived chip, override menu);
  - quality (worst latest result of the column's rules).
- **Quality** tab:
  - Rules are grouped by dimension. Each shows its latest result, measured vs threshold, a sparkline of `measured_value`, the open finding, and when it runs next.
  - *Add rule* offers three builders:
    - **Check a column:** column → metric → operator → threshold → unit.
    - **SQL:** Monaco, with the SQL page's completions over this table.
    - **From findings:** detector, custom detector or category → operator → threshold.
  - *Run now* and *Export contract* / *Import contract*.
  - Library and SQL builders are disabled, with the reason, when the table is not queryable (the DQ catalog's reason).

**Source page:**

- An Ownership card in Overview. These are the default roles for its assets, and usually where the custodian is set.
- A coverage line: N of M assets owned, K active, F failing rules.

**Assets table** (`components/assets-table.tsx`):

- Owner and governance columns.
- Filters *Ungoverned*, *Owned by me*, *Stewarded by me*, *Failing quality*.

**Governance page** (`/<ws>/governance`, sidebar under Meaning):

- Coverage per source.
- *Govern these first*: ungoverned tables by reads in 30 days.
- Failing rules by severity.
- *Mine*: assets I own or steward.
- The new top-level route prefix goes into the negative lookahead in `next.config.mjs`.

All strings are in `i18n/en.json` and `de.json`.

## 6. Phases

| Phase | What | Status |
| --- | --- | --- |
| G-1 | **Ownership**: `group:` refs, principal search, `governance_roles` + `asset_governance`, `asset.govern` and the owner/steward resource check, audit tags, Overview tab (ungoverned card, description, ownership, Meaning moved), header badge and owner chip, source Ownership card, assets table filters, glossary steward migration | Built 2026-11-12 |
| G-2 | **Business metadata**: column annotations and the editable schema grid, derived column classification and overrides, Usage card, checklist and coverage, Governance page, MCP tools | Built 2026-11-12 |
| G-3 | **Quality from what we have**: `quality_rules` / `quality_evaluations` / `quality_results`, `detector` and `metadata` rules evaluated in `finalizeIngestRun`, QUALITY findings bridge, score, Quality tab | Built 2026-11-12 (a Quality step in the Governance tab) |
| G-4 | **Quality over whole tables**: `library` and `sql` rules, job mode `quality` and the system run path, per-rule schedules, ODCS contract export and import | Built 2026-11-12 (system runs of the existing `query` job, CSV result — no new job mode) |
| G-5 | **Telling people**: per-person notifications (owner or steward assigned, rule failing, access request waiting; the last one with DQ phase 3) | Built 2026-11-12 (access requests wait for DQ phase 3) |

[DQ](DQ-data-query.md) phase 3 (masking, access requests) can start after G-2. It needs the owner to route requests to, and the column classification for default masks.

## 7. Risks and open questions

- **Member search on large organizations.**
  - The Keycloak organization members call is paged and uncached today.
  - Mitigation: cache it per tenant for 60 s and search server-side.
  - Fall back to `iam_principals`, people who have signed in at least once. That fallback cannot find someone who has never signed in.
- **Columns keyed by name.**
  - Renaming a column orphans its annotations and rules.
  - The schema grid lists *removed columns* that still carry annotations, and a steward can move them to the new name.
  - Rules on a missing column evaluate as errors, not failures.
- **Whole-table cost.**
  - A library rule set is one aggregate pass, and `count(DISTINCT)` on wide tables is the expensive part.
  - The quality job uses the DQ memory and spill settings, and a per-workspace cap of 2.
  - Schedules shorter than one hour are refused.
- **Detector rules see the sample.** "0 PII findings in `comment`" means none in the scanned rows. The rule's description says so, and `rows_checked` is the sample size from the run.
- **Owner leaves the company.**
  - The person stays as a `user:` ref and shows as "Former member" (`ActorDirectoryService`).
  - The checklist marks the owner item as needing attention.
  - G-5 tells the stewards.
- **Masking is display protection, not anonymisation** (DQ §7). Classification drives what is hidden by default, but people who can query a column can infer from it.

## 8. Testing and acceptance

| Level | What |
| --- | --- |
| API unit | Role constraints (OWNER person-only, CUSTODIAN group-only, one active owner, replace closes the old row), inheritance and override, the owner/steward resource check (and that it opens nothing workspace-wide and no `data.query`), audit resources, checklist, the library-rule compiler (one SELECT, quoting, percent), threshold operators and between bounds, score weights, finding upsert/resolve, contract export round-trip and import report |
| Migration | Glossary stewards: exact match → ref, ambiguous and unmatched → notes |
| CLI unit (`tests/test_query.py` style) | Mode `quality`: aggregate over Parquet/CSV/Delta, SQL rule returning one number, refused SQL (gate), timeout, no rows in the output |
| Personas (`scripts/dev/iam-personas.sh`) | A viewer cannot assign an owner; a person made steward of one table can edit it and nothing else; an owner cannot query without a grant |
| Dev stack smoke (`skaffold dev --profile dev`, web on :3000, signed in as `admin` / `admin`; workspace `lakehouse-lab`) | Assign owner → Draft → Active; a null rule failing on `shop_lake.shop.orders`, its QUALITY finding, fix the data, the finding resolves; a PII detector rule on a column; ODCS export validates against the ODCS JSON schema |
| Playwright (`apps/e2e`, run against the same skaffold stack as `admin` / `admin`) | Assign an owner on a table → governed badge; add a column rule → Run now → result shown |

## 9. As built

### G-1, 2026-11-12

- **Code**: `apps/api/src/governance/` (rules, filter, service, controller, DTOs), migrations `20261112120000_asset_governance` and `20261112130000_glossary_steward_ref`; web `apps/web/components/governance/` (badge, principal and steward pickers, ownership card, asset Overview, source ownership), `lib/governance.ts`.
- **Routes** declare `asset.view`; the service decides who may change (R3) and writes its own audit events (`governance.update`, `governance.status.<s>`, `governance.role.<kind>.assign|remove`, resources `governance`, `asset:`, `source:`). Resolving owners and stewards per request in the namespace hook (as §5.2 proposed) was not needed: the service reads the rows of the one asset and its source on each change.
- `CLS_ORG_ID` (the tenant's Keycloak organization) is set by the namespace hook, so `ActorDirectoryService` names `group:` refs (`Removed group` when gone) and the service checks that a named person or group exists in the tenant. Tenant members are cached 60 s per organization in the service.
- An asset is governed when it or its source has an open OWNER; the record is created on the first description or lifecycle change. ACTIVE needs an owner (409 otherwise) and stamps `certifiedAt/By`.
- **Asset search**: `assets.governance` (`ungoverned|governed|draft|active|deprecated|retired`), `ownerRef`, `stewardRef` (`me` = the signed-in person, with their groups for stewards); every result row carries `governance {status, ownerRef}`. The assets table has a Governance filter (incl. *Owned by me*, *Stewarded by me*) and column. The CSV export does not apply the governance filter yet.
- **Glossary stewards** are `user:`/`group:` refs: the API refuses text (400); CSV/SKOS imports move text into the notes (`Steward (as imported): …`); glossary packs carry no steward any more (`glossary_pack.json`). The migration matched free text to people who have signed in (`iam_principals` e-mail or display name, exactly one) and moved the rest into the notes.
- `asset.govern` is held by Curator, Workspace admin, Workspace manager and Tenant admin.
- **Smoke, 2026-11-12** (skaffold dev stack, signed in as `admin`, workspace `lakehouse-lab`): a visitor sees *Ungoverned* and no controls; the admin picked an owner from the tenant's people (only people offered) → *Draft* and the owner in the header; description (Markdown) and retention saved; a group as steward (people and groups offered); *Certify* → *Certified*; a custodian group on the source shows as inherited on its assets, coverage "1 of 4 assets owned · 1 certified"; `?governance=active` lists the one asset with its owner. Refused as designed: certifying an unowned asset (409), a group as owner and an unknown person (400), an unknown filter value (400), a glossary steward given as text (400). Four audit events tagged `governance`/`asset:`/`source:` with field names only. Migrations ran in the three tenant databases; no workspace had a glossary steward to migrate.
- **Not verified live**: a steward or owner without a workspace role editing their asset (unit-tested; the smoke personas' passwords are random per seed run), the Playwright step and the persona checks of §8.

### G-2, 2026-11-12

- **Columns**: `asset_column_annotations` (migration `20261112150000_asset_column_annotations`), keyed `(asset_id, column_name)`, term FK `ON DELETE SET NULL`. `GovernanceColumnsService.state` joins `metadata.columns` with the annotations and with open findings grouped by `metadata->>'tabular_column_name'`; findings without a column are counted (`findingsWithoutColumn`, older scans and free-text PII). Routes: `GET assets/:id/columns`, `PUT assets/:id/columns/:name` (business name, description, term, CDE, classification, `reviewClassification`), `POST …/:name/move` (a removed column's annotations to the column it became; refused when the target has some), `DELETE …/:name`; writes need the same rights as G-1 and are audited `governance.column.update|move|remove`.
- **Classification**: `public, internal, confidential, personal, sensitive, secret`. Derived: SECRETS → secret; PII national ids, card and account numbers (`CREDIT_CARD`, `IBAN_CODE`, `US_SSN`, …) → sensitive; other PII → personal; other detectors classify nothing. A steward's value wins and counts as reviewed; *Confirm* reviews the derived one. The checklist gains *Column classification reviewed* for assets with columns: done when every column findings classify has been reviewed.
- **Usage** (`GET assets/:id/usage?days=30`, needs `activity.view`): reads and exports per day, distinct readers, top five, export formats, from `audit_events` tagged `asset:<id>` with `query-runs.read-table` / `query-runs.export-table.*`.
- **Governance page** (`/<ws>/governance`, sidebar under Intelligence; `GET governance/summary`): totals, coverage per source (owned = own or source owner), *Govern these first* (ungoverned assets by reads in 30 days, top 10), *Yours* (links to the assets list filtered `mine` / `stewarding`), and the governance activity (`resource=governance`).
- **MCP**: `get_asset_governance` (governance + columns) and `set_asset_owner` in the `assets` group. `set_asset_owner` needs `asset.govern`: a token's tools are filtered by role capabilities, so an owner or steward without the role governs over REST only. MCP requests now carry the tenant's organization (`CLS_ORG_ID`) so people can be checked and named.
- The metadata card hides its column list when the columns card shows them.
- **Smoke, 2026-11-12** (skaffold dev stack, `admin`, `lakehouse-lab`): `delta_orders` lists `id` and `email`; `email` classified *Personal data* from its PII finding, marked to review; 11 open findings name no column (older scans). Business names, a critical-data-element flag and *Save and confirm* from the dialog → the checklist's *Column classification reviewed* turns done. Usage shows the real 4 reads by 2 people with the top readers. The Governance page shows 34 assets, 1 owned and certified, coverage per source, ten ungoverned tables read in 30 days (`orders` 6 reads first), and the governance activity. Refused: an unknown classification (400), a column the table does not have (404). Not verified live: the MCP tools (unit-tested registration and capability), moving a removed column (no renamed column on the dev stack).

### UI rework and owner reads, 2026-11-12

- **Governance tab** on the asset and the source page, one centred column of steps with the source editor's stepper beside it (`components/governance/governance-steps.tsx`; `StepperNavItem.complete` lets a step tick by its checklist item, not its position). Asset steps: Ownership, Description, Meaning, Columns (tables), Certification; the certification card's checklist jumps to the step that fixes an item. Source steps: Ownership, Coverage (owned / certified / ungoverned, links to the assets list filtered by source and governance).
- **Overview** keeps a summary only (`governance-summary.tsx`): lifecycle, owner, stewards, custodian, the start of the description, checklist progress, and *Open governance*; the asset Overview also shows Usage and the technical metadata (with its column schema again).
- **Meaning, redesigned** (`meaning-step.tsx`, API `GET|POST assets/:id/governance/meaning`, `DELETE …/meaning/:termId`, `POST …/meaning/suggestions/:id/dismiss`): terms as chips (hand-made ones removable, ones from bindings or the source marked *auto*), suggestions to add in one click — open semantic LINK suggestions, and glossary concepts matching the table's or its columns' names (`nameQuery`) — and a search that adds as you pick or creates the term (with `glossary.edit`). Links are the semantic layer's manual links, made under governance rights instead of `glossary.edit`, and show at once (marked pending) before the linker rolls them into `asset_terms`; the checklist counts them too. Accepting a term closes its pending LINK suggestion.
- **Role rights shown** in the ownership step, per role. **Owner reads**: `QueryCatalogService.scope()` adds the tables and sources the caller owns (`ownerDataScope`), so the catalog, the run pre-check and the job all honour it; export still needs `data.export`.
- Smoke (2026-11-12, `admin`): Overview summary and *Open governance*; steps tick from the checklist (Meaning open, then ticked after creating and adding *Customer order* in one click); compact columns table; source Governance tab via `?tab=governance` and from the summary. Not verified live: an owner without a role querying their table (no persona with a known password).

### G-3, 2026-11-12

- **Model** (migration `20261112170000_quality_rules`): `quality_rules` (ODCS fields; `key` unique per asset; `threshold` JSON number or `[low, high]`), `quality_evaluations` (trigger `scan`/`manual`, counts), `quality_results` (value, passed, error; every evaluation kept — no purge yet), and `DetectorType.QUALITY`.
- **Rules** (`governance/quality-rules.ts`, unit-tested): types `detector` (metric `openFindings`: open findings on the asset, optionally one column via `tabular_column_name`, filtered by detector type, custom detector key, finding type or category; QUALITY findings never count) and `metadata` (`rowCount` from `metadata.row_count`; `freshness` = hours since the asset was last scanned — no source records a shared "data changed at", so this is scan freshness). Eight ODCS operators, between bounds inclusive. Severity weights CRITICAL 8, HIGH 4, MEDIUM 2, LOW 1, INFO 0.
- **Evaluation** (`QualityService`): after every scan, `POST sources/:id/assets/finalize` evaluates the enabled rules of the assets the run wrote (`assets.runner_id`), after findings are reconciled; never fails the run. Also on *Run now* and right after a rule is created or changed. A measuring error (no row count recorded) is kept as an error and leaves the finding as it is.
- **Findings bridge (R9)**: a failing rule upserts one finding, `detectionIdentity = sha256('quality:<ruleId>')`, `detectorType QUALITY`, `category QUALITY`, `findingType quality:<key>`, the rule's severity, `matchedContent` like `notes: 3 findings (must be 0) — No personal data in notes`; a passing result resolves it ("Quality rule passes again"), a new failure reopens what the system resolved, a person's FALSE_POSITIVE/IGNORED stands. Deleting a rule resolves its finding. Scan clean-up of removed detectors skips QUALITY findings.
- **API**: `GET assets/:id/quality`, `POST assets/:id/quality/rules`, `PUT|DELETE quality-rules/:ruleId`, `POST assets/:id/quality/run`, rights as for the rest of governance, audited `governance.quality.*`. The checklist gains *Quality rules passing*.
- **Web**: a *Quality* step in the Governance tab (score, rules with status, measured value, a bar per kept result, the open finding, edit/delete, *Run now*, *Add rule* with *From findings* / *From the scan* builders that name the rule for you); the Overview summary shows the score and failing rules.
- **Smoke, 2026-11-12** (skaffold dev stack, `admin`, `lakehouse-lab` `delta_orders`): three rules — no PII in `email` (HIGH, measured 1 → failing, a QUALITY finding `quality:no-personal-data-in-email` opened), table not empty (11 rows, passing), scanned in the last 30 days (218.4 h, passing) — score 43 (HIGH 4 failing of 7 weight). Loosening the PII rule resolved the finding ("Quality rule passes again"), tightening it reopened it (history DETECTED → RESOLVED → RE_OPENED); a duplicate key answered 409, a bad between threshold 400. A rule added and deleted from the UI resolved its finding ("Quality rule deleted"). A real scan of the source (run `79554461…`) wrote an evaluation with trigger `scan`: 3 rules, 1 failing. QUALITY findings show in the findings search.

### G-4, 2026-11-12

- **No new job mode**: library and sql rules of one table compile (`quality-sql.ts`) into one SELECT — `COUNT(*)` as `q__rows`, then one column per rule (`SUM(CASE WHEN … THEN 1 ELSE 0 END)` for null, missing and invalid values with `validValues`/`pattern`, `COUNT(c) - COUNT(DISTINCT c)` or a `SELECT DISTINCT` subquery for duplicates, the sql rule's own SELECT as a scalar subquery with `{object}`/`{property}` substituted). `QueryRunService.createSystem` runs it as the existing `query` job over that one table, CSV result, `actorRef system:quality`, `query_runs.purpose = 'quality'`; at most 2 at once per workspace (beyond that the rules record an error and run next time). The job's SQLGlot gate still decides. Reads are audited `quality.read-table` and stay out of the Usage card. Percent units divide by `q__rows`.
- **Asynchronous**: detector and metadata rules are measured inline as before; table rules get their own `quality_evaluations` row (`status running` → `done`/`error`, `query_run_id`), one table after another in the background, and `AssetQuality.measuring` tells the page to follow (it polls every 4 s). A rule that cannot be compiled (an unknown column) or a table SQL cannot read records an error, not a failure.
- **Schedules** (migration `20261112190000_quality_whole_table`: `quality_rules.schedule`, `last_scheduled_at`, `quality_evaluations.status/query_run_id`, `query_runs.purpose`): `hourly`, `daily` (06:00 UTC), `weekly` or a 5-field cron whose minute is one number (at most hourly). `QualityWorker` (per namespace, pg-boss queue `governance-quality-tick`, every 5 minutes) runs the rules whose cron came due since `last_scheduled_at` (70-minute catch-up window). Rules with a schedule no longer run after every scan; the others still do.
- **ODCS** (`odcs.ts`, `yaml` 2.x added to the API): `GET assets/:id/contract?format=yaml|json` writes v3.2 — `id` (URN or `asset:<id>`), `version 1.<governance changes>.0`, `status`, `description.purpose/usage/limitations`, `authoritativeDefinitions` (`term://glossary/<key>`), `team.members` (e-mail or group path; ended roles with `dateOut`, `replacedByUsername`), one schema object with `properties` (`physicalType`, `logicalType`, `businessName`, `classification`, `criticalDataElement`, the column's term) and `quality` at object and property level (library and sql as ODCS; detector and metadata as `type: custom`, `engine: classifyre`, `implementation` JSON), `slaProperties` (`latency` from freshness rules, `retention`), `customProperties` (`legalBasis`, `qualityScore`). `PUT assets/:id/contract {contract: text}` applies one: team (people by e-mail or username, groups by path or name), description and status, column annotations, rules upserted by key (one evaluation after), and answers `{applied, skipped[{path, reason}]}` — other engines, unknown columns, people or classifications are skipped with the reason. Round trip unit-tested through YAML.
- **Web**: the rule dialog has four kinds — *Check a column* (null, missing, invalid with allowed values or a pattern, duplicate values, row count; rows or % of rows), *SQL* (a query with `{object}`/`{property}`), *From findings*, *From the scan* — and *When* (after each scan, hourly, daily, weekly) for the first two; a clock marks scheduled rules; *Measuring the table…* while a query is out. The Certification step gains a *Data contract* card: download YAML or JSON, apply a contract, and the report of what was applied and skipped.
- **Smoke, 2026-11-12** (skaffold dev stack, `admin`, `lakehouse-lab` `delta_orders`, Azure Delta table): five whole-table rules — no empty `email`, unique `id`, ≤ 10 % of `email` not matching `^[^@]+@[^@]+$` (daily), at least 10 rows, and the sql rule `SELECT COUNT(*) FROM {object} WHERE {property} NOT LIKE '%@lab.example.com'` — measured through system `query` jobs in 5–9 s each: 0, 0, 0 %, 11, 0, all passing. Raising the row count to ≥ 100 failed it (11) and opened its QUALITY finding. Reads audited `system:quality` / `quality.read-table`, not in the Usage card. Creating rules in a burst first hit the 2-query cap and recorded errors; system runs now wait for a free slot (up to five minutes). ODCS: the YAML export (129 lines) re-imported cleanly — 8 rules, 2 columns, nothing skipped, roles unchanged; an extra engine (`soda`) and an unknown column were skipped with reasons; `kind: Something` answered 400. Re-importing first gave the asset its own copy of the custodian it inherits from the source: inherited roles now count as held. An evaluation whose API restarted mid-query stayed `running`: *Measuring* now looks back 10 minutes only, and the worker tick closes such evaluations. Not verified live: a schedule firing (the tick runs every 5 minutes; `dueRules` is unit-tested), and an owner or steward without a role (the `test` user is a tenant admin).

### G-5, 2026-11-12

- **Role changes need `asset.govern`** (R3 changed): `assign`/`remove` check the capability itself; owners and stewards still edit description, meaning, columns, quality and lifecycle. `AssetGovernanceDto` and `SourceGovernanceDto` carry `canAssignRoles`, and the ownership card offers *Assign*, *Change* and *End* only then. A contract import by an owner without the role skips its team members with that reason.
- **Notifications to people** (migration `20261112210000_governance_notifications`): `NotificationType.GOVERNANCE`, `notifications.audience_person_refs` (GIN). `NotificationsService.createFor(dto, {personRefs, groupIds})` sends to people by `user:` and groups by id; a person sees what names them or one of their groups; the owning-group fallback applies only to notifications with no audience at all. The socket gateway emits to the person rooms too. GOVERNANCE is left out of the per-type group audiences in Settings.
- **What is sent** (`GovernanceNotifier`, never failing the change): *You are now owner/steward/custodian of …* to the person or group named (not when you name yourself); *Quality rule failing on …* to the asset's owner and stewards (own or the source's) when a rule starts failing or fails again after passing — not on every failing evaluation — with the rule's severity and its finding; *… was certified / deprecated / retired / set back to draft* to the owner and stewards other than the person who changed it. All link to the Governance tab. Access requests come with DQ phase 3.
- A person in a group named as steward still hears of a change they made themselves through that group: only the actor's own reference is left out.
- **Smoke, 2026-11-12** (skaffold dev stack, `admin`, `lakehouse-lab` `iceberg_contacts`, owner Tests Bla): naming the `admins` group steward sent *Your group is now steward of iceberg_contacts* to that group only; a failing row-count rule sent *Quality rule failing on iceberg_contacts* (HIGH) to the owner by name and the steward group; certifying sent *iceberg_contacts was certified* to the same, not to the admin by name. Admin saw them in the notification list as type GOVERNANCE, linked to the Governance tab. Not verified live: an owner or steward without `asset.govern` being refused a role change (unit logic; no such login on the dev stack), and the socket push to a person's room.


### Redesign and change trail, 2026-11-12

- **Activity says what changed** (migration `20261113090000_audit_changes`: `audit_events.changes JSONB`): `AuditTrailService` takes `changes: [{field, from, to}]`, values cut to 200 characters, and the audit list returns them. Every governance change fills it: roles by name (a steward added shows the stewards before and after; an owner shows the one replaced), each edited field of the description and lifecycle (`status DRAFT → ACTIVE`), terms linked, unlinked or dismissed by name, column annotations per field, quality rules as one line when added or removed and per changed field when edited, column moves, and what a contract import applied and skipped. The Activity table shows them as *field: from → to* and names governance operations (*Steward added*, *Certified (active)*, …) with the raw operation underneath. The ownership card no longer lists ended roles: *Last changed by … · History* (the audit trail) sits at the top of both Governance tabs instead.
- **Asset Governance tab** uses the page's full width; it opens with four tiles — status, owner, checklist progress, quality — each a jump to its step. Roles have one icon each everywhere (`role-style.tsx`: owner a crown, steward a book with a tick, custodian a wrench) and the ownership card is three tiles side by side.
- **Certification** shows the checklist as icon tiles (done ones lime) with a progress bar, and the lifecycle as a track Draft → Certified → Deprecated → Retired with the current state marked and the moves from it as buttons.
- **Quality checks are built like a source** (`quality-rule-builder.tsx`): choose what (*Column values*, *SQL query*, *Findings*, *Scan facts* — the first two only on tables SQL can read), then a template or blank, then one form in sections (*What is measured*, *When it fails*, *Name and timing*). Columns come from the table as chips with their type and open-finding counts; findings templates and selects come from `GET assets/:id/quality/options` (columns, SQL name, row count, last scan, open findings by detector, finding type, custom detector and column, with counts); scan-fact templates show today's row count and age; the SQL form shows what `{object}` and `{property}` stand for and the query as it will run. A side panel reads the check as a sentence and runs it: `POST assets/:id/quality/test` measures without saving or touching findings (table checks run their system query and wait up to a minute), returning the value, pass or fail, rows checked, time, the query that ran and what its finding would say; editing after a test marks the result stale. A *How a quality check works* strip explains the lifecycle: define and test → measured (after scans, on schedule, on *Run now*) → every result kept → a failure opens one finding and tells owner and stewards → a pass resolves it.
- **Quality shows where assets are listed**: search results carry `governance.quality {rules, failing, score}`; the assets table has a *Quality* column with a chip (red with the failing count, lime at 100, amber below) and a *Failing quality* governance filter (`governance=failing`: assets with an open QUALITY finding); the asset header shows the same chip, a click opens the Governance tab.
- **Source Governance tab** has no stepper: five coverage tiles (assets, owned, certified, ungoverned, failing quality — `SourceGovernanceCoverageDto` gains `checked` and `failing`) linking to the filtered assets list, the shared ownership card, and coverage bars.
- **Smoke, 2026-11-12** (skaffold dev stack, `admin`, `lakehouse-lab` `delta_orders`): adding *Tests Bla* as a second steward recorded `steward: bla → bla, Tests Bla`, shown in History as *Steward added*. A new *Column values → Only allowed values* check on `email` with a pattern was test-run twice before saving (0 of 11 rows invalid, passing, 13 s; with a pattern no row matches, 11 rows, failing, and the finding text it would raise) and saved as *Only valid email*, recorded as `rule only-valid-email: — → Only valid email: invalidValues on email mustBe 0 (MEDIUM)`; the test runs created no rule. Test runs through the API: findings (PII in `email`, 1, failing), scan facts (5.5 h, passing), SQL (`{object}`/`{property}` resolved, 0 of 11, passing). Options listed 2 columns, 12 open PII findings by type and column, the SQL name and 11 rows. `governance=failing` listed the two assets with failing checks, the Quality column showing *Quality 81 · 1 failing*; the source tab showed 4 assets, 2 owned, 2 certified, 2 ungoverned, 2 of 2 checked failing.
