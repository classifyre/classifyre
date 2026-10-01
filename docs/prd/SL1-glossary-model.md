# SL1 · Glossary model: concepts, entities, schemes and relations

*Part of [the semantic layer](SL0-semantic-layer-architecture.md). Research: [glossary-semantic-layer.md](../research/glossary-semantic-layer.md).*

| | |
|---|---|
| **Status** | Draft for review |
| **Date** | 2026-10-01 |
| **Size** | S–M |
| **Milestone** | M1 (no dependencies) |
| **Depends on** | — |
| **Feeds** | SL2, SL3, SL4, SL5, G5′ |
| **Owns** | Contract C8 (term reference); the terms, schemes and relations part of C10 (glossary pack) |

## 0. Decisions that apply

D1 (one glossary, two kinds), D4 (taxonomy and relations), D7 (agents may approve relations), D8 (CSV and SKOS), D9 (names). See [SL0 §2](SL0-semantic-layer-architecture.md#2-decisions).

## 1. Problem

The glossary is one flat list of `term`, `aliases`, a six-value `entityType`, `notes` and a verified flag (`apps/api/prisma/schema.prisma`, `GlossaryTerm`). It cannot express what a business glossary needs:
- whether an entry is a **concept** or a **named entity**;
- a **definition** as distinct from working notes;
- **codes** that must match exactly (`GES`, `PKS 725000`), as distinct from aliases;
- **lookup-only spellings** that must never be matched in text (`E`);
- which **vocabulary** (scheme) a term belongs to, and who is responsible for it;
- a **lifecycle** beyond verified or unverified, including deprecation with a successor;
- **taxonomy** (broader/narrower) and **relations** between concepts;
- a **stable key** that code, packs and connectors can reference.

The product also claims more than the code does in four places (research §1.4).

## 2. Goals and non-goals

### Goals

1. Terms have a **kind**: CONCEPT or ENTITY.
2. Concepts carry SKOS-shaped fields: definition, aliases, codes, hidden aliases, scheme, status, steward.
3. **Schemes** group concepts into vocabularies.
4. **Relations** give a taxonomy (BROADER) plus RELATED, PART_OF, INSTANCE_OF and custom verbs between concepts.
5. Every term has a **stable key**, and references to it survive a rename (C8).
6. **Lookup** understands codes, hidden aliases, kinds, schemes and status.
7. **Import and export** as CSV and SKOS JSON-LD.
8. The glossary page is redesigned (tabs, a tree, an editor) and gains a **term page**.
9. The four overclaiming texts are fixed in the first change of this PRD.
10. The autopilot and MCP speak the new model, and agents may approve relations under D7.

### Non-goals

- Bindings and the vocabulary inventory (SL2); semantic links and evidence (SL3); suggestions (SL4); canvases (SL5).
- Entity mentions, merging and entity relations in `edges` (G5′).
- Multilingual labels as first-class fields: other languages are aliases in v1 (§15).
- Concept properties (D4).

## 3. Users and stories

| As a… | I want to… | So that… |
|---|---|---|
| Data steward | Import a scheme of 55 company-law concepts with their register codes from a CSV | The register's codes mean something in the product |
| Data-protection officer | See *Personal data* as a tree of narrower concepts | I can explain the classification to an auditor |
| Investigator | Keep people and organisations apart from vocabulary | The glossary stays readable and lookup is unambiguous |
| Analyst | Look up `E` and land on *Einzelvertretung* without `E` ever matching in text | Short codes resolve without noise |
| Operator | Deprecate a term and point to its successor | Old references keep working and stop spreading |
| Autopilot | Propose a concept with a definition and scheme, and approve a broader relation between two approved concepts | The taxonomy grows without an operator doing every step (D7) |

## 4. Requirements

### R1 Kind

- `kind` is CONCEPT or ENTITY. New terms default to the tab they were created from. API callers and agents must pass it.
- Changing the kind is allowed for operators. If the change would break relations (an INSTANCE_OF that starts at a concept, or a custom verb on an entity), it is refused with HTTP 409, and the response lists the offending relations.
- Kind decides which relation types are allowed (R5). Later PRDs also use it: SL2 binds concepts only, and G5 links mentions to entities only.

### R2 Key (contract C8)

- `key` matches `^[a-z0-9][a-z0-9._-]{0,99}$` and is unique in the workspace.
- Generated on create from the term:
  - transliterate `ä→ae ö→oe ü→ue ß→ss`, then other diacritics to ASCII;
  - lowercase; runs of anything else become `-`; trim to 100 characters;
  - on collision, append `-2`, `-3`, ….
- Operators may edit a key. The old key is appended to `previousKeys`, which is capped at 20 entries, and continues to resolve.
- A new key that equals another term's current or previous key is refused with HTTP 409.
- Resolution order everywhere (SDK, packs, REST `:idOrKey`): `id`, then `key`, then `previousKeys`.
- Agents never set keys; the server generates them.

### R3 Concept fields

| Field | Rules |
|---|---|
| `definition` | Markdown, up to 10,000 characters. Shown as *Definition*. `notes` stays as working notes |
| `aliases[]` | As today: up to 50, trimmed, unique case-insensitively |
| `codes[]` | Up to 50. Kept exactly as entered: case is significant |
| `hiddenAliases[]` | Up to 50. Used by lookup, never by text matching (SL2 "Find in text" excludes them) |
| `schemeId` | Optional for concepts, normally empty for entities. A term belongs to at most one scheme |
| `steward` | Free text, up to 200 characters, until the enterprise edition has identities (S1) |
| `status` | R6 |
| `replacedById` | Only when DEPRECATED. Must point to an APPROVED term of the same kind |
| `sourceIri` | The IRI a term was imported from (SKOS), kept for round trips and future cross-scheme matching |

All of these apply to entities too, except that entities have no scheme by default and cannot be the subject of a custom verb (R5).

### R4 Schemes

- A scheme has a `key` (C8 format), name, description and colour. Its `origin` is OPERATOR, AGENT, PACK or IMPORT; pack-installed schemes also carry `packKey` and `packVersion`.
- Create, edit and delete (only when empty; otherwise HTTP 409 naming the term count). Moving terms between schemes in bulk is allowed.
- Concept names are unique per scheme, case-insensitively. The same name may exist in two schemes: *Contract* (Legal) and *Contract* (Telecom).
- Entity names are **not** unique. Two people called *Jane Doe* are two entities; the UI warns about a same-name entity on create. G5 handles identity.

### R5 Relations

| Type | From → to | Rules |
|---|---|---|
| BROADER | concept → concept | Acyclic. A concept may have several broader concepts (poly-hierarchy, as SKOS allows) |
| RELATED | concept ↔ concept | Symmetric, stored once with `fromTermId < toTermId` |
| PART_OF | concept → concept | Acyclic |
| INSTANCE_OF | entity → concept | An entity may be an instance of several concepts |
| CUSTOM | concept → concept | Needs a `label` (the verb, e.g. "has officer"), up to 64 characters. Facts between particular entities are G5's `edges`, not glossary relations |

- Cycle checks walk BROADER (or PART_OF) from the target, up to 50 hops. A relation that would close a cycle is refused with HTTP 409, and the response names the path.
- No duplicates: `(from, to, type, label)` is unique.
- At most 500 relations start from one term, a guard against runaway agents.
- `status` is DRAFT or APPROVED.
  - Operators create APPROVED relations.
  - Agents create DRAFT relations, and may approve their own in MANAGED mode, between APPROVED terms (D7, R14).
- Deleting a term cascades its relations. The activity log keeps the record (R11).
- **Read helpers:**
  - `broaderClosure(termId)`, `narrowerClosure(termId)` over APPROVED BROADER relations, depth ≤ 10, cached per request. SL3 uses them for "include narrower".
  - Tree endpoint for a scheme: root concepts (those with no broader concept in the scheme) and lazily loaded children.

### R6 Status lifecycle

```
DRAFT ──approve──▶ APPROVED ──deprecate(replacedBy?)──▶ DEPRECATED
  ▲                   │  ▲                                  │
  └────unapprove──────┘  └──────────reinstate───────────────┘
DRAFT ──reject──▶ deleted (deletion remembered, as today)
```

- Only APPROVED terms drive linking (SL2, SL3) and appear in the system brief's canonical section.
- DRAFT terms are visible, with a badge, and searchable.
- DEPRECATED terms are hidden from lookup unless asked for. An exact match on one still returns it, with `deprecated: true` and its `replacedBy`.
- Compatibility: `verifiedAt` and `verifiedBy` become the approval stamp, so APPROVED ⇔ `verifiedAt` is set. `PATCH /glossary/:id/verify` stays as an alias of approve. Bulk *verify* and *unverify* become *approve* and *unapprove*.
- Operators can approve directly. Agents' terms always start as DRAFT, as today.

### R7 Lookup

- New derived column `matchKeys[]`: the NFKC-normalised, case-folded, whitespace-collapsed forms of the term, aliases, codes and hidden aliases. Maintained on every write and GIN-indexed.
- Ranking tiers, extending today's order:
  1. exact term;
  2. exact alias, code or hidden alias; within the tier an exact case-sensitive code match ranks first;
  3. prefix of the term or an alias;
  4. substring of the term, an alias or a code. Hidden aliases are never matched by substring.
  5. semantic (unchanged).
- New filters: `kind`, `schemeId` or `schemeKey`, `status` (default DRAFT and APPROVED), and `includeDeprecated`.
- Each hit carries `matchedOn` (`term | alias | code | hiddenAlias | semantic`), `kind`, `scheme { key, name }` and `status`.
- The embedding text becomes term, aliases, codes, definition and notes. Hidden aliases are excluded, so misspellings and single letters do not pull the vector.

### R8 Migration of existing terms

One additive migration:
1. Add the new columns, enums and tables (§6).
2. Backfill `kind`: PERSON, ORGANIZATION and LOCATION become ENTITY; TERM, REFERENCE and OTHER become CONCEPT.
3. Backfill `key` (R2) and `status` (`verifiedAt` set → APPROVED, else DRAFT), and compute `matchKeys` in SQL.
4. Drop the global unique index on `term`. Add a partial unique index `(COALESCE(scheme_id, ''), lower(term)) WHERE kind = 'CONCEPT'` in raw SQL; Prisma cannot model a partial index, so document it in `schema.prisma`, as `case_leads` already does.

After the migration, a one-time banner on the glossary page reads "We classified N terms as concepts and M as entities — review". It opens a filtered list with bulk *Change kind*. Dismissal is stored per workspace in `InstanceSettings`.

Aliases that look like codes are **suggested** in the editor, never moved automatically:
- a single character (`E`, `K`) is suggested as a **hidden alias**;
- up to 16 characters of uppercase letters, digits and the separators `_ . / -` or a space (`GES`, `PKS 725000`, `HGB_224_3_A`) is suggested as a **code**.

### R9 Glossary page

The page becomes four tabs:
- **Concepts**, with a *List* or *Tree* view;
- **Entities**;
- **Schemes**;
- **Proposals**. SL1 shows DRAFT terms, proposed aliases and DRAFT relations; SL4 adds the rest.

**Concepts list:**
- Columns: term, scheme, labels (aliases and codes shown as compact chips), status, steward, updated.
- Filters: search, scheme, status, steward.
- Bulk actions: approve, unapprove, deprecate, change scheme, change kind.

**Concepts tree:** a scheme selector; roots and expandable children; drag a concept onto another to create a BROADER relation, with a confirmation.

**Entities:** the same list without the scheme column, with `entityType` and an *instance of* column.

**Schemes:** name, key, term count, origin or pack; create, edit, export, and import into the scheme.

**Editor:** a side sheet with sections, replacing today's dialog:
- *Basics*: kind, term, scheme, status;
- *Definition*;
- *Labels*: aliases, codes in monospace, hidden aliases, each as chip inputs with the code suggestion from R8;
- *Relations*: broader and related pickers, custom relations, and instance-of for entities;
- *Stewardship*: steward and notes.

Every row links to the term page (R10).

### R10 Term page

Route: `/[locale]/[namespace]/glossary/terms/[key]`. An old key redirects to the current one.

| Area | Content in SL1 | Filled later by |
|---|---|---|
| Header | Kind glyph (⬡ concept, ◇ entity), term, scheme chip, status pill (`lib/status-tone.ts`), steward, copyable key | — |
| Definition | Rendered markdown | — |
| Labels | Aliases, codes, hidden aliases | — |
| Taxonomy | Breadcrumb of broader concepts; narrower concepts as chips; for entities, *instance of* | — |
| Relations | A list by type, plus a small static graph of depth-1 relations | SL5 adds canvas interactions |
| Tabs | **History** (R11) | **Evidence**, **Cases & watches** (SL3), **Bindings** (SL2) |
| Actions | Edit, approve or unapprove, deprecate or reinstate, delete | *Watch* (SL3), *Find in text* (SL2), *Add to case* (SL5) |

### R11 Activity log

`glossary_activities` records every change to a term, scheme or relation (SL2 adds bindings): actor (through `ActorContextService`), type, before/after summary and timestamp.

It feeds the term page's History tab and the G7 `decision_log` for approvals. Retention is unlimited, because it is small curated data.

### R12 Import and export

**CSV**
- RFC 4180 and UTF-8; a BOM is tolerated.
- Columns: `key, term, kind, scheme, status, entity_type, definition, aliases, codes, hidden_aliases, broader, related, instance_of, steward, notes`.
- Multi-value cells separated by `|`. Relation cells hold keys.
- Unknown columns are refused, naming the column (fail closed).

**SKOS JSON-LD export**
- One `skos:ConceptScheme` per scheme.
- Each concept carries `prefLabel`, `altLabel`, `hiddenLabel`, `notation`, `definition`, `broader`, `related` and `inScheme`. Custom relations go out as `classifyre:relation`, with the label as a property.
- Concept IRIs follow the namespace URL contract (integration rule 7): `https://<host>/<namespace>/glossary/terms/<key>`.
- Entities are excluded by default. An option includes them as `skos:Concept` with `classifyre:kind "ENTITY"`.

**SKOS JSON-LD import**
- Choose a language. `prefLabel` in that language becomes the term; prefLabels in other languages and all `altLabel`s become aliases; `hiddenLabel` becomes hidden aliases; `notation` becomes codes.
- `broader`, `narrower` and `related` become relations (`narrower` is inverted). `inScheme` becomes the scheme.
- Keys come from the slugified local part of the IRI; on collision, the term instead (R2).
- The IRI is stored in `sourceIri`.

**Both directions**
- Import always runs as a **dry run** first. The report lists creates, updates, skips, conflicts and refused rows with reasons.
- Conflict policy, matched by key and then by `sourceIri`: `skip | overwrite | merge-labels`.
- Imported items are APPROVED, unless *import as draft* is chosen.
- Limits: 20,000 terms and 20 MB per file. A larger file is refused, with the reason.
- Runs as a background job with progress, reusing the data-transfer job pattern.

**Packs.** The C10 pack format (`classifyre.glossary-pack/v1`) is defined here for schemes, terms and relations; SL2 adds bindings and the starter packs.

### R13 Claims fixed (the first change of this PRD)

| Where | New wording, until SL3 makes more true |
|---|---|
| `apps/docs/app/how-it-works/glossary/page.mdx` | Describe the glossary as the shared vocabulary that people and agents use for lookup. Remove the claim about duplicates and inquiries. After SL3, rewrite the page for concepts, entities, bindings and Meaning |
| `apps/api/src/mcp-catalog.ts` (glossary group) | "The shared vocabulary of concepts and entities: list, look up and curate terms, schemes and relations." |
| `missions.ts` (`DETECTION_STEWARDSHIP` and the comment above it), `detection-impact.service.ts`, `config.toolset.ts` | Drop "glossary terms" from "built on those findings". SL3 restores a precise version: "semantic links are derived from those findings" |
| Firmenbuch case study | Add a note that cross-language search worked through semantic search and glossary lookup; alias expansion is not automatic |

### R14 Autopilot and MCP

**Autopilot tools** (`apps/api/src/autopilot/tools/glossary/glossary.toolset.ts`)

| Tool | Change |
|---|---|
| `glossary.lookup` | Adds `kind`, `scheme` and `includeDeprecated` |
| `glossary.propose` | `kind` is required; adds `scheme` (key), `codes` and `definition`. It still creates DRAFT terms and merges aliases into operator terms as proposed aliases. Proposing an ENTITY whose name an operator entity already has becomes an alias proposal on it, as today |
| `glossary.propose_relation` (new) | Creates a DRAFT relation with a rationale. R5 validation applies |
| `glossary.approve_relation` (new) | MANAGED mode only, with `autopilotGlossaryApproveEnabled` on. Both terms must be APPROVED and the daily budget not spent. It never touches an operator-created relation. Writes an `AgentDecision` (`APPROVE_RELATION`) and an `AgentUndoEntry` |

**Doctrine** (`GLOSSARY_DOCTRINE` in `missions.ts`) is replaced. The new text must cover:
- what concepts and entities are;
- that codes are exact notations, and that single letters go to hidden aliases;
- to choose the scheme by lookup and never invent a scheme for a single term;
- to propose broader relations only when the narrower concept is a kind of the broader one;
- that investigation state goes to `memory.write` (unchanged);
- that operator items are never edited.

**System brief.** The glossary section lists APPROVED concepts first, grouped by scheme, with definitions truncated to 160 characters, then APPROVED entities, all within the existing `harnessMaxGlossaryEntries`. DRAFT terms are never listed as canonical.

**MCP** (group `glossary`, zod `strictObject` per integration rule 4)

| Tool | Notes |
|---|---|
| `list_glossary_terms` | Adds `kind`, `schemeKey`, `status` and `steward` filters |
| `lookup_glossary` | R7 filters; returns `matchedOn` |
| `get_glossary_term` (new) | By id or key: the term, its scheme, relations and broader chain |
| `upsert_glossary_term` | Adds the new fields. MCP writes stay operator-level, as today |
| `list_glossary_schemes`, `upsert_glossary_scheme` (new) | — |
| `list_glossary_relations`, `relate_glossary_terms`, `remove_glossary_relation` (new) | — |
| `deprecate_glossary_term` (new) | Takes an optional `replacedBy` key |
| `export_glossary`, `import_glossary` (new) | Import defaults to `dryRun: true` |

`mcp-catalog.completeness.spec.ts` must pass. Every write tool calls `assertNotDemoMode()`.

### R15 Events, transfer, cleanup, demo mode

- **Events (F1):**
  - `glossary.term_changed` (`created | updated | approved | unapproved | deprecated | reinstated | deleted`, with kind and key);
  - `glossary.relation_changed`;
  - `glossary.scheme_changed`;
  - `glossary.imported` (one per import, with counts).
- **Data transfer** (`transfer-scopes.ts`, scope `glossary`):
  - add `glossaryScheme` (order 795) before `glossaryTerm` (800), then `glossaryRelation` (805) and `glossaryActivity` (815);
  - the conflict match for terms moves from name to **key**. Update the `conflictSkipHint` and `conflictOverwriteHint` strings in EN and DE.
- **Cleanup:** add the new tables to the protected `glossary` dataset in `maintenance.datasets.ts`.
- **Demo mode:** every write endpoint is blocked; reads and export are `@AllowInDemoMode()`.

## 5. UX sketches

**Concepts › Tree**

```
Scheme: [ GDPR personal data ▾ ]                          [ + Concept ] [ Import ] [ Export ]
▾ ⬡ Personal data                                 APPROVED   steward: DPO
   ▾ ⬡ Contact data                               APPROVED
        ⬡ E-mail address        codes: —          APPROVED
        ⬡ Phone number                            APPROVED
   ▸ ⬡ Identification data                        APPROVED
   ▾ ⬡ Special categories (Art. 9)                APPROVED
        ⬡ Health data                             APPROVED
        ⬡ Trade-union membership                  DRAFT  ● proposed by autopilot
```

**Term page header**

```
⬡ GmbH                                   [Rechtsformen]  APPROVED   steward: Legal
key: gmbh  ⧉                                              [Edit] [Deprecate] [⋯]
Gesellschaft mit beschränkter Haftung — a limited-liability company under Austrian law.
Labels   Gesellschaft mit beschränkter Haftung · limited liability company      codes  GES
Broader  Company › Kapitalgesellschaft        Narrower  —        Related  Stammkapital
[ History ]  [ Evidence (SL3) ]  [ Bindings (SL2) ]  [ Cases & watches (SL3) ]
```

## 6. Data model (Prisma, tenant schema)

```prisma
enum GlossaryTermKind {
  CONCEPT
  ENTITY
}

enum GlossaryStatus {
  DRAFT
  APPROVED
  DEPRECATED
}

enum GlossaryOrigin {
  OPERATOR
  AGENT
  PACK
  IMPORT
  SUGGESTION
}

enum GlossaryRelationType {
  BROADER
  RELATED
  PART_OF
  INSTANCE_OF
  CUSTOM
}

model GlossaryTerm {
  // existing: id, term (no longer @unique, see R4/R8), aliases, proposedAliases,
  // entityType, notes, origin, verifiedAt, verifiedBy, embedContentHash,
  // createdAt, updatedAt, references
  kind          GlossaryTermKind @default(CONCEPT)
  key           String           @unique
  previousKeys  String[]         @default([]) @map("previous_keys")
  definition    String?          @db.Text
  codes         String[]         @default([])
  hiddenAliases String[]         @default([]) @map("hidden_aliases")
  // Normalised term + aliases + codes + hidden aliases (R7). Written by the
  // service on every change; GIN-indexed for lookup and lookup bindings (SL2).
  matchKeys     String[]         @default([]) @map("match_keys")
  schemeId      String?          @map("scheme_id")
  status        GlossaryStatus   @default(DRAFT)
  steward       String?
  replacedById  String?          @map("replaced_by_id")
  deprecatedAt  DateTime?        @map("deprecated_at")
  sourceIri     String?          @map("source_iri")
  packKey       String?          @map("pack_key")

  scheme        GlossaryScheme?    @relation(fields: [schemeId], references: [id], onDelete: SetNull)
  relationsFrom GlossaryRelation[] @relation("GlossaryRelationFrom")
  relationsTo   GlossaryRelation[] @relation("GlossaryRelationTo")

  // Partial unique index (raw SQL in the migration, not expressible here):
  //   glossary_terms_concept_scheme_term_key ON (COALESCE(scheme_id, ''), lower(term))
  //   WHERE kind = 'CONCEPT'
  @@index([kind, status])
  @@index([schemeId])
  @@index([matchKeys], type: Gin)
  @@index([sourceIri])
}

model GlossaryScheme {
  id          String         @id @default(uuid())
  key         String         @unique
  name        String
  description String?        @db.Text
  color       String?
  origin      GlossaryOrigin @default(OPERATOR)
  packKey     String?        @map("pack_key")
  packVersion String?        @map("pack_version")
  createdBy   String?        @map("created_by")
  createdAt   DateTime       @default(now()) @map("created_at")
  updatedAt   DateTime       @updatedAt @map("updated_at")

  terms GlossaryTerm[]

  @@map("glossary_schemes")
}

model GlossaryRelation {
  id         String               @id @default(uuid())
  fromTermId String               @map("from_term_id")
  toTermId   String               @map("to_term_id")
  type       GlossaryRelationType
  // The verb for CUSTOM; '' otherwise, so the unique key holds.
  label      String               @default("")
  status     GlossaryStatus       @default(DRAFT)
  origin     GlossaryOrigin       @default(OPERATOR)
  note       String?              @db.Text
  approvedBy String?              @map("approved_by")
  approvedAt DateTime?            @map("approved_at")
  createdBy  String?              @map("created_by")
  createdAt  DateTime             @default(now()) @map("created_at")
  updatedAt  DateTime             @updatedAt @map("updated_at")

  from GlossaryTerm @relation("GlossaryRelationFrom", fields: [fromTermId], references: [id], onDelete: Cascade)
  to   GlossaryTerm @relation("GlossaryRelationTo", fields: [toTermId], references: [id], onDelete: Cascade)

  @@unique([fromTermId, toTermId, type, label])
  @@index([toTermId, type])
  @@index([status])
  @@map("glossary_relations")
}

model GlossaryActivity {
  id         String   @id @default(uuid())
  termId     String?  @map("term_id")
  schemeId   String?  @map("scheme_id")
  relationId String?  @map("relation_id")
  // SL2 adds bindingId.
  type       String   // TERM_CREATED, TERM_APPROVED, RELATION_ADDED, ...
  actor      String?
  payload    Json?    @db.JsonB
  createdAt  DateTime @default(now()) @map("created_at")

  @@index([termId, createdAt(sort: Desc)])
  @@index([createdAt])
  @@map("glossary_activities")
}
```

Notes:
- `GlossaryTerm.origin` keeps its `AgentMemoryOrigin` type. Changing it would touch `AgentMemory`. Pack and import provenance live in `packKey` and `sourceIri`.
- Every table lives in the tenant schema (integration rule 1). The migration is new (rule 2) and must also run on the dev stack (rule 18: restart watch-mode pods after enum changes).

## 7. API (REST)

| Method and path | Change |
|---|---|
| `GET /glossary` | Filters `kind`, `schemeId`, `status`, `steward`; returns the new fields |
| `GET /glossary/lookup` | R7 filters and `matchedOn` |
| `GET /glossary/terms/:idOrKey` (new) | Term with scheme, relations in and out, broader chain, narrower list |
| `GET /glossary/terms/:idOrKey/activity` (new) | Paged |
| `POST /glossary` | Upsert with the new fields; `key` accepted on edit only |
| `POST /glossary/:id/approve`, `/unapprove`, `/deprecate` (`{ replacedById? }`), `/reinstate` (new) | R6. `PATCH /:id/verify` stays as an alias of approve |
| `POST /glossary/bulk` | Adds `status`, `schemeId` and `kind` changes |
| `DELETE /glossary/:id` | As today (deletion memory) |
| `GET / POST / PATCH / DELETE /glossary/schemes[/:id]` (new) | R4 |
| `GET /glossary/schemes/:id/tree?parentId=` (new) | R5 tree; children loaded lazily |
| `GET /glossary/relations?termId=&type=`, `POST /glossary/relations`, `POST /glossary/relations/:id/approve`, `DELETE /glossary/relations/:id` (new) | R5 |
| `POST /glossary/import` (multipart: `file`, `format: csv \| skos`, `dryRun`, `conflict`, `language`, `asDraft`, `schemeKey?`) (new) | R12; returns a job id |
| `GET /glossary/import/:jobId` (new) | Status and report |
| `GET /glossary/export?format=csv\|skos&schemeId=&kinds=` (new) | Streams the file |

Validation happens in services and fails closed on unknown keys (integration rule 4). After codegen, add every new DTO to `packages/api-client/src/client.ts` (rule 5).

## 8. CLI

No change.

## 9. Performance and scale

- These are curated tables, usually 10²–10⁴ rows. EuroVoc is about 7,000 concepts and is the largest realistic import.
- Lookup at p95 ≤ 50 ms with 20,000 terms. Exact tiers use the GIN index on `matchKeys`; the prefix and substring tiers keep today's `ILIKE` path.
- A tree level loads at p95 ≤ 100 ms (indexes `toTermId, type`).
- Import runs as a background job; 7,000 SKOS concepts complete in ≤ 60 s.

## 10. Rollout

1. **PR 1:** the claims fixes (R13). Ships immediately.
2. **PR 2:** migration, model, service, lookup and the DTO and API changes, keeping the old fields working.
3. **PR 3:** the web tabs, editor, term page and banner.
4. **PR 4:** relations, the tree and agent tools.
5. **PR 5:** import and export.

Each PR is independently releasable. The banner (R8) ships with PR 3.

## 11. Testing

- **Unit (API):**
  - key generation (transliteration, collisions, previous keys);
  - relation validation (cycles, kinds, custom verbs, symmetric RELATED);
  - status transitions;
  - lookup tiers with codes, hidden aliases and deprecated terms (extend `glossary.service.spec.ts`; keep the GENESIS P10 cases and the `GES` ranking test);
  - CSV and SKOS round-trips, with a EuroVoc-shaped fixture;
  - the system-brief composition order.
- **Migration:** on an empty workspace, and on a populated one with 17 mixed terms (Clinton-like) checking the inferred kinds, keys and statuses. Then round-trip the data transfer.
- **MCP:** the completeness spec, demo-mode refusals, `strictObject` refusal of unknown keys.
- **E2E:**
  - create a scheme, add concepts with codes and a broader relation, see the tree;
  - export SKOS, delete, re-import, and get the same tree;
  - look up `E` and get *Einzelvertretung* via a hidden alias.

## 12. Risks

| Risk | Mitigation |
|---|---|
| Removing the global unique on `term` breaks callers that assumed it | Agent upsert matches by kind and, for concepts, scheme. Data transfer matches by key. A spec covers both |
| The migration misclassifies terms (an ORGANIZATION that is really a concept) | The review banner and bulk *Change kind* (R8) |
| Key churn breaks references | `previousKeys` redirect (R2), and keys are never reused |
| Huge imports | Limits, dry run, background job (R12) |
| Agents grow a messy taxonomy | DRAFT by default, approval guardrails (D7), relation cap per term, cycle checks |

## 13. Acceptance criteria

- [ ] A concept with codes and hidden aliases can be created, approved, related, deprecated with a successor, and found by code.
- [ ] `E` resolves by lookup and is excluded from SL2's text matching.
- [ ] A 7,000-concept SKOS file imports with a dry-run report, and exports again to an equivalent graph.
- [ ] Existing workspaces migrate without data loss; the banner lists the inferred kinds.
- [ ] The four claims are fixed.
- [ ] An agent can propose a concept and a relation, and can approve the relation only in MANAGED mode, within its budget; the approval can be undone.
- [ ] Every new string exists in EN and DE.

## 14. Definition of done

The integration architecture's §9 and SL0 §12.

## 15. Open questions

| # | Question | Default until answered |
|---|---|---|
| Q1 | Multilingual labels: a first-class `labels[{lang, value, type}]` instead of aliases? | Aliases. SKOS import picks one preferred language |
| Q2 | Should a concept name be unique across schemes in some workspaces (a strict mode)? | No. Unique per scheme |
| Q3 | Should entities ever belong to a scheme, for example a "register" scheme of companies? | No in v1; revisit in G5′ |
