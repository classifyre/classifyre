# SL3 · Semantic links: the semantic lineage

*Part of [the semantic layer](SL0-semantic-layer-architecture.md). Research: [glossary-semantic-layer.md](../research/glossary-semantic-layer.md) §4 and §6.4.*

| | |
|---|---|
| **Status** | Draft for review |
| **Date** | 2026-10-01 |
| **Size** | M |
| **Milestone** | M2, built together with SL2 |
| **Depends on** | SL1; SL2 (the binding compiler) |
| **Feeds** | SL4, SL5, G5′, G6, G7, G3 (case export) |
| **Owns** | Foundation F9 (`asset_terms`), contract C11 (Meaning DTO), the graph parts of C12 (`term` node, `term_ref`, `MEANS`) |

## 0. Decisions that apply

| # | Decision |
|---|---|
| D2 | Links, not tags: each has a method, evidence and a lifecycle |
| D3 | Connector declarations are in v1, alongside bindings and suggestions |
| D5 | The board lens and the map read these links (SL5) |
| SL-1–SL-5 | The engineering rules in SL0 §10 |

## 1. Problem

Even with bindings (SL2), meaning has to be **applied** and then **shown**. Today:
- nothing records that an asset is about a concept;
- no page shows a finding's meaning;
- no filter or watch can say "about *Health data*";
- people cannot link a finding, asset or case to a term at all (research §1.3).

A semantic link must also behave like lineage:
- it explains itself;
- it updates when evidence changes;
- it goes away when its evidence does;
- it stays out of the data-flow graph.

## 2. Goals and non-goals

### Goals

1. A rollup of links, asset × term × method (F9), maintained by one **linker**:
   - incrementally after every run;
   - by backfill when meaning changes;
   - never with a row per finding (SL-2).
2. Methods: BINDING, DECLARED, MANUAL, SUGGESTED (accepted from SL4). MENTION is reserved for G5′.
3. A lifecycle: links appear, are refreshed and go GONE; history is kept.
4. Finding-level explanations, resolved on read.
5. Manual links from findings, assets and cases.
6. Connector declarations: `Ref.term(key)` and `means()` in the notebook SDK, `asset.means()` in augmentation, `term://` URN resolution and stitching.
7. Surfaces:
   - Meaning cards on the finding, asset and detector pages;
   - the term page's *Evidence* and *Cases & watches* tabs;
   - search filters, a watch dimension, exports;
   - the glossary page's coverage figure.
8. Taxonomy roll-up on read ("include narrower").
9. Lineage, trace and the source map ignore `term` endpoints by default (SL-4).

### Non-goals

- Suggestions and the review queue (SL4); the board and the map (SL5).
- Entity mentions (G5′).
- Propagating meaning along lineage (SL-3).

## 3. How links are derived

| Method | Derived from | Asset gets a link when… | Finding-level evidence |
|---|---|---|---|
| **BINDING** | APPROVED bindings with an APPROVED target (SL2) | It has ≥ 1 OPEN finding matching an output binding, or its metadata matches a metadata binding | The findings that match the binding (compiler, SL2 §4.6). Metadata bindings have none: the evidence is the field value |
| **DECLARED** | `MEANS` edges a connector emitted to a term (§7) | The latest full scan re-declared the edge | The edge's `evidence` JSON and run |
| **MANUAL** | `glossary_references` rows with role ABOUT, on a finding or an asset | A person linked it | The linked finding, or none for an asset link |
| **SUGGESTED** | SL4 suggestions of kind LINK that a person accepted | It was accepted | The suggestion's evidence (chunk, similarity) |
| **MENTION** | G5′ (`entity_values`) | — | — |

**Confidence:**

| Method | Confidence |
|---|---|
| BINDING | The binding's confidence (default 1.0) |
| DECLARED | The edge's confidence |
| MANUAL | 1.0 |
| SUGGESTED | The accepted score |

**Support count:**

| Method | Support count |
|---|---|
| BINDING | Matching open findings |
| DECLARED | 1 per declaring edge |
| MANUAL | Linked findings, or 1 |
| SUGGESTED | 1 |

## 4. Requirements

### R1 The rollup (F9)

Each `asset_terms` row is one asset × term × method.

**Columns:**
- `supportCount`;
- `bindingIds[]` (BINDING), and `sampleFindingId` (the highest-severity, most recent supporting finding);
- `maxSeverity`, `confidence`;
- `firstLinkedAt`, `lastLinkedAt`, `goneAt`;
- `sourceId`, denormalised for filters and rollups.

**Writes.** Only the linker writes the table: an integration rule, enforced by a spec that greps for writers.

**GONE:**
- When support reaches 0, `goneAt` is set. The row stays for history.
- If support returns, `goneAt` is cleared and `firstLinkedAt` is kept.
- Rows gone for more than 90 days are purged. The table is a cleanable dataset (SL-9), and the retention can be configured.

### R2 The linker

A `semantic-links` pg-boss queue, registered per namespace (integration rule 8), with three job kinds. Counters and progress are **persisted** in `semantic_link_jobs`, because in-memory state is wiped with namespace workers.

| Job | Trigger | Scope | Mechanism |
|---|---|---|---|
| **Incremental** | Run finalisation (next to `scheduleCorrelationRecompute`); a bulk finding status operation; a finding status change by a person | The assets the run or the operation touched | Batches of 500 assets. One query per batch per method over `findings f` with `f.asset_id = ANY($batch) AND f.status = 'OPEN'`, joined to the cached APPROVED bindings through the compiler. Index `[assetId, status, severity, detectorType, findingType]`. Then upsert the asset's rows and mark missing ones GONE |
| **Backfill** | A binding approved, disabled or enabled; a term approved, deprecated or reinstated; a lookup scheme's codes or labels edited; a pack installed | The outputs or fields the change affects | Walks `findings` by **`ctid` block ranges** (integration rule 9), filtered by the changed bindings' outputs, aggregating per asset. Batches of 10,000 pages; 30 s statement timeout; resumable from the last block. Metadata bindings walk `assets` the same way. Several pending changes merge into one walk |
| **Reconcile** | Nightly, and on demand from Settings | Whole workspace, bounded | Compares the rollup with a recomputation for a sample of assets (1%, at least 1,000) and repairs drift. Reports what it repaired |

Progress shows on the binding row ("Linking… 42%"), on the term page, and in Settings → Workers. A failed job is retried with backoff; a poisoned batch is skipped with a logged reason, never silently.

Event: `semantic.links_updated`, **once per job**, carrying counts per term (added, gone) and the run id when there is one. Never one event per link.

### R3 Taxonomy roll-up

**Include narrower.** Any read that names a concept can ask for its narrower concepts too (`includeNarrower=true`), using SL1's `narrowerClosure` over APPROVED BROADER relations, depth ≤ 10. Distinct assets are counted once.

**Term-page header counts:**
- *direct*: links to this term;
- *with narrower*: links to this term or any narrower term.

**INSTANCE_OF** is not rolled up in v1: a concept doesn't count its entities' mentions until G5′ decides how to present them.

### R4 Finding-level resolution

| Endpoint | Returns |
|---|---|
| `GET /semantic/findings/:findingId/meaning` | The terms this finding is evidence of: APPROVED bindings evaluated in memory, plus MANUAL references to the finding (plus G5′ mentions later). Each as a C11 item |
| `GET /semantic/assets/:assetId/meaning` | The asset's current links (any method), grouped by term, with counts and one sample each, plus GONE links from the last 90 days behind *Show history* |
| `GET /semantic/assets/:assetId/terms/:termId/evidence?page=` | Why this asset is about this term: matching findings per binding, declarations (edge evidence), manual links, accepted suggestions |
| `GET /semantic/terms/:termId/evidence?includeNarrower=&sourceId=&method=&status=current\|gone\|all&page=` | Assets for the term page, with source, kind, support, maximum severity, method and dates. Sorted by severity, then support |
| `GET /semantic/terms/:termId/summary?includeNarrower=` | Counts (assets, findings, sources), counts by method, by source and by severity, plus a weekly trend from `firstLinkedAt` and `goneAt` |

Matched content shown in any of these goes through the content presenter (F6).

### R5 Manual links

`glossary_references` gains:
- `role`: PROVENANCE (today's meaning, "established by") or ABOUT (a semantic link);
- `note`;
- `asset` as a target type.

The unique key becomes `(glossaryTermId, entityType, entityId, role)`. Existing rows become PROVENANCE.

| Endpoint | Behaviour |
|---|---|
| `POST /semantic/links` (`{ termId \| termKey, target: { type: 'finding' \| 'asset' \| 'case', id }, note? }`) | Operator-level. Creates an ABOUT reference and schedules an incremental link for the affected asset |
| `DELETE /semantic/links/:referenceId` | Removes it; the asset's MANUAL link goes GONE when nothing else supports it |

**Rules:**
- A case ABOUT link describes the case ("this case is about *GmbH*"). It feeds SL5's case vocabulary panel and is not an asset link.
- Agents create PROVENANCE references, as today. An agent's ABOUT link is only a **proposal** (D7): it becomes an SL4 LINK suggestion with origin AGENT.

### R6 Connector declarations

**Notebook SDK** (`apps/cli/src/graph/edges.py`, exported from `classifyre`):

```python
Ref.term("gmbh")                       # -> Ref("urn", "term://glossary/gmbh")
means(Ref.asset(company_id), Ref.term("gmbh"),
      evidence={"field": "Rechtsform", "value": "GES"}, confidence=1.0)
```

- `means()` builds an `Edge` of class `REFERENCE` with relation type `MEANS` and method `SYSTEM_CATALOG` by default.
- The subject may be an asset, a URN or a finding.
- Augmentation gets `asset.means("gmbh", evidence=…)`. It is additive, like `tag()` and `link()`.

**API edge ingest** (`GraphService.upsertEdges`):
- The URN platform `term` resolves against `glossary_terms.key`, then `previousKeys` (C8). A resolved endpoint has type `term` and the term's id.
- An **unresolved** term URN is stored with endpoint type `term_ref` and the normalised URN as its id, never `external`, so the connection map and external-node hydration ignore it.
- When a term is created, or its key changes, `stitchTermRefs(keys)` rebinds those rows in the same way as `stitchExternalEdges`. Scans and glossary edits can therefore happen in either order.

**What the linker does with them:**
- It projects `asset —MEANS→ term` edges into DECLARED links.
- Declarations to DRAFT terms are stored but produce no link until the term is APPROVED (SL-5).
- A declaration not re-asserted by a later **full** scan follows the edge expiry (`lastSeenAt`), and its link goes GONE.

**Endpoint types in traversals (SL-4):**
- `GraphService.traverse`, `trace` and `lineage` skip `term` and `term_ref` endpoints unless the request asks for the `meaning` kind (SL5).
- `SourceGraphService` skips them when building rollups.
- `hydrateNodes` knows the `term` node type, labelled with the term's name and kind glyph.

### R7 Surfaces

#### R7.1 Finding page: *Meaning* card

Placed next to *Metadata* and *Extraction*.

```
Meaning
 ⬡ Bank account  ← binding "IBAN code · PII → Bank account"   (approved by Legal, 3 Oct)   ⓘ
 ⬡ Financial data (broader)
 ◇ ACME Holding GmbH  ← (G5′)
[ Link to term… ]   [ What does this mean? ]   (opens SL2's dialog, prefilled)
```

- `ⓘ` opens the explanation: method, binding, approver, confidence and since.
- An empty card says "No meaning yet" and shows the SL2 dialog button first.

#### R7.2 Asset page: *Meaning* section

- Chips for current terms, each with a method icon and a support count. Clicking a chip opens the term page filtered to this asset.
- *Show history* lists GONE links.
- *Link to term…* creates a MANUAL link.

#### R7.3 Term page tabs (filling SL1's placeholders)

| Tab | Content |
|---|---|
| **Evidence** | R4 summary header (counts, methods, sources, weekly trend), *include narrower* toggle, filters (source, method, current/gone), asset table with *Why?* expansion (R4 evidence) and CSV export |
| **Cases & watches** | Cases whose evidence assets link to the term, or which have a case ABOUT link; watches with a term condition on it; *Watch this term* and *Add to case…* |
| **Bindings** | SL2 |

#### R7.4 Glossary page

The coverage figure: the share of open findings matched by at least one APPROVED binding or manual link, plus outputs marked *No meaning*. It is computed by the linker after each job and stored in `semantic_stats` (one row per day).

#### R7.5 Findings and assets search

- New filters `term` (keys), `includeNarrower` and `meaningMethod`.
  - **Findings:** a finding qualifies when it is evidence of the term: a BINDING match through the compiler's SQL half, or a MANUAL reference to the finding.
  - **Assets:** an asset qualifies when it has a current link of any method.
- `assertKnownFindingFilterKeys` and the asset search's fail-closed check learn the new keys (integration rule 4).
- **Quick search** returns terms as a result group that opens the term page.

#### R7.6 Watches

The inquiry matcher gains the dimension `termKeys[]` with `includeNarrower`. A finding matches when it is evidence of one of the terms, with the same semantics as the findings filter.
- **In memory** (`CompiledMatcher`): evaluates the cached APPROVED bindings, plus a set of manually linked finding ids for those terms, loaded per matcher compile.
- **SQL half** (`candidateWhere`): an `OR` of the compiled binding predicates, plus `id IN (manual ids)`.
- `matcher-sql-conformance.spec.ts` is extended with term fixtures.
- **Inquiry form:** a new *About* section with a term picker and *include narrower*.
- **When G4 lands:** this dimension becomes the F2 field `finding.term`, migrated with the other matcher dimensions.

**Newness** stays with run anchors. A binding approved today does not make every old finding "NEW"; matches arrive as the existing ones they are. The watch's timeline records a `MATCHERS_UPDATED`-style entry: "meaning changed: binding *IBAN → Bank account* approved, 812 matches".

#### R7.7 Exports

- **Findings CSV and live query:** a `terms` column listing the keys this finding is evidence of. It is built in SQL with a `LATERAL` join on APPROVED bindings, the binding table being small, plus manual references.
- **Assets CSV and live query:** a `terms` column with the current asset-level keys from `asset_terms`.
- **G3 case export (C6):** each piece of evidence carries its Meaning (C11).

### R8 Autopilot and MCP

**MCP (group `glossary`, plus filter additions in `findings` and `inquiries`):**
- `get_finding_meaning`, `get_asset_meaning`;
- `get_term_evidence`, `get_term_summary`;
- `link_term`, `unlink_term` (operator level);
- the `term` and `includeNarrower` filters on `search_findings`, `search_assets` and the inquiry tools.

**Autopilot:**
- `glossary.term_evidence` and `glossary.finding_meaning` (read);
- `glossary.propose_link`, which goes to the SL4 queue;
- the `term` filter on agent finding search.

**Doctrine:**
- prefer filtering by term over regex on values when a concept exists;
- explain a case's scope in terms (*about* links) when obvious.

**Restore the precise doctrine sentence** from SL1 R13: "semantic links are derived from those findings — removing a detector removes the meaning they carried".

`detection-impact.service.ts` adds to the preview the terms whose links would go GONE.

### R9 Events, transfer, cleanup, demo mode

| Area | Behaviour |
|---|---|
| **Events (F1)** | `semantic.links_updated`: one per linker job, with `{ runId?, trigger, terms: [{ key, added, gone }], durationMs }`. Payload schema in `domain_events.json` |
| **Data transfer** | `asset_terms`, `semantic_stats` and `semantic_link_jobs` are deliberately absent (derived; a backfill rebuilds them after import, and the transfer job schedules it). `glossary_references` keeps its existing scope, with the new columns |
| **Cleanup** | A cleanable dataset, *Semantic links (derived)*, with *Rebuild*. Purging GONE rows follows R1 |
| **Demo mode** | Link writes are blocked; reads are allowed |

## 5. Data model (Prisma, tenant schema)

```prisma
enum SemanticLinkMethod {
  BINDING
  DECLARED
  MANUAL
  SUGGESTED
  MENTION // G5′
}

enum GlossaryReferenceRole {
  PROVENANCE
  ABOUT
}

model AssetTerm {
  assetId         String             @map("asset_id")
  termId          String             @map("term_id")
  method          SemanticLinkMethod
  sourceId        String             @map("source_id")
  supportCount    Int                @map("support_count")
  bindingIds      String[]           @default([]) @map("binding_ids")
  sampleFindingId String?            @map("sample_finding_id")
  maxSeverity     Severity?          @map("max_severity")
  confidence      Decimal            @default(1.00) @db.Decimal(3, 2)
  firstLinkedAt   DateTime           @map("first_linked_at")
  lastLinkedAt    DateTime           @map("last_linked_at")
  goneAt          DateTime?          @map("gone_at")

  asset Asset        @relation(fields: [assetId], references: [id], onDelete: Cascade)
  term  GlossaryTerm @relation(fields: [termId], references: [id], onDelete: Cascade)

  @@id([assetId, termId, method])
  // Term page and filters: current assets of a term.
  @@index([termId, goneAt])
  @@index([sourceId, termId])
  @@map("asset_terms")
}

model GlossaryReference {
  // existing: id, glossaryTermId, entityType ('case'|'inquiry'|'source'|'finding', now also 'asset'),
  // entityId, createdBy, createdAt
  role GlossaryReferenceRole @default(PROVENANCE)
  note String?               @db.Text

  @@unique([glossaryTermId, entityType, entityId, role]) // replaces the 3-column unique
}

model SemanticStat {
  day                 DateTime @id @db.Date
  openFindings        Int      @map("open_findings")
  findingsWithMeaning Int      @map("findings_with_meaning")
  assetsWithMeaning   Int      @map("assets_with_meaning")
  computedAt          DateTime @map("computed_at")

  @@map("semantic_stats")
}

model SemanticLinkJob {
  id         String    @id @default(uuid())
  kind       String    // INCREMENTAL | BACKFILL | RECONCILE
  trigger    Json      @db.JsonB   // { runId } | { bindingIds } | { termIds } | {}
  status     String    // QUEUED | RUNNING | DONE | FAILED
  // Backfill resume point: the last ctid block done.
  cursor     Json?     @db.JsonB
  progress   Float     @default(0)
  added      Int       @default(0)
  gone       Int       @default(0)
  error      String?   @db.Text
  startedAt  DateTime? @map("started_at")
  finishedAt DateTime? @map("finished_at")
  createdAt  DateTime  @default(now()) @map("created_at")

  @@index([status, createdAt])
  @@map("semantic_link_jobs")
}
```

**Volume.** Assets × linked terms. For example, 2 M assets with 2 links each is 4 M narrow rows: the same order as `asset_correlation_values`, which this codebase already runs.

**Migration notes:**
- The `glossary_references` unique-key change happens in a new migration that adds the column with its default before swapping the index (integration rule 2).
- `CaseBoardItemKind` is untouched here; SL5 adds TERM.

## 6. Notebook SDK detail

| Addition | Where |
|---|---|
| `Ref.term(key)` | `graph/edges.py`. Validates the key against C8 and builds `term://glossary/<key>` through `utils/urn.py` |
| `means(subject, term, *, confidence=None, evidence=None, method=Method.SYSTEM_CATALOG)` | `graph/edges.py`, exported in `notebook/sdk.py`'s `__all__` and module, next to `references` |
| `AugmentedAsset.means(key, *, evidence=None, confidence=None)` | `augmentation/sdk.py`. Additive writer, recorded in `patch()` |
| `_RefMeta` hints | A misspelt `Ref.terms` or `Ref.concept` suggests `Ref.term(<key>)`, as the existing hints do |
| URN rules | Platform `term` in both `utils/urn.py` and `graph/urn.ts`, with `authorityCase: lower` and `pathCase: lower`. `urn.spec.ts` and `tests/test_urn.py` pin the same cases |

Every Python function stays type-annotated (mypy strict) and ruff-clean.

## 7. Performance

| Path | Target |
|---|---|
| Incremental linking | ≤ 2 s per 500 assets at p95 with 500 APPROVED bindings. Never on the scan's critical path; scheduled after finalisation |
| Backfill | One binding over 2 M open findings of one output in ≤ 10 min. Several bindings share one `ctid` walk |
| Term evidence page | ≤ 300 ms at p95, from `asset_terms` through `(termId, goneAt)` |
| Finding Meaning card | ≤ 50 ms: cached bindings in memory, plus one indexed reference read |
| Findings filter by term | Compiles to `OR`ed typed predicates on `detector_type`, `finding_type` and `custom_detector_key`, which are indexed. Value bindings add `glossary_norm(matched_content) = ANY($values)` only inside the narrowed output |
| Watches | The matcher compile caches bindings per namespace and invalidates on `glossary.binding_changed` |

## 8. Rollout

1. **PR 1:** model, linker (incremental and backfill), jobs table, events. Ships with SL2's PR 3 so a saved binding produces links.
2. **PR 2:** read APIs and Meaning cards on the finding and asset pages; the term page's Evidence tab.
3. **PR 3:** search filters, quick search, exports.
4. **PR 4:** watch dimension and inquiry form.
5. **PR 5:** manual links (`glossary_references.role`) and the case ABOUT link.
6. **PR 6:** connector declarations: SDK, URN platform, `term_ref` stitching and traversal exclusions.
7. **PR 7:** reconcile job, coverage stats, cleanup and transfer registration.

## 9. Testing

- **Linker:**
  - incremental vs backfill equivalence on a fixture corpus (the same rollup either way);
  - GONE and revival;
  - binding disable;
  - term deprecate;
  - lookup scheme edits;
  - resume from a `ctid` cursor;
  - poison-batch skip;
  - persistence across a worker teardown (`clearForSchema`).
- **Rules:**
  - SL-2: a spec asserts that nothing writes per-finding semantic rows;
  - SL-4: traversal, trace, lineage and source-graph specs with `term` and `term_ref` endpoints present;
  - SL-5: DRAFT terms and bindings produce no links.
- **Matcher conformance** with the term dimension.
- **SDK:**
  - `Ref.term` validation; `means()` payload;
  - augmentation `means`;
  - URN parity tests in both languages;
  - stitching when the term is created after the scan.
- **E2E:**
  - scenario D, steps 4–5;
  - scenario E, steps 3 and 5 (SL0 §7);
  - a manual link from a finding appears on the term page and in the asset's Meaning.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Backfill load on large corpora | `ctid` walks, merged changes, statement timeouts, resumable cursor, off peak by default for jobs over 1 M findings (configurable) |
| Rollup drift (missed incremental) | Nightly reconcile and an on-demand *Rebuild* |
| Concept hubs make filters and watches slow | Filters compile to typed predicates; the term page paginates; hub caps live in SL5 |
| Watches flood after a broad binding | Newness is anchored to runs (R7.6), so approving a binding doesn't create a NEW flood. Watches with a term condition show the meaning change on their timeline |
| Declared links to misspelt keys | Stored as `term_ref` and listed under Glossary → Proposals → *Unknown term references*, with counts and *Create concept* |

## 11. Acceptance criteria

- [ ] Approving a binding links the matching assets without a re-scan. Disabling it marks the links GONE within one linker job.
- [ ] After a run, new findings of a bound output show their meaning on the finding page within the incremental job's latency.
- [ ] The term page shows evidence with *include narrower*, sources, methods and a weekly trend. *Why?* explains every asset.
- [ ] Findings and assets can be filtered by term. A watch with a term condition matches exactly what the filter returns (conformance).
- [ ] A notebook's `means(Ref.asset(...), Ref.term("gmbh"))` yields DECLARED links, also when the term is created after the scan.
- [ ] Lineage, trace and the connection map are unchanged by `term` endpoints (specs).
- [ ] Exports carry `terms`; coverage shows on the glossary page.

## 12. Definition of done

The integration architecture's §9 and SL0 §12.

## 13. Open questions

| # | Question | Default until answered |
|---|---|---|
| Q1 | Should a concept count its entities' mentions (INSTANCE_OF roll-up)? | No until G5′ decides presentation |
| Q2 | Should GONE links of case evidence stay visible on the board forever, given evidence preservation? | Yes on the board (SL5 snapshots); purge applies to the rollup only |
| Q3 | Should the findings filter treat asset-level links (DECLARED, metadata bindings) as "every finding of the asset"? | No: findings qualify only as evidence. Asset search covers asset-level meaning |
