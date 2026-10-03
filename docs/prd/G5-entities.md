# PRD G5 · Entities: from mentions to things

| | |
|---|---|
| **Status** | Proposed |
| **Size** | L |
| **Milestone** | M4 · Entities ([integration](00-integration-architecture.md#4-build-order-and-milestones)) |
| **Depends on** | F2 conditions ([G4](G4-extracted-values-and-watch-conditions.md)) for entity watches; F1 events ([G3](G3-outbound-webhooks-notifications-export.md)); [S1](S1-enterprise-extension-seams.md) actor for verdicts. Strongly benefits from [G2](G2-eu-detection-coverage.md) A7 (identifier labels) |
| **Provides** | Foundation **F4**: the value index as a shared service, independent of the duplicates switch. Entity pages, the entity review queue, entity evidence on cases, entity conditions |
| **Used by** | [G6](G6-triage-queue.md) (group triage items by entity), [G3](G3-outbound-webhooks-notifications-export.md) (entity events, exports), [G7](G7-outcome-metrics.md) (entity-resolution review metrics) |

## 1. Summary

Turn the strings Classifyre finds into the **things** they refer to. An *entity* (a person, organisation, location, account or other named thing) has a canonical name, aliases and identifiers, and a set of confirmed **values**: normalised finding values that refer to it.

Mentions are not stored per finding. They are derived by joining an entity's values with the existing value index (`asset_correlation_values`). Exact aliases and identifiers link automatically. Phonetic and fuzzy candidates go to a review queue, and two entities are never merged automatically.

Entities get a page, can be case evidence and board nodes, can be watched ("anything new about ACME"), and their co-mentions show who appears with whom.

This grows out of the **glossary**, which already has typed canonical terms, aliases, operator-gated alias proposals, embeddings and verification. It is not a new platform.

## 2. Why

- **The flow pivots on strings, never on things.** In the [gap analysis](../../palantir-use-case-gap-analysis.md) §4.4, these are four unconnected objects:
  - the mention "ACME Holding GmbH" in an email (a PII `ORGANIZATION` finding);
  - the Firmenbuch record for ACME (a CUSTOM record asset with a URN);
  - the glossary term "ACME";
  - the value `ATU12345678` (a VAT number).

  An investigator must connect them by hand every time.
- **The strongest signal already exists, per string.** Exact cross-document recurrence (`get_value_occurrences`) was "the cleanest, most defensible signal" in the Enron run and carried its main case (`docs/first-use/enron-second-attempt/product-evaluation.md`). Entities make that signal first-class across *all* of a thing's names and identifiers.
- **Several sector slices need it.** The single client view (the core of the Citi result in the research), deduplicating beneficiaries across NGO records, supplier and part identity, person and organisation pivots in investigations, and GDPR access requests ("everything we hold about this person") are all entity problems.
- **Duplicates, weights and embeddings measure similarity, not identity.** Duplicate review compares documents; embeddings compare texts; the value index matches exact strings. None of them says "these five spellings and this IBAN are the same company".

## 3. Goals

- An operator can create an entity (or promote a finding value to one) and immediately see every mention across all sources.
- Exact aliases and identifiers link without review. Uncertain candidates are reviewed quickly and decisions are remembered.
- An entity can be case evidence, a board node, the subject of a watch, and a pivot in the case trace.
- Register-like CUSTOM sources (Firmenbuch, a customer master) can *declare* entities as they ingest records.
- Resolution never makes correlation noisier (field report P6): only identifier-like and name-like labels take part.

## 4. Non-goals

- Automatic merging of two entities.
- Typed object schemas, functions or actions (a Palantir Ontology). Entities carry free-form `attributes` only.
- Relationship *types* between entities in v1, beyond co-mention and connector-declared edges.
- Semantic (embedding-based) candidate generation in v1 (see §12).

## 5. Requirements

### Model and resolution

| # | Requirement | Priority |
|---|---|---|
| R1 | Glossary terms are entities. New columns on `glossary_terms` (§6.1): `identifiers`, `anchorUrn`, `attributes`, mention counters, `mergedIntoId`, `status`. Existing terms keep working unchanged | MUST |
| R2 | New table `entity_values`: (term, `valueHash`, label, normalised value, method, verdict, score, decidedBy, decidedAt). Mentions are the join `entity_values (CONFIRMED) ⋈ asset_correlation_values ON value_hash` | MUST |
| R3 | **Exact linking without per-run work.** On entity save, every alias and identifier is normalised with the correlation normaliser (`normalizeValue(label, raw)` in `correlation/value-normalizer.ts`) and stored as a CONFIRMED value (`EXACT_ALIAS` / `IDENTIFIER`). Future findings with the same normalised value become mentions automatically through the join | MUST |
| R4 | **Candidate generation** runs after each run's values are indexed, for the run's new values only (bounded by the run's assets). Phonetic match on `phoneticHash` for name-like labels, plus Jaro-Winkler ≥ 0.92 inside the phonetic bucket (`correlation/fuzzy.ts` has `jaroWinkler`). Results are PROPOSED, with a score | MUST |
| R5 | Only identifier labels (the non-phonetic identifier set, generated from the PII catalogue in [G2](G2-eu-detection-coverage.md) A7) and name labels (`person`, `organization`, `name`, custom labels declared as names) take part. Tag and free-text labels never do | MUST |
| R6 | An identifier value (IBAN, national ID, VAT) confirmed for one entity cannot be confirmed for another without a conflict review. A name value may belong to several entities and is then flagged *ambiguous* on the entity page | MUST |
| R7 | **Merge:** move aliases, identifiers, values, references and case evidence from A to B. A becomes `MERGED` and redirects to B. Recorded as `entity.merged`. Splitting is v2 | MUST |
| R8 | Counters (`mentionCount`, `assetCount`, `sourceCount`, `firstSeenAt`, `lastSeenAt`) are updated incrementally per run and fully recomputed nightly and after imports | MUST |

### Value index as a shared service (F4)

| # | Requirement | Priority |
|---|---|---|
| R9 | Split today's correlation work into **value indexing** (`values.index`: writes `asset_correlation_values`) and **pair scoring and review** (existing duplicates). Value indexing runs whenever *any* consumer is on: duplicates or entities. Scoring honours the duplicates workspace switch as today (`correlation/correlation-switch.service.ts`) | MUST |
| R10 | A separate **Entities** workspace feature switch sits next to embeddings and duplicates (Settings → Cleanup › Features), with the same off-and-keep / off-and-delete semantics | MUST |
| R11 | The autopilot hand-off happens after entity resolution, so agents see fresh mentions | SHOULD |

### Sources declaring entities

| # | Requirement | Priority |
|---|---|---|
| R12 | Notebook SDK: `Asset(entity=Entity(type="ORGANIZATION", name="ACME Holding GmbH", identifiers={"fn": "123456a", "vat": "ATU12345678"}, aliases=[…]))`. On ingest the API upserts the entity, anchored to the asset's URN (idempotent by URN). Identifiers become CONFIRMED values | SHOULD |
| R13 | Declared entities are `origin=CONNECTOR` and verified by default: the register is the authority. Operators can still edit them | SHOULD |

### Surfaces

| # | Requirement | Priority |
|---|---|---|
| R14 | **Entity page** (the glossary page becomes "Entities & glossary"): name, type, aliases, identifiers, anchor link; mentions over time; sources and assets; findings (through the content presenter, [S1](S1-enterprise-extension-seams.md)); top co-mentioned entities; cases; watches; pending candidates | MUST |
| R15 | **Review queue** for PROPOSED values: value, label, score, snippets from up to 3 occurrences, accept or reject, batch actions. It reuses the duplicate-review components and conventions (`decidedBy` separating agent from human work, as `CorrelationPairVerdict` does) | MUST |
| R16 | **"Make entity"** from a finding or from `get_value_occurrences`: creates the entity with the value as its first alias or identifier | MUST |
| R17 | **Cases:** an entity can be case evidence (`CaseEvidence.entityType = 'entity'`). The board renders it as an EVIDENCE node with a mention count. A new lead origin `ENTITY` proposes findings that newly mention a case's entities, through the existing lead refresh (`CaseActivityService` → `CaseLeadsScheduler`) | MUST |
| R18 | **Watches:** the `entity` condition from [G4](G4-extracted-values-and-watch-conditions.md) is enabled. "Watch this entity" on the entity page creates a watch with that condition | MUST |
| R19 | **Graph:** an entity with an anchor URN has an IDENTITY edge to its anchor asset, so traces and lineage pass through it. Co-mentions are computed on demand, never stored as edges, which avoids the hub fan-out of field report P13 | MUST |
| R20 | **Access-request export:** "Export mentions" (CSV and JSON: asset, source, location, finding type, value through the presenter) answers "what do we hold about this person" | SHOULD |
| R21 | **MCP:** `search_entities`, `get_entity`, `get_entity_mentions`, `get_co_mentioned_entities`, `create_entity`, `update_entity`, `list_entity_candidates`, `review_entity_candidates`, `merge_entities` in a new `entities` capability group. `lookup_glossary` returns entity counters | MUST |
| R22 | **Autopilot:** agents may create unverified entities and propose aliases (the existing `proposedAliases` gate), and may propose verdicts. Only a person confirms identifier conflicts and merges | MUST |

## 6. Design

### 6.1 Schema changes (per tenant schema)

```prisma
// glossary_terms: new columns
model GlossaryTerm {
  // … existing columns …
  identifiers     Json      @default("[]")              // [{ label: "vat", value: "ATU12345678" }]
  anchorUrn       String?   @map("anchor_urn")
  attributes      Json?                                   // free-form, from connectors or people
  status          String    @default("ACTIVE")           // ACTIVE | MERGED
  mergedIntoId    String?   @map("merged_into_id")
  mentionCount    Int       @default(0) @map("mention_count")
  assetCount      Int       @default(0) @map("asset_count")
  sourceCount     Int       @default(0) @map("source_count")
  firstSeenAt     DateTime? @map("first_seen_at")
  lastSeenAt      DateTime? @map("last_seen_at")
  values          EntityValue[]
  @@index([anchorUrn])
}

enum EntityValueMethod {
  EXACT_ALIAS
  IDENTIFIER
  CONNECTOR
  PHONETIC
  FUZZY
  MANUAL
}

enum EntityValueVerdict {
  CONFIRMED
  PROPOSED
  REJECTED
}

model EntityValue {
  id              String             @id @default(uuid())
  termId          String             @map("term_id")
  valueHash       String             @map("value_hash") @db.VarChar(64)   // = asset_correlation_values.value_hash
  label           String
  normalizedValue String             @map("normalized_value")
  method          EntityValueMethod
  verdict         EntityValueVerdict
  score           Float?
  decidedBy       String?            @map("decided_by")
  decidedAt       DateTime?          @map("decided_at")
  createdAt       DateTime           @default(now()) @map("created_at")
  term            GlossaryTerm       @relation(fields: [termId], references: [id], onDelete: Cascade)
  @@unique([termId, valueHash])
  @@index([valueHash, verdict])
  @@map("entity_values")
}
```

- `valueHash` uses the correlation engine's own `valueHash(label, normalizedValue)`, so no second normalisation exists anywhere.
- `glossary_references` already supports polymorphic references to cases, inquiries, sources and findings. Merges move them.
- Data transfer: add `entityValue` to the existing `glossary` scope (`transfer-scopes.ts`). Counters are derived and recomputed after import.

### 6.2 Resolution worker (`apps/api/src/entities/`)

- **Queue `entities.resolve`.** A coalesced singleton per namespace, enqueued when `values.index` finishes for a run. Its input is the run id, whose assets bound the delta through `RunnerAsset`.
- **Steps:**
  1. Load the new value rows for the run's assets, name-like and identifier labels only.
  2. Exact matches are already joined (R3); only counters need updating.
  3. For name-like values without a confirmed entity, run a phonetic bucket lookup against entity alias phonetic hashes (precomputed on save), then Jaro-Winkler, then insert PROPOSED rows. `ON CONFLICT DO NOTHING` on (`term_id`, `value_hash`); de-duplicate the `VALUES` list first.
  4. Update counters for the touched entities.
  5. Record `entity.candidates_pending` (count, top entities) if any were proposed (F1).
- **Nightly `entities.recount`.** Full counter recomputation, and `lastSeenAt` for entities whose mentions were retired.

### 6.3 Queries

- **Mentions of one entity:** `SELECT acv.asset_id, acv.finding_id … FROM entity_values ev JOIN asset_correlation_values acv ON acv.value_hash = ev.value_hash WHERE ev.term_id = $1 AND ev.verdict = 'CONFIRMED'`. This uses the existing `@@index([valueHash])` on the value index. Page with keyset on (`asset_id`, `value_hash`).
- **Co-mentions:** start from the entity's mention assets (bounded to the latest 5,000), join the other value rows in those assets, then confirmed values of *other* entities; group, count, limit 20. The asset set is bounded first and joined afterwards, the same lesson as the HNSW "bound the scan, then join" fix.
- **Condition `entity in [ids]`** (for [G4](G4-extracted-values-and-watch-conditions.md)): `EXISTS (SELECT 1 FROM asset_correlation_values acv JOIN entity_values ev ON ev.value_hash = acv.value_hash AND ev.verdict = 'CONFIRMED' WHERE acv.finding_id = f.id AND ev.term_id = ANY($ids))`.

### 6.4 Web (`apps/web`)

- **Routes:** `…/glossary` becomes "Entities & glossary", with type filters and counters. New routes `…/entities/[id]` and `…/entities/review`.
- **Components:** reuse the duplicates review pair card for candidates, the finding list for mentions, and the case-board node renderer for entity evidence.
- **Buttons:** "Make entity" on the finding detail and in value occurrences. "Watch this entity" on the entity page.

### 6.5 CLI SDK (R12)

`apps/cli/src/notebook/sdk.py` gains an `Entity` dataclass. `Asset.entity` travels in the asset payload, and the API's bulk ingest upserts the entity by `anchorUrn`. The declaration joins the asset's checksum basis only when set, so existing corpora are not re-checksummed. The same pattern was used for `tag_severities`.

## 7. How it connects

| With | What flows |
|---|---|
| [G2](G2-eu-detection-coverage.md) | National IDs, VAT numbers and IBANs are exact identifiers, the strongest links between an entity and its mentions |
| [G1](G1-python-detector.md) | PYTHON findings with `normalized_value` (for example a sanctions-list entry id) become linkable values; a screening rule can target entities |
| [G4](G4-extracted-values-and-watch-conditions.md) | The `entity` condition enables entity watches and entity-based case filters |
| [G6](G6-triage-queue.md) | Triage items can be grouped by entity: "3 new documents mention ACME" is one item, not three |
| [G3](G3-outbound-webhooks-notifications-export.md) | `entity.*` events reach webhooks and channels; case exports list entity evidence with identifiers |
| Duplicates | Unchanged. Duplicate review keeps comparing documents and shares the value index (R9) |

## 8. Rollout and migration

- **Migrations:** new columns (nullable or defaulted), new enums and `entity_values`. Backfill values for existing glossary aliases (R3) with a one-off job.
- **The switch is off by default** on existing workspaces and on for new ones. When turned on, it runs `entities.recount` to build counters.
- **The R9 split is the riskiest change.** Ship it first, with no behaviour change while duplicates stay on, and test the duplicates-off case explicitly.

## 9. Testing and acceptance

- **Exact:** create "ACME Holding GmbH" with identifier `vat: ATU12345678`. Existing and future findings with either value appear as mentions without any resolution run.
- **Candidates:** "Acme Holding G.m.b.H." is proposed, not confirmed. Rejecting it prevents re-proposal. Accepting it adds mentions.
- **Conflict:** confirming the same IBAN for a second entity opens a conflict review and does not silently double-link.
- **Merge:** after merging A into B, all of A's values, references and case evidence belong to B, A redirects, and `entity.merged` is recorded.
- **Switches:** with duplicates off and entities on, values are still indexed and mentions stay fresh. With both off, nothing is indexed.
- **Scale:** on the Enron fixture (or a 1M-value synthetic corpus), the entity page loads its first mention page in under 1 s and co-mentions in under 2 s.
- **E2E:** "Make entity" from a finding, then the entity page shows cross-source mentions, then "Watch this entity", then a new scan lands a match on the watch.

## 10. Success measures

- Investigation showcases (Firmenbuch, Enron): at least 70 % of case evidence assets are reachable from a case entity within one hop.
- Candidate review precision (accepted ÷ decided) of at least 80 %, so the queue is worth a person's time.

## 11. Open questions

- **Semantic candidates.** Embed distinct name values (bounded) and propose nearest entity aliases. This uses the embedding stack and needs a filtered HNSW query that bounds the scan before joining. Proposed for v2.
- **Typed relations.** Promote a co-mention to a typed relation ("director of") by hand, stored in `edges` with `fromType='entity'` (the edge table is polymorphic by design). Proposed for v2.
