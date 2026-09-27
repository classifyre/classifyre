-- Case clean-up rules and finding filters.
--
-- Three per-case switches that take evidence out of a case by themselves
-- (findings the scans no longer see, findings someone resolved, assets deleted
-- from their source), and filters that keep a kind of finding out of a case —
-- case-wide, or for the answers of one watch only.
--
-- No backfill: every switch defaults to off and no case has a filter, so every
-- existing case behaves exactly as before.

-- ─── Timeline activity types ──────────────────────────────────────────────────
-- `ADD VALUE IF NOT EXISTS` is idempotent and legal inside a transaction as long
-- as the new value is not used in it, so it replays safely across every tenant
-- schema. Nothing below uses these values.
ALTER TYPE "CaseActivityType" ADD VALUE IF NOT EXISTS 'CLEANUP_SETTINGS_UPDATED';
ALTER TYPE "CaseActivityType" ADD VALUE IF NOT EXISTS 'FINDING_FILTER_ADDED';
ALTER TYPE "CaseActivityType" ADD VALUE IF NOT EXISTS 'FINDING_FILTER_UPDATED';
ALTER TYPE "CaseActivityType" ADD VALUE IF NOT EXISTS 'FINDING_FILTER_REMOVED';
ALTER TYPE "CaseActivityType" ADD VALUE IF NOT EXISTS 'FINDINGS_AUTO_REMOVED';
ALTER TYPE "CaseActivityType" ADD VALUE IF NOT EXISTS 'EVIDENCE_AUTO_REMOVED';

-- ─── Enums ────────────────────────────────────────────────────────────────────
CREATE TYPE "CaseFindingFilterKind" AS ENUM ('FINDING_TYPE', 'VALUE_PATTERN');

-- ─── cases: clean-up switches ─────────────────────────────────────────────────
ALTER TABLE "cases"
  ADD COLUMN "remove_gone_findings"     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "remove_resolved_findings" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "remove_gone_assets"       BOOLEAN NOT NULL DEFAULT false;

-- ─── case_finding_filters ─────────────────────────────────────────────────────
CREATE TABLE "case_finding_filters" (
  "id"              TEXT                    NOT NULL,
  "case_id"         TEXT                    NOT NULL,
  "case_inquiry_id" TEXT,
  "kind"            "CaseFindingFilterKind" NOT NULL,
  "pattern"         TEXT                    NOT NULL,
  "description"     TEXT,
  "created_by"      TEXT,
  "created_at"      TIMESTAMP(3)            NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3)            NOT NULL,

  CONSTRAINT "case_finding_filters_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "case_finding_filters_case_id_idx"
  ON "case_finding_filters"("case_id");
CREATE INDEX "case_finding_filters_case_inquiry_id_idx"
  ON "case_finding_filters"("case_inquiry_id");

ALTER TABLE "case_finding_filters"
  ADD CONSTRAINT "case_finding_filters_case_id_fkey"
  FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- A watch's own filters leave with the watch: unlinking deletes the link row.
ALTER TABLE "case_finding_filters"
  ADD CONSTRAINT "case_finding_filters_case_inquiry_id_fkey"
  FOREIGN KEY ("case_inquiry_id") REFERENCES "case_inquiries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
