-- Investigation platform: cases, inquiries/queries, evidence graph.
-- Also includes incidental schema-drift fixes that drifted from Prisma's
-- expected state (dropped GIN indexes, timestamp precision, FK re-add, etc.)
--
-- Model overview:
--   Case            the investigation — owns hypotheses + the real, persisted evidence.
--   Inquiry         a saved query/monitor (matchers only); tracks which findings match.
--   InquiryMatch    lightweight tracker (findingId + matchedAt) for "N matches, M new".
--   CaseEvidence    an observed node (asset|sandbox) pulled into a case (denormalized snapshot).
--   CaseFinding     an inferred observation on a piece of evidence (no FK to findings; snapshot).
--   Hypothesis      a possible answer; HypothesisSupport links it to evidence/findings with a stance.
--   Edge            generic directed relationship between graph entities (asset/finding/…).
--   CaseNote        free-form notes on a case.

-- ─── Schema-drift fixes ──────────────────────────────────────────

-- DropForeignKey
ALTER TABLE "custom_detector_training_examples" DROP CONSTRAINT "custom_detector_training_examples_custom_detector_id_fkey";

-- DropIndex (GIN indexes Prisma no longer generates)
DROP INDEX IF EXISTS "assets_metadata_idx";
DROP INDEX IF EXISTS "custom_detector_extractions_pipeline_result_gin_idx";
DROP INDEX IF EXISTS "findings_metadata_idx";
DROP INDEX IF EXISTS "runner_assets_metadata_idx";

-- AlterTable: asset_type no longer has a DB-level default (Prisma drives the value)
ALTER TABLE "assets" ALTER COLUMN "asset_type" DROP DEFAULT;

-- AlterTable: align timestamp precision on custom_detector_extractions
ALTER TABLE "custom_detector_extractions"
    ALTER COLUMN "extracted_at" SET DATA TYPE TIMESTAMP(3),
    ALTER COLUMN "created_at"   SET DATA TYPE TIMESTAMP(3);

-- AlterTable: training examples id/created_at alignment
ALTER TABLE "custom_detector_training_examples"
    ALTER COLUMN "id"         DROP DEFAULT,
    ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable: mcp_access_tokens.updated_at no longer carries a DB default
ALTER TABLE "mcp_access_tokens" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable: schedule_timezone is nullable in schema (String? @default("UTC"))
ALTER TABLE "sources" ALTER COLUMN "schedule_timezone" DROP NOT NULL;

-- AddForeignKey (re-add after the DROP above)
ALTER TABLE "custom_detector_training_examples"
    ADD CONSTRAINT "custom_detector_training_examples_custom_detector_id_fkey"
    FOREIGN KEY ("custom_detector_id") REFERENCES "custom_detectors"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex (IF EXISTS: only needed on DBs where the index drifted to the _id suffix;
-- fresh DBs already have the correct _idx name from 20260213230000_assets_with_findings_indexes)
ALTER INDEX IF EXISTS "findings_asset_id_status_severity_detector_type_finding_type_id"
    RENAME TO "findings_asset_id_status_severity_detector_type_finding_typ_idx";

-- ─── Enums ───────────────────────────────────────────────────────

CREATE TYPE "EdgeOrigin"      AS ENUM ('SOURCE_DERIVED', 'INFERRED', 'MANUAL');
CREATE TYPE "CaseStatus"      AS ENUM ('OPEN', 'IN_PROGRESS', 'CLOSED', 'ARCHIVED');
CREATE TYPE "HypothesisStatus" AS ENUM ('PROPOSED', 'SUPPORTED', 'REFUTED', 'INCONCLUSIVE');
CREATE TYPE "EvidenceStance"  AS ENUM ('SUPPORTS', 'CONTRADICTS', 'NEUTRAL');
CREATE TYPE "InquiryStatus"  AS ENUM ('ACTIVE', 'ARCHIVED');

-- ─── Graph edges ─────────────────────────────────────────────────

CREATE TABLE "edges" (
    "id"            TEXT          NOT NULL,
    "from_type"     TEXT          NOT NULL,
    "from_id"       TEXT          NOT NULL,
    "to_type"       TEXT          NOT NULL,
    "to_id"         TEXT          NOT NULL,
    "relation_type" TEXT          NOT NULL,
    "confidence"    DECIMAL(3,2)  NOT NULL DEFAULT 1.00,
    "origin"        "EdgeOrigin"  NOT NULL DEFAULT 'INFERRED',
    "metadata"      JSONB,
    "created_at"    TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "edges_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "edges_from_type_from_id_to_type_to_id_relation_type_key"
    ON "edges"("from_type", "from_id", "to_type", "to_id", "relation_type");
CREATE INDEX "edges_from_type_from_id_idx"  ON "edges"("from_type", "from_id");
CREATE INDEX "edges_to_type_to_id_idx"      ON "edges"("to_type",   "to_id");
CREATE INDEX "edges_relation_type_idx"      ON "edges"("relation_type");

-- ─── Case (the investigation) ────────────────────────────────────

CREATE TABLE "cases" (
    "id"          TEXT          NOT NULL,
    "title"       TEXT          NOT NULL,
    "description" TEXT,
    "status"      "CaseStatus"  NOT NULL DEFAULT 'OPEN',
    "severity"    "Severity"    NOT NULL DEFAULT 'MEDIUM',
    "assignee"    TEXT,
    "created_by"  TEXT,
    "conclusion"  TEXT,
    "created_at"  TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMP(3)  NOT NULL,
    CONSTRAINT "cases_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "cases_status_idx"     ON "cases"("status");
CREATE INDEX "cases_severity_idx"   ON "cases"("severity");
CREATE INDEX "cases_created_at_idx" ON "cases"("created_at");

-- ─── Inquiry (a saved query / monitor) ───────────────────────────

CREATE TABLE "inquiries" (
    "id"                   TEXT             NOT NULL,
    "case_id"              TEXT,
    "title"                TEXT             NOT NULL,
    "description"          TEXT,
    "status"               "InquiryStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by"           TEXT,
    "match_all_sources"    BOOLEAN          NOT NULL DEFAULT false,
    "source_ids"           TEXT[],
    "detector_types"       "DetectorType"[],
    "custom_detector_keys" TEXT[],
    "finding_types"        TEXT[],
    "finding_type_regex"   TEXT[],
    "finding_value_regex"  TEXT[],
    "matches_seen_at"      TIMESTAMP(3),
    "created_at"           TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"           TIMESTAMP(3)     NOT NULL,
    CONSTRAINT "inquiries_pkey"        PRIMARY KEY ("id"),
    CONSTRAINT "inquiries_case_id_fkey" FOREIGN KEY ("case_id")
        REFERENCES "cases"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "inquiries_case_id_idx" ON "inquiries"("case_id");
CREATE INDEX "inquiries_status_idx"  ON "inquiries"("status");

-- ─── InquiryMatch (lightweight match tracker) ────────────────────

CREATE TABLE "inquiry_matches" (
    "id"          TEXT         NOT NULL,
    "inquiry_id"  TEXT         NOT NULL,
    "finding_id"  TEXT         NOT NULL,
    "matched_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inquiry_matches_pkey"        PRIMARY KEY ("id"),
    CONSTRAINT "inquiry_matches_inquiry_id_fkey" FOREIGN KEY ("inquiry_id")
        REFERENCES "inquiries"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "inquiry_matches_inquiry_id_finding_id_key"
    ON "inquiry_matches"("inquiry_id", "finding_id");
CREATE INDEX "inquiry_matches_inquiry_id_matched_at_idx"
    ON "inquiry_matches"("inquiry_id", "matched_at");

-- ─── CaseEvidence (observed node on a case) ──────────────────────

CREATE TABLE "case_evidence" (
    "id"          TEXT         NOT NULL,
    "case_id"     TEXT         NOT NULL,
    "entity_type" TEXT         NOT NULL,
    "entity_id"   TEXT         NOT NULL,
    "label"       TEXT,
    "asset_type"  TEXT,
    "source_type" TEXT,
    "note"        TEXT,
    "added_by"    TEXT,
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "case_evidence_pkey"        PRIMARY KEY ("id"),
    CONSTRAINT "case_evidence_case_id_fkey" FOREIGN KEY ("case_id")
        REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "case_evidence_case_id_entity_type_entity_id_key"
    ON "case_evidence"("case_id", "entity_type", "entity_id");
CREATE INDEX "case_evidence_case_id_idx"              ON "case_evidence"("case_id");
CREATE INDEX "case_evidence_entity_type_entity_id_idx" ON "case_evidence"("entity_type", "entity_id");

-- ─── CaseFinding (inferred observation on evidence) ──────────────

CREATE TABLE "case_findings" (
    "id"                   TEXT         NOT NULL,
    "case_id"              TEXT         NOT NULL,
    "case_evidence_id"     TEXT         NOT NULL,
    "finding_id"           TEXT         NOT NULL,
    "label"                TEXT         NOT NULL,
    "severity"             TEXT,
    "detector_type"        TEXT,
    "custom_detector_name" TEXT,
    "matched_content"      TEXT,
    "note"                 TEXT,
    "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "case_findings_pkey"              PRIMARY KEY ("id"),
    CONSTRAINT "case_findings_case_id_fkey"       FOREIGN KEY ("case_id")
        REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "case_findings_case_evidence_id_fkey" FOREIGN KEY ("case_evidence_id")
        REFERENCES "case_evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "case_findings_case_id_finding_id_key"
    ON "case_findings"("case_id", "finding_id");
CREATE INDEX "case_findings_case_id_idx"          ON "case_findings"("case_id");
CREATE INDEX "case_findings_case_evidence_id_idx" ON "case_findings"("case_evidence_id");

-- ─── Hypotheses ──────────────────────────────────────────────────

CREATE TABLE "case_hypotheses" (
    "id"         TEXT               NOT NULL,
    "case_id"    TEXT               NOT NULL,
    "statement"  TEXT               NOT NULL,
    "status"     "HypothesisStatus" NOT NULL DEFAULT 'PROPOSED',
    "confidence" DECIMAL(3,2),
    "color"      TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3)       NOT NULL,
    CONSTRAINT "case_hypotheses_pkey"        PRIMARY KEY ("id"),
    CONSTRAINT "case_hypotheses_case_id_fkey" FOREIGN KEY ("case_id")
        REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "case_hypotheses_case_id_idx" ON "case_hypotheses"("case_id");

-- ─── Hypothesis support (polymorphic link to evidence/finding) ───

CREATE TABLE "hypothesis_support" (
    "id"            TEXT             NOT NULL,
    "hypothesis_id" TEXT             NOT NULL,
    "target_type"   TEXT             NOT NULL,
    "target_id"     TEXT             NOT NULL,
    "stance"        "EvidenceStance" NOT NULL DEFAULT 'SUPPORTS',
    "weight"        DECIMAL(3,2),
    "note"          TEXT,
    "created_at"    TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "hypothesis_support_pkey"             PRIMARY KEY ("id"),
    CONSTRAINT "hypothesis_support_hypothesis_id_fkey" FOREIGN KEY ("hypothesis_id")
        REFERENCES "case_hypotheses"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "hypothesis_support_hypothesis_id_target_type_target_id_key"
    ON "hypothesis_support"("hypothesis_id", "target_type", "target_id");
CREATE INDEX "hypothesis_support_hypothesis_id_idx"          ON "hypothesis_support"("hypothesis_id");
CREATE INDEX "hypothesis_support_target_type_target_id_idx"  ON "hypothesis_support"("target_type", "target_id");

-- ─── Case notes ──────────────────────────────────────────────────

CREATE TABLE "case_notes" (
    "id"         TEXT         NOT NULL,
    "case_id"    TEXT         NOT NULL,
    "body"       TEXT         NOT NULL,
    "author"     TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "case_notes_pkey"        PRIMARY KEY ("id"),
    CONSTRAINT "case_notes_case_id_fkey" FOREIGN KEY ("case_id")
        REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "case_notes_case_id_idx" ON "case_notes"("case_id");
