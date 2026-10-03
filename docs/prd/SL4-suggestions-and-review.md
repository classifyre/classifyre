# SL4 · Suggestions and the review queue

*Part of [the semantic layer](SL0-semantic-layer-architecture.md). Research: [glossary-semantic-layer.md](../research/glossary-semantic-layer.md) §5.*

| | |
|---|---|
| **Status** | Draft for review |
| **Date** | 2026-10-01 |
| **Size** | M |
| **Milestone** | M3 |
| **Depends on** | SL1, SL2, SL3 |
| **Feeds** | G5′ (adds entity kinds to the queue), G7 (decisions and precision) |
| **Owns** | Foundation F10 (review queue) |

## 0. Decisions that apply

| # | Decision |
|---|---|
| D3 | Semantic suggestions are in v1 |
| D7 | Agents may approve their own BINDING and RELATION items under guardrails; LINK, TERM and ALIAS stay operator decisions |
| D1 | One review flow for concepts and, later, entities |
| SL-5 | Proposals are inert until decided |

## 1. Problem

Bindings and links depend on someone noticing what is unbound, which concept fits, and which documents talk about a concept without using its words.

**What exists today:**
- the autopilot proposes terms and aliases into a glossary page with no queue;
- the duplicates engine has a strong review flow, but for documents only.

**What is missing:**
- nothing suggests a binding;
- nothing finds documents about a concept;
- nothing proposes how concepts relate;
- there is no single place to decide any of it.

The research found that judgment is the bottleneck in every field run (Enron, Epstein). This queue is where that judgment happens, at keyboard speed, with its outcomes measured.

## 2. Goals and non-goals

### Goals

1. One **review queue** (F10) for every proposal. Kinds:
   - DRAFT terms and proposed aliases (SL1);
   - DRAFT relations (SL1);
   - DRAFT bindings (SL2);
   - machine suggestions: bindings, relations and asset links;
   - unknown term references (SL3).

   G5′ adds entity mentions and merges.
2. Four **generators**:
   - binding suggestions for unbound vocabulary;
   - link suggestions (documents about a concept);
   - relation suggestions (co-occurrence);
   - unknown-reference grouping.
3. **Decisions are remembered.** A dismissed proposal does not come back unless its evidence changes materially.
4. **Keyboard-first review**, with bulk acceptance for link groups.
5. **Measured:** each decision writes a G7 `decision_log` row; acceptance rate per generator and score band; thresholds tunable.
6. Works **without embeddings**, with fewer generators, and says so.

### Non-goals

- Entity mention candidates and merges (G5′ adds them to this queue).
- LLM-written definitions or concept extraction from documents (§13 Q2).
- Auto-accepting anything an operator would decide (D7 limits agents to bindings and relations).

## 3. Proposal kinds

| Kind | Comes from | Accept does | Who may accept |
|---|---|---|---|
| `TERM` | Agent `glossary.propose`; imports run as draft | Approves the term (SL1) | Operator |
| `ALIAS` | Agent aliases on operator terms (`proposedAliases`) | Moves the alias into `aliases` | Operator |
| `RELATION` | Agent `propose_relation`; the co-occurrence generator | Creates or approves the relation | Operator; agent in MANAGED mode (D7) |
| `BINDING` | Agent `propose_binding`; the binding generator; pack bindings waiting for a detector (shown as informational) | Creates or approves the binding (SL2 §4.5) | Operator; agent in MANAGED mode within SL2's guardrails (D7) |
| `LINK` | The link generator; agent `propose_link` (SL3 R5) | The asset gets a SUGGESTED link (SL3) | Operator |
| `TERM_REF` | `term_ref` endpoints nobody has resolved (SL3 R6) | *Create term* with that key, or *Map to existing term* (adds the key to its `previousKeys`; the references stitch) | Operator |
| `ENTITY_MENTION`, `ENTITY_MERGE` | G5′ | G5′ | G5′ |

**Storage.** The queue is a **view**, not a copy:
- agent and pack proposals stay as DRAFT rows in their own tables (terms, aliases, relations, bindings);
- machine suggestions and agent link proposals live in `semantic_suggestions`;
- unknown references are read from `edges` with endpoint type `term_ref`.

`GlossaryProposalsService` merges them into one paged list with one decision API.

## 4. Generators

All generators:
- write `semantic_suggestions` rows with a **score** in [0, 1], a **rationale** sentence and **evidence**;
- run on the `semantic-suggestions` pg-boss queue, per namespace and coalesced (integration rule 8);
- run after the SL3 linker's jobs, nightly, and on demand.

### G-1 Binding suggestions

**Input.** Unbound rows of the vocabulary inventory (SL2 F8), meaning outputs and fields with open findings or assets and no APPROVED binding, not marked *No meaning* and not dismissed.

**Signals, each scored 0–1:**

| Signal | How | Needs embeddings |
|---|---|---|
| **Lexical** | Humanise the label (`IBAN_CODE` → "iban code"; `entity:organization` → "organization"; `tag:legal_form` → "legal form"; LLM label names as written) and compare with APPROVED concepts' `matchKeys`. A normalised exact match scores 0.9; token Jaccard ≥ 0.5 scores 0.6 + 0.3 × Jaccard | No |
| **Label meaning** | Embed "label + detector name + the label's description" (LLM label descriptions, GLiNER2 entity descriptions, TAG detector description) with `QueryEmbeddingService`, and take the cosine to concept vectors (terms are already embedded, SL1 R7). Keep the top 3 concepts | Yes |
| **Content** | Sample up to 20 OPEN findings of the output that have embeddings. The mean cosine of their vectors to each candidate concept confirms or penalises the label signals | Yes |
| **Value lookup** | For categorical outputs (SL2 §3): the share of the top values (by count) that are codes or `matchKeys` of APPROVED concepts in one scheme. ≥ 0.5 suggests `OUTPUT_LOOKUP` on that scheme, scored by the share | No |

**Score:**
- the maximum signal;
- + 0.05 for each other signal that agrees on the same concept, capped at 1.0;
- − 0.2 when the content signal contradicts (its cosine is below the space's neighbourhood floor).

Shown when the score is ≥ `suggestionMinScore.binding` (default 0.6).

**Rationale example:** "'iban code' matches alias *IBAN* of ⬡ Bank account (lexical 0.90). 18 of 20 sampled findings are semantically close (content 0.81)."

**Payload:** a complete C9 binding spec. Accepting needs no further input; *Edit & accept* opens SL2's dialog prefilled.

### G-2 Link suggestions: documents about a concept

**For** APPROVED concepts that have a definition or at least one alias (a bare name makes a weak vector), with embeddings switched on.

**Method.** One HNSW query per concept vector over asset chunks, reusing `EmbeddingService.semanticAssetIds`:
- candidate budget per concept is 200;
- keep assets scoring ≥ `suggestionMinScore.link`. The default is the embedding space's calibrated neighbourhood threshold when one exists, else 0.78;
- skip assets that already have a current link to the concept, by any method, or a dismissed suggestion with the same fingerprint (§6).

**When:**
- nightly;
- after linker jobs that touched ≥ 500 assets, coalesced;
- immediately for one concept when its definition, aliases or status change.

**Caps:**
- at most 200 pending LINK suggestions per concept, keeping the highest scores;
- a concept above the cap gets "and more: refine the definition or add a binding".

**Evidence:** the best-matching chunk's text, through the content presenter, plus its similarity and asset name.

**Rationale:** "Mentions the idea in §3: '…equity ratio below 8%…' (similarity 0.83)."

### G-3 Relation suggestions

**Co-occurrence** over current links in `asset_terms`, for pairs of APPROVED concepts with no relation between them or their ancestors.

**Measures:**
- support = assets linked to both;
- lift = P(A∧B) / (P(A)·P(B)).

**Suggest** RELATED when support ≥ 20 and lift ≥ 3 (defaults).

**Hub bound:** concepts linked to more than 50,000 assets are sampled down to 50,000.

Nightly only.

**Rationale:** "Co-occur on 120 assets (lift 6.4): *Health data* and *Bank account*."

### G-4 Unknown term references

Groups `term_ref` endpoints by key, with counts of edges, assets and the declaring sources.

The rationale names the key, its count and the closest existing terms by lookup, so a typo (`gmbh-at` vs `gmbh`) is one click to map.

### Without embeddings

When the `embeddings` workspace feature is off:
- G-1 runs its lexical and value-lookup signals only;
- G-2 does not run;
- G-3 and G-4 run.

The queue shows one banner: "Document and meaning-based suggestions need embeddings (Settings → Cleanup › Features)".

## 5. Review experience

**Where.** Glossary → *Proposals*, the tab SL1 started. Two panes, and the same keyboard grammar as duplicate review.

```
┌ Proposals ───────────────────────────────┬───────────────────────────────────────────────────┐
│ Kind  [All ▾]  Origin [All ▾]  Scheme ▾  │ BINDING · score 0.91 · generator: binding         │
│ ─────────────────────────────────────── │ "IBAN code · PII"  →  ⬡ Bank account              │
│ ● Bindings            12                 │ Every finding of this kind · all sources          │
│ ● Documents (links)   148  (9 concepts)  │ Why: 'iban code' matches alias IBAN (0.90);       │
│ ● Relations            4                 │ 18/20 sampled findings close (0.81)               │
│ ● Terms                6  ● Aliases 3    │ Impact: 812 findings · 640 assets · 3 sources     │
│ ● Unknown references   2                 │ Samples: AT61 1904 3002 3457 3201 · …             │
│ ─────────────────────────────────────── │                                                   │
│ ▸ IBAN code · PII → Bank account   0.91 │ [A] Accept  [E] Edit & accept  [D] Dismiss  [S] Skip│
│   force_majeure → Force majeure    0.88 │                                                   │
│   …                                      │ History: proposed 2026-10-04 by binding generator │
└──────────────────────────────────────────┴───────────────────────────────────────────────────┘
```

**Keyboard:**

| Key | Action |
|---|---|
| `J` / `K` | Next or previous proposal |
| `A` | Accept |
| `E` | Edit & accept |
| `D` | Dismiss |
| `Shift+D` | Dismiss forever |
| `S` | Skip |
| `X` | Select |
| `?` | Cheat sheet |

**Link groups.** *Documents* are grouped per concept, with a score histogram and *Accept all ≥ 0.85* (the threshold is adjustable in the group header). A bulk accept is one decision row per item, and one `glossary.proposal_decided` event per batch.

**Impact.** Shown for bindings (the SL2 preview) and relations (how many assets the narrower roll-up would add).

**Dismissal.** Takes an optional reason, chosen from *wrong concept*, *too broad*, *noise* or *other* plus text. Reasons feed precision analysis.

**Entry points:**
- the sidebar's Glossary item shows a badge with the pending count;
- a term page shows *n proposals* for its own term;
- the detector page's Meaning tab shows binding suggestions inline (SL2 §6.4).

**Agent items** carry the agent kind and run id, linked to the Harness decision log.

## 6. Memory of decisions

**Fingerprint.** Every suggestion has one per kind:

| Kind | Fingerprint |
|---|---|
| BINDING | The C9 fingerprint |
| LINK | Asset and concept |
| RELATION | The ordered pair and type |

**Re-proposal.**
- Accepted, or *dismissed forever*: never proposed again.
- *Dismissed*: proposed again only when the evidence changes materially, defined as score up by ≥ 0.1, or support (findings or assets) at least doubled. The new row points to the old decision ("dismissed on 4 Oct for 'too broad'; evidence doubled since").

**Expiry.** Pending suggestions whose underlying reason disappeared become EXPIRED without a decision. Examples: the output got a binding some other way; the asset was deleted; the concept was deprecated.

## 7. Agents (D7)

| Tool | Behaviour |
|---|---|
| `glossary.list_proposals` | Read the queue, with filters by kind and status, and minimum score |
| Binding items | Approved through `glossary.approve_binding` (SL2 §9), with all its guardrails. Approving a machine suggestion first creates the DRAFT binding, attributed to the agent as proposer, then approves it, so the agent owns the approval |
| Relation items | Approved through `glossary.approve_relation` (SL1 R14) |
| LINK, TERM, ALIAS, TERM_REF | **Never** decided by agents (D7). An agent may add a supporting note; the note is shown to the operator |

**Doctrine:** "work the binding queue from the highest score; preview, then approve within budget; never decide documents, terms or aliases."

## 8. Requirements summary

| # | Requirement |
|---|---|
| R1 | `GlossaryProposalsService`: one paged, filterable list over all kinds (§3), with counts per kind |
| R2 | Generators G-1 to G-4 (§4), each switchable in Settings → Glossary → Suggestions, with thresholds and caps editable |
| R3 | Decide API: accept, edit-and-accept, dismiss, dismiss-forever, skip; bulk decide for LINK groups. Validation fails closed |
| R4 | Decision memory and expiry (§6) |
| R5 | Review UI (§5), with EN and DE strings and the keyboard map; reuse duplicate-review components where they fit |
| R6 | Agents (§7) |
| R7 | Measurement: every human decision writes a G7 `decision_log` row (actor, kind, generator, score, decision, reason). Settings shows acceptance rate per generator and score band, over the last 90 days |
| R8 | Events: `glossary.proposals_pending` (when the pending count crosses 10, 50, 100 or 500; at most once per day per threshold; counts by kind); `glossary.proposal_decided` (one per decision or bulk batch). Aggregate only |

## 9. Data model (Prisma, tenant schema)

```prisma
enum SemanticSuggestionKind {
  BINDING
  RELATION
  LINK
}

enum SemanticSuggestionStatus {
  PROPOSED
  ACCEPTED
  DISMISSED
  EXPIRED
}

model SemanticSuggestion {
  id            String                   @id @default(uuid())
  kind          SemanticSuggestionKind
  status        SemanticSuggestionStatus @default(PROPOSED)
  // Term the suggestion is about (the binding/link target, or the relation's "from").
  termId        String?                  @map("term_id")
  assetId       String?                  @map("asset_id")   // LINK
  // BINDING: C9 spec. RELATION: { from, to, type }. LINK: { chunkHash, similarity }.
  payload       Json                     @db.JsonB
  score         Decimal                  @db.Decimal(4, 3)
  generator     String                   // binding | link | relation | agent
  origin        GlossaryOrigin           @default(SUGGESTION)
  rationale     String                   @db.Text
  evidence      Json?                    @db.JsonB
  fingerprint   String
  // Evidence snapshot used by the re-proposal rule (§6).
  supportCount  Int                      @default(0) @map("support_count")
  suppressed    Boolean                  @default(false)        // dismissed forever
  previousId    String?                  @map("previous_id")    // the earlier dismissed row
  decidedBy     String?                  @map("decided_by")
  decidedAt     DateTime?                @map("decided_at")
  dismissReason String?                  @map("dismiss_reason")
  createdBy     String?                  @map("created_by")     // agent kind + run for agent links
  createdAt     DateTime                 @default(now()) @map("created_at")
  updatedAt     DateTime                 @updatedAt @map("updated_at")

  term  GlossaryTerm? @relation(fields: [termId], references: [id], onDelete: Cascade)
  asset Asset?        @relation(fields: [assetId], references: [id], onDelete: Cascade)

  // One live row per fingerprint. Older dismissed rows keep their history
  // through previousId. Enforced by a partial unique index in raw SQL:
  //   (kind, fingerprint) WHERE status = 'PROPOSED'
  @@index([status, kind, score(sort: Desc)])
  @@index([termId, status])
  @@index([kind, fingerprint])
  @@map("semantic_suggestions")
}
```

**Settings.** Added to `InstanceSettings`:
- `suggestionGenerators` (JSON on/off map);
- `suggestionMinScore` (JSON per kind);
- `suggestionLinkCapPerConcept` (default 200);
- `suggestionCooccurrenceMinSupport` (default 20);
- `suggestionCooccurrenceMinLift` (default 3).

**The SL3 linker** reads ACCEPTED LINK suggestions as SUGGESTED links. Decided suggestions are never purged automatically: they are the memory.

## 10. API (REST)

| Method and path | Purpose |
|---|---|
| `GET /glossary/proposals?kind=&origin=&schemeId=&termId=&minScore=&status=PROPOSED&page=` | The merged queue (R1) |
| `GET /glossary/proposals/counts` | Pending counts by kind, for the badge |
| `POST /glossary/proposals/decide` (`{ kind, id, decision: accept \| edit \| dismiss \| dismiss_forever \| skip, edit?, reason? }`) | R3. Per-kind validation |
| `POST /glossary/proposals/decide-bulk` (`{ kind: 'LINK', termId, minScore? \| ids[], decision }`) | Bulk accept or dismiss for link groups |
| `POST /semantic/suggestions/refresh` (`{ generators?, termIds? }`) | On-demand generation (queued) |
| `GET /semantic/suggestions/stats?days=90` | Acceptance rates per generator and score band (R7) |

## 11. MCP

In group `glossary`:
- `list_glossary_proposals`;
- `decide_glossary_proposal` (operator level, every kind);
- `refresh_glossary_suggestions`;
- `glossary_suggestion_stats`.

## 12. Events, transfer, cleanup, demo mode, performance

| Area | Behaviour |
|---|---|
| **Data transfer** | Decided `semantic_suggestions` rows (ACCEPTED, DISMISSED, suppressed) travel with scope `glossary`, so decisions survive an archive. PROPOSED and EXPIRED rows are deliberately absent: they are regenerated |
| **Cleanup** | *Pending suggestions* is a cleanable derived dataset (deletes PROPOSED and EXPIRED rows only) |
| **Demo mode** | Decisions blocked; reading the queue allowed |
| **Performance: queue page** | ≤ 300 ms at p95 for 10,000 pending items (indexed by status, kind, score) |
| **Performance: G-1** | ≤ 60 s for 1,000 unbound outputs |
| **Performance: G-2** | One HNSW query per concept; ≤ 10 min nightly for 2,000 concepts |
| **Performance: G-3** | One SQL pass over `asset_terms`, ≤ 5 min at 4 M rows |

## 13. Open questions

| # | Question | Default until answered |
|---|---|---|
| Q1 | Should accepted LINK suggestions become MANUAL links, so they survive regeneration and threshold changes? | They stay SUGGESTED, and accepted rows are never expired. This keeps G7 precision per method honest |
| Q2 | Should an LLM draft definitions for DRAFT concepts, or extract candidate concepts from documents? | Not in v1. It is a separate PRD if wanted, behind the same queue |
| Q3 | Should the queue be per user once identities exist (enterprise)? | Shared queue in the open-source core |

## 14. Testing and acceptance

**Generators:**
- G-1 lexical and lookup cases from the starter packs (PII types against the GDPR pack, `tag:legal_form` against *Rechtsformen*);
- G-2 against a fixture space with known neighbours;
- G-3 lift arithmetic and the hub sampling;
- G-4 typo grouping;
- behaviour with embeddings off.

**Memory:** dismiss, then no re-proposal; double the support, then re-proposal with `previousId`; dismiss forever, then never; expiry when the reason disappears.

**Agents:**
- a BINDING approval runs through SL2's guardrails;
- a LINK decision by an agent is refused (spec).

**UI:** keyboard flow; bulk accept by threshold; the badge counts; EN and DE.

**E2E:** scenario F, step 4, and scenario G, step 1 (SL0 §7).

**Acceptance:**
- [ ] After a scan of a new LLM detector, its unbound label appears in *Proposals* with a binding suggestion and rationale. Accepting it links the findings (with SL3).
- [ ] With embeddings on, *Eigenmittelquote* gets document suggestions that do not contain its labels. Bulk accept ≥ 0.85 creates SUGGESTED links.
- [ ] A dismissed suggestion does not return after the next generation run.
- [ ] Acceptance rate per generator is visible in Settings, and `decision_log` rows exist for each human decision.

## 15. Definition of done

The integration architecture's §9 and SL0 §12.
