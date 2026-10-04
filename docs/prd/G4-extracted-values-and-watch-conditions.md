# PRD G4 · Usable extracted values and watch conditions

| | |
|---|---|
| **Status** | Proposed |
| **Size** | M |
| **Milestone** | M3 · Structured signals ([integration](00-integration-architecture.md#4-build-order-and-milestones)) |
| **Depends on** | C1 `identity_key` (from [G1](G1-python-detector.md); introduce it here if G4 ships first). F1 events ([G3](G3-outbound-webhooks-notifications-export.md)) for threshold alerts |
| **Provides** | Foundation **F2** (the condition language) and **F3** (typed finding fields) |
| **Used by** | [G5](G5-entities.md) (`entity` condition), [G6](G6-triage-queue.md) (queues are watches with conditions), [G3](G3-outbound-webhooks-notifications-export.md) (threshold events), [G1](G1-python-detector.md) (rule output becomes queryable) |

## 1. Summary

Make structured values that detectors extract (LLM output fields, GLiNER2 structured extraction, PYTHON rule fields) first-class: stored in a typed table, searchable, filterable, exportable, and usable in rules.

Replace the fixed matcher dimensions of watches and case filters with one small **condition language**:
- over finding attributes, asset metadata and extracted fields;
- over co-occurrence on the same asset ("has an IBAN too");
- over recurrence across sources ("this value appears in 3+ sources");
- later over entities.

Add **volume thresholds** to watches ("20+ new matches in 7 days"), which raise events.

## 2. Why

- **Extraction is write-only today.** LLM output fields land in `Finding.metadata.fields` and `ExtractionPayload.pipelineResult` (`apps/api/src/asset.service.ts`, `detectors/custom/runners/_llm.py`). Search filters them only by detector, source and asset (`CustomDetectorExtractionsService.search`). No watch, case filter, export or search can ask "`delay_days` > 7". The research's "unstructured contract → operational variable" step, credited to AIP in the retail and supply-chain cases, stops halfway.
- **Fields are lost without a label.** `LLMRunner` attaches fields only to label findings: when no label passes the confidence threshold, the fields are discarded (`_llm.py`, `_result_to_findings`). Pure extraction ("pull these contract terms out") needs a dummy label today.
- **Watches can't express rules.** A watch (`Inquiry`) matches only source, detector, custom detector key, finding type (exact or regex) and value regex (`matching/inquiry-matcher.ts`). Case filters match finding type or value pattern (`CaseFindingFilterKind`). The rules the research's sectors run ("an IBAN and a sanctions hit on the same asset", "severity HIGH in contracts", "a value in 3+ sources", "20 new this week") cannot be written.
- **A good predicate module already exists, but only for asset metadata.** `apps/api/src/assets/asset-metadata-predicate.ts` implements `eq/in/exists/gt/gte/lt/lte` with strict JSON typing and fails loudly. It backs `ctx.query_assets()` and asset search. Generalising it gives one language everywhere.
- **JSONB predicates plan badly at scale.** Metadata filters have produced 1-row estimates against 28k-row reality, with nested-loop anti-joins taking 40 s. A typed side table with plain b-tree indexes avoids that class of problem for extracted fields.

## 3. Goals

- Every extracted value is stored once, typed, indexed and joinable.
- One condition language, one parser, one SQL compiler and one in-memory evaluator, used by watches, case filters, finding search, exports, live query and triage queues.
- Invalid conditions fail loudly (HTTP 400 naming the leaf). A condition never silently matches everything.
- The preview explains which condition removed candidates, as the current preview diagnostics do for dimensions.

## 4. Non-goals

- Arbitrary boolean trees in v1. The grammar is an AND of leaves, OR within a leaf through `in`, and one level of sub-matcher. Nested `any`/`not` groups can come later without breaking stored conditions.
- Aggregations across findings beyond the two recurrence counts and the watch volume threshold.
- Changing how findings are produced, apart from Part A's extraction mode.

## 5. Requirements

### Part A: extraction mode

| # | Requirement | Priority |
|---|---|---|
| A1 | LLM and GLiNER2 detectors get `emit: "labels" \| "fields" \| "both"` (default `labels`, which is today's behaviour) | MUST |
| A2 | In `fields` or `both` mode, a non-empty extraction produces one finding per asset (or per page when `per_page: true`): `finding_type = "extraction:<detector key>"`, category `EXTRACTION`, severity from the detector (default INFO), `matched_content` = a compact summary (`delay_days=12 · po=4500123`), and `identity_key = "asset"` or `"page:<n>"` (C1). Re-runs then update the same finding | MUST |
| A3 | `DetectorOutputField` (shared with [G1](G1-python-detector.md)) adds the `date` type. LLM `output_fields` use it | MUST |

### Part B: typed finding fields (F3)

| # | Requirement | Priority |
|---|---|---|
| B1 | New table `finding_fields` (§6.1): one row per (finding, field, list position), with the declared type and a typed value column | MUST |
| B2 | One writer in bulk ingest fills it for every finding that carries `extracted_data`, from LLM, GLiNER2 or PYTHON, using the detector's declared fields. It deletes and re-inserts per changed finding in the same transaction. Rows are de-duplicated before insert: one repeated key in a `VALUES` list fails a whole `ON CONFLICT` statement | MUST |
| B3 | Coercion: a declared `number` accepts JSON numbers and numeric strings. A declared `date` accepts ISO dates. A declared `boolean` accepts booleans and `"true"`/`"false"`. Anything else is stored as text with `coerced=false` and counted in the run's warnings | MUST |
| B4 | Caps: 50 fields per finding, 20 list items per field, 1,024 characters per text value (truncated, flagged) | MUST |
| B5 | Backfill job `fields.backfill` for existing findings from `Finding.metadata.fields` and `ExtractionPayload.pipelineResult`. It walks the findings table by `ctid` block ranges (a sequential walk, far faster than primary-key keyset paging on this table), is resumable, and reports progress | MUST |
| B6 | Extraction coverage (the existing `custom-detector-extraction-coverage.tsx` and `get_extraction_coverage`) also reports per-field fill rate and type-coercion failures | SHOULD |

### Part C: condition language (F2)

| # | Requirement | Priority |
|---|---|---|
| C1 | Grammar: `{ "all": [ leaf, … ] }`, where `leaf = { field, op, value }`. Ops: `eq`, `neq`, `in`, `not_in`, `exists`, `not_exists`, `gt`, `gte`, `lt`, `lte`, `matches` (regex) | MUST |
| C2 | Field catalogue (§6.2): `finding.*`, `asset.*` (including `asset.metadata.<path>` with today's strict JSON semantics), `extracted.<detectorKey>.<field>`, `asset.has_finding` (sub-matcher), `recurrence.sources`, `recurrence.assets`, and `entity` (reserved, enabled by [G5](G5-entities.md)) | MUST |
| C3 | Validation fails closed with HTTP 400 and a message naming the leaf index and the reason. This matches the existing fail-closed behaviour of finding filters and asset search | MUST |
| C4 | Limits: ≤ 20 leaves, ≤ 1,000 `in` values, regex ≤ 500 characters (compiled and checked on save), one sub-matcher level, relative dates (`"-7d"`, `"-24h"`) for date fields | MUST |
| C5 | One compiler to parameterised SQL (`Prisma.Sql`, `EXISTS` subqueries over `finding_fields` and `assets`) and one in-memory evaluator. A conformance spec runs every condition in both on the same fixtures, in the style of `matching/matcher-sql-conformance.spec.ts` | MUST |
| C6 | `asset.metadata.*` leaves reuse `asset-metadata-predicate.ts` (moved into `apps/api/src/conditions/`, with re-exports so existing imports keep working) | MUST |

### Part D: where conditions apply

| # | Requirement | Priority |
|---|---|---|
| D1 | **Watches:** `Inquiry.conditions Json?`. A finding matches iff the existing dimensions match **and** the conditions hold. NEW and GONE semantics, run anchors and counters are unchanged | MUST |
| D2 | **Preview diagnostics:** `preview_inquiry_matchers` and the web preview report, per leaf, how many candidates it removed | MUST |
| D3 | **Watch volume threshold:** `Inquiry.alert Json?` = `{ newMatchesAtLeast, windowHours }`. After each landing, count matches created in the window. On crossing, record `inquiry.threshold_crossed` (F1) at most once per window; the last-fired time is stored on the inquiry | MUST |
| D4 | **Case filters:** `CaseFindingFilterKind.CONDITION` with `conditions Json`, for both EXCLUDE and ESCALATE rules | MUST |
| D5 | **Finding search:** `conditions` on the findings search request, the MCP `search_findings` tool (zod `strictObject`) and the web filter panel | MUST |
| D6 | **Exports and live query:** `conditions` plus `fields=extracted.<key>.<field>,…` adds typed columns to CSV and live-query results (the Excel Power Query path) | MUST |
| D7 | **Extraction search:** `search_extractions` accepts `field`, `op`, `value` | MUST |
| D8 | **Autopilot:** the INQUIRY agent may add conditions through its existing `ENRICH_INQUIRY_MATCHERS` action, under the same observe-only rules | SHOULD |

### Part E: UI

| # | Requirement | Priority |
|---|---|---|
| E1 | A `ConditionBuilder` component: pick a field from the catalogue (typed, with the declared fields of each detector and the known metadata keys of each source), then a type-appropriate op and value input. Used in the watch editor, case filter dialog and findings filter panel | MUST |
| E2 | Findings table: when filtered to one detector, its declared fields can be shown as columns | SHOULD |
| E3 | i18n EN/DE for every label, op and error message | MUST |

## 6. Design

### 6.1 Table (per tenant schema)

```prisma
enum FieldValueType {
  STRING
  NUMBER
  BOOLEAN
  DATE
}

model FindingField {
  findingId   String         @map("finding_id")
  field       String         @db.VarChar(100)
  ordinal     Int            @default(0)
  detectorKey String         @map("detector_key")      // custom detector key, or built-in type
  sourceId    String         @map("source_id")
  assetId     String         @map("asset_id")
  valueType   FieldValueType @map("value_type")
  textValue   String?        @map("text_value") @db.VarChar(1024)
  textNorm    String?        @map("text_norm") @db.VarChar(1024)   // trimmed, lower-cased, for eq/in
  numberValue Float?         @map("number_value")
  boolValue   Boolean?       @map("bool_value")
  dateValue   DateTime?      @map("date_value")
  coerced     Boolean        @default(true)
  finding     Finding        @relation(fields: [findingId], references: [id], onDelete: Cascade)

  @@id([findingId, field, ordinal])
  @@index([detectorKey, field, numberValue])
  @@index([detectorKey, field, textNorm])
  @@index([detectorKey, field, dateValue])
  @@index([assetId])
  @@map("finding_fields")
}
```

Row volume is bounded by the declared fields times the findings that carry extraction, which is a small fraction of all findings. The table is excluded from namespace transfer as derived data (rebuilt by B5 after an import), with the reason added to `transfer-scopes.ts`.

### 6.2 Field catalogue (v1)

| Field | Type | Notes |
|---|---|---|
| `finding.severity`, `finding.status`, `finding.category` | enum | |
| `finding.type`, `finding.detector` | string | `detector` accepts a built-in type or a custom key |
| `finding.value` | string | `matches` only, evaluated after SQL narrowing (as value regexes are today) |
| `finding.confidence`, `finding.importance` | number | `importance` is the denormalised `importanceScore` |
| `finding.first_detected`, `finding.last_detected` | date | relative values allowed |
| `asset.source`, `asset.source_type`, `asset.kind`, `asset.name` | string | |
| `asset.metadata.<path>` | JSON scalar | strict typing, from `asset-metadata-predicate.ts` |
| `extracted.<detectorKey>.<field>` | declared | `EXISTS (SELECT 1 FROM finding_fields ff WHERE ff.finding_id = f.id AND …)` |
| `asset.has_finding` | sub-matcher | `{ detector?, type?, severity_at_least?, conditions? }`, OPEN findings on the same asset. `exists` and `not_exists` only |
| `recurrence.sources`, `recurrence.assets` | number | Distinct sources or assets sharing this finding's normalised value in the value index (F4). No value row means no match |
| `entity` | id list | Enabled by [G5](G5-entities.md): the finding's value resolves to one of these entities |

### 6.3 Module layout (`apps/api/src/conditions/`)

- `grammar.ts`: types and the `parseConditions(raw, target)` validator (fail closed).
- `catalogue.ts`: static fields plus a dynamic catalogue service (declared detector fields and known metadata keys), served at `GET /conditions/fields?target=findings`.
- `sql.ts`: `compileToSql(ast, aliases) → Prisma.Sql`.
- `evaluate.ts`: `evaluate(ast, row, lookups) → boolean`, for in-memory paths (the `CompiledMatcher` counterpart and case-cleanup rules).
- `metadata.ts`: moved from `assets/asset-metadata-predicate.ts`, re-exported from the old path.
- `conditions.conformance.spec.ts`: every fixture condition through both paths.

**Integration points.** Watches compose `candidateWhere` in `matching/inquiry-matching.service.ts` plus the compiled conditions. The invariants in the `CompiledMatcher` header comment (no status dimension, no newness dimension) still hold: conditions add *what* dimensions, never *when*. Case filters live in `cases/case-finding-filters.service.ts`, finding search in `findings.service.ts` (`buildBaseFindingsWhere`), and exports in `export/export-query.service.ts`.

### 6.4 Planner safety

- Extracted-field leaves hit b-tree indexes on (`detector_key`, `field`, typed value).
- Metadata leaves keep today's implementation. The asset metadata filter has already been tuned against misestimated JSONB predicates, so reuse its SQL shape rather than writing a new one.
- A benchmark spec runs a 3-leaf condition over a 1M-finding fixture and asserts that the plan uses index scans (checked with `EXPLAIN (FORMAT JSON)`).

## 7. How it connects

| With | What flows |
|---|---|
| [G1](G1-python-detector.md) | PYTHON `fields` are declared with the same `DetectorOutputField` and land in `finding_fields`, so rules are queryable without new code |
| [G2](G2-eu-detection-coverage.md) | Art. 9 LLM fields (`subject_type`) become conditions: "health data about employees" |
| [G5](G5-entities.md) | Reserved `entity` field; recurrence leaves read the value index G5 keeps independent of the duplicates switch |
| [G6](G6-triage-queue.md) | A triage queue *is* a watch with conditions plus `mode = QUEUE` |
| [G3](G3-outbound-webhooks-notifications-export.md) | `inquiry.threshold_crossed` and `inquiry.new_matches` reach webhooks and channels. Case exports print each watch's conditions in words |
| [G7](G7-outcome-metrics.md) | Watch yield per condition set (matches to accepted) shows whether a rule is worth keeping |

## 8. Rollout and migration

- Migrations: the `finding_fields` table, the `FieldValueType` enum, `inquiries.conditions` and `inquiries.alert` (JSONB, nullable), the `CaseFindingFilterKind.CONDITION` value plus `case_finding_filters.conditions`.
- A new Prisma model and enum in dev can crash the watch-mode API and worker pods until they are restarted; plan the dev rollout accordingly.
- Run the B5 backfill after deploy. Until it completes, conditions on old findings see partial data, and the UI shows a "fields index building…" note with progress.
- Existing watches and filters are untouched (`conditions = null`).

## 9. Testing and acceptance

- **Conformance:** every leaf type × every op, through SQL and in-memory, on shared fixtures, with identical results.
- **Fail closed:** unknown field, wrong type for the op, bad regex, too many leaves: each returns 400 naming the leaf. Nothing matches everything.
- **Extraction mode:** an LLM detector with fields and no labels produces one `extraction:<key>` finding per asset. On re-run with changed values it is the same finding, updated.
- **Supplier scenario (E2E):** an email fixture, an LLM extraction of `delay_days`, a watch `extracted.supplier_mail.delay_days gt 7`. Only the late-delivery emails match; the preview shows the leaf eliminating the others.
- **Threshold:** 25 matches within 7 days fire `inquiry.threshold_crossed` once. A second landing in the same window doesn't fire again.
- **Backfill:** idempotent and resumable after a kill; field counts equal a direct JSON scan on the fixture.

## 10. Success measures

- At least 50 % of active watches on instances with LLM detectors use at least one `extracted.*` condition within two releases.
- Median watch evaluation time is unchanged (±10 %) for watches without conditions, and under 2 s for 3-leaf watches on 1M findings.

## 11. Open questions

- Should `asset.has_finding` also look across the asset's *lineage neighbours* ("the parent email has an attachment with an IBAN")? It is useful for mail and attachment pairs. The recommendation is v2, reusing the incoming-edge walk of `GET /assets/{id}/referencing-findings` (field report P12).
