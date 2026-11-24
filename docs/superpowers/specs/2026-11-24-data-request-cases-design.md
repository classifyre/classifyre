# Design Spec · Data Requests: Cases That Ask a Data Team for a Dataset

| | |
| --- | --- |
| **Date** | 2026-11-24 |
| **PRD** | [DR · Data requests](../../prd/DR-data-requests.md) |
| **Status** | Approved for implementation (direct on `develop`) |
| **Depends on** | DQ §5.12 shared datasets, DQ §5.9 access requests, IAM groups |

## 1. Goals & Scope

Cases become the shared umbrella for two kinds of work:
1. **Investigation** (`CaseKind.INVESTIGATION`): existing case board, statuses, inquiries, evidence, Autopilot, and automation — unchanged.
2. **Data request** (`CaseKind.DATA_REQUEST`): a business user builds a dataset request on a visual join canvas, routes it to a data-team group (any group holding `dataset.publish`), and receives a versioned shared dataset published or linked by that team (or self-serves if they can publish it themselves).

Out of scope:
- Materialised datasets and datasets over datasets (`shared.*` tables are excluded from the request canvas catalog).
- Per-person routing rules, workspace allow-lists of routing groups, SLAs/due dates, decline-to-access-request shortcut links, and AI free-text drafting (MCP `create_data_request` covers agent creation).

## 2. Architecture & Key Decisions

- **Data model:** `Case.kind` (`INVESTIGATION` | `DATA_REQUEST`, immutable after creation) + 1:1 `DataRequest` extension (`data_requests`) + `DataRequestDelivery` (`data_request_deliveries`). Canvas state lives on `DataRequest.spec` JSONB (never in board item/link tables), avoiding `case.edit` requirements for business users and keeping Autopilot/board item switches untouched.
- **State machine:** `DRAFT → SUBMITTED → IN_PROGRESS → DELIVERED ⇄ CHANGES_REQUESTED`, terminal states `DECLINED` and `WITHDRAWN`, codified in a pure `data-request-rules.ts` transition table with roles `requester`, `team` (member of `routeGroupId`), and `manager` (`case.manage`). `Case.status` is derived via `caseStatusFor(state)`: `DRAFT|SUBMITTED → OPEN`, `IN_PROGRESS|CHANGES_REQUESTED → IN_PROGRESS`, `DELIVERED|DECLINED|WITHDRAWN → CLOSED`.
- **SQL generation:** `@workspace/schemas/data-request` (`packages/schemas/src/data-request.ts`) holds the Zod schema for `spec` (`tables`, `joins`, `pins`), deterministic `generateRequestSql(spec, lookup)` (unquoted `source.schema.table`, minimally quoted columns, typed literals, BFS join ordering, disconnected table error, 12-table cap and `MAX_SOURCES_PER_QUERY`), and `specToSketch(spec)` for `BoardSketchCanvas` thumbnails.
- **Permission evaluation:** SQL is always checked and described against the routed group's principal (`DataRequest.routeGroupId` read server-side) via `QueryRunService.describe(sql, { principal })` and `SharedDatasetsService.describeForGroup(sql, groupId)`. Requesters see catalog columns (with `asset.view`) and masks, never rows or preview.
- **Delivery:** `POST /data-requests/:id/deliver` verifies the dataset exists and that `audienceGroupId` has `canQuery`, records a `DataRequestDelivery` snapshot at the dataset's current version, transitions to `DELIVERED`, and notifies the requester. Creation/update of the shared dataset itself uses the existing `ShareDatasetSheet` with a new `preset` prop.
- **Real-time & Notifications:** Optimistic concurrency via `baseVersion` (409 on stale write); live broadcasts over `/case-board` (`CASE_BOARD_EVENTS.emitChanged`); `NotificationType.GOVERNANCE` notifications via `DataRequestNotifier`; audit entries via `AuditTrailService` and timeline entries via `CaseActivityService`.
- **Autopilot & automation isolation:** Shared `INVESTIGATIONS = { kind: 'INVESTIGATION' }` filter across Autopilot search, harness system brief, detection impact, case cleanup, leads scheduler/escalation, and a guard in `decision-applier`.
- **URL & Navigation rename:** `/investigations/**` moves to `/cases/**` with Next.js redirects (`/:ns/investigations/cases/new → /:ns/cases/new/investigation`, then `/:ns/investigations/:path* → /:ns/cases/:path*`, plus `/de` variants) and `NotificationsService.qualifyActionUrl` rewriting legacy `/investigations/` links to `/cases/`.

## 3. Phases

- **DR0:** Design doc, PRD record, fix `CLAUDE.md` migrations section.
- **DR1:** Prisma schema & idempotent migrations, `@workspace/schemas/data-request`, `describeForGroup`, `apps/api/src/data-requests/` module, notifications/audit/unavailable listener, case guards, Autopilot filter, URL rename, MCP data tools, OpenAPI & API client regeneration.
- **DR2:** `apps/web/components/data-request/` 3-pane drafting-sheet workspace (catalog rail, React Flow join canvas with table nodes, join edges, filter popover, comment pins, SQL/Checks/Preview/History panel, top bar, zustand store, `ShareDatasetSheet` preset).
- **DR3:** Rename `(dashboard)/investigations` to `(dashboard)/cases`, redirects, type picker (`cases/new`), `new/investigation` & `new/data-request`, kind-aware cards/badges/lists/pickers, dashboard `WaitingOnYouCard` section, EN/DE i18n.
- **DR4:** `apps/docs` Data Requests guide & nav, `apps/blog` landing-page "share" step & canvas share demo, `changelog.d/` release-notes fragment.
- **DR5:** API jest unit tests, Web jest & Playwright component tests, E2E smoke test update, docs/blog/api/web builds and live verification.
