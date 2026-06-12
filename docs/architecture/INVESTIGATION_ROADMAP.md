# Investigation Platform — Protocol Correction & Roadmap

> Status: the MVP shipped in [PR #116](https://github.com/classifyre-com/classifyre/pull/116)
> (cases, evidence, generic edges, recursive-CTE graph, hypotheses, Cytoscape explorer).
> This document corrects a **conceptual flaw** in that MVP and lays out the full roadmap.

---

## Context — what is wrong today and why it matters

The MVP treats a **case as a collection of files (evidence)** with hypotheses bolted on
as a secondary tab. The correct mental model is the opposite:

- **A case is a collection of theories and evidence**, born from a question.
- The flow is **Question → Hypothesis → Evidence → Conclusion** (there is no separate
  "Analysis" step — analysis *is* the weighing of evidence against hypotheses).
- The **hypothesis comes first**: a case is opened *because* you suspect something.
  Evidence then accumulates to **strengthen or weaken** that hypothesis, and the
  hypothesis confidence evolves (0.4 → 0.8 → 0.9) as evidence lands.
- The **graph is generated *from* evidence** — it is not the case itself.

Two concepts are currently conflated and **must be separated**:

| Concept | Definition | Example |
|---|---|---|
| **Evidence** | An *observed* node that participates in the case | `customer.csv`, `CUSTOMERS` table, `export_customer_data.py`, `Email 555`, `vendor@gmail.com` |
| **Finding** | An *inferred* observation **attached to** evidence | "Contains PII", "Exports 50k customer records" |

Today `case_evidence.entityType` accepts `"asset" | "finding"`, so a finding can be
attached *as* evidence — collapsing the distinction. Findings should be metadata on
evidence, not evidence themselves.

### Corrected ontology

```
Case  ──contains──▶  Hypothesis (primary; has confidence that evolves)
Case  ──contains──▶  Evidence (observed asset nodes)
Evidence  ──has──▶   Finding (inferred: Contains PII, Exports 50k rows)
Evidence  ──connected_to (edges)──▶  other Evidence   ← the investigation graph
Hypothesis ──supported/contradicted by──▶ Evidence and/or Findings (with confidence)
Data Concept ──groups──▶ many assets (Customer Data → table + csv + notebook + email)
Alert/Trigger ──promotes to──▶ Case (manual now, AI later) Promoted from finding or group of findings, link must be presented in original case opening initiation.
```

### Target case model (internal tables)

```
cases
case_hypotheses          (primary — a case is created WITH one)
case_evidence            (observed asset nodes ONLY)
case_findings            (inferred observations attached to evidence)
case_hypothesis_support  (links evidence OR findings to a hypothesis, with stance)
case_notes
case_tasks               (NEW — not yet built)
```

---

## Gap analysis: current MVP vs target protocol

| Area | MVP today | Target | Action |
|---|---|---|---|
| Flow | Question→Hypothesis→Evidence→**Analysis**→Conclusion; evidence-led UI | Question→Hypothesis→Evidence→Conclusion; **hypothesis-led** | Phase 0 |
| Case creation | Title + severity only | Title + severity + **initial hypothesis** | Phase 0 |
| Evidence vs Finding | `case_evidence` accepts assets *and* findings | `case_evidence` = assets only; new `case_findings` | Phase 0 |
| Hypothesis support | Links to `case_evidence` only | Links to evidence **or** findings | Phase 0 |
| UI layout | Tabs: Evidence first | Hypothesis-centric workspace (hypotheses + their evidence/findings; graph as a lens) | Phase 0 |
| Relationships | Only inferred `CONTAINS` + `REFERENCES` | Source-derived `OWNS/READS/ACCESSED/GENERATED_FROM/ATTACHED_TO/SENT_TO/MENTIONS/EXPORTED_TO/EXECUTED` | Phase 1 |
| Graph interaction | Generic "expand" (all neighbours) | **Pivot menu** of named questions ("Who touched this?", lineage, access, emails…) | Phase 2 |
| Case origination | Manual create only | **Alerts/triggers** promoted to cases (manual now → AI) | Phase 3 |
| Semantic layer | none | **Data Concept** nodes (Customer Data, Secrets…) | Phase 4 |
| History | none | `asset_events` + case/graph timelines | Phase 5 |
| Reactivity | none | Case **watchers** + re-evaluation on graph change | Phase 6 |
| AI | none | **Relevance engine**: suggested evidence, suggested cases, auto confidence | Phase 7 |
| Tasks | none | `case_tasks`, collaboration | Phase 8 |

---

## Phase 0 — Correct the protocol (refactor the MVP) ★ do first

> This is a **breaking change** to the just-merged MVP schema. It is safe because the
> feature is unreleased; existing `case_evidence` rows with `entity_type = 'finding'`
> migrate into `case_findings`.

**Schema** (`apps/api/prisma/schema.prisma`)
- `case_evidence`: keep assets only. Document `entityType` = `"asset"` (later `"concept"`),
  drop `"finding"` usage.
- **New `case_findings`**: `{ id, caseId, caseEvidenceId (FK → the evidence the finding is on),
  findingId (→ Finding.id), note, createdAt }`. A finding is always anchored to a piece of evidence.
- Rename `hypothesis_evidence` → **`case_hypothesis_support`** with a **polymorphic target**:
  `{ id, hypothesisId, targetType ("evidence" | "finding"), targetId, stance, weight, note }`.
- `cases`: a case must have ≥1 hypothesis. Keep `case_hypotheses` but make creation atomic
  (create case + first hypothesis in one transaction).
- Migration: `add_case_findings_split_hypothesis_support` (data-migrate existing finding-evidence rows).

**API** (`apps/api/src`)
- `CreateCaseDto` (`dto/case.dto.ts`): add required `hypothesis: string`. `CasesService.create`
  creates the case + first `Hypothesis` in a `prisma.$transaction`.
- `CasesService.addEvidence` (`cases.service.ts`): reject `entityType = 'finding'`; instead expose
  `addFinding(caseId, evidenceId, findingId)` writing `case_findings`. When an asset is added as
  evidence, optionally auto-pull its open findings into `case_findings` as suggestions.
- Replace `HypothesisEvidence` logic in `hypotheses.service.ts` with `case_hypothesis_support`
  (link/unlink against evidence **or** findings).
- Regenerate OpenAPI + `@workspace/api-client` (`bun run openapi:generate` → `codegen`).

**Web** (`apps/web`)
- Create-case dialog (`app/(dashboard)/investigations/page.tsx`): add a **Hypothesis** field
  ("What do you suspect?") — required.
- Case workspace (`app/(dashboard)/investigations/[id]/page.tsx`): make it **hypothesis-led**.
  Default view lists hypotheses, each showing its supporting/contradicting **evidence and findings**
  and an evolving confidence bar. Evidence and Graph become supporting lenses, not the headline.
- `hypothesis-panel.tsx`: support linking both evidence and findings with a stance.
- Evidence cards show their attached findings inline (evidence → findings hierarchy), not findings as siblings.

**Acceptance**: create a case from a hypothesis; attach `customer.csv` (evidence) which carries a
`Contains PII` finding (case_finding); link both to the hypothesis as SUPPORTS; confidence reflects support.

---

## Phase 1 — Source-derived relationships (highest leverage)

The graph is only as good as its edges. Today edges are inferred (`CONTAINS`, `REFERENCES`).
Add **real** relationships emitted by connectors with `origin = SOURCE_DERIVED`.

- Relation vocabulary: `OWNS`, `ACCESSED`, `READS`, `WRITES`, `GENERATED_FROM`, `EXPORTED_TO`,
  `ATTACHED_TO`, `SENT_TO`, `EXECUTED`, `MENTIONS`.
- **CLI connectors** (`apps/cli`): each connector emits relationship records alongside assets
  (e.g. Databricks notebook → `READS` → Snowflake table; email → `ATTACHED_TO` → file →
  `SENT_TO` → recipient; storage → `OWNS`/`ACCESSED` from ACLs/access logs).
- **Ingestion API**: extend the bulk-ingest path to accept and upsert edges into `edges`
  (reuse the `@@unique` idempotency already in place).
- `packages/schemas`: declare per-source relationship kinds (mirrors `x-asset-metadata`).
- Keep inferred edges; distinguish visually by `origin`.

**Acceptance**: ingest a fixture where a notebook reads a table and an email carries a file;
`/graph/expand` returns `READS`/`ATTACHED_TO`/`SENT_TO` edges with `origin = SOURCE_DERIVED`.

---

## Phase 2 — Pivot menu (the "expand entity" workflow)

Replace the generic expand with **named investigation questions** on any node (Palantir / MS Sentinel style):

- Show owner • Show upstream lineage • Show downstream lineage • Show users with access •
  Show emails mentioning this • Show related incidents/cases • Show similar files •
  Show other assets with the same findings.

- Backend: each preset is a typed traversal in `GraphService` (filter `edges` by relation set +
  direction), e.g. "Who touched this?" → incoming `ACCESSED`/`READS`/`EXECUTED`. Add
  `POST /graph/pivot { entityType, entityId, pivot }`.
- Web `case-graph.tsx`: node context menu listing the pivots; results merge into the canvas.

**Acceptance**: from `customer.csv`, "Who touched this?" returns John (ACCESSED), the notebook
(READS), the pipeline (GENERATED_FROM); "Was this sent externally?" reaches `vendor@gmail.com`.

---

## Phase 3 — Alerts / case triggers (manual now → AI later)

A case should originate from a signal (finding or multiple findings, which MUST be linked to an alert), not only a blank form.

- **New `alerts`** (a.k.a. case triggers): `{ id, title, summary, severity, status (NEW/PROMOTED/DISMISSED),
  seedEntities (jsonb of asset/finding ids), origin (MANUAL | AI), createdAt }`.
- "Sensitive customer data might be shared externally" is an alert; **Promote to case** creates the
  case + initial hypothesis + pre-attaches the seed entities as evidence/findings.
- Manual creation now (a simple "raise alert" form + an alerts inbox); the table/flow is the
  foundation the AI engine (Phase 7) writes into.

**Acceptance**: create an alert with seed entities; promote it → a case opens pre-populated.

---

## Phase 4 — Data Concept nodes (semantic investigation)

The "connecting dots" value often comes from a shared **business concept**, not file-to-file links.

- **New `data_concepts`**: `{ id, name, kind }` — Customer Data, Employee Data, Financial Data,
  Source Code, Secrets.
- Concept↔asset relationships stored in `edges` with `fromType = 'concept'` (the generic edge
  table already supports this — see the schema comment).
- Auto-tag assets to concepts from their findings/metadata (PII+customer columns → Customer Data;
  secret findings → Secrets), with manual override.
- Graph + pivots gain `entityType = 'concept'`: "Show all assets related to Customer Data" returns
  the table, the export csv, the notebook, the email attachment.

**Acceptance**: a `Customer Data` concept expands to all four assets across S3/Snowflake/Databricks/Email.

---

## Phase 5 — Event sourcing & history

Reason about *evolution*, not just current state (also the substrate for AI).

- **New `asset_events`** (append-only): `{ id, assetId, type, payload, at }` with
  `ASSET_CREATED, ASSET_UPDATED, ASSET_DELETED, FINDING_ADDED, FINDING_REMOVED, EDGE_CREATED,
  EDGE_REMOVED, CLASSIFICATION_CHANGED, OWNER_CHANGED, ACCESS_GRANTED, ACCESS_REVOKED, LINEAGE_CHANGED`.
- **Case timeline** (`case_events`) and **graph timeline** (edge add/remove/confidence change).
- Emitted from ingestion + edge inference; surfaced as a timeline in the case workspace.

---

## Phase 6 — Case watchers + reactive engine

- **New `case_watch_entities`**: `{ caseId, entityId, depth }` — a case subscribes to part of the graph.
- On ingestion / new edge, enqueue (existing **pg-boss** `SchedulerService`) a Case Impact Assessment:
  **SQL first** finds cases whose watched entities are within N hops of the change (recursive CTE),
  cheaply, before any AI.

---

## Phase 7 — AI Case Relevance Engine

The differentiator. Reuses the existing `AiClientService` (`apps/api/src/ai`).

- Pipeline: `graph change → SQL finds candidate cases (≤3 hops) → LLM judges relevance per case`.
- Prompt returns `{ relevant, confidence, reason, suggested_action }`.
- **Never auto-attach.** Write **`case_suggestions`** `{ caseId, targetType, targetId, confidence,
  reason, status (NEW/ACCEPTED/REJECTED) }`; investigator Accepts/Rejects/Ignores.
- AI also: drafts **alerts** (Phase 3) and **auto-evolves hypothesis confidence** from accumulated
  support/contradiction.

---

## Phase 8 — Tasks & collaboration

- **New `case_tasks`**: `{ caseId, title, status, assignee, dueAt }`.
- Per-user identity/authZ (today single-tenant; `assignee`/`createdBy` are free-text).
- Large-graph virtualization; export a case (evidence + findings + hypotheses + conclusion) as a report.

---

## Sequencing & priority

1. **Phase 0** — protocol correction (must precede everything; it changes the data model the rest builds on).
2. **Phase 1** — source-derived edges (unlocks real investigations and the pivots).
3. **Phase 2** — pivot menu (turns the graph into an investigation tool).
4. **Phase 3 + 4** — alerts and data concepts (origination + semantic pivots).
5. **Phase 5 → 6 → 7** — history → watchers → AI engine (the reactive, AI-driven endgame).
6. **Phase 8** — tasks/collaboration polish.

## Verification approach (per phase)

- **Schema**: `prisma migrate dev` (Node 22); confirm tables + data migration for Phase 0.
- **API**: `bun --filter api check-types` + new `.spec.ts` per service; recursive-CTE/pivot traversals
  tested against a seeded fixture (assets + findings + typed edges).
- **Client**: regenerate OpenAPI + api-client; `bun --filter web typecheck`.
- **E2E**: dev servers + preview tools — create a case *from a hypothesis*, attach evidence whose
  findings support it, pivot ("Who touched this?", "Sent externally?"), watch confidence evolve,
  record a conclusion. Production `bun build`.

## Notes / open decisions

- Phase 0 is intentionally a **breaking refactor** of the unreleased MVP — preferred over carrying the
  evidence/finding conflation forward.
- Implementation begins with Phase 0 on approval.
