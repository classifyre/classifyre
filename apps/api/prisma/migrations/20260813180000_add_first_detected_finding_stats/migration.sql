-- Mirror the finding rollups on `first_detected_at`, so the findings charts
-- can be served from pre-aggregated rows too.
--
-- 20260813120000 deliberately left the charts endpoint on the live path: its
-- day key is `first_detected_at` ("when was this finding first seen"), not the
-- `detected_at` ("when was it last seen") that the existing rollup buckets by.
-- Serving one from the other would have returned numbers that look right and
-- are not. These tables carry the other key rather than reinterpret the first.
--
-- Measured on the same 5.17M-finding workspace, the charts endpoint took
-- 15.1 s for a 7-day window — the same shape of full-table aggregate, for the
-- same reason: `first_detected_at >= <window>` also matches nearly every row.
--
-- Both tables are populated by the same refresh pass and invalidated by the
-- same dirty-day list, so this adds no new scheduling.

-- CreateTable
CREATE TABLE IF NOT EXISTS "finding_stats_first_daily" (
    "day" DATE NOT NULL,
    "severity" "Severity" NOT NULL,
    "status" "FindingStatus" NOT NULL,
    "detector_type" "DetectorType" NOT NULL,
    "source_id" TEXT NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "finding_stats_first_daily_pkey" PRIMARY KEY ("day","severity","status","detector_type","source_id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "finding_stats_first_daily_day_idx" ON "finding_stats_first_daily"("day");

-- CreateTable
CREATE TABLE IF NOT EXISTS "finding_stats_first_asset_daily" (
    "day" DATE NOT NULL,
    "asset_id" TEXT NOT NULL,
    "severity" "Severity" NOT NULL,
    "status" "FindingStatus" NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "finding_stats_first_asset_daily_pkey" PRIMARY KEY ("day","asset_id","severity","status")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "finding_stats_first_asset_daily_day_idx" ON "finding_stats_first_asset_daily"("day");

-- Force one rebuild on the next boot so the new tables are populated for
-- workspaces whose rollup was already built by the previous migration.
UPDATE "finding_stats_state" SET "is_built" = false WHERE "id" = 'singleton';
