# PRD G3 · Things leave the app: domain events, webhooks, push notifications, case export

| | |
|---|---|
| **Status** | Proposed |
| **Size** | S–M |
| **Milestone** | M1 · Extensibility ([integration](00-integration-architecture.md#4-build-order-and-milestones)) |
| **Depends on** | [S1](S1-enterprise-extension-seams.md) for the actor and content presenter. Without S1, use today's behaviour and adopt S1 when it lands |
| **Provides** | Foundation **F1**: the domain event outbox. [G4](G4-extracted-values-and-watch-conditions.md), [G5](G5-entities.md), [G6](G6-triage-queue.md), [G7](G7-outcome-metrics.md) and the enterprise audit all write to or read from it |

## 1. Summary

Three outbound capabilities on one backbone:

- **Domain events (F1).** An append-only table of meaningful things that happened in a workspace, written in the same transaction as the change.
- **Webhooks.** Signed, retried HTTP deliveries of chosen events to any endpoint (n8n, Zapier, Jira automation, SOAR, a custom service).
- **Push notifications.** Chosen events delivered to Slack, Telegram, email and Microsoft Teams, reusing the existing chat-bot connectors.

Plus **case export**: a whole investigation as Markdown or JSON, with evidence, lineage, chronology, hypotheses and provenance.

## 2. Why

- **Decisions never leave Classifyre.** There is no webhook, no email and no push. The Telegram and Slack bots (`apps/api/src/chat-gateway/`) answer questions but never speak first. Notifications are in-app only (`Notification` model, `notification-events.gateway.ts`). The research behind the [gap analysis](../../palantir-use-case-gap-analysis.md) is clear on adoption: successful deployments put the decision where people already work, rather than adding another dashboard.
- **A case can't leave either.** An investigation's result must reach a regulator, a board, a court or a data-protection officer. Phase 8 of `docs/architecture/INVESTIGATION_ROADMAP.md` lists "export a case … as a report", and it was never built.
- **Open-source adopters expect webhooks.** They are the cheapest integration: instead of building N write-back connectors (Jira, ServiceNow, TheHive, …), the customer's own automation acts on a signed event.
- **Without a shared event backbone, every feature grows its own notifier.** Today 13 call sites create notifications with an `event` string (`types/notification.types.ts`), triage, entities and metrics are coming, and the enterprise edition needs an audit trail. One outbox serves all of them.

## 3. Goals

- Any meaningful workspace change produces exactly one domain event, committed only if the change commits.
- An operator can subscribe an endpoint or a channel to event types, filtered by severity and subject.
- Deliveries are signed, retried with backoff, observable (delivery log) and re-sendable.
- Nothing sensitive leaves by default: payloads carry ids, titles, counts and links, not matched content, unless explicitly enabled.
- A case can be exported in one click as a self-contained, provenance-stamped document.

## 4. Non-goals

- Two-way integrations (closing a Jira ticket closes the case). They can come later, using the same event ids.
- Writing back to source systems (redacting a file in SharePoint). That is out of scope for the product; see §8 of the gap analysis.
- A notification rule engine beyond type, severity and subject filters. Richer finding conditions belong to watches ([G4](G4-extracted-values-and-watch-conditions.md)), which then emit events.

## 5. Requirements

### Domain events (F1)

| # | Requirement | Priority |
|---|---|---|
| E1 | New per-tenant table `domain_events` (§6.1). `DomainEventsService.record(tx, event)` writes inside the caller's Prisma transaction | MUST |
| E2 | Events are **aggregate-level**: one per run, per watch landing, per case change, per lead refresh. There are never per-finding events at scan volume (a run can create 100k findings) | MUST |
| E3 | v1 event catalogue: see the [integration doc](00-integration-architecture.md#f1-domain-events). Every type has a JSON schema in `packages/schemas/src/schemas/domain_events.json` | MUST |
| E4 | `NotificationsService.create` records the matching domain event for its `NotificationEvent`, so the 13 existing notification sites become event sources with one change | MUST |
| E5 | Recording enqueues a coalesced `events.dispatch` pg-boss job (singleton per namespace). A one-minute sweep catches anything missed. The dispatcher fans each undispatched event out to matching webhook endpoints and channels, then sets `dispatchedAt` | MUST |
| E6 | Retention: 30 days by default (`DOMAIN_EVENT_RETENTION_DAYS`), pruned by the maintenance worker. Enterprise audit extensions ([S1](S1-enterprise-extension-seams.md) R13) may copy events before pruning | MUST |

### Webhooks

| # | Requirement | Priority |
|---|---|---|
| W1 | CRUD for webhook endpoints: name, URL, event types, minimum severity, subject filter (source, inquiry and case ids), `includeContent` (default **false**), enabled | MUST |
| W2 | Signature header `X-Classifyre-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, t + "." + body)>`, plus `X-Classifyre-Event`, `X-Classifyre-Delivery` and `X-Classifyre-Namespace`. Secrets are encrypted at rest (`MaskedConfigCryptoService.encryptString`) and shown once at creation. Rotation keeps two secrets and signs with both during overlap | MUST |
| W3 | Delivery: POST JSON, 10 s timeout, redirects not followed, response body stored truncated to 2 KB. Retries at 1 min, 5 min, 30 min, 2 h, 6 h, 12 h, then `GAVE_UP` | MUST |
| W4 | An endpoint is auto-disabled after 50 consecutive failures, with a notification. The failure count is **persisted in the database**: per-namespace in-memory state is wiped whenever namespace workers are torn down (`clearForSchema`), so an in-memory breaker would reset every few minutes | MUST |
| W5 | Delivery log per endpoint (status, attempts, response code, duration), "Redeliver" per delivery, and "Send test event" | MUST |
| W6 | **Network guard.** Extract `isPrivateAddress` from `custom-detector-tests.service.ts` into `utils/network-guard.ts`. Always block link-local and cloud metadata addresses. `WEBHOOK_TARGET_POLICY=any` (default: internal targets are legitimate for self-hosted installs) or `public-only`. Resolve DNS at delivery time and connect to the resolved, checked IP, to prevent DNS rebinding | MUST |
| W7 | Payload envelope `classifyre.event/v1` (§6.2). Absolute links need `CLASSIFYRE_PUBLIC_URL` (new instance setting, also used by email and exports). Without it, links are relative and the settings page warns | MUST |

### Push notification channels

| # | Requirement | Priority |
|---|---|---|
| N1 | Channel kinds: **Slack** (an existing `ChatBot` of platform SLACK plus a channel id; needs `chat:write`), **Telegram** (an existing bot plus a chat id), **Email** (SMTP), **Microsoft Teams** (an incoming-webhook URL, encrypted) | MUST (Teams SHOULD) |
| N2 | Same subscription model as webhooks (W1), plus `language` (EN/DE, default: instance language) and `mode` = `immediate` \| `hourly digest` \| `daily digest` | MUST (digests SHOULD) |
| N3 | Message templates per event type in EN and DE: one line of what happened, severity, and an absolute link into the namespaced UI (`/<namespace>/…`, per the namespace URL contract) | MUST |
| N4 | SMTP settings in instance settings (host, port, TLS, user, password encrypted, from), with a "send test email" button. Uses `nodemailer` | MUST |
| N5 | The ESCALATION agent's `NOTIFY_OPERATOR` already creates a `case.escalated` notification. Through E4 it reaches channels with no autopilot change | MUST |

### Case export

| # | Requirement | Priority |
|---|---|---|
| X1 | `GET /cases/:id/export?format=markdown\|json&redact=true\|false&include=activity,leads,notes` streams a file. `redact` defaults to **true**. Finding values go through the content presenter (S1) with `purpose='export'` | MUST |
| X2 | Contents (§6.4): metadata, conclusion, hypotheses with confidence history and supporting or contradicting items, evidence assets with source, link, URN and a lineage summary, attached findings with location, chronology, linked watches with their matchers and conditions, optional notes, leads summary and activity log, and a provenance footer | MUST |
| X3 | JSON follows `classifyre.case-export/v1` (schema in `packages/schemas`), so exports can be diffed, archived and re-imported later | MUST |
| X4 | Large cases: stream generation; cap at 10,000 findings with an explicit truncation note | MUST |
| X5 | Records `case.exported` (format, redact flag, actor) | MUST |
| X6 | Web: an "Export" action on the case page, with an options dialog and a warning when `redact=false`. MCP: `export_case` returns the document inline up to 1 MB, otherwise a summary | MUST |
| X7 | PDF export | Enterprise edition, or v2 |

### Platform

| # | Requirement | Priority |
|---|---|---|
| P1 | New MCP capability group `integrations` (`mcp-catalog.ts`) with `list/create/update/delete_webhook`, `list_webhook_deliveries`, `redeliver_webhook`, `send_test_event`, `list/create/update/delete_notification_channel`. `export_case` goes in `cases` | MUST |
| P2 | Demo mode blocks creating and editing endpoints and channels. Export stays allowed (read-only) | MUST |
| P3 | Data transfer: endpoints, channels, deliveries and domain events are **excluded**, with reasons added to the comment block in `transfer-scopes.ts`. Targets and secrets are instance-specific, and an event log is meaningless once detached from its instance | MUST |
| P4 | Web: Settings gets a new **Integrations** tab (existing tabs: general, workers, cleanup, data, mcp, chat) with public URL, SMTP, webhooks, channels and delivery logs. i18n EN/DE | MUST |

## 6. Design

### 6.1 Tables (per tenant schema)

```prisma
model DomainEvent {
  id           String    @id @default(uuid())
  type         String    @db.VarChar(80)          // "case.status_changed"
  occurredAt   DateTime  @default(now()) @map("occurred_at")
  actorKind    String?   @map("actor_kind")       // person | agent | integration | system (S1)
  actorName    String?   @map("actor_name")
  subjectType  String?   @map("subject_type")     // case | inquiry | source | runner | detector | entity | triage_item
  subjectId    String?   @map("subject_id")
  severity     Severity?
  payload      Json      @db.JsonB
  dispatchedAt DateTime? @map("dispatched_at")
  @@index([dispatchedAt, occurredAt])
  @@index([type, occurredAt])
  @@index([subjectType, subjectId, occurredAt])
  @@map("domain_events")
}

model WebhookEndpoint {
  id                  String    @id @default(uuid())
  name                String
  url                 String
  secretEnc           String    @map("secret_enc")
  previousSecretEnc   String?   @map("previous_secret_enc")
  eventTypes          String[]  @map("event_types")
  minSeverity         Severity? @map("min_severity")
  subjectFilter       Json?     @map("subject_filter")   // { sourceIds?, inquiryIds?, caseIds? }
  includeContent      Boolean   @default(false) @map("include_content")
  enabled             Boolean   @default(true)
  consecutiveFailures Int       @default(0) @map("consecutive_failures")
  disabledReason      String?   @map("disabled_reason")
  lastSuccessAt       DateTime? @map("last_success_at")
  lastFailureAt       DateTime? @map("last_failure_at")
  createdBy           String?   @map("created_by")
  createdAt           DateTime  @default(now()) @map("created_at")
  updatedAt           DateTime  @updatedAt @map("updated_at")
  deliveries          WebhookDelivery[]
  @@map("webhook_endpoints")
}

model WebhookDelivery {
  id              String   @id @default(uuid())
  endpointId      String   @map("endpoint_id")
  eventId         String   @map("event_id")
  status          String   // PENDING | SUCCEEDED | FAILED | GAVE_UP
  attempt         Int      @default(0)
  nextAttemptAt   DateTime? @map("next_attempt_at")
  responseStatus  Int?     @map("response_status")
  responseSnippet String?  @map("response_snippet")
  errorMessage    String?  @map("error_message")
  durationMs      Int?     @map("duration_ms")
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")
  endpoint        WebhookEndpoint @relation(fields: [endpointId], references: [id], onDelete: Cascade)
  @@unique([endpointId, eventId])
  @@index([status, nextAttemptAt])
  @@map("webhook_deliveries")
}
```

`NotificationChannel` mirrors `WebhookEndpoint`, with `kind`, `chatBotId?`, `targetEnc`, `language`, `mode`. Its deliveries share the delivery table shape (`channel_deliveries`).

**Why a `dispatchedAt` column instead of a sequence cursor.** Sequence values commit out of order, so "everything after seq N" can skip an event committed late. Marking rows dispatched is robust, and `@@unique([endpointId, eventId])` makes fan-out idempotent.

### 6.2 Payload envelope

```jsonc
{
  "schema": "classifyre.event/v1",
  "id": "5f0c…",                       // DomainEvent.id, stable across redeliveries
  "type": "inquiry.new_matches",
  "occurredAt": "2026-10-02T08:15:03Z",
  "namespace": { "id": "…", "slug": "de-fruehwarnung" },
  "actor": { "kind": "system", "name": "scheduler" },
  "subject": { "type": "inquiry", "id": "…", "title": "Insolvenzsprünge", "url": "https://…/de-fruehwarnung/investigations/inquiries/…" },
  "severity": "HIGH",
  "data": { "newCount": 12, "goneCount": 1, "sampleFindingIds": ["…"], "runnerId": "…" }
}
```

With `includeContent=true`, the `data` of finding-bearing events gains `findings: [{ id, type, severity, value }]` (at most 20), where `value` comes from the content presenter (S1).

### 6.3 Workers and modules

- Module `apps/api/src/integrations/`, following the existing `*.constants.ts`, `*.scheduler.ts`, `*.worker.ts` pattern (compare `stats/finding-stats.*`, `cases/case-leads.*`).
- Queues:
  - `events.dispatch`: coalesced singleton per namespace. pg-boss completed jobs still hold their singleton slot, so use a short retention for this queue or `singletonSeconds`.
  - `webhooks.deliver` and `channels.deliver`: one job per delivery, backoff from W3.
- Queues are registered per namespace through the existing worker-queue registry, so workspace pause and holds apply.
- The HTTP client uses `undici`, with the W6 guard as a custom `connect` that checks the resolved address.

### 6.4 Case export assembly

- `CaseExportService` reads through the existing services: `CasesService`, `CaseThreadsService` (hypotheses and support), `CaseEventsService` (chronology), `CaseLeadsService`, `CaseActivityService` (timeline, paged with `activity-page.ts`), and `GraphService` / `graph-trace.ts` for a bounded lineage summary per evidence asset (hub fan-out capped as in field report P13).
- Markdown renderer: headings per section, tables for evidence and findings, footnotes for sources. Provenance footer: instance version, namespace, exported by (actor), exported at, `sha256` of the JSON form.
- JSON renderer: the same data model, validated against `classifyre.case-export/v1`.

## 7. How it connects

| With | What flows |
|---|---|
| **F1** consumers | [G4](G4-extracted-values-and-watch-conditions.md) emits `inquiry.threshold_crossed`, [G5](G5-entities.md) emits `entity.*`, [G6](G6-triage-queue.md) emits `triage.*`, [G2](G2-eu-detection-coverage.md) emits `detector.imported/exported`. [G7](G7-outcome-metrics.md) may read events for time-to-notify metrics |
| [S1](S1-enterprise-extension-seams.md) | Actor on every event; the content presenter for `includeContent` and exports; enterprise audit subscribes to all events |
| Autopilot | Escalation notifications reach channels (N5). Agents cannot manage endpoints or channels: the tools are not in any agent toolset |
| Case board | The export's board section (v2) renders the stored `BoardSketch` shapes as SVG, which the board already keeps as JSON |

## 8. Rollout

- Ship F1 plus webhooks first. That delivers the integration story and the backbone.
- Channels next, then case export.
- Document the payload schema, signature verification snippets (Node, Python) and the retry policy in `apps/docs/app/integrations/`.

## 9. Testing and acceptance

- **Transactionality:** a case status change that rolls back produces no event. One that commits produces exactly one.
- **Fan-out idempotency:** the dispatcher crashing mid-fan-out and re-running creates no duplicate deliveries (the unique key holds).
- **Signature:** a reference verifier in the docs validates a real delivery. A tampered body fails.
- **Retry:** a 500 endpoint moves through the schedule to `GAVE_UP`. Fifty failures disable the endpoint, and the count survives a worker restart and namespace teardown.
- **Network guard:** `169.254.169.254`, `localhost` and a DNS name rebinding to a private address are refused per policy.
- **Channels:** Slack and Telegram messages arrive in both languages. The email test succeeds against a local SMTP catcher in CI.
- **Export:** a golden-file test for Markdown and JSON on a fixture case. `redact=true` never contains raw matched values. A 12,000-finding case truncates with a note.

## 10. Success measures

- Median event-to-delivery latency under 30 s.
- At least 99 % of deliveries succeed on the first or second attempt for healthy endpoints.
- Case exports are used in at least 30 % of closed cases on instances with G7 metrics enabled (tracked through `case.exported`).

## 11. Open questions

- Should the in-app notification inbox itself become a consumer of F1, with one path instead of two? It would be cleaner, but it is a refactor of 13 call sites and the WebSocket gateway. The recommendation is to keep both in v1 (E4 bridges them) and revisit.
