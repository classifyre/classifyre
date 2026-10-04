# PRD G6 · Workspace triage queue

| | |
|---|---|
| **Status** | Proposed |
| **Size** | S–M |
| **Milestone** | M5 · Workflow and proof ([integration](00-integration-architecture.md#4-build-order-and-milestones)) |
| **Depends on** | [G4](G4-extracted-values-and-watch-conditions.md) (queues are watches with conditions); F1 events ([G3](G3-outbound-webhooks-notifications-export.md)); [S1](S1-enterprise-extension-seams.md) actor. Optional: [G5](G5-entities.md) for grouping by entity |
| **Used by** | [G7](G7-outcome-metrics.md) (time to decision, acceptance and dismissal reasons) |

## 1. Summary

A watch can be switched to **queue mode**. Its new matches then become *triage items*, grouped per asset (or per entity, or per finding), which a person works through:
- **accept** into a new or existing case;
- **dismiss** with a reason, remembered;
- **snooze**;
- **assign**.

Items reopen when genuinely new findings arrive on a dismissed group, and close themselves when the scan retires every finding behind them. It is the pre-case inbox that AML alert handling, QA non-conformance handling and DPO review all assume.

## 2. Why

- **Leads are per case.** `CaseLead` (`apps/api/prisma/schema.prisma`) is a good triage mechanism, with proposal, accept, remembered dismissal and rationale. It only exists *inside* a case, though. Before a case exists there is no queue.
- **Watches deliberately persist no match rows.** Newness is derived per run (the model comment on `Inquiry`: "It persists no match rows at all"). That is right for monitoring, but a queue needs per-item state: who decided, why, when it is due.
- **The roadmap asked for it.** Phase 3 of `docs/architecture/INVESTIGATION_ROADMAP.md` ("alerts / case triggers … promote to case") was never built. Findings reach cases only by auto-pull, manual pull or leads.
- **The research's sectors run exactly this loop.** The AML alert queue, the quality non-conformance queue and the privacy review queue: signal, then triage decision, then case or dismissal, with an audit of who decided and why.

## 3. Goals

- Turning a watch into a queue is one switch. The conditions, sources and detectors stay the same.
- Every item has a single, explained state and history, and decisions are never lost to a re-scan.
- Accepting reuses the existing case attach flow, so a case built from triage looks exactly like one built by hand.
- Dismissal reasons feed detector precision ([G7](G7-outcome-metrics.md)) and, optionally, finding status.

## 4. Non-goals

- Replacing case leads. They stay the in-case suggestion mechanism.
- Workload balancing across users, SLA escalation chains and team queues: enterprise edition, on top of real identities.
- Auto-accepting by the autopilot.

## 5. Requirements

| # | Requirement | Priority |
|---|---|---|
| R1 | `Inquiry.mode` = `WATCH` (default, today's behaviour) \| `QUEUE`. For a queue: `queueGroupBy` = `ASSET` (default) \| `ENTITY` \| `FINDING`, an optional `slaHours`, an optional `defaultAssignee`, and `reopenOnNew` (default true) | MUST |
| R2 | When a run lands matches for a queue ([G4](G4-extracted-values-and-watch-conditions.md) semantics, at the existing `MATCHES_LANDED` step in `matching/inquiry-matching.service.ts`), items are upserted per group. A new group becomes `NEW`. An existing group refreshes its finding list and counts | MUST |
| R3 | **Reopen.** A `DISMISSED` group that receives findings whose `detectionIdentity` was not part of the decision reopens as `NEW`, showing "n new since dismissal", when `reopenOnNew` is on. An `ACCEPTED` group only increments `newSinceDecision`, and its case receives them through the case's own watch link if auto-pull is on | MUST |
| R4 | **Retire.** When every finding behind a `NEW` or `SNOOZED` item is resolved or deleted by scans, the item becomes `RESOLVED` automatically, with the reason "no longer detected" | MUST |
| R5 | **Accept:** into a new case (title prefilled from the watch and group label) or an existing case, attaching the group's assets and findings through the existing attach flow (the `CasesService` attach and pull ports). Optionally link the watch to the case with auto-pull. Records a case activity `TRIAGE_ACCEPTED` | MUST |
| R6 | **Dismiss** with a reason code (`false_positive`, `not_relevant`, `duplicate`, `accepted_risk`, `other`) and a note. With "Mark findings as false positive" checked, the findings become `FALSE_POSITIVE` through the existing status path, which writes `CustomDetectorFeedback` for custom detectors | MUST |
| R7 | **Snooze** until a date, then return to `NEW`. **Assign** is free text in the open-source core; the enterprise edition maps it to users | MUST |
| R8 | Bulk accept (into one case), bulk dismiss, bulk snooze and bulk assign on a selection | MUST |
| R9 | Priority order: severity, then importance, then overdue, then age. `dueAt = createdAt + slaHours` | MUST |
| R10 | Events (F1): `triage.items_created` (aggregated per landing: counts and top severity), `triage.item_decided`, and `triage.overdue` from a daily sweep | MUST |
| R11 | Autopilot: the INQUIRY agent may attach a *proposed* decision with a rationale to an item, shown as a suggestion. It never applies decisions in v1 | SHOULD |
| R12 | MCP: `list_triage_items`, `get_triage_item`, `decide_triage_items` (accept, dismiss, snooze, assign; batch; `dryRun` plus `expectedCount`, like the bulk findings tool), in a new `triage` capability group | MUST |
| R13 | Web: a `/triage` page with filters (queue, status, severity, assignee, overdue) and keyboard operation (j/k to move, a/d/s to accept, dismiss or snooze). A side panel shows the group's findings through the content presenter, the asset preview and, when grouped by entity, the entity card. A dashboard card shows "New: n · Overdue: m" | MUST |
| R14 | Demo mode blocks decisions. Data transfer: triage items travel in the `investigations` scope, because they are human work | MUST |

## 6. Design

### 6.1 Schema

```prisma
enum InquiryMode {
  WATCH
  QUEUE
}

enum TriageGroupType {
  ASSET
  ENTITY
  FINDING
}

enum TriageItemStatus {
  NEW
  ACCEPTED
  DISMISSED
  SNOOZED
  RESOLVED
}

// Inquiry: new columns
//   mode InquiryMode @default(WATCH)
//   queueGroupBy TriageGroupType @default(ASSET) @map("queue_group_by")
//   slaHours Int? @map("sla_hours")
//   defaultAssignee String? @map("default_assignee")
//   reopenOnNew Boolean @default(true) @map("reopen_on_new")

model TriageItem {
  id                String           @id @default(uuid())
  inquiryId         String           @map("inquiry_id")
  groupType         TriageGroupType  @map("group_type")
  groupKey          String           @map("group_key")          // asset id | entity id | detection identity
  assetId           String?          @map("asset_id")
  entityId          String?          @map("entity_id")
  title             String
  findingIds        String[]         @map("finding_ids")        // current open matches, capped at 200
  decidedFindingIds String[]         @map("decided_finding_ids") // identities covered by the last decision
  findingCount      Int              @map("finding_count")
  topSeverity       Severity         @map("top_severity")
  topImportance     Float?           @map("top_importance")
  status            TriageItemStatus @default(NEW)
  assignee          String?
  dueAt             DateTime?        @map("due_at")
  snoozedUntil      DateTime?        @map("snoozed_until")
  decision          String?                                     // accepted | dismissed:<reason> | resolved
  decisionNote      String?          @map("decision_note") @db.Text
  decidedBy         String?          @map("decided_by")
  decidedAt         DateTime?        @map("decided_at")
  caseId            String?          @map("case_id")
  newSinceDecision  Int              @default(0) @map("new_since_decision")
  proposedDecision  Json?            @map("proposed_decision")   // autopilot suggestion { action, rationale }
  createdAt         DateTime         @default(now()) @map("created_at")
  updatedAt         DateTime         @updatedAt @map("updated_at")
  inquiry           Inquiry          @relation(fields: [inquiryId], references: [id], onDelete: Cascade)
  @@unique([inquiryId, groupType, groupKey])
  @@index([status, dueAt])
  @@index([inquiryId, status])
  @@index([assignee, status])
  @@map("triage_items")
}
```

`decidedFindingIds` stores detection identities, not finding ids. Identities survive a finding row being re-created, and they make "new since decision" exact (R3).

### 6.2 Generation

- **Where.** A new `TriageService.syncForLanding(inquiryId, runnerId)` is called from the matching service after it computes the landed and retired sets. Queue-mode watches only.
- **Grouping keys:**
  - `ASSET`: the finding's `assetId`.
  - `FINDING`: `detectionIdentity`.
  - `ENTITY` ([G5](G5-entities.md)): the confirmed entity of the finding's value. Findings with no entity fall back to `ASSET`.
- **Volume guard.** At most 5,000 new items per landing per queue. Beyond that, record one `triage.flood` event and stop, because a queue that floods is a mis-specified rule, not work.
- **Retirement (R4)** reuses the GONE computation already derived from run anchors (`matching/match-state.ts`).

### 6.3 Module layout

`apps/api/src/triage/` holds `triage.service.ts`, `triage.controller.ts`, `triage.constants.ts`, and `triage-overdue.scheduler.ts` (a daily sweep on pg-boss, registered per namespace). Accept goes through the case pull port (`cases/case-pull.port.ts`), so triage never duplicates attach logic.

### 6.4 Web

- `app/[locale]/[namespaceSlug]/(dashboard)/triage/page.tsx`, with a list and detail layout.
- Reuse the lead card and finding list components, plus the `STATUS_TONE` tokens for status pills (`lib/status-tone.ts`).
- The watch editor gets a "Work as a queue" section (R1).

## 7. How it connects

| With | What flows |
|---|---|
| [G4](G4-extracted-values-and-watch-conditions.md) | The queue's rule *is* the watch's conditions: no second rule language |
| [G5](G5-entities.md) | `ENTITY` grouping turns "12 documents about ACME" into one decision |
| [G3](G3-outbound-webhooks-notifications-export.md) | `triage.items_created` to Slack or Teams pings the reviewers; `triage.overdue` goes to the lead reviewer |
| [G7](G7-outcome-metrics.md) | Time to decision, acceptance rate per queue, and dismissal reasons per detector. `false_positive` dismissals feed precision |
| Cases | Accepted items create normal cases, with evidence, findings and the watch link. The case timeline shows `TRIAGE_ACCEPTED` with the queue name |
| [S1](S1-enterprise-extension-seams.md) | `decidedBy` comes from the actor context. Enterprise turns `assignee` into a user, with team queues and SLA escalation |

## 8. Rollout

- Additive: an existing watch behaves exactly as before until someone switches it to `QUEUE`.
- On switching, the operator chooses "start from now" (default) or "include current open matches", with the count shown before confirming.

## 9. Testing and acceptance

- **Lifecycle:** land, `NEW`, dismiss (false positive), re-land the same findings (stays dismissed), land a new finding on the same asset (reopens with "1 new since dismissal").
- **Retire:** all findings behind a `NEW` item resolved by a scan makes it `RESOLVED` automatically.
- **Accept:** into a new case; the case shows the assets, the findings and a `TRIAGE_ACCEPTED` activity, and the watch is linked with the chosen auto-pull setting.
- **Bulk:** `dryRun` returns the count, and an `expectedCount` mismatch refuses, the same safety as bulk finding updates.
- **Flood guard:** a rule matching 20,000 assets creates 5,000 items and one `triage.flood` event.
- **E2E:** Art. 9 watch in queue mode, then the triage page, keyboard accept, then the case exists.

## 10. Success measures

- On instances using queues, median time from a `NEW` item to a decision is under 2 working days, and falls release over release (G7 shows it).
- Under 5 % of dismissed items reopen without new findings. That would indicate identity churn: a bug, not reality.

## 11. Open questions

- Should `FINDING`-grouped queues support per-finding decisions inside an asset group (partial accept)? This is proposed for v2. Grouping by asset covers the common case, and per-finding grouping exists for when finer control is needed.
