# PRD GOV · Governed data assets: owners, business metadata, quality

|                  |                                                                                                                                                     |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**       | G-1 (ownership) built 2026-11-12, §9; G-2–G-5 proposed                                                                                              |
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
| R3  | The owner and the stewards of an asset (or of its source) can edit its governance without a workspace role that gives `asset.govern`. Ownership never gives `data.query`. |
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

It is a read-only aggregate, so no new storage is needed. DQ phase 5 (JDBC/ODBC) writes the same events, so BI tools show here too. On the workspace Governance page, *ungoverned tables by reads* uses the same query grouped by asset.

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
| G-2 | **Business metadata**: column annotations and the editable schema grid, derived column classification and overrides, Usage card, checklist and coverage, Governance page, MCP tools | Proposed |
| G-3 | **Quality from what we have**: `quality_rules` / `quality_evaluations` / `quality_results`, `detector` and `metadata` rules evaluated in `finalizeIngestRun`, QUALITY findings bridge, score, Quality tab | Proposed |
| G-4 | **Quality over whole tables**: `library` and `sql` rules, job mode `quality` and the system run path, per-rule schedules, ODCS contract export and import | Proposed |
| G-5 | **Telling people**: per-person notifications (owner or steward assigned, rule failing, access request waiting; the last one with DQ phase 3) | Proposed |

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
