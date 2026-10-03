# SL5 · Semantic canvas: the case-board Meaning lens and the semantic map

*Part of [the semantic layer](SL0-semantic-layer-architecture.md). Research: [glossary-semantic-layer.md](../research/glossary-semantic-layer.md) §8. Builds on [CASE_BOARD_PRD.md](../architecture/CASE_BOARD_PRD.md).*

| | |
|---|---|
| **Status** | Draft for review |
| **Date** | 2026-10-01 |
| **Size** | M–L (Part A ≈ M, Part B ≈ M) |
| **Milestone** | M3 |
| **Depends on** | SL1, SL3 (links and the `term` graph type). SL4 is optional; its counts show when present |
| **Feeds** | G5′ (entities appear in the same lens and map) |
| **Owns** | The board parts of contract C12: item kind `TERM`, op `term.place`, trace kind `meaning`. The semantic map rollups |
| **Lifts** | CASE_BOARD_PRD §2 non-goal "the domain stays asset / finding / hypothesis", for TERM items |

## 0. Decisions that apply

| # | Decision |
|---|---|
| D5 | Both a case-board *Meaning* lens and a workspace semantic map |
| D4 | Relations are drawn: taxonomy, related, part of, instance of, custom verbs |
| D1 | Concepts now; entities join through G5′ with no change to this design |
| SL-4 | Meaning is not lineage: `meaning` is its own trace kind and lens, never a hop in lineage |

## 1. Problem

Investigators work on the case board, and it shows only assets, findings, hypotheses, notes and frames. Meaning is invisible there:
- that three documents are all about *GmbH*;
- that a finding is a *Bank account* under *Financial data*;
- that the case touches *Health data* at all.

At workspace level there is a map of how **sources** connect, and no picture of what the data **means**: which concepts exist, how they relate, and how much evidence stands behind each.

The product owner asked to "see the ontology" on the canvas.

## 2. Goals and non-goals

### Goals

**Part A, the case board:**
1. A *Meaning* lens with three settings: Off, Concepts, Concepts + entities.
2. Term cards as first-class board items (pinned).
3. Ghost terms for meaning that isn't pinned.
4. Dotted *means* edges from findings or assets to terms, each explaining itself on hover.
5. Relations between pinned terms.
6. Highlight by concept.
7. A trace kind `meaning`: other assets about the same concepts.
8. Board links to terms that promote to meaning.
9. A *Meaning* panel listing the case's vocabulary.
10. ⌘K search for terms.

**Part B, the workspace:**
1. Discovery → **Sources | Meaning**: a semantic map with two layouts, *Taxonomy* and *Network*.
2. Concepts sized by evidence and ringed by severity.
3. Relation and co-occurrence edges.
4. Filters by scheme and source.
5. A case overlay.
6. An unbound-vocabulary lane.
7. A detail rail.
8. Built from rollups, like the source map.

### Non-goals

- Editing taxonomy definitions on the map. The map links to term pages; a board link between two concepts can **propose** a relation (A9).
- Entity-specific views: mentions over time and co-mention networks are G5′.
- Map snapshots or exports beyond the existing canvas image export.
- Real-time co-editing of TERM items beyond what the board already does (CASE_BOARD_PRD Phase 8).

## Part A — The case board's Meaning lens

### A1 The lens

The View popover gains a **Meaning** section:

```
Meaning      [ Off | Concepts | Concepts + entities ]      ⓘ
             ☐ Show broader concepts (one level)
Highlight by [ Source ▾ | Detector ▾ | Hypothesis ▾ | Concept ▾ ]
```

**Defaults:**
- *Off* on existing boards.
- *Concepts* on boards created after this ships, when the case has at least one linked term.

**Persistence:** per board in the URL state (`board-url-state`), and per viewer in `localStorage`, wrapped in try/catch.

*Concepts + entities* is disabled until G5′ ships, with the tooltip "Entities arrive with the Entities release".

### A2 The semantic layer in the board payload

`CaseBoardResponseDto` gains `semantic: BoardSemanticLayerDto`, computed by a new `SemanticBoardLayerService`. It is part of the payload whatever the lens setting, so switching the lens doesn't need a round trip, and snapshots keep it.

| Part | Derived from |
|---|---|
| `terms[]`: `{ termId, key, name, kind, scheme, status, linkedItems: [{ itemId, findingIds[], methods[], supportCount }], totalLinked, isHub }` | Current `asset_terms` rows of the case's evidence assets; the case's attached findings evaluated against cached APPROVED bindings (SL2 compiler, in memory); MANUAL ABOUT references on those findings and assets; ABOUT references on the case itself, which have no linked item and appear only in the panel |
| `relations[]`: `{ fromTermId, toTermId, type, label }` | APPROVED glossary relations among `terms`, plus broader parents one level up when asked |
| `gone[]` | Links of case evidence that went GONE, with `goneAt`. **Evidence preservation:** the board never drops meaning silently; it shows it faded, like a gone finding |

**Bounds:**
- the 40 terms with the most linked items (`BOARD_SEMANTIC_TERM_LIMIT`), plus `truncated: n`;
- a term linked to more than 30 board items is a **hub** (`isHub: true`): drawn once, with its edges bundled (A5);
- the layer computes in ≤ 150 ms at p95 for the board scale target (≤ 300 bubbles, about 2,000 findings), and has a budget like the existing finding budget.

### A3 Term items (C12)

| Area | Change |
|---|---|
| Prisma | `enum CaseBoardItemKind` gains `TERM`. `refId` → `glossary_terms.id`. `@@unique([boardId, kind, refId])` already prevents duplicates. Plan dev rollouts for the enum (integration rule 18) |
| `packages/schemas/src/case-board.ts` | `BOARD_ITEM_KINDS` gains `"TERM"`, and a new op: `{ type: "term.place", opId, itemId, termId, x?, y? }`. Replaying it for a removed TERM item restores the same row, as `thread.place` does. `item.delete` on a TERM item removes the card only; the term is untouched |
| `CaseActivityType` | Gains `BOARD_TERM_PLACED`, `BOARD_TERM_REMOVED`, `MEANING_LINKED` and `MEANING_UNLINKED` (A8). Payloads carry `itemId` and `termKey` for *Show on board* |
| Rendering | `packages/case-board/src/components/term-node.tsx` (new) |

**A term card shows:**
- the kind glyph (⬡ concept, ◇ entity), the name and a scheme chip;
- "linked to *n* items on this board";
- a status treatment:
  - DRAFT: dashed border;
  - DEPRECATED: struck through, with "replaced by …";
  - deleted term: "(deleted term)", with the card kept, as for missing evidence.

Level of detail follows `use-lod.ts`: name only when far away; glyph and count when very far.

### A4 Ghost terms

**What.** Linked terms that are not pinned appear as **ghost cards** (`suggested-node` style, kind TERM):
- placed near the centroid of their linked items (`placement.ts`);
- shown when the lens is on;
- hidden behind *View → Show ghost terms* once there are more than 20, mirroring the board's D5 rule for neighbours.

**Pinning.** One click pins a ghost: a `term.place` op at its current position.

### A5 Means edges

**What.** A dotted, muted *means* edge runs:
- from each finding node to each term the finding is evidence of;
- from the asset node, when the link is asset-level (metadata binding, declaration, asset-level manual link, accepted suggestion).

**Hubs.** Edges to a hub term are bundled: one edge from each frame or cluster that contains linked items. They expand on hovering or selecting the term.

**Hover card.** Shows the C11 explanation:

```
⬡ Bank account   ← binding "IBAN code · PII → Bank account"
approved by Legal · 3 Oct · confidence 1.00 · since run 412
[Open term]  [Edit binding]
```

**Locking.** Means edges are system edges: they cannot be deleted. The context menu offers:
- *Unlink*, for MANUAL links (removes the ABOUT reference);
- *Edit binding*, which opens SL2's dialog;
- *Open term*.

Rendering lives in `apps/web/components/case-board/edges/meaning-edge.tsx` (new); the shared style goes into `packages/case-board/src/lib/edges.ts`.

### A6 Relations between terms

When two or more terms are on the board, as cards or ghosts, their APPROVED relations are drawn as thin, labelled, locked edges:
- *broader* points up, with an arrow to the broader concept;
- *related* is undirected;
- custom verbs carry their label;
- *instance of* applies to entities (G5′).

*Show broader concepts* adds ghost parents one level up, so the local taxonomy reads at a glance.

### A7 Highlight by concept

View → Highlight by → **Concept** offers a picker of terms in the layer. Choosing one:
- dims findings and assets not linked to it, narrower concepts included;
- leaves *Only highlighted* working as it does for source and detector.

### A8 Board links to and from terms

`link.create` accepts TERM items as endpoints. **Promote** (`link.promote`) gives the link a meaning beyond the board, depending on what it connects:

| Endpoints | Promote does |
|---|---|
| Evidence or a finding ↔ a TERM | Creates a MANUAL ABOUT reference (SL3 R5). The means edge replaces the board link, and `MEANING_LINKED` is logged |
| Concept TERM ↔ concept TERM | Creates a glossary **relation**: RELATED, or CUSTOM with the link's label. An operator's is APPROVED; an agent's is DRAFT, approvable under D7. The ontology can grow from the board |
| Entity TERM ↔ entity TERM | A global `edges` row with `term` endpoints, origin MANUAL (G5′; disabled until it ships) |

The link popover shows what *Promote* will do before it is clicked.

### A9 Trace kind `meaning`

**Where.** *Show connections* (`POST /cases/:id/board/trace`) gains the kind `meaning`, so `TRACE_KINDS` becomes lineage, links, duplicates, similar and meaning.

**From an asset, the walk:**
1. reads its current `asset_terms` links;
2. for each term, takes the top 10 other assets linked to it, ranked by maximum severity, then support, then recency;
3. returns them on the `side` group as ghosts, with `via` set to the term.

**Edges.** They are virtual, with id `sl:<assetId>:<termId>`; they are never written to `edges`.

**Bounds.** Hub terms are walked with the existing per-node cap (`TRACE_PER_NODE`), and depth is 1 for meaning. No multi-hop chains through concepts (SL-4).

**In the panel.** A *Same meaning* group: "6 other documents about ⬡ GmbH". *Add all* and *Add one* work as for the other groups.

### A10 The Meaning panel

A new panel in the board's rail (CASE_BOARD_PRD D4): **Meaning**.

```
Meaning on this case                               [ + Link case to term ]
⬡ GmbH                 6 items · binding        [Place] [Open]
⬡ Bank account         4 items · binding        [Place] [Open]
⬡ Health data          1 item  · manual         [Place] [Open]
Case is about: ⬡ Counterparty due diligence (manual)
Faded (gone):  ⬡ Insolvency — evidence resolved 2 Oct
```

- Sorted by linked items.
- Clicking a row selects and flies to the card or ghost.
- *Link case to term* creates a case-level ABOUT reference (SL3 R5).

### A11 ⌘K

The command palette gains a **Terms** group: search APPROVED terms by lookup (SL1 R7). Actions: *Place on board*, *Open term*, *Highlight*.

### A12 MCP and autopilot

| Tool | Change |
|---|---|
| Board summary tools (`case-board-tools.service.ts`, `board-summary.ts`) | List placed and ghost terms, with linked items, in the labelled summary |
| `apply_board_ops` | Accepts `term.place` automatically, since it reuses the shared schema |
| Trace tool | Accepts the `meaning` kind |
| Autopilot (case focus) | May place terms and draw links. Promoting a concept-to-concept link creates a DRAFT relation; promoting evidence-to-term creates an SL4 LINK proposal (D7: agents never create links directly) |

### A13 Requirements checklist (Part A)

- [ ] A1–A11 implemented, with EN and DE strings, keyboard reachable, and readable in light and dark (board tokens).
- [ ] The layer is in snapshots (`CaseBoardSnapshot.payload` is the served DTO).
- [ ] Undo and redo for `term.place` and the TERM item delete (the board's command stack).
- [ ] Performance: the board scale target with the lens on stays within the existing frame budget. Ghosts and means edges respect `onlyRenderVisibleElements` and level of detail.

## Part B — The workspace semantic map

### B1 Where

Discovery's connections canvas card gets a header toggle: **Sources | Meaning**. *Sources* is today's map, unchanged. *Meaning* is the semantic map. The choice is kept in the URL (`?map=meaning`).

### B2 What it draws

```
 Scheme [ All ▾ ]  Source [ All ▾ ]  Min assets [ 1 ]  ☐ Co-occurrence  ☐ Entities (G5′)
 Layout ◉ Taxonomy ○ Network          Highlight case [ Choose… ]        Built 3 min ago · Rebuild
                       ( Personal data 14,210 )
                 ╱              │                 ╲
     ( Contact data 12,403 ) ( Special categories 37 ) ( Financial data 812 )
        │        │                  │                         │
   (E-mail 12,1k) (Phone 980)   (Health 37)              (Bank account 812)
                                                    ┊ co-occurs on 120 assets (lift 6.4)
 ─────────────────────────────────────────────────────────────────────────────────────────
 Unbound vocabulary: 21 outputs · 3,402 open findings without meaning   [ Review ]
```

**Nodes** are APPROVED concepts with at least `minAssets` assets including narrower concepts, plus their broader ancestors, even if empty, so trees stay connected.

| Visual | Encodes |
|---|---|
| Size | Square root of `totalAssetCount` (narrower included) |
| Ring | Severity mix of the linked evidence, the same ring the source map uses |
| Fill | Scheme colour (SL1 R4) |
| Badge | Pending SL4 proposals for the concept, when present |

**Edges:**

| Kind | Style |
|---|---|
| BROADER (taxonomy) | Solid |
| RELATED | Dashed |
| PART_OF, CUSTOM | Labelled |
| Co-occurrence | Dotted, weighted by lift. Off by default; the top 3 per node |

**Layouts:**
- **Taxonomy** (default): ELK layered, top-down, broader above narrower. Reuse the board's `elk.worker.ts`.
- **Network:** force layout with clustering by scheme. Reuse `graph-explorer` (`GraphCanvas`, `use-force-layout`, `use-pan-zoom`), as the source map does.

**Level of detail.**
- Labels are hidden below a zoom threshold, except for the top 20 nodes by size.
- More than 500 nodes collapse into one bubble per scheme, expanded on click.

### B3 The rail

Selecting a concept opens the right rail, reusing the `ConnectionsRail` pattern:
- definition (first 300 characters);
- counts: assets, findings, sources, with a bar per source;
- bindings count;
- top co-occurring concepts;
- narrower concepts.

Actions: **Open term** · **Show assets** (the asset list filtered by term) · **Watch** (SL3) · **Add to case…** (places the term on a chosen case's board, with `term.place`) · **Review proposals** (SL4, when there are any).

### B4 Filters and the case overlay

| Control | Behaviour |
|---|---|
| **Scheme** | Multi-select |
| **Source** | Multi-select. Counts are recomputed live from `asset_terms` with `source_id = ANY(...)`, with a 3 s timeout and a 60 s cache |
| **Min assets** | Hides concepts below the number |
| **Entities** | Disabled until G5′, which adds entity nodes as satellites of their INSTANCE_OF concepts |
| **Highlight case** | Choose a case. Concepts linked to its evidence get the board's lime "in the case" ring; everything else dims. The same overlay opens from a case: *Open in semantic map* |

### B5 Empty states

| State | Message and action |
|---|---|
| No concepts | "Your glossary has no concepts yet." **Install a starter pack** (SL2 §8) · **Import SKOS or CSV** (SL1 R12) |
| Concepts but no links | "Nothing is bound yet." **Bind detector outputs** (opens *Unbound vocabulary*) |
| Embeddings off | Nothing changes here; the map does not need them |

### B6 Rollups

The map is built like the source connection map (`stats/source-graph.service.ts`): aggregation never leaves Postgres, and the grain keeps the response small.

```prisma
model TermGraphNode {
  termId            String   @id @map("term_id")
  schemeId          String?  @map("scheme_id")
  directAssetCount  Int      @map("direct_asset_count")
  // Distinct assets linked to this term or any narrower term.
  totalAssetCount   Int      @map("total_asset_count")
  findingCount      Int      @map("finding_count")   // sum of support for finding-backed methods
  sourceCount       Int      @map("source_count")
  severityCounts    Json     @map("severity_counts") @db.JsonB
  lastLinkedAt      DateTime? @map("last_linked_at")

  @@map("term_graph_nodes")
}

model TermGraphLink {
  termAId    String  @map("term_a_id")
  termBId    String  @map("term_b_id")
  // BROADER | RELATED | PART_OF | INSTANCE_OF | CUSTOM | CO_OCCURRENCE
  kind       String
  label      String  @default("")
  assetCount Int     @default(0) @map("asset_count")  // co-occurrence support
  lift       Decimal? @db.Decimal(8, 3)

  @@id([termAId, termBId, kind, label])
  @@index([termAId])
  @@map("term_graph_links")
}

model TermGraphState {
  id          String    @id @default("singleton")
  refreshedAt DateTime? @map("refreshed_at")
  durationMs  Int?      @map("duration_ms")
  isBuilt     Boolean   @default(false) @map("is_built")
  updatedAt   DateTime  @updatedAt @map("updated_at")

  @@map("term_graph_state")
}
```

**Rebuild:**
- runs on the `semantic-map-rebuild` queue, coalesced, at most every 5 minutes;
- triggered by `semantic.links_updated`, glossary relation changes, term status changes, and *Rebuild*.

**Speed:** ≤ 30 s at 4 M `asset_terms` rows.

**Co-occurrence links** reuse SL4 G-3's computation when SL4 is present; otherwise the map computes them with the same bounds.

**Classification:** derived and cleanable (*Semantic map*); not transferred, and rebuilt after import.

### B7 API

| Method and path | Purpose |
|---|---|
| `GET /semantic/map?schemeIds=&sourceIds=&minAssets=&cooccurrence=&caseId=` | `{ nodes, links, overlay?: { termIds }, unbound: { outputs, findings }, freshness }`. Served from the rollups; live only for source filters (B4). Falls back to a live build with a timeout when the map isn't built yet, and says so |
| `GET /semantic/map/terms/:termId` | Rail details (B3) |
| `POST /semantic/map/rebuild` | Queue a rebuild |

MCP gets `get_semantic_map`: a compact summary of the top concepts by evidence, relations and unbound totals, so agents can "see" the ontology.

### B8 Performance

| Measure | Target |
|---|---|
| `GET /semantic/map` from rollups | ≤ 300 ms at p95 for 2,000 concepts |
| Drawing 500 nodes | 60 fps pan and zoom on the reference laptop, the same as the source map |
| Taxonomy layout for 500 nodes | ≤ 1 s, off the main thread |

## Testing

**Board:**
- `term.place` validation and idempotent replay;
- TERM item delete, restore, undo and redo;
- the layer computation, its bounds and hub detection;
- gone links shown faded;
- each promote case in A8, including the disabled entity case;
- the `meaning` trace never walks more than one hop and never writes `edges` (spec);
- the snapshot contains the layer;
- the MCP summary lists terms.

**Map:**
- rollup counts equal a live recomputation on a fixture corpus (narrower roll-up and distinct assets);
- co-occurrence lift arithmetic;
- the source filter;
- the case overlay;
- empty states;
- level of detail and scheme collapse above 500 nodes.

**Visual:** light and dark mode; phone width (view only, as for the board).

**E2E:** scenario D, step 6, and scenario E, step 4 (SL0 §7). Also: open a case, switch the lens on, pin a ghost term, draw a link from a finding to the term and promote it, then see the means edge replace the link and the term page list the asset as MANUAL.

## Acceptance criteria

- [ ] On a case whose evidence links to concepts, *Meaning → Concepts* shows ghost terms with dotted means edges. Hovering explains the binding; pinning keeps the card after reload.
- [ ] *Highlight by concept* dims everything not about it.
- [ ] *Show connections → Same meaning* proposes other assets about the case's concepts, and adds them as evidence.
- [ ] Promoting a finding-to-term link creates a manual link. Promoting a concept-to-concept link creates a relation (APPROVED for operators).
- [ ] Discovery → Meaning shows the taxonomy with sizes and severity rings, filters by scheme and source, and highlights a chosen case.
- [ ] The unbound lane opens *Unbound vocabulary*. Empty states lead to packs and bindings.
- [ ] Every string exists in EN and DE.

## Risks

| Risk | Mitigation |
|---|---|
| Visual overload on dense boards | Lens off by default on existing boards; ghost cap; hub bundling; level of detail; the panel as a calm list alternative |
| Hub concepts (*Personal data*) dominate the map | Square-root sizing, scheme collapse, a *min assets* filter, and the taxonomy layout so hubs sit on top rather than in the middle |
| Users read means edges as lineage | Distinct dotted style, the term glyph, and *means* in the hover title. The edges never appear in the lineage view (SL-4) |
| Payload growth for big cases | Layer bounds (A2), and a budget the same as the finding budget |

## Open questions

| # | Question | Default until answered |
|---|---|---|
| Q1 | Should a hypothesis be able to take a stance on a term card ("supports: this is about *Health data*")? | Not in v1: board links between hypothesis and term cover it visually. `CaseThreadSupport.targetType = 'term'` can follow |
| Q2 | Should the semantic map open a source-scoped view from the source map (click a source → its meaning)? | Yes, as a follow-up: `?map=meaning&sourceIds=…` already works |
| Q3 | Should the map offer a matrix (concepts × sources) next to the graph? | Not in v1; the rail's per-source bars cover the common question |
