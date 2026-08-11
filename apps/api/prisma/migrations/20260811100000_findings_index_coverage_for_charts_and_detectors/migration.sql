-- Widen two findings indexes to cover the columns their queries actually read,
-- and drop one that nothing has ever used.
--
-- Measured on a 57 GB desktop instance (17 namespace schemas, 3.1M findings in
-- the largest). The dashboard, the charts and the custom-detectors page were
-- all slow for the same reason: the index answered the *predicate* but not the
-- *projection*, so every matching row still went to the heap. On findings that
-- is 3.3 GB of random reads to produce a handful of counts.
--
--   Aggregate  (actual time=19361.902..19361.903 rows=1)
--     Buffers: shared hit=1014 read=73913
--     ->  Index Only Scan using findings_status_idx  (rows=3145538)
--           Heap Fetches: 610204          -- <= the projection, not the filter
--
-- 1. [custom_detector_id] -> [custom_detector_id, source_id]
--
--    The detector usage query groups by detector and counts distinct sources:
--
--      SELECT custom_detector_id, COUNT(DISTINCT source_id), COUNT(*)
--      FROM findings WHERE custom_detector_id IN (…) GROUP BY custom_detector_id
--
--    With only custom_detector_id indexed, source_id came from the heap once
--    per finding. The trailing column makes the whole aggregate index-only.
--
-- 2. [first_detected_at] -> [first_detected_at, severity, status]
--
--    searchFindingsCharts aggregates counts per (first_detected_at, severity,
--    status) across a window. Same shape: the window was indexed, the three
--    aggregated columns were not.
--
-- Both new indexes have the old single-column index as their leading prefix,
-- so every plan the old index could serve the new one serves too — the drops
-- below remove redundancy, not capability.
--
-- 3. DROP [last_detected_at]
--
--    436 MB across 17 schemas and *zero* scans in any of them, against a
--    findings_pkey with 79M scans in the same stats window — so this is a
--    genuinely dead index, not a cold one. It is not a prefix of anything:
--    [asset_id, last_detected_at] and [importance_score, last_detected_at]
--    both lead with another column, and neither can serve a bare
--    last_detected_at predicate. Nothing issues one.
--
--    Deliberately NOT dropped, despite also showing zero scans:
--    findings_matched_content_fts_idx (741 MB). Zero scans there means the
--    text-search path has not been exercised on this instance, not that it is
--    dead — dropping it would turn every future content search into a
--    sequential scan of the whole findings table.
--
-- prisma migrate runs each migration inside a transaction, so no CONCURRENTLY
-- and no transaction control here. Every statement is idempotent so a partial
-- apply can be re-run.
--
-- Cost note: creating an index on findings is O(table). On the largest
-- namespace measured (3.3 GB heap) each CREATE INDEX took a few minutes and
-- held a write lock for the duration; reads are unaffected. Migrations run at
-- startup before the API serves traffic, so this lands as a slower first boot
-- on large existing installs, once. The creates come before the drops so that
-- a failure part-way through leaves the old indexes in place and the instance
-- no worse off than before.

-- CreateIndex
CREATE INDEX IF NOT EXISTS "findings_custom_detector_id_source_id_idx"
  ON "findings"("custom_detector_id", "source_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "findings_first_detected_at_severity_status_idx"
  ON "findings"("first_detected_at", "severity", "status");

-- DropIndex (superseded: leading prefix of findings_custom_detector_id_source_id_idx)
DROP INDEX IF EXISTS "findings_custom_detector_id_idx";

-- DropIndex (superseded: leading prefix of findings_first_detected_at_severity_status_idx)
DROP INDEX IF EXISTS "findings_first_detected_at_idx";

-- DropIndex (unused: 0 scans across all 17 namespace schemas, 436 MB)
DROP INDEX IF EXISTS "findings_last_detected_at_idx";

-- 4. extraction_payloads: index the JSONB value-equality dedup lookup.
--
--    Every custom-detector extraction asks "does a payload with exactly this
--    pipeline_result already exist?" before writing one. That predicate is
--    jsonb equality, which nothing indexed — so it was a sequential scan, and
--    on one namespace it ran 105,368 times (1.8B rows read, whole JSONB
--    documents compared row by row) on a table of only 33k rows.
--
--    The lookup cannot be replaced by a content_hash probe: rows created by
--    the payload data migration carry a content_hash that is not
--    stableJsonHash(pipeline_result), and finding those legacy rows by value
--    is precisely what stops a duplicate payload being written.
--
--    A HASH index, not btree: btree entries are capped at ~8191 bytes, so a
--    large pipeline_result would make INSERT fail outright. Hash indexes store
--    the hash rather than the value, have no size ceiling, support exactly the
--    equality this query needs, and are crash-safe/WAL-logged since PG 10.
--
--    Measured on 50k representative rows:
--      before:  Seq Scan   18.186 ms, 715 buffers
--      after:   Index Scan  0.031 ms,   3 buffers
CREATE INDEX IF NOT EXISTS "extraction_payloads_pipeline_result_hash_idx"
  ON "extraction_payloads" USING hash ("pipeline_result");
