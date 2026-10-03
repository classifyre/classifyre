# PRD G7 · Outcome metrics and baselines

| | |
|---|---|
| **Status** | Proposed |
| **Size** | S |
| **Milestone** | M5 · Workflow and proof ([integration](00-integration-architecture.md#4-build-order-and-milestones)) |
| **Depends on** | [S1](S1-enterprise-extension-seams.md) actor (human versus agent). Richer with [G6](G6-triage-queue.md) (triage decisions) and [G5](G5-entities.md) (entity review) |
| **Provides** | The **decision log**, one row per human or agent decision, used for metrics, and later for the enterprise audit and productivity reports |

## 1. Summary

Measure what Classifyre changes, from data it already has:
- **precision per detector**, from reviewer verdicts;
- **time to first decision** on new findings;
- **case cycle time**;
- **lead and watch yield**;
- **triage throughput**;
- **how often people undo the autopilot**.

A **baseline** snapshot is saved on demand and compared later. Everything is aggregate: no content ever enters the metrics.

## 2. Why

- **The research's sharpest warning is about evidence.** Vendor case studies are "not equivalent to independently audited causal ROI studies". NHS England itself conceded some platform benefits "could not establish cause and effect" (`deep-research-report.md`). European public buyers and enterprise procurement will ask Classifyre the same question. The honest answer is a baseline, a measured change, and a clear statement of what the number does and does not prove.
- **Adopters need numbers to write case studies,** and case studies are what move an open-source user towards an enterprise purchase.
- **Precision is the product's main quality lever.** Both first-use retrospectives found the bottleneck is judgment, not extraction ("The core problem is judgment", `docs/first-use/epstein-retrospective-blunt.md`). Every new detector, PYTHON rule ([G1](G1-python-detector.md)) or pack ([G2](G2-eu-detection-coverage.md)) adds findings. Without observed precision, noise grows unnoticed.
- **The raw facts exist but are scattered.** Human decisions live in several places:
  - finding history entries (`STATUS_CHANGED` with `changedBy`, `types/finding-history.types.ts`);
  - case attachments (`CaseFinding`, `CaseEvidence.addedBy`);
  - lead reviews (`CaseLead.reviewedBy`, `reviewedAt`);
  - duplicate verdicts (`CorrelationPairVerdict.decidedBy`);
  - detector feedback (`CustomDetectorFeedback`);
  - autopilot undo entries (`AgentUndoEntry`).

  Nothing joins them into a metric.

## 3. Goals

- Every metric has one written definition (§6.2), shown next to the number in the UI.
- Human and agent decisions are always counted separately.
- Small samples are shown with their uncertainty: a Wilson interval and *n*, never a bare percentage.
- A baseline can be saved, named and compared with any later window.

## 4. Non-goals

- Per-user productivity, team leaderboards and cost/ROI reports. Those are the enterprise edition, on top of real identities.
- Causal attribution. The UI says "changed by", never "caused by".
- Content-level analytics. That is what findings and search already do.

## 5. Requirements

| # | Requirement | Priority |
|---|---|---|
| R1 | New per-tenant table `decision_log` (§6.1), written at every decision point listed in §6.3, inside the same transaction as the decision | MUST |
| R2 | Bulk decisions (bulk finding updates, bulk triage) write **one row per operation** with per-detector counts, not one row per finding. Bulk operations can touch 100k findings | MUST |
| R3 | Backfill the log once from the existing sources listed in §2. It walks findings by `ctid` block ranges for history entries, is resumable, and marks backfilled rows `origin=BACKFILL` | MUST |
| R4 | Daily rollup `outcome_stat_daily` from the log, following the finding-stats pattern: a worker, a scheduler, dirty days and a state row (`apps/api/src/stats/finding-stats.*`, `FindingStatsDirtyDay`, `FindingStatsState`) | MUST |
| R5 | Metrics per §6.2, filterable by window (30, 90 or 365 days, or custom), source, detector, watch and case | MUST |
| R6 | Baselines: save the current metrics as a named snapshot, then compare any window with it, showing deltas and intervals. Baselines are workspace-scoped and travel with namespace transfer | MUST |
| R7 | Surfaces: an **Outcomes** page; a precision card on each detector page (value, *n*, interval, review coverage, 12-week trend); a yield card on each watch; a dashboard tile (median time to first decision, top 3 noisiest detectors) | MUST |
| R8 | CSV export of any metric table. REST `GET /metrics/outcomes`. MCP `get_outcome_metrics`, `save_outcome_baseline` and `compare_outcome_baseline` in a new `metrics` capability group. Agent toolsets get read-only access, so the supervisor and dream agents can use precision in their decisions | MUST |
| R9 | A "How to measure honestly" docs page: pick a window, save a baseline *before* a change, compare equal windows, beware concurrent changes. It follows the research's NHS example | SHOULD |
| R10 | Metrics exclude content entirely. The log stores ids, types, timestamps and actor kinds only | MUST |

## 6. Design

### 6.1 Tables

```prisma
model DecisionLog {
  id            String   @id @default(uuid())
  decidedAt     DateTime @map("decided_at")
  kind          String   // finding_status | case_attach | lead_review | triage | duplicate_verdict | entity_review | agent_revert
  outcome       String   // confirmed | rejected | dismissed | accepted | reverted | …
  reason        String?  // triage/dismissal reason code
  actorKind     String   @map("actor_kind")   // person | agent | integration | system
  actorName     String?  @map("actor_name")
  subjectType   String   @map("subject_type") // finding | case | lead | triage_item | pair | entity_value | agent_decision
  subjectId     String?  @map("subject_id")   // null for bulk rows
  count         Int      @default(1)          // > 1 for bulk rows
  detectorType  String?  @map("detector_type")
  detectorKey   String?  @map("detector_key")
  sourceId      String?  @map("source_id")
  inquiryId     String?  @map("inquiry_id")
  caseId        String?  @map("case_id")
  detectedAt    DateTime? @map("detected_at") // finding's firstDetectedAt, for time-to-decision
  breakdown     Json?                          // bulk: [{ detectorKey, count }]
  origin        String   @default("LIVE")     // LIVE | BACKFILL
  @@index([decidedAt])
  @@index([kind, decidedAt])
  @@index([detectorKey, decidedAt])
  @@map("decision_log")
}

model OutcomeStatDaily {
  day            DateTime @db.Date
  metric         String                 // e.g. "precision.confirmed", "ttd.hours"
  dimensionType  String   @map("dimension_type")   // detector | source | inquiry | lead_origin | queue | workspace
  dimensionKey   String   @map("dimension_key")
  actorKind      String   @map("actor_kind")
  count          Int
  sum            Float    @default(0)
  histogram      Json?                              // log2 buckets for durations
  @@id([day, metric, dimensionType, dimensionKey, actorKind])
  @@map("outcome_stat_daily")
}

model OutcomeBaseline {
  id          String   @id @default(uuid())
  name        String
  windowStart DateTime @map("window_start")
  windowEnd   DateTime @map("window_end")
  snapshot    Json                                 // metric → dimension → { value, n, ci }
  note        String?  @db.Text
  createdBy   String?  @map("created_by")
  createdAt   DateTime @default(now()) @map("created_at")
  @@map("outcome_baselines")
}
```

`decision_log` is the *analytical* record, one row per decision. Domain events (F1, [G3](G3-outbound-webhooks-notifications-export.md)) are the *integration* record, at aggregate level. They answer different questions at different volumes, so they stay separate.

### 6.2 Metric definitions

| Metric | Definition |
|---|---|
| **Confirmed finding** | A person attached it to a case, resolved it, or accepted its triage item |
| **Rejected finding** | A person marked it `FALSE_POSITIVE`, or dismissed its triage item as `false_positive` |
| **Dismissed finding** | `IGNORED`, or triage dismissed as `not_relevant`, `accepted_risk` or `duplicate` |
| **Precision** (per detector) | confirmed ÷ (confirmed + rejected), with a Wilson 95 % interval and *n*. Dismissed findings are shown as a separate *noise share* |
| **Review coverage** | reviewed ÷ all findings of that detector first detected in the window |
| **Time to first decision** | the finding's `firstDetectedAt` → its first human decision. Median and p90, from histograms |
| **Case cycle time** | case created → status `CLOSED` (`Case.closedAt`, a new column set on the transition), plus time to first evidence and the reopen count |
| **Lead acceptance** (per origin) | ACCEPTED ÷ (ACCEPTED + DISMISSED) for the origins semantic neighbour, watch, duplicate, autopilot, manual and entity |
| **Watch yield** | matches landed per week, and the share that reached a case (through triage, pull or attach) |
| **Triage throughput** ([G6](G6-triage-queue.md)) | items created, decided, overdue, and dismissal reasons |
| **Autopilot trust** | agent decisions applied, then reverted within 7 days (`AgentUndoEntry`); the share of autopilot-proposed leads accepted |
| **Entity review** ([G5](G5-entities.md)) | candidates decided, and the acceptance rate by method |

### 6.3 Where decisions are written (R1)

| Chokepoint | Kind |
|---|---|
| Finding status updates: single and bulk paths in `findings.service.ts` and `findings-bulk/` | `finding_status` |
| Case attach ports, evidence and findings (`cases.service.ts`, `cases/case-pull.port.ts`) | `case_attach` |
| `CaseLeadsService.review` / `reviewMany` | `lead_review` |
| `TriageService` decisions ([G6](G6-triage-queue.md)) | `triage` |
| Duplicate review verdicts (`correlation/review/`) | `duplicate_verdict` |
| Entity candidate review ([G5](G5-entities.md)) | `entity_review` |
| Autopilot undo (`REVERT_ACTION`) | `agent_revert` |

Each call reads the actor from `ActorContextService` ([S1](S1-enterprise-extension-seams.md)). Until S1 lands, it reads today's actor strings, with `ai-autopilot` meaning agent.

### 6.4 Module and UI

- **API.** `apps/api/src/outcomes/`: `decision-log.service.ts` (the writer), `outcome-stats.worker.ts` / `.scheduler.ts` / `.constants.ts` (the rollup), `outcomes.controller.ts` (reads and baselines).
- **Web.**
  - The Outcomes page at `…/(dashboard)/outcomes`.
  - A precision card on `detectors/[id]` and a yield card on `investigations/inquiries/[id]`.
  - The dashboard tile.
  - Charts follow the existing chart conventions; intervals are drawn as error bars.

## 7. How it connects

| With | What flows |
|---|---|
| [G1](G1-python-detector.md) and [G2](G2-eu-detection-coverage.md) | Observed precision next to a bundle's *expected* precision; a rule that drifts below its bar is visible |
| [G6](G6-triage-queue.md) | Triage decisions are the richest decision source: reasons, times, queues |
| [G5](G5-entities.md) | Entity review acceptance shows whether candidate thresholds are right |
| [G3](G3-outbound-webhooks-notifications-export.md) | Optional: a weekly `outcomes.digest` event, a summary of changes, sent to a channel |
| [S1](S1-enterprise-extension-seams.md) | Actor kind on every row. Enterprise adds per-user and per-team views over the same log |
| Autopilot | Agents read precision to decide whether to tune or retire a detector: data for decisions, not a new agent |

## 8. Rollout

- Ship R1 to R3 first (log plus backfill), then the rollup, then the UI. The log starts adding value the day it lands, because it fixes the facts.
- `Case.closedAt` is backfilled from `CaseActivity` status-change payloads where present.

## 9. Testing and acceptance

- **Definitions:** fixture workspaces with known decisions produce the exact precision, coverage and time-to-decision values in §6.2, via a unit test per metric.
- **Human versus agent:** agent decisions never count as human confirmations.
- **Bulk:** a 100k-finding bulk FP writes one log row with the breakdown, and precision reflects all 100k.
- **Backfill:** idempotent (re-running changes nothing) and resumable.
- **Baseline:** save, then make a change, then the compare view shows deltas with intervals. Baselines survive a namespace export and import.

## 10. Success measures

- Every shipped detector pack shows observed precision within two releases of adoption.
- At least one public case study (showcase or community) quotes Classifyre's own baseline comparison.

## 11. Open questions

- Should reviewers be able to mark a finding "confirmed" without attaching it to a case or resolving it? A lightweight 👍 would increase review coverage. It is recommended, as a new finding action that writes `finding_status` with outcome `confirmed` and changes no status.
