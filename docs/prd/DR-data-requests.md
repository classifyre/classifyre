# PRD DR · Data requests: cases that ask a data team for a dataset

|                  |                                                                                                                                                                                                 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**       | In progress, 2026-11-24                                                                                                                                                                         |
| **Size**         | L (5 phases)                                                                                                                                                                                    |
| **Depends on**   | [DQ](DQ-data-query.md) §5.12 shared datasets (versions, owning and audience groups, `describe`, publish rights), §5.9 access requests (approval pattern); [IAM](IAM-access-management.md) groups |
| **Fulfils**      | DQ §5.13, "a business user's request turned into a first SQL"                                                                                                                                  |
| **Not in scope** | materialised datasets, datasets over datasets (DQ §5.13), per-person routing rules, SLAs and due dates, AI drafting of the spec from free text (MCP `create_data_request` is enough)           |

## 1. Summary

Classifyre sells governed data access. Investigations (inquiries, cases, Autopilot) stay as they are. **Cases** become the umbrella for two kinds of work:

- **Investigation**: the existing case board, unchanged.
- **Data request** (new): a business user describes the dataset they need on a canvas.
  - They place governed tables, draw column-to-column joins, tick the columns to keep, add filters and pin comments.
  - The canvas writes valid SQL live.
  - The request is routed to a data-team **group**, which sees it on the dashboard and in notifications.
  - The team publishes a **shared dataset** from it, or links an existing one. The requester is notified and can use it.
  - The requester can ask for changes, and each delivery is a new dataset version.
  - If the requester could publish the dataset themselves, they get **Publish now** (self-serve).

Most of what's needed already exists:
- Shared datasets: versions, owning and audience groups, `describe`, publish-rights check.
- Access requests: the pattern for approval flows.
- `NotificationsService.createFor` for group notifications.
- Case timeline, threads, presence and live sync.
- The Monaco `SqlEditor` with catalog completion.
- `@xyflow/react` and the `@workspace/case-board` primitives.

## 2. Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| What the canvas does with a join | **Visual join builder.** Table cards with column rows; dragging one column onto another makes a join. The canvas generates the SQL live; the data team can override it by hand. | Simple requests need no SQL at all; complex ones carry comments and a hand-written query. |
| Which tables a requester may place | **Any catalog table**, including tables they can't read. Columns are shown, rows are not. | The real case is "I need data I don't have yet". |
| Whose access the SQL is checked against | The **routed group's**, never the requester's. The dataset runs with the data team's rights and is shared with the requester's group. The requester never gets raw-table access. | It's the shared-dataset model (DQ §5.12), unchanged. |
| Data model | **Case + `kind` + a 1:1 `DataRequest` extension.** Investigation statuses, filters and automation are untouched. | Reuses title, priority, assignee, timeline, threads, lists and cards. |
| Where the canvas is stored | On `DataRequest.spec` (JSON), **not** in the board's item and link tables. | Board writes need `case.edit`, which business users lack. Adding item kinds would touch every exhaustive switch in autopilot, MCP, layout and thumbnails. |
| Priority | Reuse `Severity`, labelled "Priority" on requests, with INFO hidden. | Lists already sort and filter by severity; a second axis adds nothing. |
| Routing targets | Groups that hold `dataset.publish`. A team member **claims** the request and becomes its assignee. The team can **reroute** it. | Covers both "a group" and "a specific person". |
| Notifications | `NotificationType.GOVERNANCE` with new events. | Access-request and dataset events already do this; no enum or settings-UI change. |

Limit from the code: tables the requester can't query appear in the catalog only if they hold `asset.view` (`QueryCatalogService.catalog()`, `seeLocked`). The built-in `viewer` role has it; `data-reader` alone does not.

## 3. States

`DRAFT → SUBMITTED → IN_PROGRESS → DELIVERED ⇄ CHANGES_REQUESTED`, ending in `DECLINED` or `WITHDRAWN`.

`Case.status` is derived from the request state by one pure function, `caseStatusFor(state)`, so existing lists and filters keep working:

| Request state | Case status |
| --- | --- |
| DRAFT, SUBMITTED | OPEN |
| IN_PROGRESS, CHANGES_REQUESTED | IN_PROGRESS |
| DELIVERED, DECLINED, WITHDRAWN | CLOSED |

The allowed transitions live in `data-request-rules.ts` as a pure `transition(state, action, role)` table, with roles *requester*, *team* (members of the route group) and *manager* (`case.manage`).

## 4. Design

### 4.1 Data model

Migrations are hand-written idempotent SQL in `apps/api/prisma/migrations/<ts>_<name>/migration.sql`, applied per tenant by `src/database-migrations.ts`. Enums go in their own migration.

**`…_case_kind_enums`:**
- `CaseKind { INVESTIGATION DATA_REQUEST }`
- `DataRequestState { DRAFT SUBMITTED IN_PROGRESS CHANGES_REQUESTED DELIVERED DECLINED WITHDRAWN }`
- New `CaseActivityType` values: `REQUEST_SUBMITTED`, `REQUEST_CLAIMED`, `REQUEST_REROUTED`, `REQUEST_SQL_EDITED`, `REQUEST_DELIVERED`, `REQUEST_CHANGES_REQUESTED`, `REQUEST_DECLINED`, `REQUEST_WITHDRAWN`, `REQUEST_REOPENED`

**`…_data_requests`:**
- `Case.kind CaseKind @default(INVESTIGATION)`, indexed. Set at creation, never changed: no create or update DTO takes it.
- `DataRequest` (table `data_requests`):
  - `caseId` (PK, FK to cases, cascade delete)
  - `requesterRef`, `routeGroupId`, `audienceGroupId`, `assigneeRef?`, `state`
  - `spec Json`, `specVersion Int`, `draftSql Text`, `sqlEdited Bool`
  - `lastCheck Json?`, `lastCheckSqlHash?`
  - `datasetAssetId?` (FK to `shared_datasets.asset_id`, SetNull), `deliveredVersion Int?`
  - `declineReason?`, `submittedAt?`, `deliveredAt?`, `closedAt?`, timestamps
  - Indexes on `[routeGroupId, state]`, `[requesterRef]`, `[datasetAssetId]`
- `DataRequestDelivery`: keeps a snapshot of what was asked, even when the request is later linked to another dataset.
  - `id`, `caseId`, `round`, `datasetAssetId`, `datasetVersion`, `sqlSnapshot`, `specSnapshot Json`
  - `mode` PUBLISHED | LINKED | UPDATED | SELF_SERVE
  - `deliveredBy`, `note`, `createdAt`

### 4.2 Spec and SQL generator

The new file `packages/schemas/src/data-request.ts`, exported as `./data-request`, holds the spec as a zod schema:
- `tables[{id, assetId, sqlName, alias, x, y, keep[], filters[]}]`
- `joins[{id, left{tableId, column}, right{tableId, column}, type INNER|LEFT}]`
- `pins[{threadId, anchor:{tableId, column?}|null, x, y}]`

`generateRequestSql(spec, lookup) → {sql, diagnostics}` follows these rules:
- Tables are written as **unquoted** `source.schema.table`. `sql-names.ts` guarantees plain lower-case names, and `precheckSql` blanks quoted identifiers, so a quoted table name would be refused.
- Columns are written `alias."Col"`, quoted only when they don't match `^[a-z_][a-z0-9_]*$` or are reserved words.
- Literals are escaped and coerced by column type. Output aliases are `<alias>_<col>` when names collide.
- JOINs are ordered by BFS from the first table. Several joins between the same pair become one ON with AND.
- A table not joined to the others is an error, never an implicit CROSS JOIN.
- Formatting is deterministic. Limits: 12 tables, and `MAX_SOURCES_PER_QUERY` sources.

`specToSketch(spec)` turns the spec into a sketch for case-card thumbnails, drawn with the existing `BoardSketchCanvas`.

`packages/schemas` has no test runner, so the generator is tested from the API's jest suite.

### 4.3 Checking SQL as the routed group

Today `SharedDatasetsService.describe` runs as the caller. The smallest change:
1. `QueryRunService.describe(sql, opts?: {principal?: DataPrincipal})` passes the principal into `begin()`, which uses `catalog.catalog(principal)` for the allowed tables and masks. The actor still owns the run, for the rate cap and the audit.
2. `SharedDatasetsService.describeForGroup(sql, groupId)` reuses the body of `describe()` with the principal from `SharedDatasetResolver.principalForGroup`. Its problems come only from `inputsOf` and `groupCanQuery`; it skips the caller checks in `shareProblems`.
3. The group always comes from `DataRequest.routeGroupId` on the server, never from the client.
4. Only the requester, members of the route group and `case.manage` holders may call it. A describe reads no rows, but it still reveals column lineage.

### 4.4 API (`apps/api/src/data-requests/`)

Files: module, controller, service, dto, `data-request-rules.ts`, `data-request.notifier.ts`.
- The controller uses `@SignedInOnly()` and `@Requires('workspace.view')` on every route, which `route-access.completeness.spec.ts` checks.
- Per-request role checks happen in the service, the way `access-requests/` does them.

| Route | Who can use it | Effect |
| --- | --- | --- |
| `GET /data-requests/options` | anyone | Route groups, the caller's groups as audience, a `canSelfServe` hint |
| `GET /data-requests?scope=mine\|team\|all` | anyone; `all` needs `case.view` | Lists. Drafts are visible only to the requester |
| `POST /data-requests` | anyone | Creates Case(DATA_REQUEST) + DataRequest(DRAFT) in one transaction |
| `GET /:id` | requester, route and audience members, `case.view` | Request, spec, deliveries, and the live dataset status: ok, retired, blocked, unavailable or removed |
| `PUT /:id/spec {spec, baseVersion}` | requester while DRAFT, SUBMITTED or CHANGES_REQUESTED; team in any open state | The server regenerates the SQL unless `sqlEdited` |
| `PUT /:id/sql {sql, baseVersion}` | team only | Sets `sqlEdited`; `{regenerate:true}` clears it |
| `POST /:id/check` | requester, team | Fast static check: `precheckSql` against the route group's catalog, `groupCanQuery` per table, masked and hidden columns. No job |
| `POST /:id/describe` | requester, team | `describeForGroup`; result cached in `lastCheck` by SQL hash |
| `POST /:id/submit` | requester | DRAFT → SUBMITTED; notifies the route group |
| `POST /:id/withdraw` | requester | Any open state → WITHDRAWN |
| `POST /:id/claim {assigneeRef?}` | team, `case.manage` | → IN_PROGRESS |
| `POST /:id/reroute {groupId}` | team, `case.manage` | Notifies the new group |
| `POST /:id/deliver {datasetAssetId, note?}` | team; the requester only if they created the dataset (self-serve) | Records a delivery at the dataset's current version → DELIVERED |
| `POST /:id/request-changes {reason}` | requester | DELIVERED → CHANGES_REQUESTED; notifies the group; the reason is also posted as a comment |
| `POST /:id/decline {reason}` | team | → DECLINED |
| `POST /:id/comments` | requester, team | Creates a DISCUSSION thread through `CaseThreadsService` and adds the pin |

### 4.5–4.7, 5–8

See the full design specification in [2026-11-24-data-request-cases-design.md](../superpowers/specs/2026-11-24-data-request-cases-design.md).
