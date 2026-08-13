-- Pre-aggregate the finding counts the dashboard reads, and retire three
-- indexes on `findings` that cannot pay for themselves.
--
-- Measured on a 64 GB desktop instance, workspace `enron-email`
-- (5,165,490 findings, 5.5 GB heap, 6.0 GB of indexes):
--
--   GET /findings/discovery   55 s cold, 15-38 s warm
--
--   EXPLAIN (ANALYZE, BUFFERS) of its six statements:
--     groupBy(severity,status)   13,750 ms   Parallel Seq Scan, 2.7 GB read
--     groupBy(assetId) top-50    18,717 ms   Parallel Seq Scan + sort
--     count(month)                8,542 ms   Index Only Scan, 2.58M x 2
--     count(week)                 2,604 ms   Index Only Scan
--     count(today)                   97 ms   Index Only Scan
--     recent runs (10)               ~0 ms
--                                --------
--                                 43,710 ms
--
-- No index can fix that, and the planner is right to ignore the ones we have:
--
--   status | count      ->  OPEN | 5,165,490     (n_distinct = 1)
--   detected_at range   ->  4 days
--
-- Every finding is OPEN and a scan stamps `detected_at` with its own runtime,
-- so `WHERE status = 'OPEN' AND detected_at >= <window>` selects 100% of rows
-- for any window of two days or more. There is nothing to narrow; the only way
-- to make the aggregate cheaper is to aggregate fewer rows.
--
-- Prototyped as a temp table against that live workspace:
--
--   grain                                   rows       size
--   (day, severity, status, detector, src)     739      -- from 5,165,490
--   (day, asset, severity, status)          26,993      3 MB   -- from 5.5 GB
--
--   severity totals      13,750 ms ->   8.2 ms
--   activity 3 counts    11,243 ms ->  19.8 ms   (one query, FILTER)
--   top 50 assets        18,717 ms ->  10.8 ms
--                        ---------     -------
--                         43,710 ms      38.8 ms          ~1,100x
--
-- Values verified identical against the live endpoint: today = 104,817,
-- total = 5,165,490, and the severity buckets reconcile to that total.

-- CreateTable
CREATE TABLE IF NOT EXISTS "finding_stats_daily" (
    "day" DATE NOT NULL,
    "severity" "Severity" NOT NULL,
    "status" "FindingStatus" NOT NULL,
    "detector_type" "DetectorType" NOT NULL,
    "source_id" TEXT NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "finding_stats_daily_pkey" PRIMARY KEY ("day","severity","status","detector_type","source_id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "finding_stats_daily_day_idx" ON "finding_stats_daily"("day");

-- CreateTable
CREATE TABLE IF NOT EXISTS "finding_stats_asset_daily" (
    "day" DATE NOT NULL,
    "asset_id" TEXT NOT NULL,
    "severity" "Severity" NOT NULL,
    "status" "FindingStatus" NOT NULL,
    "count" INTEGER NOT NULL,
    "last_detected_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finding_stats_asset_daily_pkey" PRIMARY KEY ("day","asset_id","severity","status")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "finding_stats_asset_daily_day_idx" ON "finding_stats_asset_daily"("day");

-- CreateTable
CREATE TABLE IF NOT EXISTS "finding_stats_dirty_days" (
    "day" DATE NOT NULL,

    CONSTRAINT "finding_stats_dirty_days_pkey" PRIMARY KEY ("day")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "finding_stats_state" (
    "id" TEXT NOT NULL,
    "refreshed_at" TIMESTAMP(3),
    "duration_ms" INTEGER,
    "total_findings" INTEGER NOT NULL DEFAULT 0,
    "is_built" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finding_stats_state_pkey" PRIMARY KEY ("id")
);

-- The rollup starts empty and unbuilt. The namespace worker schedules the
-- first full build on startup; until it finishes, readers fall back to the
-- live queries rather than reporting zero.
INSERT INTO "finding_stats_state" ("id", "total_findings", "is_built", "updated_at")
VALUES ('singleton', 0, false, NOW())
ON CONFLICT ("id") DO NOTHING;

-- ── Index retirement ────────────────────────────────────────────────────────
--
-- Usage summed across all 16 namespace schemas on the same instance. Only
-- indexes that are provably redundant or provably dead are dropped here; a
-- low scan count on its own is not sufficient evidence, because these counters
-- reset with the server and a cold path is not a dead one.
--
--   index                          scans        size    verdict
--   findings_status_idx            8,627      103 MB    redundant (prefix)
--   findings_asset_id_idx        102,671      509 MB    redundant (prefix)
--   findings_resolved_at_idx           0      960 kB    dead
--
-- 1. findings_status_idx is the leading prefix of
--    findings_status_detected_at_idx, which is present in every schema. Any
--    predicate the narrow index can serve, the composite serves too. It also
--    indexes a column with one distinct value, so it can never narrow a scan.
--
-- 2. findings_asset_id_idx is the leading prefix of
--    findings_asset_id_last_detected_at_idx (232,531 scans) and of
--    findings_asset_id_status_severity_detector_type_finding_type_idx.
--    Scanning the composite costs marginally more I/O per lookup than the
--    narrow index; carrying 509 MB of duplicate index through the buffer cache
--    on an instance whose measured problem is cache starvation costs more.
--
-- 3. findings_resolved_at_idx has zero scans across all 16 schemas and
--    `resolved_at` is NULL for every row, so there is no query to regress.
--
-- Deliberately NOT dropped:
--   findings_matched_content_fts_idx  (0 scans, 783 MB) — the reasoning in
--     20260811100000 still holds: zero scans means the content-search path has
--     not been exercised here, not that it is dead. Dropping it turns every
--     future content search into a sequential scan.
--   findings_severity_idx  (26 scans, 110 MB) — severity has three distinct
--     values, but they are wildly skewed: CRITICAL is 2,242 of 5,165,490
--     (0.04%), and a filtered search on it returns in 121 ms precisely because
--     this index exists.
--   findings_detector_type_idx  (94 scans, 128 MB) — same skew argument.
--   findings_finding_type_idx  (61,134 scans, 140 MB) — genuinely hot. It
--     reads as unused on the largest workspace alone, which is why this
--     decision was made on the totals across every schema rather than on one.

-- DropIndex (redundant: leading prefix of findings_status_detected_at_idx)
DROP INDEX IF EXISTS "findings_status_idx";

-- DropIndex (redundant: leading prefix of findings_asset_id_last_detected_at_idx)
DROP INDEX IF EXISTS "findings_asset_id_idx";

-- DropIndex (dead: 0 scans across all 16 schemas, resolved_at is always NULL)
DROP INDEX IF EXISTS "findings_resolved_at_idx";
