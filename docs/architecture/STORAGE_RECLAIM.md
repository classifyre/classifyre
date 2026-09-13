# Namespace storage — what was reclaimed, and what is left

> Status: tiers 1 and 2 shipped in [PR #277](https://github.com/classifyre/classifyre/pull/277);
> the follow-up corrected several numbers below and closed the item this
> document had ranked first. Sections marked **Closed** record measurements that
> contradicted an earlier revision of this file — read those before re-deriving.
> Measured on `firmenbuch-test-2`: **21 GB → 15 GB** from these changes alone, and
> **9944 MB** once a full correlation recompute had also re-evaluated the pair set.
> Only ~7.4 GB of that is this work — see the attribution note below.
> This document records what was *not* done, why, and what it would take — so the
> next person does not re-derive the same dead ends.

---

## Where the bytes were

One namespace held 20 GB of a 21 GB database; the other four totalled 124 MB
between them. Roughly 135 KB of Postgres per asset, and most of it was written
more than once.

| Relation | Before | After | What changed |
|---|---:|---:|---|
| `pgboss_*.job_common` | 4588 MB | 203 MB | Retention capped and actually swept |
| `content_embeddings` | 3722 MB | 2054 MB | `halfvec`, surrogate key dropped |
| `finding_stats_asset_daily` | 458 MB | 75 MB | Upsert instead of delete+insert |
| `finding_stats_first_asset_daily` | 428 MB | 71 MB | Same |
| Never-scanned indexes | 304 MB | 0 | Four dropped |
| `edges` metadata | 342 B/row | 128 B/row | Six of nine JSONB keys derived |

### Attribution: what a recompute does that this work did not

A full correlation recompute run afterwards took `edges` to 418 MB and
`correlation_pair_signatures` to 525 MB, but most of that is **not** the metadata
slimming. Scored pairs fell from ~4.05M to 574,419 because the fan-out filter
re-evaluated the corpus as it grew (159,394 → 166,863 assets, 277,390 → 606,798
correlation values):

| Tag | Distinct values | Assets | Assets per value |
|---|---:|---:|---:|
| `tag_register_status` | 10 | 84,034 | 8,403 |
| `tag_legal_form` | 38 | 82,713 | 2,177 |
| `tag_balance_sheet_size_class` | 4 | 5,188 | 1,297 |

A value shared by 8,403 companies is not evidence. The old 4.05M had accumulated
across incremental scans that never re-evaluated those tags globally; the top of
the queue is now `regex_at_firmenbuchnummer` (383,826 pairs), the real company
number. **A better queue, not merely a smaller one** — and a reminder that pair
counts are not a storage metric.

Side effect worth knowing: `GET /correlation/review/portfolio` went from 122 s to
3.9-7.7 s warm (about 22 s cold), because it aggregates that table.

Two of those shrink **as data is rewritten**, not retroactively: existing edges
keep their nine-key metadata until the next correlation recompute, and existing
analyses keep their rendered sentences until recalibration refreshes them.

---

## Rejected after investigation

These look like obvious wins and are not. Each was measured before being
dropped.

### `edges.id` — 514 MB, blocked by a public contract

Identical in shape to the `content_embeddings.id` that *was* removed: a 359 MB
primary key sitting on top of an already-unique natural key
`(from_type, from_id, to_type, to_id, relation_type)`, plus 37 bytes a row.
Every `ON CONFLICT` in `graph.service.ts` already targets the natural key, so
promoting it costs nothing there.

**Why not:** `PATCH /graph/edges/{id}` and `DELETE /graph/edges/{id}` address a
manual edge by that id, and `EdgeDetailDto` returns it. It is an API contract.

**What it would take:** re-key those two routes on the natural tuple (an API
break), or keep `id` as a non-key column with its own lookup index — which
saves the 359 MB PK but not the column, and needs the two cursor loops in
`correlation.service.ts` and `correlation-review-index.service.ts` re-pointed at
the composite key.

### `correlation_pair_signatures.source_a_id` / `source_b_id` — 164 MB, costs more than it saves

Six distinct values across 4.1 million rows. Textbook redundancy.

**Why not:** they back the review queue's source filter
(`AND (s.source_a_id IN (…) OR s.source_b_id IN (…))`) and the constellation
aggregation, which groups by source pair. Deriving them by joining `assets`
turns a fast filter into a 4.1M-row double join on a hot path. That is a
regression dressed as a saving.

### Native `uuid` columns — 1.4 GB, cascades schema-wide

Forty columns hold 36-character UUID strings in `text` (37 bytes against 16).
`correlation_pair_signatures` alone carries five of them, worth 410 MB of heap
plus index savings.

**Why not:** Postgres will not implicitly compare `uuid` to `text`, so
converting `a_id` means converting `assets.id`, which means converting every
column that joins to it, which is the whole schema — plus every raw-SQL
comparison and every `ANY($1::text[])` parameter. There is no contained subset:
the two biggest candidates (`edges.from_id`/`to_id`) are polymorphic and hold
URNs for `external` endpoints, so they are not UUIDs at all.

**What it would take:** its own PR, done table-group by table-group with the
FK graph as the ordering, and a way to verify every raw query. Worth doing
eventually; not worth doing beside seven other changes.

---

## The big one that is still open

### Consolidating the similarity graph — ~340 MB, not ~3 GB

> **Re-measured after the fan-out fix, and demoted.** The 6.4 GB below was the
> pre-fix corpus. `edges` is now **418 MB** (711,316 rows, of which 574,419 are
> `likely_duplicate` + `related`) and `correlation_pair_signatures` **596 MB**
> (1,148,261 rows — almost exactly 2× the edges, because signatures hold both
> directions of each pair). Consolidating removes roughly the similarity share
> of `edges`, about **340 MB**, for the whole inversion described below. That is
> no longer a good trade; it is listed here as the sequencing plan if the
> pipeline is being reworked for other reasons.

`edges` held 4.05M `related` / `likely_duplicate` rows and
`correlation_pair_signatures` 4.1M of the same pairs. The signature table is
literally `INSERT INTO correlation_pair_signatures … SELECT … FROM edges`.
Together that was roughly 6.4 GB for one derived similarity graph.

**Why it is not a storage change.** The pipeline is ordered:

```
stagePairAggregates  ->  correlation_pair_staging   (UNLOGGED, ~12.8M rows)
scoring loop         ->  edges (related/likely_duplicate)
clustering           <-  reads edges  (likely_duplicate + identical_content)
refreshPairSignatures<-  reads edges + clusters + lineage profiles
```

Clustering reads `edges` **before** signatures exist, and `refreshPairSignatures`
needs `cluster_id` — so signatures cannot become the source without inverting
the pipeline. Making the scorer write signatures directly means they must be
written once without cluster/pattern/lineage, clustering must read them, and a
second pass must fill the rest in.

**Consumers that would have to move** (all currently read `edges` by relation
type):

| Site | What it reads |
|---|---|
| `correlation.service.ts` `rebuildAllClusters` / `reconcileClusters` (×3) | `CLUSTERING_RELATION_TYPES` |
| `correlation.service.ts` `getCorrelationGraph` | `CORRELATION_RELATION_TYPES` |
| `correlation-review-index.service.ts` `refreshPairSignatures` | `REVIEWABLE_RELATION_TYPES` |
| `correlation-review.service.ts` pair screen | `edge.metadata` for the waterfall |
| `autopilot/search/agent-search.service.ts` | `CORRELATION_RELATION_TYPES` |
| `autopilot/tools/fingerprints/fingerprints.toolset.ts` | `CORRELATION_RELATION_TYPES` |
| `correlation.worker.ts` | counts them |
| `graph/edge-class.ts` | classifies them into `REFERENCE` |

**It is also arguably correct on the merits**, not only for space: these are
scored pairs, not catalog edges. `relation_class` already sorts them into
`REFERENCE`, the class that propagates nothing through lineage.

**Suggested sequencing**, if someone picks this up:

1. Make the scorer write pairs to `correlation_pair_signatures` with
   `cluster_id`/`pattern_key`/lineage nullable, keeping the edge write.
2. Move clustering to read signatures. Verify cluster membership is identical
   on a real corpus before going further — this is the step that can silently
   change Duplicate Review output.
3. Move `refreshPairSignatures` to an in-place enrichment instead of a rebuild
   from edges.
4. Move the five read-only consumers.
5. Only then stop writing the edges, and backfill-delete the existing 4.05M.

Each step is independently revertible. Step 2 is the one that needs a
before/after diff of `asset_cluster_members` on a corpus of this size.

---

## Smaller items, measured but not done

| Item | Worth | Why it was skipped |
|---|---:|---|
| ~~`findings.history` to its own table~~ | ~~205 MB~~ | **Compacted in place instead.** See below — the table move stays available, but is no longer worth ~205 MB. |
| `finding_evidence_analyses.signals` to typed columns | ~152 MB | Eight numeric keys whose names are repeated 604k times (the earlier 113 MB figure was low; measured at 252 B a row). Would also make them queryable. Needs a migration plus a projection to keep the `Record<string, number>` API shape. |
| `findings.detection_identity` as `bytea` | ~90 MB | 65-byte hex against 33 bytes, and it carries two indexes (75 + 72 MB). Every comparison site has to change. |
| `asset_chunks` overlap | ~250 MB | 19.4 % of chunk text is deliberate sliding-window overlap. Reducing it is a retrieval-quality trade, not a free win. |

### `findings.history`: compacted, not moved

The doc used to say "six write sites across three services" and "eight indexes".
Both were wrong: there are **ten** write sites, and `findings` carries **18**
indexes — one of them, `findings_matched_content_fts_idx`, exists only in a raw
SQL migration and is absent from `schema.prisma`, which is how it gets missed.

Measured: 213 MB across 816,436 entries, no cap anywhere, and **never queried in
SQL** — no JSONB operators, no `where`, and its only GIN index was dropped the
day after it was created. It is read whole and reverse-scanned in JS. Three
things accounted for the size: key names repeated 816,436 times, `runnerId` as a
36-character string, and a `location` object copied onto 607,227 entries from
the finding's own column that no reader has ever touched.

So it was compacted in place — codes and short keys, rendered on read, tolerant
of both shapes, no backfill — following `embedding/reason-labels.ts`. See
`src/types/finding-history.ts`. Moving it to its own table remains possible and
would make an append an insert instead of a row rewrite, but it is now worth far
less than 205 MB.

**Measured on a real pair of entries from this corpus: 461 B → 224 B, 51.4 %.**
So expect roughly 213 MB → ~105 MB as rows are rewritten, not the two-thirds a
first estimate suggested. What is left is mostly two strings per entry: the ISO
timestamp (24 chars) and `runnerId` as a 36-character UUID. That second one is
the same 37-versus-16-bytes problem as the native-`uuid` item above, so it is
the ceiling on compaction here rather than something more key-shortening can
reach.

One claim worth not repeating: this is **not** a HOT-update fix. `findings` runs
at **0.8 % HOT over 1,077,875 updates**, and compaction does not change that,
because the same statements also change `status`, `lastDetectedAt` and
`severity`, which are indexed. It reduces the bytes rewritten per update, not
the number of indexes each update touches.

---

## The bug behind the numbers

The 4.05M → 574,419 pair collapse was not the corpus growing. It was a defect,
fixed in this branch.

`stagePairAggregates` counted value owners inside `raw`, which is scoped to the
working set, and `loadAssetTotals` scoped its `hash_counts` CTE the same way. On
a full recompute that scope is the corpus, so the cap worked. On an incremental
scan it is a handful of touched assets — so a value held by 84,034 assets
corpus-wide showed fifty owners, sailed under the 2000 cap, and produced pairs
joined on "is an active company". 22 hub values spanning 333,622 rows were
admissible incrementally and excluded by a full recompute.

One bug, three symptoms: a review queue that was 86% non-evidence, ~6 GB across
`edges` and `correlation_pair_signatures`, and a portfolio endpoint at 122s
instead of 3.9-7.7s warm. Both sites now share `hubValuesCte()`, unscoped by
construction.

**The lesson generalises**: any "is this too common to be evidence" test must be
asked of the corpus, never of the scan window. The same mistake was present in
the boilerplate projection, which capped pairs per group but never asked whether
a group was too broad — 24 groups spanned 2,000+ assets and carried 57.7% of all
membership. Now capped by `BOILERPLATE_GROUP_BREADTH_CAP`.

**Two siblings of that lesson**, both found while following up on it:

*A signal that fires on ~100% of the corpus carries no information, and if it
carries a direction it breaks whatever reads that direction.* `readable_context`
at 603,633/603,633 disabled the autopilot evidence floor outright.
`duplicate_group` at 91% merely compressed a ranking. The scope test and this
one are the same test asked of a different axis: *what fraction does this fire
on?* — and the answer has to come from the corpus either way.

*The condition that SUPPRESSES a signal deserves the same scrutiny as the one
that fires it.* `crossDocumentLead`'s `similarCount === 0` was never questioned
because it was on the quiet side of an `if`. Everything about the fan-out review
looked at what admitted a pair; nothing looked at what silently withheld a
bonus.

### Which denominator is which

Three different units are easy to confuse, so once, explicitly:

| Unit | Value | What it counts |
|---|---:|---|
| Group memberships | 591,106 | distinct `(duplicate_group_hash, asset_id)` pairs — the unit the breadth analysis uses |
| Analyses in a group | 591,304 | rows of `finding_evidence_analyses` with a non-null group hash |
| Analyses total | 602,938 | all rows of `finding_evidence_analyses` |

The breadth exclusion removes 341,057 of the 591,106 memberships (57.7%),
leaving 250,049. The ranking harm is measured against analyses: 591,304 of
602,938, which is 98%.

### Closed: boilerplate does NOT wrongly suppress importance

An earlier revision of this document called this "arguably the larger harm" and
proposed applying the breadth exclusion inside `EmbeddingAnalysisService`. That
was measured on `firmenbuch-test-2` and **the proposal was wrong** — it would
have made the ranking worse. Recorded here so nobody re-derives it.

The breadth cap is scoped to the pair projection, and its effect on queue volume
is small: those groups were already bounded to 200 pairs each, so excluding 24 of
them removed ~4,800 pairs, not 341,057.

Beyond that, **the score is already monotone in breadth**, because the
suppression is not the reason at all — it is `noveltyScore = 1/sqrt(similarCount
+ 1)` at weight 0.25, plus `COMMON_VALUE_PENALTY`:

| Duplicate group | analyses | mean importance |
|---|---:|---:|
| none | 12,650 | 0.807 |
| 1–10 assets | 80,229 | 0.672 |
| 11–100 | 95,308 | 0.578 |
| 101–500 | 37,157 | 0.504 |
| 501–2000 | 37,929 | 0.473 |
| 2000+ | 341,057 | 0.441 |

And **all 341,057 broad-group analyses are `tag:*` findings** — `Gesellschaft
mit beschränkter Haftung` ×56,405, `Eingetragen` ×47,404, `Einzelvertretung`
×32,748, registry courts. Not one non-tag finding is in a group that wide.
Excluding them from the penalty would lift register-wide taxonomy values out of
the bottom band, where they belong. The top of the queue is already right: of
the top 300 by importance, 216 are CRITICAL `tag:Financial distress` /
`tag:Shell-company risk`, 36 are `insolvenzgefahr_hoch`.

What was fixed instead is the *label*: `duplicate_group` renders as
"Register-wide value: N findings carry it" above the breadth threshold, because
"56,404 identical findings grouped" is accurate and useless.

### Still open: the recurrence bonus is withheld from the narrow end

The real defect the investigation found is at the opposite end of the
distribution, and only half of it is fixed.

`crossDocumentLead` required `similarCount === 0`, so a value recurring in 2–25
assets forfeited the `cross_document_recurrence` reason *and* the `+0.12` bonus
whenever its content hash collided. That gate was deliberate —
`docs/first-use/ranking-calibration-2026-07-16.md` added the bonus precisely
because recurrence went unrewarded, and scoped it to "different contexts"
because "same-context repeats are template copies". True for prose. False for
structured extraction, where a shared field has identical context **by
construction**: an asset's company-number field looks the same as every other
one because the context window *is* the field. So the fix for "recurrence
unrewarded" reintroduced it for the corpus shape where it matters most.

| | analyses | clears 0.75 |
|---|---:|---:|
| no duplicate group | 12,650 | **99.2 %** |
| narrow group, 2–25 assets | 123,015 | **6.0 %** |

147,823 analyses meet every condition except `similarCount === 0`; 90,570 are
`regex:AT_FIRMENBUCHNUMMER`, averaging 4.8 assets — the same company number this
document calls "the real company number" two sections up. With
`UNMONITORED_MIN_IMPORTANCE` and `EXPRESS_IMPORTANCE_SCORE` both 0.75, autopilot
was blind to the register's central cross-reference.

**Shipped: the reason only.** `crossDocumentRecurrence` now governs the reason
and `crossDocumentLead` still governs the bonus, so no score moved.

**Shipped 2026-09-12: the bonus, with the re-tune.** `crossDocumentLead` is
now `crossDocumentRecurrence`, so the +0.12 follows the wider set, and
`EXPRESS_IMPORTANCE_SCORE`, `UNMONITORED_MIN_IMPORTANCE` (plus the third 0.75
on the same standard, case-leads `MIN_INQUIRY_IMPORTANCE`) moved 0.75 → 0.85
in the same change. Re-measured at ship time on 605,935 analyses: 148,231
eligible (was 147,823), 67,968 newly over the old 0.75, 66,961 of them company
numbers. The 0.85 rests on the express bypass rate (137 of 272 scans today;
251 at 0.75 post-bonus, 146 at 0.85) — count-matching is impossible because
structured contexts quantize scores into lumps. Full before/after,
methodology, and the 10.5–13.5 h rollout budget are in
`docs/first-use/ranking-calibration-2026-07-16.md`. Scores land only as
recalibration rewrites rows; run the `VACUUM (FULL, ANALYZE)` below after it.

### Reconciled, still hypotheses: the two "too common" caps

`RECURRENCE_HUB_CAP = 25` and `BOILERPLATE_GROUP_BREADTH_CAP = 2000` look like
the same judgement written twice, two orders of magnitude apart. They are not
the same judgement — they measure different units on different signals, with
different costs of being wrong:

- The **25** counts *distinct assets sharing one normalized value* and feeds
  *scoring*: 2–25 earns the recurrence bonus, above it earns the common-value
  penalty. Its unit is the identifier — a company number recurring across a
  handful of filings is the register's central cross-reference, while one on
  8,403 filings is a category. Being wrong here mis-scores individual
  findings, so the cap sits close to the "handful" end.
- The **2000** counts *distinct assets in one near-duplicate text cohort* and
  feeds the *pair projection only*: above it, a text group contributes no
  asset pairs to Duplicate Review. Its unit is the template sentence —
  register boilerplate repeats verbatim in tens of thousands of filings, and
  the measured break (24 groups over 2,000 assets carrying 57.7% of
  membership) is where projection pairs stop being candidate duplicates and
  start being co-occurrence noise. Being wrong here floods or starves a review
  queue, so the cap sits where the queue was measured to drown.

A shared constant would imply the units are interchangeable; they are not
(the label-side breadth note in `reason-labels.ts` makes the same point about
`similarCount` vs asset counts). What would settle each: for the 25, an
analyst review of findings just under and over it on a corpus where recurrence
is common (this one) — do 20-asset values read as leads and 30-asset values
as noise? For the 2000, a before/after of the Duplicate Review queue at a
lower candidate (e.g. 500): does anything evidential disappear, or only
template pairs? Until someone runs those, both remain hypotheses — but they
are two hypotheses, not one contradiction.

### Closed: the autopilot evidence floor was dead

Not a storage item, found while measuring this one, and the most serious thing
in this document.

`readable_context` carried `impact: 'up'` and fires whenever `qualityScore`
clears `QUALITY_GATE` (0.45). The **minimum** quality on this corpus is 0.690,
so it fired on 603,633 of 603,633 analyses. `hasPositiveImpact` was therefore
always true, `strong === analyzed` always held, and `provablyWeak` —
`analyzed > 0 && strong === 0` — was structurally unreachable. Both refusals it
gates never fired: `inquiries.create` over a boilerplate cluster, and
`cases.create` over noise. The floor's unit tests were green throughout, because
the `weak()` fixture omitted the one reason the analyzer always writes.

Fixed by reclassifying the two hygiene signals (`readable_context`, `context`)
to `neutral`, leaving `up` for the three codes that make an evidential claim.
`renderOne` now takes impact from the template table unconditionally rather than
honouring a legacy row's stored value, so the change reaches the 206,700 rows
recalibration had not yet rewritten.

**The effect arrives in two stages, and the interim is the stricter one.**
Impact is rendered, so the floor becomes reachable the moment the code deploys;
but `cross_document_recurrence` is *written*, so the wider set does not carry it
until recalibration has rotated through:

| | `provablyWeak`-eligible |
|---|---:|
| before | **0** of 603,633 |
| on deploy, before any re-scoring | 549,906 (90.9 %) |
| after recalibration | **402,203 (66.5 %)** |

The interim refuses more than the settled state, not less, so it fails in the
safe direction — an agent is told to cite better evidence rather than being
waved through. Worth knowing anyway if agents start reporting refusals right
after a deploy: that is the floor working for the first time, and it relaxes to
66.5 % as the recurrence reason lands.

---

## `finding_evidence_analyses`: 1024 MB, half of it free space

Not in the original survey, and now the fourth-largest relation in the
namespace. 946 MB of heap holding roughly 465 MB of live rows (603,633 rows at
770 bytes), so about **480 MB is reusable free space** — the sediment of
7,372,783 lifetime updates against 604,235 rows, twelve rewrites apiece, only
35 % of them HOT.

The cause was that recalibration's refresh phase bounded the wrong number.
`RECALIBRATE_REFRESH_BATCHES × RECALIBRATE_BATCH_SIZE` reads as 20 × 500 =
10,000 findings, but each batch expands to the **full hash cohort** of its seed
findings, and one `tag:Legal form` hash is 56,405 findings. One pass rewrote all
603,633 analyses.

Two fixes, both in the embedding module:

- **`duplicateGroupHash` has one owner.** Analysis means "my own content hash,
  if I have exact duplicates" by that column; `calibrateNeighborhood` means "the
  root of my near-duplicate component", which is a wider and different value.
  Both wrote it unconditionally, so the two took turns — analysis wrote the own
  hash, the comparison below saw a mismatch on the next pass and rewrote the
  row, calibration flipped it back, forever. **130,489 analyses (21.6 %) stood
  diverged**, so the optimisation below could not converge for any of them, and
  the value a client read depended on which phase ran last. Analysis now seeds
  the group and may clear a value it owns, but never overwrites a component root
  it has no way of computing.
- **No-op writes are skipped.** The computed payload is compared against the
  stored row and, when nothing moved, only `analyzedAt` is stamped. That still
  rotates the refresh cursor, but touches neither index and does not fire
  `trg_sync_finding_importance_score`. Verified rather than assumed, because the
  distinction is not the obvious one: `UPDATE OF importance_score` fires on the
  column being in the SET list, **not on its value changing**. So the old shape
  fired the trigger on all 603,633 rows of every pass even where the score was
  identical — the guard inside the trigger body (`IS DISTINCT FROM`) then made
  each resulting `UPDATE findings` match zero rows, but the statement was still
  issued per row. Leaving the column out of the SET list is what actually stops
  it. The derived signals are rounded to the three decimals `importanceScore`
  already uses, so a cohort member going 56,404 → 56,405 no longer reads as
  changed.
- **The budget counts rows walked, by both phases.** `analyzeHashes` and
  `calibrateNeighborhood` each return a visited count and honour a cap;
  `analyzeBatches` spends one budget across the two. Counting only the analysis
  side let a bounded pass do up to twice the rows it reported, since calibration
  walks the same cohorts. Phase 1 stays unbounded deliberately — its cohort
  expansion is semantically required, since adding one finding to a cohort
  really does change `similarCount` for every member.

  One SQL note, because it is easy to reintroduce: the guard that stops
  calibration rewriting a whole component every pass needs an explicit null arm.
  Prisma compiles `not` to inequality, which is three-valued, so a bare
  `{ not: root }` skips every row that has no group yet — the findings whose
  content hash is unique but which still belong to a component, whose
  `noveltyScore` would then stay pinned at 1.0 for good. Measured: the bare form
  matched 593,085 of 605,220 rows, missing all 12,135 nulls.

The free space was reusable but not returned. Done 2026-09-12, after the
no-op-write fix had stopped the bleeding: `VACUUM (FULL, ANALYZE)` took the
table **1024 MB → 514 MB** (heap 474 MB), so ~510 MB handed back — the ~480 MB
estimate plus a little drift. Run it again after the bonus-award rewrite pass,
which rewrites the same ~600k rows once more.

---

## Two correctness bugs found alongside, and fixed

Neither is a storage item; both were on the same code paths.

**A select-all bulk resolve was undone by the next scan.** Filter-mode
`bulkUpdate` takes `updateMany`, which cannot append to a JSONB array, so it
wrote no history — and history is where a manual status decision lives.
`findingHasManualStatusOverride` found no `STATUS_CHANGED` entry, reported no
override, and ingest's `shouldReopen = wasResolved && !statusOverride` re-opened
every finding the operator had just resolved. Reachable from the findings
table's select-all and from the `bulk_update_findings` MCP tool, which takes the
same `filters`. Latent on `firmenbuch-test-2` — all 260 RESOLVED rows there are
auto-resolved — but reachable in one click. The entry is now appended in SQL,
paged by id, before the update takes the rows out of the filter.

The same branch also carried an **unbounded read**: the custom-detector feedback
fetch selected every matching finding, `matchedContent` included, in one array —
on a select-all over 607,000 findings, the shape behind two previous heap OOMs
here. Both walks had the same predicate and the same cursor, so they are now one
paged walk that appends history and records feedback per page: 122 pages instead
of 244, and nothing corpus-sized is ever held. `recordCustomDetectorFeedback` is
safe per page — it filters rows and inserts them, holding no state across calls.

Two things that walk has to keep, if it is edited: the read must stay **before**
the `updateMany`, because the update is what stops the rows matching
`{ status: { not: status } }`; and the projection is fixed rather than
conditional on whether feedback is wanted, because making it conditional leaves
the page a union type and the cast that hides that is exactly the kind that
would let a dropped column silently produce zero feedback rows.

**`assetCorrelationValue.findingId` was not remapped on import.** It is a real
FK (`ON DELETE SET NULL`) and was the only real FK missing from any `idRefs` in
`transfer-scopes.ts` — while `sourceId`, which has no constraint at all, was
listed. Importing into a fresh namespace, the finding was remapped and the
correlation row was not, so the constraint rejected it and `insertBisecting`
silently skipped most of the `fingerprints` scope behind the generic "already
exist here, or reference data in a scope that was not included" warning.
Re-importing into the same namespace was worse: `assetId` *was* remapped, so the
row landed carrying a stale `findingId`, and Fingerprints deep-linked an
imported asset's value to a different asset's finding. The self-heal in
`getValueOccurrences` never corrects that, because it only repairs nulls.

Both `idRefs` and `optionalRefs` were needed: `fingerprints` declares
`dependsOn: ['assets']` and not `findings`, so importing it without them is
supported, and a newly-remapped `findingId` would then point at nothing.

**Two things an operator has to do, because neither fix reaches backwards.**

*Stale links from imports taken before the fix have no repair path.* The
self-heal in `getValueOccurrences` only fills nulls — a row carrying a
wrong-but-valid `findingId` is trusted outright, which is what made the
same-namespace direction the nastier one. They are precisely detectable,
because a correlation value and the finding it cites always belong to the same
asset (606,798 of 606,798 on a never-imported namespace, zero exceptions):

```sql
-- Findings cited by a correlation value on a DIFFERENT asset: imported rows
-- whose reference was never remapped. Nulling them hands the row back to the
-- self-heal, which re-derives the link on the next read.
UPDATE asset_correlation_values v
SET finding_id = NULL
FROM findings f
WHERE f.id = v.finding_id AND f.asset_id <> v.asset_id;
```

Run it per tenant schema on any install that imported `fingerprints` before this
change. It is deliberately not a boot migration: it is a data repair that only
affects installs that imported, and the boot path is already the wrong place for
per-tenant table scans.

*Manual bulk-resolves taken before the fix will re-open once.* Rows resolved
through filter-mode carry no `STATUS_CHANGED` entry, so ingest cannot tell them
from auto-resolved ones and `shouldReopen` fires on the next detection. Nothing
to repair — the judgement was never recorded — but an install that has used
select-all should expect one re-open wave and redo those resolutions, which will
then stick.

The regression guard is a test that asks **schema.prisma** which columns back
each model's relations and asserts every one is in `idRefs`. Note for whoever
extends it: `Prisma.dmmf` is not a usable source here — the client's runtime
dmmf carries the relation fields but leaves `relationFromFields` undefined, so a
dmmf-based version of this test passes on every model while checking nothing. It
was written that way first and caught nothing until it was pointed at the schema
file.

---

## Operational notes

Two things are worth knowing before measuring this again.

**Index bloat hides in the high-water mark.** `finding_stats_asset_daily_pkey`
was 263 MB holding 25,710 deleted pages around 7,911 live ones — about 28 MB of
actual keys. `pgstatindex` shows this; `pg_relation_size` does not. After the
upsert fix and a `REINDEX`, the two rollups' indexes went 420 → 36 MB and
394 → 35 MB.

**Reclaiming after a recompute needs a `VACUUM`.** Deleting 4.05M edges left the
heap at 2504 MB holding 574k live rows; `VACUUM (FULL, ANALYZE)` took it to
226 MB. Autovacuum recycles that space for reuse but never hands it back to the
filesystem, so schedule it rather than assume it.

**`ALTER TYPE` rewrites the table under `ACCESS EXCLUSIVE` during boot.** The
HNSW *index* build was moved off the boot path; the halfvec column rewrite was
not. On the deploy that carries that migration, expect embedding reads and
writes to stall for minutes and readiness probes to flap. The "15-second boot"
figure describes every boot *after* it, not that one.

**HNSW parameter changes never rebuild an existing index.** `buildHnswIndex`
returns early on a valid index, so editing `hnswM` or `ef_construction` in
settings has no effect on spaces that already have one. This is pre-existing
(the old `CREATE INDEX IF NOT EXISTS` behaved identically), and it is left
deliberately: now that the build is backgrounded, rebuilding on a param change
would mean a settings tweak silently starts a 20–70 minute index build. That is
plausibly right, but it is a product decision rather than a storage fix.
`buildHnswIndex` is where the stored-parameter comparison belongs if someone
wants it.

**`REINDEX … CONCURRENTLY` queues behind `CREATE INDEX CONCURRENTLY`** on the
same table, waiting on `virtualxid`. If a per-space HNSW build is running
(20–70 minutes on ~880k vectors), every concurrent reindex waits for it.
