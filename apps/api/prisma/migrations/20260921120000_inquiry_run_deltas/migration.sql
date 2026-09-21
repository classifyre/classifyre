-- Inquiry run deltas: NEW/GONE derived from the latest run, an inquiry timeline,
-- and per-link auto-pull into cases.
--
-- "New" used to mean "created since the reader last looked" (matches_seen_at),
-- which meant opening an inquiry destroyed its own signal. It now means "created
-- by the latest completed run of its source", so it clears when the corpus moves
-- on rather than when someone reads it. Nothing about that is storable per match
-- — it is recomputed from the run anchor — so no match table appears here.

-- ─── inquiry_activities ───────────────────────────────────────────────────────

CREATE TYPE "InquiryActivityType" AS ENUM (
  'INQUIRY_CREATED', 'MATCHERS_UPDATED', 'STATUS_CHANGED', 'REMATCHED',
  'MATCHES_LANDED', 'MATCHES_RETIRED',
  'CASE_LINKED', 'CASE_UNLINKED', 'PULLED_TO_CASE', 'AUTO_PULLED'
);

CREATE TABLE "inquiry_activities" (
  "id"            TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "inquiry_id"    TEXT        NOT NULL,
  "activity_type" "InquiryActivityType" NOT NULL,
  "actor"         TEXT,
  "payload"       JSONB,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "inquiry_activities_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inquiry_activities_inquiry_id_fkey"
    FOREIGN KEY ("inquiry_id") REFERENCES "inquiries"("id") ON DELETE CASCADE
);

CREATE INDEX "inquiry_activities_inquiry_id_created_at_idx"
  ON "inquiry_activities"("inquiry_id", "created_at" DESC);

-- ─── Counters ─────────────────────────────────────────────────────────────────

ALTER TABLE "inquiries"
  ADD COLUMN "gone_match_count" INTEGER NOT NULL DEFAULT 0;

-- Stored under the old definition ("unseen by the reader"), which is not a valid
-- value under the new one ("landed in the latest run"). Zero is the only honest
-- starting point; the next matching pass recomputes every row from the live set.
UPDATE "inquiries" SET "new_match_count" = 0;

-- ─── Auto-pull ────────────────────────────────────────────────────────────────

ALTER TABLE "case_inquiries"
  ADD COLUMN "auto_pull" BOOLEAN NOT NULL DEFAULT false;

-- ─── Run anchor index ─────────────────────────────────────────────────────────
-- Serves "latest COMPLETED|WARNING run per source" (DISTINCT ON). runners
-- already indexes source_id, status and started_at separately; none of the three
-- can seek this, and source_id alone still sorts every run a source ever had.

CREATE INDEX "runners_source_id_status_started_at_idx"
  ON "runners"("source_id", "status", "started_at" DESC);
