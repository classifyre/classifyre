# Namespace storage — what was reclaimed, and what is left

> Status: tiers 1 and 2 shipped in [PR #277](https://github.com/classifyre/classifyre/pull/277).
> Measured on `firmenbuch-test-2` (159,394 assets, 590,387 findings): **21 GB → 15 GB**.
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
| `edges` metadata | 342 B/row | 123 B/row | Six of nine JSONB keys derived |

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

### Consolidating the similarity graph — ~3 GB

`edges` holds 4.05M `related` / `likely_duplicate` rows and
`correlation_pair_signatures` holds 4.1M of the same pairs. The signature table
is literally `INSERT INTO correlation_pair_signatures … SELECT … FROM edges`.
Together that is roughly 6.4 GB for one derived similarity graph.

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
| `findings.history` to its own table | ~205 MB | Six write sites across three services, plus a backfill of ~785k rows per namespace before the column can be dropped. It is also a write-amplification fix — every status flip rewrites a row carrying eight indexes — so it deserves its own PR rather than being folded in. |
| `finding_evidence_analyses.signals` to typed columns | ~113 MB | Eight numeric keys whose names are repeated 604k times. Would also make them queryable. Needs a migration plus a projection to keep the `Record<string, number>` API shape. |
| `findings.detection_identity` as `bytea` | ~90 MB | 65-byte hex against 33 bytes, and it carries two indexes (75 + 72 MB). Every comparison site has to change. |
| `asset_chunks` overlap | ~250 MB | 19.4 % of chunk text is deliberate sliding-window overlap. Reducing it is a retrieval-quality trade, not a free win. |

---

## Operational notes

Two things are worth knowing before measuring this again.

**Index bloat hides in the high-water mark.** `finding_stats_asset_daily_pkey`
was 263 MB holding 25,710 deleted pages around 7,911 live ones — about 28 MB of
actual keys. `pgstatindex` shows this; `pg_relation_size` does not. After the
upsert fix and a `REINDEX`, the two rollups' indexes went 420 → 36 MB and
394 → 35 MB.

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
